import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { logError, logInfo } from "@/lib/errors"
import {
    phonepeEnvCreds,
    resolveTenantPhonePeCreds,
    verifyWebhookSignature,
    type PhonePeCreds,
    type TenantPhonePeRow,
} from "@/lib/billing/phonepe"

/**
 * POST /api/webhooks/phonepe
 *
 * Server-to-server callback PhonePe POSTs to after a customer either
 * completes a payment OR PhonePe gives up on it. We:
 *
 *   1. Read the raw body and the X-VERIFY header.
 *   2. Decode the base64 `response` field WITHOUT trusting it yet —
 *      we need the merchantTransactionId to find which tenant's
 *      credentials to verify against, but we treat the body as
 *      untrusted until the signature passes.
 *   3. Look up our phonepe_payment_events row by merchant_transaction_id.
 *      That gives us the tenant_id; tenant gives us the credentials
 *      used to mint the original transaction.
 *   4. Recompute X-VERIFY using those credentials and constant-time
 *      compare. On mismatch, refuse with 401 — the webhook is the
 *      ONLY trust boundary that protects against a forged "payment
 *      succeeded" event.
 *   5. Update the event row (status = SUCCESS / FAILED) AND, when the
 *      flow is QR_ORDER, call `confirm_qr_order_system` to materialise
 *      the bill. POS flow just flips the `pos_display_sessions` row to
 *      PAID so the cashier's polling loop detects it and finalises the
 *      bill on its own.
 *
 * IDEMPOTENT — the merchant_transaction_id PRIMARY KEY on
 * phonepe_payment_events + the "already SUCCESS/FAILED" guard mean
 * PhonePe's webhook retries (they can fire up to 5 times in 30 min)
 * are safe no-ops after the first successful processing.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * GET /api/webhooks/phonepe — endpoint-existence probe.
 *
 * PhonePe Business's "Create New Webhook" form validates the URL
 * before saving by hitting it with a GET (or HEAD) request and
 * expecting a 2xx response — if it sees anything else (404, 405,
 * 500) the save fails with "Webhook validation failed".
 *
 * This handler answers that probe with a plain "I'm here, send me
 * POSTs" so PhonePe's validation passes. We do NOT expose any
 * tenant data here — the real signature-verified handler is POST.
 */
export async function GET() {
    return NextResponse.json({
        ok: true,
        endpoint: "phonepe-webhook",
        method: "POST",
        message: "Send PhonePe webhook callbacks here via POST with an X-VERIFY or Authorization header. GET requests are accepted only for endpoint-existence probes.",
    })
}

// Some validators send HEAD instead of GET. Next.js App Router
// auto-maps HEAD to GET when no explicit HEAD handler is exported,
// but we're not relying on that — keep the simplest possible path:
// GET returns 200 → HEAD returns 200 with no body. Done.

interface PhonePeWebhookData {
    merchantId?: string
    merchantTransactionId?: string
    transactionId?: string
    amount?: number       // paise
    state?: string        // "COMPLETED" | "FAILED" | "PENDING"
    responseCode?: string
}

interface PhonePeWebhookPayload {
    success?: boolean
    code?: string
    message?: string
    data?: PhonePeWebhookData
}

export async function POST(req: Request) {
    const xVerify = req.headers.get("x-verify") || req.headers.get("X-VERIFY")
    if (!xVerify) {
        return NextResponse.json({ error: "missing X-VERIFY header" }, { status: 400 })
    }

    const rawBody = await req.text().catch(() => "")
    if (!rawBody) {
        return NextResponse.json({ error: "empty body" }, { status: 400 })
    }

    // The wire body shape is `{ response: "<base64>" }`. Parse just
    // that without trusting the inner payload yet.
    let wireBody: { response?: string } | null = null
    try { wireBody = JSON.parse(rawBody) as { response?: string } } catch { /* fall through */ }
    if (!wireBody?.response || typeof wireBody.response !== "string") {
        return NextResponse.json({ error: "missing response field" }, { status: 400 })
    }
    const responseBase64 = wireBody.response

    // Decode untrusted — used only to look up the event row so we
    // can fetch the right credentials to verify against.
    let untrustedPayload: PhonePeWebhookPayload | null = null
    try {
        const decoded = Buffer.from(responseBase64, "base64").toString("utf8")
        untrustedPayload = JSON.parse(decoded) as PhonePeWebhookPayload
    } catch {
        return NextResponse.json({ error: "couldn't decode response" }, { status: 400 })
    }
    const merchantTxnId = untrustedPayload?.data?.merchantTransactionId
    if (!merchantTxnId) {
        return NextResponse.json({ error: "missing merchantTransactionId" }, { status: 400 })
    }

    const service = createServiceRoleClient()

    // Find the event row we created when we minted this payment.
    const { data: eventRow, error: eventErr } = await service
        .from("phonepe_payment_events")
        .select("merchant_transaction_id, tenant_id, order_id, display_session_id, bill_id, amount, flow, status")
        .eq("merchant_transaction_id", merchantTxnId)
        .maybeSingle() as { data: {
            merchant_transaction_id: string
            tenant_id: string
            order_id: string | null
            display_session_id: string | null
            bill_id: string | null
            amount: number
            flow: "POS" | "QR_ORDER"
            status: "PENDING" | "SUCCESS" | "FAILED"
        } | null; error: unknown }

    if (eventErr || !eventRow) {
        logError(eventErr ?? `no event row for ${merchantTxnId}`, {
            route: "/api/webhooks/phonepe",
            merchantTxnId,
        })
        return NextResponse.json({ error: "unknown transaction" }, { status: 404 })
    }

    // Already processed — ack but don't redo the work.
    if (eventRow.status !== "PENDING") {
        logInfo("[phonepe webhook] duplicate notification, already terminal", {
            merchantTxnId, status: eventRow.status, tenant_id: eventRow.tenant_id,
        })
        return NextResponse.json({ ok: true, alreadyProcessed: true })
    }

    // Resolve the credentials this tenant used to mint the transaction
    // (per-tenant first, fall through to platform .env).
    const { data: gw } = await service
        .from("tenant_payment_gateways")
        .select("phonepe_mid, phonepe_merchant_key, phonepe_salt_index, phonepe_mid_staging, phonepe_merchant_key_staging, phonepe_salt_index_staging, phonepe_enabled, phonepe_env")
        .eq("tenant_id", eventRow.tenant_id)
        .maybeSingle() as { data: TenantPhonePeRow | null }
    const creds: PhonePeCreds | null = resolveTenantPhonePeCreds(gw) ?? phonepeEnvCreds()
    if (!creds) {
        logError(`no creds found for tenant ${eventRow.tenant_id}`, {
            route: "/api/webhooks/phonepe",
            merchantTxnId,
            tenant_id: eventRow.tenant_id,
        })
        return NextResponse.json({ error: "credentials unavailable" }, { status: 500 })
    }

    // CRITICAL trust boundary — verify the signature BEFORE touching
    // any state. A forged "PAYMENT_SUCCESS" event reaching the bill-
    // generation code is the entire attack to defend against.
    if (!verifyWebhookSignature(xVerify, responseBase64, creds)) {
        logError("[phonepe webhook] X-VERIFY mismatch — refusing", {
            route: "/api/webhooks/phonepe",
            merchantTxnId,
            tenant_id: eventRow.tenant_id,
        })
        return NextResponse.json({ error: "signature invalid" }, { status: 401 })
    }

    // From here on, the payload is trusted.
    const data = untrustedPayload?.data
    const state = data?.state
    const providerTxnId = data?.transactionId ?? null
    const providerAmountMajor = data?.amount != null ? data.amount / 100 : null

    const isSuccess = state === "COMPLETED" && untrustedPayload?.success === true
    const isFailed = state === "FAILED" || untrustedPayload?.success === false

    // Update the event row first — this is the journal of record. If
    // anything below fails (e.g. confirm_qr_order_system raises), the
    // row is still SUCCESS/FAILED and the operator can re-fire bill
    // generation manually from there.
    const newStatus = isSuccess ? "SUCCESS" : isFailed ? "FAILED" : "PENDING"
    if (newStatus === "PENDING") {
        // PhonePe sent a status update we don't interpret as terminal —
        // just store the payload for the cron to re-poll later.
        await service
            .from("phonepe_payment_events")
            .update({ raw: untrustedPayload } as never)
            .eq("merchant_transaction_id", merchantTxnId)
        return NextResponse.json({ ok: true, state })
    }

    const { error: updateErr } = await service
        .from("phonepe_payment_events")
        .update({
            status: newStatus,
            provider_txn_id: providerTxnId,
            raw: untrustedPayload,
            processed_at: new Date().toISOString(),
        } as never)
        .eq("merchant_transaction_id", merchantTxnId)
        // Re-assert PENDING here — if a concurrent webhook fired and
        // already flipped this row, the update is a no-op and the rest
        // of the handler returns without double-billing.
        .eq("status", "PENDING")
    if (updateErr) {
        logError(updateErr, { route: "/api/webhooks/phonepe", merchantTxnId })
        return NextResponse.json({ error: "couldn't update event" }, { status: 500 })
    }

    // On FAILED — just log and ack. No bill to generate.
    if (newStatus === "FAILED") {
        logInfo("[phonepe webhook] payment failed", {
            merchantTxnId, tenant_id: eventRow.tenant_id, state, code: untrustedPayload?.code,
        })
        return NextResponse.json({ ok: true, state: "FAILED" })
    }

    // SUCCESS path — SAME server-side RPC for both POS and QR_ORDER
    // flows. confirm_phonepe_payment atomically:
    //   • locks the order_id
    //   • bails out if a bill already exists (idempotent → webhook
    //     retries + reconcile cron + double-fires are all safe)
    //   • inserts bills + payments(method='PHONEPE') in one transaction
    //   • returns the new bill_id + invoice_number
    //
    // The order row is pre-created by either:
    //   • /api/public/qr/place-order (for QR_ORDER flow), or
    //   • /api/payments/phonepe/display-checkout (for POS flow).
    // Both ensure event_row.order_id is non-null by the time we get here.
    //
    // After the bill exists we stamp pos_display_sessions.invoice_number
    // for the POS flow so the cashier's UI (which subscribes to that
    // row) can flip to "Payment received — invoice INV-…" instantly.
    // The display session is purely a UI mirror at this point — the
    // bill exists in the database regardless of whether anyone reads
    // the display update.
    try {
        if (!eventRow.order_id) {
            // Defensive: every PhonePe flow we mint pre-creates an order.
            // If we somehow have a SUCCESS event with no order_id, the
            // money is collected but we can't bill — surface it loudly.
            logError(
                `phonepe success without order_id — payment collected but cannot bill: ${merchantTxnId}`,
                { route: "/api/webhooks/phonepe", merchantTxnId, flow: eventRow.flow },
            )
            return NextResponse.json({
                ok: true,
                warning: "payment recorded but order_id was missing — manual reconciliation required",
            })
        }

        const { data: rpcRes, error: rpcErr } = await service.rpc("confirm_phonepe_payment" as never, {
            p_order_id: eventRow.order_id,
            p_provider_txn_id: providerTxnId ?? merchantTxnId,
            p_amount: providerAmountMajor ?? Number(eventRow.amount),
        } as never) as {
            data: { ok?: boolean; bill_id?: string; invoice_number?: string; already_confirmed?: boolean } | null
            error: unknown
        }
        if (rpcErr) throw rpcErr
        const invoiceNumber = rpcRes?.invoice_number ?? null
        const billId = rpcRes?.bill_id ?? null

        // Stamp the event row with the bill_id so future audits can join
        // payments back to the original PhonePe transaction.
        if (billId) {
            await service
                .from("phonepe_payment_events")
                .update({ bill_id: billId } as never)
                .eq("merchant_transaction_id", merchantTxnId)
        }

        // Best-effort POS UI refresh — if the cashier tab is open, this
        // is what flips the dialog to "Payment received — invoice X".
        // If the tab is closed, nothing breaks: the bill already exists.
        if (eventRow.flow === "POS" && eventRow.display_session_id) {
            await service
                .from("pos_display_sessions")
                .update({
                    status: "PAID",
                    invoice_number: invoiceNumber,
                } as never)
                .eq("id", eventRow.display_session_id)
        }
    } catch (e) {
        logError(e, {
            route: "/api/webhooks/phonepe",
            merchantTxnId,
            flow: eventRow.flow,
            stage: "finalize",
        })
        // Event is already SUCCESS — the operator can re-run finalisation
        // by hand. Still ack PhonePe so it doesn't keep retrying.
        return NextResponse.json({ ok: true, warning: "finalised event but downstream failed" })
    }

    logInfo("[phonepe webhook] payment success finalised", {
        merchantTxnId,
        tenant_id: eventRow.tenant_id,
        flow: eventRow.flow,
        amount: providerAmountMajor,
    })
    return NextResponse.json({ ok: true })
}
