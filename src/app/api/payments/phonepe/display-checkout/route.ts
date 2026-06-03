import { NextResponse } from "next/server"

import { appOrigin } from "@/lib/app-origin"
import { assertSameOrigin } from "@/lib/csrf"
import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { logError, logInfo } from "@/lib/errors"
import {
    createPhonePePayment,
    phonepeEnvCreds,
    resolveTenantPhonePeCreds,
    type PhonePeCreds,
    type TenantPhonePeRow,
} from "@/lib/billing/phonepe"

/**
 * POST /api/payments/phonepe/display-checkout
 *
 * Cashier-fired payment QR for the customer screen.
 *
 * THE PAYMENT-SAFETY CONTRACT
 *   This route is the entry point for the POS auto-confirm flow. The
 *   guarantee it makes — and that downstream MUST preserve — is:
 *
 *     "Once we hand the customer a PhonePe QR with amount X, if the
 *      customer pays amount X, a bill row WILL exist in the database
 *      for that payment. No cashier action, no live POS tab, no
 *      browser-side step is required to finalise."
 *
 *   To honour that, this route:
 *     1. Pre-creates an `orders` row (status='ON_HOLD') with the cart
 *        snapshot, so the webhook (or the reconcile cron) has an
 *        `order_id` to bill against.
 *     2. Snapshots cashier-applied modifiers (coupon discount, service
 *        charge, round-off) onto the order, so the auto-confirmed bill
 *        matches the price the customer just paid — no surprises.
 *     3. Inserts the `phonepe_payment_events` row BEFORE calling
 *        PhonePe, so that even if PhonePe responds OK but the HTTP
 *        response back to us is dropped, the webhook can still find
 *        the event row and finalise.
 *     4. Calls PhonePe. If the mint fails, we leave the order as
 *        ON_HOLD (admin can void it later) — no money has changed
 *        hands yet at that point, so no payment is at risk.
 *
 *   After this returns, the cashier's tab state stops mattering. The
 *   PhonePe webhook + the every-10-min reconcile cron BOTH call
 *   `confirm_phonepe_payment(order_id, …)` server-side, which atomically
 *   creates `bills` + `payments(method='PHONEPE')`. Same code path,
 *   idempotent on `order_id` — racing is fine, only the first call wins.
 *
 * INPUT
 *   { display_session_id: string }   — uuid of the pos_display_sessions row
 *                                       the cashier just opened.
 *
 * OUTPUT
 *   { ok: true, qr_data, auto_confirm: true, checkout_session_id, order_id }
 *     • qr_data            — the UPI intent string (`upi://pay?…`) the
 *                            customer screen renders as a QR + a deeplink
 *                            for "open any UPI app on this device".
 *     • auto_confirm       — true. The PhonePe webhook will create the
 *                            bill server-side; the cashier's UI just
 *                            reacts to invoice_number being populated.
 *     • checkout_session_id — our merchant_transaction_id, surfaced so
 *                             the cashier can reference it in support.
 *     • order_id           — the pre-created order id, for debugging.
 *
 *   { ok: false, reason: "not_configured" }
 *     The tenant hasn't set up PhonePe AND the platform .env doesn't
 *     have UAT defaults. The POS dialog renders a "set up online
 *     payments first" message in this case.
 *
 *   { ok: false, phonepe_error: "…" }
 *     PhonePe returned an error. POS will fall back to the manual UPI
 *     QR (using the tenant's `upi_id`) if it has one.
 *
 * AUTH: must be a signed-in staff user with bill.generate. The display
 * session is scoped to `created_by = auth.uid()` so a cashier can only
 * fire a QR for THEIR own session.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

interface CartLine {
    name?: string
    menu_item_id?: string | null
    quantity?: number
    unit_price?: number
    gst_slab?: number
    taxable_amount?: number
    notes?: string | null
    hsn_code?: string | null
}

interface SessionRow {
    id: string
    tenant_id: string
    branch_id: string | null
    grand_total: number
    currency: string | null
    status: string
    cart_payload: CartLine[] | null
    discount_total: number | null
    coupon_code: string | null
    customer_name: string | null
    customer_phone: string | null
    order_type: string | null
    table_no: string | null
}

export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { data: u } = await supabase
        .from("users")
        .select("tenant_id, role")
        .eq("id", user.id)
        .maybeSingle() as { data: { tenant_id: string | null; role: string | null } | null }
    if (!u?.tenant_id) {
        return NextResponse.json({ error: "no tenant" }, { status: 403 })
    }
    const role = u.role ?? ""
    if (!["OWNER", "MANAGER", "CASHIER", "CAPTAIN"].includes(role)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const body = await req.json().catch(() => null) as { display_session_id?: string } | null
    const displaySessionId = body?.display_session_id
    if (!displaySessionId) {
        return NextResponse.json({ error: "missing display_session_id" }, { status: 400 })
    }

    // Load the full session — every field we need to build a faithful
    // snapshot order. Scoped to THIS cashier (RLS would too, but the
    // explicit eq() is one less round-trip).
    const { data: session } = await supabase
        .from("pos_display_sessions")
        .select("id, tenant_id, branch_id, grand_total, currency, status, cart_payload, discount_total, coupon_code, customer_name, customer_phone, order_type, table_no")
        .eq("id", displaySessionId)
        .eq("created_by", user.id)
        .maybeSingle() as { data: SessionRow | null }
    if (!session) {
        return NextResponse.json({ error: "display session not found" }, { status: 404 })
    }
    if (!session.grand_total || session.grand_total <= 0) {
        return NextResponse.json({ error: "grand total must be > 0" }, { status: 400 })
    }
    if ((session.currency ?? "INR") !== "INR") {
        return NextResponse.json({ error: "PhonePe only supports INR" }, { status: 400 })
    }
    const cart = Array.isArray(session.cart_payload) ? session.cart_payload : []
    if (cart.length === 0) {
        return NextResponse.json({ error: "cart is empty" }, { status: 400 })
    }

    // Service-role for everything past the auth gate — RLS on
    // tenant_payment_gateways hides salt keys from non-owners, and
    // RLS on phonepe_payment_events is service-role-only.
    const service = createServiceRoleClient()

    // Resolve PhonePe credentials (per-tenant first, platform .env as
    // fallback). No creds → tell POS to fall back to manual UPI.
    const { data: gw } = await service
        .from("tenant_payment_gateways")
        .select("phonepe_mid, phonepe_merchant_key, phonepe_salt_index, phonepe_mid_staging, phonepe_merchant_key_staging, phonepe_salt_index_staging, phonepe_enabled, phonepe_env")
        .eq("tenant_id", session.tenant_id)
        .maybeSingle() as { data: TenantPhonePeRow | null }
    const creds: PhonePeCreds | null = resolveTenantPhonePeCreds(gw) ?? phonepeEnvCreds()
    if (!creds) {
        return NextResponse.json({ ok: false, reason: "not_configured" })
    }

    // Tenant defaults for service_charge + round_off — same fields the
    // cashier-clicked generate_bill picks up. We snapshot them onto the
    // order so the auto-confirmed bill matches what the customer paid.
    const { data: tenant } = await service
        .from("tenants")
        .select("service_charge, round_off")
        .eq("id", session.tenant_id)
        .maybeSingle() as { data: { service_charge: number | null; round_off: number | null } | null }

    // Resolve coupon — pos_display_sessions stores `coupon_code` but the
    // bill needs `coupon_id` + a clamped discount. Re-validate
    // server-side so a stale / expired code doesn't slip through.
    let couponId: string | null = null
    let orderDiscount = Number(session.discount_total ?? 0)
    if (session.coupon_code) {
        const subtotal = cart.reduce((s, l) => s + Number(l.taxable_amount ?? 0), 0)
        const { data: cRes } = await service.rpc("validate_coupon_for_tenant" as never, {
            p_tenant_id: session.tenant_id,
            p_code: session.coupon_code,
            p_subtotal: subtotal,
        } as never) as { data: { coupon_id?: string; discount?: number } | null }
        if (cRes?.coupon_id) {
            couponId = cRes.coupon_id
            orderDiscount = Number(cRes.discount ?? orderDiscount)
        }
    }

    // Resolve customer — best-effort lookup by phone. If the cashier
    // didn't type one, leave the order anonymous.
    let customerId: string | null = null
    if (session.customer_phone) {
        const { data: c } = await service
            .from("customers")
            .select("id")
            .eq("tenant_id", session.tenant_id)
            .eq("phone", session.customer_phone)
            .maybeSingle() as { data: { id: string } | null }
        customerId = c?.id ?? null
    }

    // Resolve table — DINE_IN may have a table number, others don't.
    let tableId: string | null = null
    if (session.table_no && session.order_type === "DINE_IN") {
        const { data: t } = await service
            .from("dining_tables")
            .select("id")
            .eq("tenant_id", session.tenant_id)
            .eq("table_number", session.table_no)
            .maybeSingle() as { data: { id: string } | null }
        tableId = t?.id ?? null
    }

    // ── 1. Pre-create the order ────────────────────────────────────
    // status='ON_HOLD' marks it as awaiting payment. confirm_phonepe_payment
    // flips it to 'PAID' when PhonePe confirms.
    const orderNumber = `POS-${Date.now().toString().slice(-8)}`
    const orderType = (session.order_type ?? "QSR").toUpperCase()
    const allowedTypes = ["DINE_IN", "TAKEAWAY", "DELIVERY", "QSR"]
    const safeOrderType = allowedTypes.includes(orderType) ? orderType : "QSR"
    const { data: orderRow, error: orderErr } = await service
        .from("orders")
        .insert({
            tenant_id: session.tenant_id,
            order_number: orderNumber,
            status: "ON_HOLD",
            order_type: safeOrderType,
            table_id: tableId,
            customer_id: customerId,
            branch_id: session.branch_id,
            created_by: user.id,
            service_charge: tenant?.service_charge ?? 0,
            order_discount: orderDiscount,
            round_off: tenant?.round_off ?? 0,
            notes: `POS PhonePe auto-confirm${session.table_no ? ` · Table ${session.table_no}` : ""}`,
        } as never)
        .select("id")
        .maybeSingle() as { data: { id: string } | null; error: unknown }
    if (orderErr || !orderRow) {
        logError(orderErr ?? "order insert returned no row", {
            route: "/api/payments/phonepe/display-checkout",
            stage: "order_insert",
            tenant_id: session.tenant_id,
        })
        return NextResponse.json({ error: "couldn't create order" }, { status: 500 })
    }
    const orderId = orderRow.id

    // ── 2. order_items from cart snapshot ──────────────────────────
    // Same shape confirm_phonepe_payment + generate_bill expect.
    // taxable_amount is the NET (pre-tax) line value the cashier's POS
    // already computed; we trust it because the POS is the only writer
    // and the cashier is authenticated staff.
    const lines = cart.map((c) => {
        const qty = Math.max(1, Math.round(Number(c.quantity) || 1))
        const unit = Number(c.unit_price) || 0
        const slab = Number(c.gst_slab) || 0
        const taxable = Number(c.taxable_amount ?? unit * qty)
        return {
            tenant_id: session.tenant_id,
            order_id: orderId,
            menu_item_id: c.menu_item_id ?? null,
            item_name: c.name ?? "Item",
            hsn_code: c.hsn_code ?? null,
            gst_slab: slab,
            quantity: qty,
            unit_price: unit,
            taxable_amount: taxable,
            line_total: taxable,
            notes: c.notes ?? null,
        }
    })
    const { error: itemsErr } = await service.from("order_items").insert(lines as never)
    if (itemsErr) {
        logError(itemsErr, {
            route: "/api/payments/phonepe/display-checkout",
            stage: "order_items_insert",
            orderId,
        })
        // The orphan order will sit as ON_HOLD — visible to ops and
        // safe (no bill, no payment). No money is at risk here:
        // we haven't called PhonePe yet.
        return NextResponse.json({ error: "couldn't create order items" }, { status: 500 })
    }

    // ── 3. Tracking row — BEFORE calling PhonePe ───────────────────
    // The webhook + reconcile cron find the right order via this row.
    // Inserting it first means even if PhonePe responds OK and our HTTP
    // response back to the cashier is then dropped, the webhook still
    // resolves cleanly (it has the order_id) — no payment slips through.
    const txnId = `pos-${session.id.slice(0, 8)}-${Date.now().toString(36)}`
    const { error: insertErr } = await service
        .from("phonepe_payment_events")
        .insert({
            merchant_transaction_id: txnId,
            tenant_id: session.tenant_id,
            order_id: orderId,
            display_session_id: session.id,
            amount: session.grand_total,
            currency: "INR",
            flow: "POS",
            status: "PENDING",
        } as never)
    if (insertErr) {
        logError(insertErr, { route: "/api/payments/phonepe/display-checkout", txnId, orderId })
        return NextResponse.json({ error: "couldn't initialise payment" }, { status: 500 })
    }

    // ── 4. Mint the PhonePe transaction ────────────────────────────
    const appUrl = appOrigin(req)
    const result = await createPhonePePayment(creds, {
        merchantTransactionId: txnId,
        amount: session.grand_total,
        merchantUserId: orderId,
        redirectUrl: `${appUrl}/`,
        callbackUrl: `${appUrl}/api/webhooks/phonepe`,
        instrument: "UPI_INTENT",
    })

    if (!result.ok || !(result.intentUri || result.qrData)) {
        // Mark the event FAILED so the cron won't keep polling for a
        // transaction PhonePe never accepted. Order + items stay as
        // an orphan ON_HOLD — admin can void it.
        await service
            .from("phonepe_payment_events")
            .update({
                status: "FAILED",
                raw: result.raw ?? { error: result.message },
                processed_at: new Date().toISOString(),
            } as never)
            .eq("merchant_transaction_id", txnId)
        return NextResponse.json({
            ok: false,
            phonepe_error: result.message ?? "PhonePe couldn't mint the QR.",
        })
    }

    logInfo("[phonepe display-checkout] minted QR", {
        txnId, orderId, tenant_id: session.tenant_id, amount: session.grand_total,
    })

    return NextResponse.json({
        ok: true,
        qr_data: result.intentUri ?? result.qrData ?? "",
        auto_confirm: true,
        checkout_session_id: txnId,
        order_id: orderId,
    })
}
