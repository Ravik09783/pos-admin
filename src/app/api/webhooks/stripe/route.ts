import { NextResponse } from "next/server"
import crypto from "node:crypto"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { logError, logInfo, logWarn } from "@/lib/errors"
import { sendPushToTenant } from "@/lib/notifications/push"
import { findTierByPriceId, toDbLimit } from "@/lib/billing/plans"

type ServiceClient = ReturnType<typeof createServiceRoleClient>

/**
 * Stripe webhook endpoint. Configure in Stripe dashboard:
 *   https://your-domain.com/api/webhooks/stripe
 *
 * Required env: STRIPE_WEBHOOK_SECRET
 *
 * Verifies the signature without the Stripe SDK (manual HMAC) so we don't
 * pull in the full SDK for one webhook.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EVENTS HANDLED — enable each one in the Stripe dashboard's webhook
 * endpoint config. Anything not listed here returns `{ ok, ignored }`
 * (the dedup row still records it for audit).
 *
 *   ▸ POS bill payments (customers paying for a bill via card / Apple Pay /
 *     Google Pay through Connect)
 *     - payment_intent.succeeded            → record payment, flip bill PAID
 *     - checkout.session.completed          → same path; redundant safety net
 *     - payment_intent.payment_failed       → audit-log the decline; bill stays GENERATED
 *     - charge.refunded                     → negative payment row; VOID if fully refunded
 *     - charge.dispute.created              → audit-log + push, "submit evidence by X"
 *     - charge.dispute.closed               → audit-log dispute outcome
 *
 *   ▸ Stripe Connect (restaurant's own acct_* — KYC, payouts, deauth)
 *     - account.updated                     → mirror charges/payouts/details flags to tenant_payment_gateways
 *     - account.application.deauthorized    → flip stripe_account_enabled=false
 *     - payout.paid                         → cache last-payout summary
 *     - payout.failed                       → cache + push "fix your bank info"
 *
 *   ▸ SaaS subscription (platform billing the restaurant for using RestoPOS)
 *     - customer.subscription.created       → mirror status + tier to tenants
 *     - customer.subscription.updated       → same; covers tier swaps & cancellations-at-period-end
 *     - customer.subscription.deleted       → flip subscription_status=CANCELED, push notice
 *     - customer.subscription.trial_will_end → 3-day pre-trial-end nag (suppressed if card on file)
 *     - invoice.payment_succeeded           → ACTIVE; "back online" push if previously not ACTIVE
 *     - invoice.payment_failed              → PAST_DUE; push "update card before retry"
 *     - invoice.upcoming                    → ~7 days before charge; push "make sure card has balance"
 *
 * All events are deduped on event.id via the stripe_webhook_events table
 * (PRIMARY KEY = stripe_event_id), so Stripe's retry-on-5xx behavior is
 * safe — re-deliveries return `{ ok, deduped }` without re-running the
 * handler.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function POST(req: Request) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET
    if (!secret) {
        return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 })
    }

    const body = await req.text()
    const sigHeader = req.headers.get("stripe-signature") ?? ""

    // Header format: "t=timestamp,v1=signature[,v0=...]"
    const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")))
    const timestamp = parts["t"]
    const signature = parts["v1"]
    if (!timestamp || !signature) return NextResponse.json({ error: "Bad signature header" }, { status: 401 })

    const payload = `${timestamp}.${body}`
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex")
    const ok = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    if (!ok) return NextResponse.json({ error: "Invalid signature" }, { status: 401 })

    // Stripe shapes:
    //  - payment_intent.succeeded → PaymentIntent object (has application_fee_amount, latest_charge, transfer_data)
    //  - checkout.session.completed → Session object (lighter; we mainly use the PI event)
    //  - charge.refunded → Charge object (refunds.data[] populated; record negative payment + void bill if fully refunded)
    interface StripeMeta { bill_id?: string; tenant_id?: string; platform_fee?: string; connected_account?: string }
    interface StripeRefund { id: string; amount: number; status?: string }
    const event = JSON.parse(body) as {
        /** Event id, e.g. evt_*. Used for idempotency. */
        id: string
        type: string
        /** For Connect events, top-level `account` is the acct_* the event
         *  pertains to. For platform events (Checkout, PaymentIntent on
         *  the platform itself) this is absent. */
        account?: string
        data: {
            object: {
                id: string
                amount?: number                 // PaymentIntent / Charge / Payout
                amount_total?: number           // Checkout Session
                amount_refunded?: number        // Charge (on charge.refunded)
                arrival_date?: number           // Payout
                currency?: string
                status?: string                 // Payout / Account / Dispute
                metadata?: StripeMeta
                application_fee_amount?: number // PaymentIntent.application_fee_amount
                latest_charge?: string          // PaymentIntent
                transfer_data?: { destination?: string }
                payment_intent?: string         // Session OR Charge → parent PaymentIntent
                refunds?: { data?: StripeRefund[] } // Charge.refunded
                // ── Account-updated shape
                charges_enabled?: boolean
                payouts_enabled?: boolean
                details_submitted?: boolean
                country?: string
                requirements?: Record<string, unknown>
                // ── Payout shape
                failure_message?: string | null
                // ── Subscription shape
                customer?: string                     // cus_*
                subscription?: string                 // sub_* (on invoice)
                current_period_end?: number           // unix ts
                cancel_at_period_end?: boolean
                items?: { data?: Array<{ price?: { id?: string } }> }
                trial_end?: number                    // sub.trial_end (unix)
                // ── Invoice shape
                amount_paid?: number
                amount_due?: number
                hosted_invoice_url?: string
                attempt_count?: number
                next_payment_attempt?: number | null
                // ── Dispute shape
                reason?: string
                evidence_due_by?: number
                charge?: string                       // ch_* (parent charge)
                // ── PaymentIntent.payment_failed
                last_payment_error?: { message?: string; code?: string }
            }
        }
    }

    const supabase = createServiceRoleClient()

    // ---- Idempotency ----
    // Stripe redelivers events on 5xx OR when our 2xx ack didn't reach
    // them in time. Without dedup, payment_intent.succeeded would mark
    // the bill PAID twice, fire two push notifications, etc. We record
    // every event id we've seen; duplicates ack immediately with no work.
    //
    // We INSERT first (failing if it already exists) so the dedup is
    // race-safe even if Stripe fires two parallel deliveries. The
    // stripe_webhook_events table has stripe_event_id as PRIMARY KEY,
    // so a re-insert raises a unique-violation we can detect.
    if (event.id) {
        const { error: dupErr } = await supabase
            .from("stripe_webhook_events")
            .insert({
                stripe_event_id: event.id,
                event_type: event.type,
            } as never)
        if (dupErr) {
            // Unique-violation code on PK → we've already seen this event.
            if ((dupErr as { code?: string }).code === "23505") {
                return NextResponse.json({ ok: true, deduped: event.id })
            }
            // Some other DB error — log it but PROCESS the event anyway.
            // Better to risk a double-process than drop revenue events
            // because of an unrelated DB hiccup.
            logWarn("stripe_webhook_events insert failed", { eventId: event.id, error: dupErr.message })
        }
    }

    // After the handler returns, we mark the event processed_at = now()
    // so the dedup table doubles as an audit log. Wrap the per-event
    // handler dispatch so we can do this in one place.
    const dispatch = await dispatchStripeEvent(event, supabase)
    if (event.id) {
        await supabase
            .from("stripe_webhook_events")
            .update({ processed_at: new Date().toISOString() } as never)
            .eq("stripe_event_id", event.id)
    }
    return dispatch
}

/** Per-event dispatch. Pulled out so the idempotency wrapper above can
 *  stamp processed_at after the handler finishes. The function returns
 *  the same NextResponse the original inline code returned.
 *
 *  We re-declare the inner shapes here so this function is self-contained
 *  rather than passing an implicit any from the JSON.parse cast above. */
interface StripeMeta { bill_id?: string; tenant_id?: string; platform_fee?: string; connected_account?: string }
interface StripeRefund { id: string; amount: number; status?: string }
interface StripeEventObject {
    id: string
    amount?: number
    amount_total?: number
    amount_refunded?: number
    arrival_date?: number
    currency?: string
    status?: string
    metadata?: StripeMeta
    application_fee_amount?: number
    latest_charge?: string
    transfer_data?: { destination?: string }
    payment_intent?: string
    refunds?: { data?: StripeRefund[] }
    charges_enabled?: boolean
    payouts_enabled?: boolean
    details_submitted?: boolean
    country?: string
    requirements?: Record<string, unknown>
    failure_message?: string | null
    customer?: string
    subscription?: string
    current_period_end?: number
    cancel_at_period_end?: boolean
    items?: { data?: Array<{ price?: { id?: string } }> }
    trial_end?: number
    amount_paid?: number
    amount_due?: number
    hosted_invoice_url?: string
    attempt_count?: number
    next_payment_attempt?: number | null
    reason?: string
    evidence_due_by?: number
    charge?: string
    last_payment_error?: { message?: string; code?: string }
}
interface StripeEvent {
    id: string
    type: string
    account?: string
    data: { object: StripeEventObject }
}

async function dispatchStripeEvent(
    event: StripeEvent,
    supabase: ServiceClient,
): Promise<NextResponse> {
    // ---- Connect account / payout events ----
    // These don't touch bills — they're about the restaurant's Stripe
    // account itself (KYC progress, payouts to their bank). We update
    // tenant_payment_gateways so the settings UI shows real-time status
    // without polling Stripe.
    if (event.type === "account.updated") {
        return await handleAccountUpdated(event.data.object, supabase)
    }
    if (event.type === "payout.paid" || event.type === "payout.failed") {
        return await handlePayoutEvent(event.type, event.data.object, event.account ?? null, supabase)
    }

    // ---- Platform-side SaaS subscription events ----
    //
    // These fire on OUR Stripe account (not a connected account), so
    // event.account is undefined. They drive tenants.subscription_status
    // so the dashboard banner + generate_bill gate know what's true.
    //
    // We only act on these when event.account is missing — otherwise
    // they'd be from a connected account (which doesn't run subs in
    // our model, but defensive guard either way).
    if (!event.account && (
        event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted"
    )) {
        return await handleSubscriptionEvent(event.type, event.data.object, supabase)
    }
    if (!event.account && (
        event.type === "invoice.payment_succeeded" ||
        event.type === "invoice.payment_failed"
    )) {
        return await handleInvoiceEvent(event.type, event.data.object, supabase)
    }

    // ---- Refund branch ----
    // Stripe fires charge.refunded for both full and partial refunds. We
    // book a negative `payments` row keyed on the refund.id (idempotent
    // on replay) and, if the net paid drops to ~0, void the bill so the
    // books reflect that the customer was made whole.
    if (event.type === "charge.refunded") {
        return await handleStripeRefund(event.data.object, supabase)
    }

    // ---- Dispute branch ----
    // A customer filed a chargeback against a card payment. Restaurant
    // needs to know immediately so they can submit evidence inside the
    // dispute window (usually 7-21 days). Push notification + a row in
    // the bill_audit_log so it shows up in the bill detail audit.
    if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") {
        return await handleDisputeEvent(event.type, event.data.object, event.account ?? null, supabase)
    }

    // ---- Trial-ending reminder ----
    // Stripe fires trial_will_end 3 days before the trial ends. We push
    // a "your trial ends on X, add a card now" notification so the OWNER
    // isn't surprised by SUSPENDED status the morning after.
    if (!event.account && event.type === "customer.subscription.trial_will_end") {
        return await handleTrialWillEnd(event.data.object, supabase)
    }

    // ---- Connect deauthorization ----
    // The restaurant disconnected our Stripe Connect app from their
    // Stripe dashboard. Their acct_* is no longer usable; we flip
    // stripe_account_enabled = false so /api/payments/stripe/create
    // returns the clear "Stripe disconnected" error instead of a generic
    // Stripe rejection.
    if (event.type === "account.application.deauthorized" && event.account) {
        return await handleConnectDeauthorized(event.account, supabase)
    }

    // ---- Upcoming-invoice reminder ----
    // Fires ~7 days before the next subscription invoice is charged.
    // The push notification gives the OWNER lead time to make sure their
    // card has funds. Exactly what your spec called for ("keep balance
    // on ___ date").
    if (!event.account && event.type === "invoice.upcoming") {
        return await handleInvoiceUpcoming(event.data.object, supabase)
    }

    // ---- Customer-side payment failure ----
    // Their card was declined on a Stripe Checkout for a bill (not the
    // SaaS sub). Log it so the cashier sees the attempt in audit if they
    // need to investigate. Doesn't change bill status — bill is still
    // GENERATED and waiting for a successful payment.
    if (event.type === "payment_intent.payment_failed" && event.data.object.metadata?.bill_id) {
        return await handlePaymentIntentFailed(event.data.object, supabase)
    }

    if (!event.type.startsWith("payment_intent.succeeded") && !event.type.startsWith("checkout.session.completed")) {
        return NextResponse.json({ ok: true, ignored: event.type })
    }

    const intent = event.data.object

    // Three paths land here:
    //   1. POS bill payment        → metadata.bill_id present, bill exists
    //   2. QR-customer order       → metadata.order_id present, awaiting_confirmation=true
    //   3. Cashier display checkout→ metadata.display_session_id + order_id
    //                                present, generic order (not QR)
    let billId = intent.metadata?.bill_id ?? null
    const orderIdFromMeta = (intent.metadata as { order_id?: string } | undefined)?.order_id ?? null
    const displaySessionIdFromMeta =
        (intent.metadata as { display_session_id?: string } | undefined)?.display_session_id ?? null

    // ── Path 3: cashier-display Stripe Checkout ─────────────────────
    // Atomically generates the bill via a system-level RPC, records
    // the STRIPE payment, and flips the display session to PAID so
    // the customer's tablet shows the "Thank you" screen.
    if (!billId && displaySessionIdFromMeta && orderIdFromMeta) {
        const grossPaise = intent.amount ?? intent.amount_total ?? 0
        const feePaise = intent.application_fee_amount
            ?? Number(intent.metadata?.platform_fee ?? "0")
            ?? 0
        const { data: confirmed, error: confErr } = await supabase.rpc(
            "confirm_display_checkout_payment" as never,
            {
                p_order_id: orderIdFromMeta,
                p_display_session_id: displaySessionIdFromMeta,
                p_stripe_intent_id: intent.id,
                p_gross_amount: grossPaise / 100,
                p_platform_fee: feePaise / 100,
                p_currency: (intent.currency ?? "usd").toUpperCase(),
            } as never,
        )
        if (confErr) {
            logError(confErr, {
                route: "/api/webhooks/stripe",
                step: "confirm_display_checkout_payment",
                orderId: orderIdFromMeta,
                displaySessionId: displaySessionIdFromMeta,
            })
            return NextResponse.json({ error: confErr.message }, { status: 500 })
        }
        // Drop the public-bill cache so the customer's /b/:slug/:invoice
        // page reflects PAID immediately.
        const { revalidateTag } = await import("next/cache")
        revalidateTag("public-bill", "max")
        return NextResponse.json({
            ok: true,
            flow: "cashier_display",
            bill_id: (confirmed as { bill_id?: string } | null)?.bill_id ?? null,
        })
    }

    if (!billId && orderIdFromMeta) {
        // QR-ordering path. Confirm the order + auto-generate the bill,
        // then record the payment against the new bill. Same RPC the
        // Paytm webhook uses for its QR-order handling.
        const { data: order } = await supabase
            .from("orders")
            .select("id, awaiting_confirmation, tenant_id, table_id")
            .eq("id", orderIdFromMeta).maybeSingle()
        const o = order as { id: string; awaiting_confirmation?: boolean; tenant_id: string; table_id?: string | null } | null
        if (o?.awaiting_confirmation) {
            const grossPaise = intent.amount ?? intent.amount_total ?? 0
            const { data, error } = await supabase.rpc("confirm_qr_order_system" as never, {
                p_order_id: o.id,
                p_razorpay_payment_id: intent.id,   // RPC param is named for legacy; we pass the Stripe intent id
                p_amount: grossPaise / 100,
            } as never)
            if (error) throw error
            // RPC returns the new bill_id; the payment-row insert below
            // attaches the gross/fee breakdown to it.
            const r = data as { bill_id?: string } | null
            billId = r?.bill_id ?? null
            // Fire Web Push to every staff device for this tenant.
            // Best-effort: never block the webhook on push success.
            void fireQrPush(o.tenant_id, o.table_id ?? null, grossPaise / 100, billId, supabase)
        }
        if (!billId) {
            // Order may already be confirmed (idempotent replay) — fetch
            // the bill that was created for this order.
            const { data: existingBill } = await supabase
                .from("bills").select("id").eq("order_id", orderIdFromMeta).maybeSingle()
            billId = (existingBill as { id?: string } | null)?.id ?? null
        }
    }

    if (!billId) return NextResponse.json({ ok: true, ignored: "no bill_id" })

    // Idempotency: Stripe redelivers webhooks on failure. The intent.id is
    // stable per payment, so check for an existing row before inserting —
    // otherwise a retry doubles up the recorded amount and we mis-mark the
    // bill PAID for half the value or worse.
    const { data: existing } = await supabase
        .from("payments")
        .select("id")
        .eq("bill_id", billId)
        .eq("reference", intent.id)
        .maybeSingle()
    if (existing) return NextResponse.json({ ok: true, idempotent: true })

    const { data: bill, error: billErr } = await supabase
        .from("bills").select("tenant_id, order_id, grand_total, bill_status").eq("id", billId).maybeSingle()
    if (billErr) {
        logError(billErr, { route: "/api/webhooks/stripe", billId })
        return NextResponse.json({ error: "db error" }, { status: 500 })
    }
    if (!bill) return NextResponse.json({ error: "bill not found" }, { status: 404 })
    const b = bill as { tenant_id: string; order_id: string; grand_total: number; bill_status: string }

    // Refuse to record a payment against a voided bill — that'd corrupt
    // the books and reopen a closed audit trail. Return 200 so Stripe
    // stops retrying; we log it for the operator.
    if (b.bill_status === "VOID") {
        logWarn("Stripe payment for VOID bill — ignored", { billId, paymentIntent: intent.id })
        return NextResponse.json({ ok: true, ignored: "bill_voided" })
    }

    // Money-flow breakdown for the payments row. With Stripe Connect
    // destination charges:
    //   - intent.amount             = gross (what customer paid)
    //   - intent.application_fee_amount = platform's cut (1% by default)
    //   - Stripe's own processing fee is invisible to the API at this point
    //     (it shows up later on the balance transaction). We can only
    //     record gross − application_fee_amount as "money in connected
    //     account before Stripe's processing fee" — which is the
    //     highest-confidence number we have without polling balance txns.
    //   - The actual restaurant-received amount = gross − stripe_fee −
    //     application_fee, surfaced in the balance txn (handled later
    //     via `charge.balance_transaction.updated` if needed).
    const grossPaise = intent.amount ?? intent.amount_total ?? 0
    const feePaise   = intent.application_fee_amount
        ?? Number(intent.metadata?.platform_fee ?? "0")
        ?? 0
    const transferredPaise = Math.max(0, grossPaise - feePaise)

    const { error: insertErr } = await supabase.from("payments").insert({
        tenant_id: b.tenant_id,
        bill_id: billId,
        method: "STRIPE",
        // `amount` = restaurant earnings (gross − platform fee, ignoring
        // Stripe's own processing fee which is unknown until balance txn).
        amount: transferredPaise / 100,
        reference: intent.id,
        gross_amount: grossPaise / 100,
        platform_fee: feePaise / 100,
        transferred_amount: transferredPaise / 100,
        stripe_payment_intent_id: intent.id,
        stripe_charge_id: intent.latest_charge ?? null,
        metadata: intent.transfer_data?.destination
            ? { connected_account: intent.transfer_data.destination }
            : intent.metadata?.connected_account
                ? { connected_account: intent.metadata.connected_account }
                : null,
    } as never)
    if (insertErr) {
        // If a concurrent retry beat us to the insert and there's a uniqueness
        // constraint, that's actually fine — treat as idempotent success.
        if (insertErr.code === "23505") return NextResponse.json({ ok: true, idempotent: true })
        logError(insertErr, { route: "/api/webhooks/stripe", billId, paymentIntent: intent.id })
        return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    // CRITICAL: a DB error here would yield totalPaid=0 and we'd never
    // flip the bill to PAID. Return 500 so Stripe redelivers instead of
    // us silently dropping a captured payment.
    const { data: pays, error: paysErr } = await supabase.from("payments").select("amount").eq("bill_id", billId)
    if (paysErr) {
        logError(paysErr, { route: "/api/webhooks/stripe", billId })
        return NextResponse.json({ error: "db error" }, { status: 500 })
    }
    const totalPaid = (pays ?? []).reduce((s, p) => s + Number((p as { amount: number }).amount), 0)
    if (totalPaid >= Number(b.grand_total) && b.bill_status !== "PAID") {
        await supabase.from("bills").update({ bill_status: "PAID" } as never).eq("id", billId)
        await supabase.from("orders").update({ status: "PAID", paid_at: new Date().toISOString() } as never).eq("id", b.order_id)
        // Invalidate the public bill cache so the customer's /b/:slug/:invoice
        // page reflects PAID immediately on the next refresh instead of
        // waiting out the unstable_cache TTL. Next 16 requires a second
        // `profile` argument on revalidateTag; "max" wipes the entry fully.
        const { revalidateTag } = await import("next/cache")
        revalidateTag("public-bill", "max")
    }

    return NextResponse.json({ ok: true })
}

/** Best-effort Web Push fan-out for a freshly-confirmed QR order.
 *  Errors here must not affect the webhook's ACK to Stripe. */
async function fireQrPush(
    tenantId: string,
    tableId: string | null,
    amount: number,
    billId: string | null,
    supabase: ServiceClient,
) {
    try {
        let tableNumber: string | null = null
        if (tableId) {
            const { data } = await supabase
                .from("dining_tables").select("number").eq("id", tableId).maybeSingle()
            tableNumber = (data as { number?: string } | null)?.number ?? null
        }
        const title = tableNumber ? `🛎️ New QR order — Table ${tableNumber}` : "🛎️ New QR order"
        // Currency symbol unknown at the SW layer; the body is intentionally
        // generic so it works for INR / USD / GBP tenants alike.
        const body = `${amount.toFixed(2)} paid · ready for the kitchen`
        await sendPushToTenant(tenantId, {
            title,
            body,
            tag: `qr-${billId ?? tenantId}-${Date.now()}`,
            url: billId ? `/bills/${billId}` : "/dashboard",
        })
    } catch (e) {
        logWarn("Web Push fan-out failed (Stripe)", { tenantId, error: (e as Error).message })
    }
}

/**
 * Handle Stripe `charge.refunded`. The event payload is a Charge with
 * `refunds.data[]` populated; we look at the most recent refund (the one
 * that triggered the event), find the matching original payment row via
 * `stripe_charge_id` or `stripe_payment_intent_id`, and:
 *   1. Skip if we've already booked this refund (idempotent on refund.id).
 *   2. Insert a negative `payments` row so the bill's net paid drops.
 *   3. If net paid ≤ 0, flip the bill to VOID and log a system audit row.
 *
 * Returns 200 with `ignored: ...` for soft failures so Stripe stops
 * retrying; throws (→ 500) for DB errors so Stripe redelivers.
 */
async function handleStripeRefund(
    charge: {
        id: string
        payment_intent?: string
        refunds?: { data?: Array<{ id: string; amount: number; status?: string }> }
        amount_refunded?: number
    },
    supabase: ServiceClient,
) {
    const refundList = charge.refunds?.data ?? []
    if (refundList.length === 0) {
        // Defensive: shouldn't happen on charge.refunded, but bail gracefully.
        logWarn("Stripe charge.refunded with empty refunds.data", { chargeId: charge.id })
        return NextResponse.json({ ok: true, ignored: "no_refund_in_payload" })
    }
    // Stripe puts the most recent refund first in the array; use that.
    const refund = refundList[0]!

    // Find the original payment by charge id first (most specific), then
    // by payment_intent id as a fallback. Both are stamped at success time.
    let original = await supabase
        .from("payments")
        .select("id, tenant_id, bill_id, amount")
        .eq("stripe_charge_id", charge.id)
        .maybeSingle()
    if (!original.data && charge.payment_intent) {
        original = await supabase
            .from("payments")
            .select("id, tenant_id, bill_id, amount")
            .eq("stripe_payment_intent_id", charge.payment_intent)
            .maybeSingle()
    }
    if (!original.data) {
        logWarn("Stripe refund: original payment not found", { chargeId: charge.id, paymentIntent: charge.payment_intent })
        return NextResponse.json({ ok: true, ignored: "original_payment_not_found" })
    }
    const p = original.data as { id: string; tenant_id: string; bill_id: string; amount: number }

    // Idempotency: refund.id is stable per refund; if we've already booked
    // it (Stripe redelivery), no-op.
    const { data: existing } = await supabase
        .from("payments")
        .select("id")
        .eq("bill_id", p.bill_id)
        .eq("reference", refund.id)
        .maybeSingle()
    if (existing) return NextResponse.json({ ok: true, idempotent: true })

    const { error: insertErr } = await supabase.from("payments").insert({
        tenant_id: p.tenant_id,
        bill_id: p.bill_id,
        method: "STRIPE",
        amount: -(refund.amount / 100),
        reference: refund.id,
        stripe_charge_id: charge.id,
        stripe_payment_intent_id: charge.payment_intent ?? null,
        metadata: { type: "refund", refund_status: refund.status ?? null } as never,
    } as never)
    if (insertErr) {
        if ((insertErr as { code?: string }).code === "23505") {
            return NextResponse.json({ ok: true, idempotent: true })
        }
        logError(insertErr, { route: "/api/webhooks/stripe", refundId: refund.id, billId: p.bill_id })
        return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    // Recompute net paid. A DB error here would falsely show 0 paid and
    // wrongly void a still-paid bill — bail loud so Stripe redelivers.
    const { data: pays, error: paysErr } = await supabase
        .from("payments").select("amount").eq("bill_id", p.bill_id)
    if (paysErr) {
        logError(paysErr, { route: "/api/webhooks/stripe", billId: p.bill_id })
        return NextResponse.json({ error: "db error" }, { status: 500 })
    }
    const netPaid = (pays ?? []).reduce((s, x) => s + Number((x as { amount: number }).amount), 0)

    const { data: bill, error: billErr } = await supabase
        .from("bills").select("grand_total, bill_status").eq("id", p.bill_id).maybeSingle()
    if (billErr) {
        logError(billErr, { route: "/api/webhooks/stripe", billId: p.bill_id })
        return NextResponse.json({ error: "db error" }, { status: 500 })
    }
    const b = bill as { grand_total: number; bill_status: string } | null
    if (b && netPaid <= 0.01 && b.bill_status !== "VOID") {
        await supabase.from("bills").update({
            bill_status: "VOID",
            void_reason: `Fully refunded via Stripe (refund ${refund.id})`,
            voided_at: new Date().toISOString(),
        } as never).eq("id", p.bill_id)
        await supabase.from("bill_audit_log").insert({
            tenant_id: p.tenant_id,
            bill_id: p.bill_id,
            user_role: "SYSTEM",
            action: "BILL_VOIDED",
            reason: `Stripe refund ${refund.id}`,
            after_state: { netPaid, refund_id: refund.id } as never,
        } as never)
    }

    logInfo("Stripe refund processed", {
        tenantId: p.tenant_id, billId: p.bill_id, refundId: refund.id,
        amount: refund.amount / 100,
    })
    return NextResponse.json({ ok: true, refunded: true })
}

/**
 * Handle Stripe `account.updated`. Fires whenever Stripe re-evaluates
 * the connected account's verification status — e.g. KYC completes,
 * bank account confirmed, a capability flips on/off. We mirror the
 * relevant flags into tenant_payment_gateways so the settings UI shows
 * real-time status without us polling Stripe.
 *
 * Idempotent: a re-delivered event just overwrites the same values.
 */
async function handleAccountUpdated(
    account: {
        id: string
        charges_enabled?: boolean
        payouts_enabled?: boolean
        details_submitted?: boolean
        country?: string
        requirements?: Record<string, unknown>
    },
    supabase: ServiceClient,
) {
    if (!account.id) {
        return NextResponse.json({ ok: true, ignored: "no_account_id" })
    }
    // Look up the tenant by the connected-account id. We don't have to
    // join — there's at most one tenant per acct_*.
    const { data: gw, error: gwErr } = await supabase
        .from("tenant_payment_gateways")
        .select("tenant_id")
        .eq("stripe_connected_account_id", account.id)
        .maybeSingle()
    if (gwErr) {
        logError(gwErr, { route: "/api/webhooks/stripe", event: "account.updated", acctId: account.id })
        return NextResponse.json({ error: "db error" }, { status: 500 })
    }
    if (!gw) {
        // Unknown account — probably belongs to a Stripe account from a
        // different platform on the same server, or a stale row. Ignore.
        logWarn("account.updated for unknown acct_*", { acctId: account.id })
        return NextResponse.json({ ok: true, ignored: "unknown_account" })
    }

    const { error: upErr } = await supabase
        .from("tenant_payment_gateways")
        .update({
            stripe_charges_enabled: account.charges_enabled ?? false,
            stripe_payouts_enabled: account.payouts_enabled ?? false,
            stripe_details_submitted: account.details_submitted ?? false,
            stripe_account_country: account.country ?? null,
            stripe_requirements: account.requirements ?? null,
        } as never)
        .eq("stripe_connected_account_id", account.id)
    if (upErr) {
        logError(upErr, { route: "/api/webhooks/stripe", event: "account.updated", acctId: account.id })
        return NextResponse.json({ error: "db error" }, { status: 500 })
    }

    logInfo("Stripe account updated", {
        acctId: account.id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
    })
    // Best-effort push notification to the OWNER when the account
    // becomes fully operational — they'll want to know they can start
    // accepting cards.
    if (account.charges_enabled && account.payouts_enabled && account.details_submitted) {
        try {
            await sendPushToTenant((gw as { tenant_id: string }).tenant_id, {
                title: "Stripe is live",
                body: "Your restaurant can now accept card payments.",
                url: "/settings/payments",
            })
        } catch { /* push is best-effort */ }
    }
    return NextResponse.json({ ok: true })
}

/**
 * Handle Stripe `payout.paid` / `payout.failed`. Fires when Stripe sends
 * (or fails to send) money from the connected account to the
 * restaurant's bank. We store the last payout summary so the embedded
 * dashboard + the settings page can show "Last payout: $X on YYYY-MM-DD"
 * without polling Stripe.
 *
 * For payout.failed we additionally push a notification to the OWNER so
 * they can fix the bank info before the next attempt.
 */
async function handlePayoutEvent(
    eventType: string,
    payout: {
        id: string
        amount?: number
        currency?: string
        status?: string
        arrival_date?: number
        failure_message?: string | null
    },
    accountId: string | null,
    supabase: ServiceClient,
) {
    if (!accountId) {
        // Some old test payloads omit event.account; payouts without an
        // account are unactionable here, so ignore.
        return NextResponse.json({ ok: true, ignored: "no_event_account" })
    }
    const { data: gw } = await supabase
        .from("tenant_payment_gateways")
        .select("tenant_id, stripe_account_country")
        .eq("stripe_connected_account_id", accountId)
        .maybeSingle()
    if (!gw) {
        logWarn(`${eventType} for unknown acct_*`, { acctId: accountId })
        return NextResponse.json({ ok: true, ignored: "unknown_account" })
    }
    const tenantId = (gw as { tenant_id: string }).tenant_id
    const amountInMinorUnits = payout.amount ?? 0
    // Stripe amounts are in the smallest currency unit. JPY/KRW are
    // zero-decimal; everything we currently support is two-decimal, so
    // dividing by 100 works for USD/EUR/GBP/CAD/AUD. If you add JPY,
    // branch on currency here.
    const amountMajor = amountInMinorUnits / 100
    const arrival = payout.arrival_date
        ? new Date(payout.arrival_date * 1000).toISOString()
        : new Date().toISOString()

    await supabase
        .from("tenant_payment_gateways")
        .update({
            stripe_last_payout_at: arrival,
            stripe_last_payout_amount: amountMajor,
            stripe_last_payout_currency: payout.currency ?? null,
            stripe_last_payout_status: eventType === "payout.paid" ? "PAID" : "FAILED",
        } as never)
        .eq("stripe_connected_account_id", accountId)

    if (eventType === "payout.failed") {
        try {
            await sendPushToTenant(tenantId, {
                title: "Payout failed",
                body: payout.failure_message ?? "Stripe couldn't send your payout. Check bank details.",
                url: "/settings/payments",
            })
        } catch { /* best-effort */ }
    }

    logInfo(`Stripe ${eventType}`, {
        acctId: accountId,
        tenantId,
        payoutId: payout.id,
        amount: amountMajor,
        currency: payout.currency,
    })
    return NextResponse.json({ ok: true })
}

/**
 * Handle Stripe `customer.subscription.created/updated/deleted` for the
 * PLATFORM's SaaS billing on the restaurant. These events fire on our
 * own Stripe account (no event.account header set by the caller).
 *
 * We mirror the Stripe status into tenants.subscription_status so the
 * is_tenant_billable() function (and therefore generate_bill) can gate
 * correctly without re-querying Stripe on every bill.
 *
 * Idempotent: re-delivery just overwrites the same fields.
 */
async function handleSubscriptionEvent(
    eventType: string,
    sub: {
        id: string
        status?: string
        customer?: string
        current_period_end?: number
        cancel_at_period_end?: boolean
        items?: { data?: Array<{ price?: { id?: string } }> }
    },
    supabase: ServiceClient,
) {
    if (!sub.id || !sub.customer) {
        return NextResponse.json({ ok: true, ignored: "missing_ids" })
    }
    const { data: tenantRow } = await supabase
        .from("tenants")
        .select("id, country, plan_tier")
        .eq("stripe_customer_id", sub.customer)
        .maybeSingle()
    if (!tenantRow) {
        logWarn(`${eventType} for unknown stripe_customer_id`, { customer: sub.customer })
        return NextResponse.json({ ok: true, ignored: "unknown_customer" })
    }
    const tenant = tenantRow as { id: string; country: string | null; plan_tier: string | null }

    const internalStatus = eventType === "customer.subscription.deleted"
        ? "CANCELED"
        : mapStripeSubStatus(sub.status ?? "")

    // ── Tier reverse-lookup ──────────────────────────────────────────────
    // If the active line item's Price ID maps to a tier we know about
    // (e.g. owner upgraded in the Stripe Customer Portal), mirror that
    // back into tenants.plan_tier + the limit columns so our access-
    // control SQL stays consistent. We do this BEFORE the status update
    // so the same UPDATE statement carries both changes atomically.
    let tierFields: Record<string, unknown> = {}
    const activePriceId = sub.items?.data?.[0]?.price?.id ?? null
    if (activePriceId) {
        const lookup = findTierByPriceId(activePriceId)
        if (lookup) {
            tierFields = {
                plan_tier: lookup.plan.tier,
                plan_max_branches: toDbLimit(lookup.plan.maxBranches),
                plan_max_staff_per_br: toDbLimit(lookup.plan.maxStaffPerBranch),
            }
            if (tenant.plan_tier !== lookup.plan.tier) {
                logInfo("Subscription tier change via Stripe webhook", {
                    tenantId: tenant.id, from: tenant.plan_tier ?? "(none)", to: lookup.plan.tier,
                })
            }
        } else {
            // Subscription is on a Price ID we don't have an env var for —
            // log so the operator can either add the var or fix the
            // subscription. Status still mirrors; tier just stays as-is.
            logWarn("Subscription active on unknown Price ID — tier left unchanged", {
                tenantId: tenant.id, subscriptionId: sub.id, priceId: activePriceId,
            })
        }
    }

    await supabase
        .from("tenants")
        .update({
            stripe_subscription_id: sub.id,
            subscription_status: internalStatus,
            current_period_end: sub.current_period_end
                ? new Date(sub.current_period_end * 1000).toISOString()
                : null,
            ...tierFields,
        } as never)
        .eq("id", tenant.id)

    logInfo(`Subscription ${eventType}`, {
        tenantId: tenant.id, subscriptionId: sub.id, status: sub.status, internalStatus,
        tierFromPrice: Object.keys(tierFields).length > 0 ? (tierFields as { plan_tier?: string }).plan_tier : undefined,
    })

    // OWNER-facing push: surface significant state transitions so the
    // restaurant isn't surprised by a sudden billing block.
    if (eventType === "customer.subscription.deleted") {
        try {
            await sendPushToTenant(tenant.id, {
                title: "RestoPOS subscription canceled",
                body: "Bill generation is paused. Re-subscribe from Settings → Billing.",
                url: "/settings/billing",
            })
        } catch { /* best-effort */ }
    }
    return NextResponse.json({ ok: true })
}

/**
 * Handle Stripe `invoice.payment_succeeded` / `invoice.payment_failed` on
 * the platform's SaaS subscription. The Subscription event above is the
 * primary status driver; this handler just refines it (PAST_DUE on
 * failure, ACTIVE on success) and surfaces a notification.
 */
async function handleInvoiceEvent(
    eventType: string,
    invoice: {
        id: string
        customer?: string
        subscription?: string
        amount_paid?: number
        amount_due?: number
        currency?: string
        hosted_invoice_url?: string
        attempt_count?: number
        next_payment_attempt?: number | null
    },
    supabase: ServiceClient,
) {
    if (!invoice.customer) {
        return NextResponse.json({ ok: true, ignored: "missing_customer" })
    }
    const { data: tenantRow } = await supabase
        .from("tenants")
        .select("id, country, subscription_status")
        .eq("stripe_customer_id", invoice.customer)
        .maybeSingle()
    if (!tenantRow) {
        logWarn(`${eventType} for unknown stripe_customer_id`, { customer: invoice.customer })
        return NextResponse.json({ ok: true, ignored: "unknown_customer" })
    }
    const tenant = tenantRow as { id: string; country: string | null; subscription_status: string | null }

    if (eventType === "invoice.payment_succeeded") {
        await supabase
            .from("tenants")
            .update({ subscription_status: "ACTIVE" } as never)
            .eq("id", tenant.id)
        // Only nudge them if they were just unblocked — repeated nudges
        // every month would be noise.
        if (tenant.subscription_status && tenant.subscription_status !== "ACTIVE") {
            try {
                await sendPushToTenant(tenant.id, {
                    title: "Payment received",
                    body: "Your RestoPOS subscription is active again.",
                    url: "/settings/billing",
                })
            } catch { /* best-effort */ }
        }
        return NextResponse.json({ ok: true })
    }

    // invoice.payment_failed → PAST_DUE (the Subscription event will
    // refine to SUSPENDED later if Stripe gives up retrying).
    await supabase
        .from("tenants")
        .update({ subscription_status: "PAST_DUE" } as never)
        .eq("id", tenant.id)

    try {
        await sendPushToTenant(tenant.id, {
            title: "Subscription payment failed",
            body: invoice.next_payment_attempt
                ? "Stripe will retry. Update your card before then to avoid suspension."
                : "Your card was declined. Update it in Settings → Billing to keep using POS.",
            url: "/settings/billing",
        })
    } catch { /* best-effort */ }

    logInfo("Subscription invoice failed", {
        tenantId: tenant.id, invoiceId: invoice.id, attempt: invoice.attempt_count,
    })
    return NextResponse.json({ ok: true })
}

/** Stripe Subscription status strings → our internal subscription_status.
 *  Stripe has more states than we care about; we collapse them to the
 *  five values our state machine uses. */
function mapStripeSubStatus(s: string): "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED" {
    switch (s) {
        case "trialing":            return "TRIAL"
        case "active":              return "ACTIVE"
        case "past_due":            return "PAST_DUE"
        case "unpaid":              return "SUSPENDED"
        case "canceled":
        case "incomplete_expired":  return "CANCELED"
        case "incomplete":          return "PAST_DUE"  // first invoice unconfirmed
        default:                    return "PAST_DUE"
    }
}

/**
 * Handle Stripe charge.dispute.created / charge.dispute.closed.
 *
 * A dispute (chargeback) means the customer claimed back the money via
 * their bank. The restaurant has a deadline (usually 7-21 days) to
 * submit evidence; ignoring it means losing the funds plus a Stripe fee.
 *
 * We:
 *   - Look up the bill via the parent charge_id stored on payments
 *   - Insert an audit log row so it surfaces on /bills/[id]
 *   - Push a notification to the OWNER with the evidence-due date
 */
async function handleDisputeEvent(
    eventType: string,
    dispute: {
        id: string
        status?: string
        reason?: string
        amount?: number
        currency?: string
        evidence_due_by?: number
        charge?: string
    },
    accountId: string | null,
    supabase: ServiceClient,
) {
    if (!dispute.charge) {
        return NextResponse.json({ ok: true, ignored: "no_charge_id" })
    }
    let tenantId: string | null = null
    let billId: string | null = null
    const { data: pay } = await supabase
        .from("payments")
        .select("tenant_id, bill_id")
        .eq("stripe_charge_id", dispute.charge)
        .maybeSingle()
    if (pay) {
        tenantId = (pay as { tenant_id: string }).tenant_id
        billId   = (pay as { bill_id: string }).bill_id
    } else if (accountId) {
        const { data: gw } = await supabase
            .from("tenant_payment_gateways")
            .select("tenant_id")
            .eq("stripe_connected_account_id", accountId)
            .maybeSingle()
        tenantId = (gw as { tenant_id?: string } | null)?.tenant_id ?? null
    }
    if (!tenantId) {
        logWarn(`${eventType} for unknown tenant`, { chargeId: dispute.charge, accountId })
        return NextResponse.json({ ok: true, ignored: "unknown_tenant" })
    }

    if (billId) {
        await supabase.from("bill_audit_log").insert({
            tenant_id: tenantId,
            bill_id: billId,
            user_role: "SYSTEM",
            action: eventType === "charge.dispute.created" ? "DISPUTE_OPENED" : "DISPUTE_CLOSED",
            reason: dispute.reason ?? null,
            after_state: {
                dispute_id: dispute.id,
                status: dispute.status,
                amount: (dispute.amount ?? 0) / 100,
                currency: dispute.currency,
                evidence_due_by: dispute.evidence_due_by
                    ? new Date(dispute.evidence_due_by * 1000).toISOString()
                    : null,
            } as never,
        } as never)
    }

    if (eventType === "charge.dispute.created") {
        try {
            const due = dispute.evidence_due_by
                ? new Date(dispute.evidence_due_by * 1000).toLocaleDateString()
                : "soon"
            await sendPushToTenant(tenantId, {
                title: "Chargeback opened",
                body: `Customer disputed a charge. Submit evidence by ${due} or lose the funds.`,
                url: billId ? `/bills/${billId}` : "/orders",
            })
        } catch { /* best-effort */ }
    }
    logInfo(`Stripe ${eventType}`, { tenantId, billId, disputeId: dispute.id, reason: dispute.reason })
    return NextResponse.json({ ok: true })
}

/**
 * Handle customer.subscription.trial_will_end — fires 3 days before
 * trial ends. Push a notification so the OWNER adds a card before
 * SUSPENDED kicks in.
 *
 * Suppresses the notification if a card is already on file — auto-renew
 * will go through, no nag needed.
 */
async function handleTrialWillEnd(
    sub: { id: string; customer?: string; trial_end?: number },
    supabase: ServiceClient,
) {
    if (!sub.customer) return NextResponse.json({ ok: true, ignored: "no_customer" })
    const { data: tenantRow } = await supabase
        .from("tenants")
        .select("id, platform_payment_method_id")
        .eq("stripe_customer_id", sub.customer)
        .maybeSingle()
    if (!tenantRow) return NextResponse.json({ ok: true, ignored: "unknown_customer" })
    const tenant = tenantRow as { id: string; platform_payment_method_id: string | null }
    if (tenant.platform_payment_method_id) {
        return NextResponse.json({ ok: true, suppressed: "card_on_file" })
    }
    const endDate = sub.trial_end ? new Date(sub.trial_end * 1000).toLocaleDateString() : "in 3 days"
    try {
        await sendPushToTenant(tenant.id, {
            title: "Trial ends soon",
            body: `Your RestoPOS trial ends ${endDate}. Add a payment method to keep selling.`,
            url: "/settings/billing",
        })
    } catch { /* best-effort */ }
    return NextResponse.json({ ok: true })
}

/**
 * Handle account.application.deauthorized — restaurant revoked our
 * Connect access from their Stripe Dashboard. The acct_* is dead from
 * our side; flip stripe_account_enabled so create-checkout surfaces a
 * friendly "reconnect Stripe" error instead of a raw Stripe rejection.
 */
async function handleConnectDeauthorized(
    accountId: string,
    supabase: ServiceClient,
) {
    const { data: gw } = await supabase
        .from("tenant_payment_gateways")
        .select("tenant_id")
        .eq("stripe_connected_account_id", accountId)
        .maybeSingle()
    const tenantId = (gw as { tenant_id?: string } | null)?.tenant_id
    if (!tenantId) {
        logWarn("account.application.deauthorized for unknown acct_*", { acctId: accountId })
        return NextResponse.json({ ok: true, ignored: "unknown_account" })
    }
    await supabase
        .from("tenant_payment_gateways")
        .update({
            stripe_account_enabled: false,
            stripe_charges_enabled: false,
            stripe_payouts_enabled: false,
        } as never)
        .eq("stripe_connected_account_id", accountId)
    try {
        await sendPushToTenant(tenantId, {
            title: "Stripe disconnected",
            body: "Online card payments are paused. Reconnect Stripe in Settings → Payments.",
            url: "/settings/payments",
        })
    } catch { /* best-effort */ }
    logInfo("Connect account deauthorized", { acctId: accountId, tenantId })
    return NextResponse.json({ ok: true })
}

/**
 * Handle invoice.upcoming. Fires ~7 days before Stripe charges the
 * subscription. Push notification with the amount + date so the OWNER
 * has lead time to top up the card if needed.
 */
async function handleInvoiceUpcoming(
    invoice: {
        id: string
        customer?: string
        amount_due?: number
        currency?: string
        next_payment_attempt?: number | null
    },
    supabase: ServiceClient,
) {
    if (!invoice.customer) return NextResponse.json({ ok: true, ignored: "no_customer" })
    const { data: tenantRow } = await supabase
        .from("tenants")
        .select("id")
        .eq("stripe_customer_id", invoice.customer)
        .maybeSingle()
    if (!tenantRow) return NextResponse.json({ ok: true, ignored: "unknown_customer" })
    const tenant = tenantRow as { id: string }
    const amount = ((invoice.amount_due ?? 0) / 100).toFixed(2)
    const currency = (invoice.currency ?? "USD").toUpperCase()
    const when = invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000).toLocaleDateString()
        : "soon"
    try {
        await sendPushToTenant(tenant.id, {
            title: "Upcoming subscription charge",
            body: `${currency} ${amount} will be charged on ${when}. Make sure your card has the balance.`,
            url: "/settings/billing",
        })
    } catch { /* best-effort */ }
    return NextResponse.json({ ok: true })
}

/**
 * Handle payment_intent.payment_failed for CUSTOMER bill payments
 * (not the SaaS subscription — that's invoice.payment_failed elsewhere).
 *
 * The bill stays GENERATED — the next attempt can still succeed. We
 * just log an audit row so the cashier has a trail when investigating
 * why a payment link isn't clearing.
 */
async function handlePaymentIntentFailed(
    intent: {
        id: string
        amount?: number
        metadata?: { bill_id?: string; tenant_id?: string }
        last_payment_error?: { message?: string; code?: string }
    },
    supabase: ServiceClient,
) {
    const billId = intent.metadata?.bill_id
    const tenantId = intent.metadata?.tenant_id
    if (!billId || !tenantId) {
        return NextResponse.json({ ok: true, ignored: "no_bill_id" })
    }
    await supabase.from("bill_audit_log").insert({
        tenant_id: tenantId,
        bill_id: billId,
        user_role: "SYSTEM",
        action: "PAYMENT_FAILED",
        reason: intent.last_payment_error?.message ?? "Card declined",
        after_state: {
            payment_intent_id: intent.id,
            error_code: intent.last_payment_error?.code ?? null,
            amount: (intent.amount ?? 0) / 100,
        } as never,
    } as never)
    logInfo("Stripe payment_intent.payment_failed", {
        tenantId, billId, intentId: intent.id,
        error: intent.last_payment_error?.message,
    })
    return NextResponse.json({ ok: true })
}
