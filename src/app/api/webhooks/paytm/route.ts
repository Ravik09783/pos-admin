import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { logError, logInfo, logWarn } from "@/lib/errors"
import { paytmEnvCreds, paytmVerifySignature } from "@/lib/billing/paytm"
import { finalizePaytmPayment } from "@/lib/billing/paytm-confirm"

/**
 * Paytm payment webhook — `/api/webhooks/paytm`
 *
 * Configure this URL as the **callback / status-notification URL** in the
 * Paytm dashboard. One endpoint serves every tenant; we route by the
 * `MID` in the payload.
 *
 * Flow:
 *   1. Parse the notification (Paytm posts form-encoded params, but we
 *      also accept JSON).
 *   2. Look up the tenant by `MID` → get their Paytm merchant key.
 *   3. **Verify the CHECKSUMHASH** against that key. An unsigned /
 *      mis-signed callback is rejected (401) — NEVER trust an unsigned
 *      payment notification.
 *   4. Find our `paytm_payment_events` row by `ORDERID`.
 *   5. Idempotency: if the row is already SUCCESS, ack and stop —
 *      Paytm retries notifications.
 *   6. On TXN_SUCCESS → mark the event, then finalise the bill by
 *      reusing the SAME confirm RPCs the Stripe webhook uses:
 *        - cashier customer-display checkout → confirm_display_checkout_payment
 *        - customer QR-table order            → confirm_qr_order_system
 *      On failure → mark the event FAILED.
 *
 * The QR-issuing routes (the QR-ordering place-order route, and the POS
 * customer-display checkout) populate the `paytm_payment_events` row
 * up-front; if no row is found this handler simply acks with
 * `{ ignored: "unknown_order" }`.
 */
export async function POST(req: Request) {
    // ── 1. Parse the notification ───────────────────────────────────────
    const rawBody = await req.text()
    let params: Record<string, string> = {}
    const contentType = req.headers.get("content-type") ?? ""
    try {
        if (contentType.includes("application/json")) {
            const j = JSON.parse(rawBody) as Record<string, unknown>
            // Paytm JSON callbacks nest the txn under `body`; flatten either way.
            const flat = (j.body as Record<string, unknown>) ?? j
            for (const [k, v] of Object.entries(flat)) params[k] = String(v ?? "")
        } else {
            for (const [k, v] of new URLSearchParams(rawBody)) params[k] = v
        }
    } catch {
        return NextResponse.json({ error: "unparseable body" }, { status: 400 })
    }

    const mid       = params.MID ?? params.mid ?? ""
    const orderId   = params.ORDERID ?? params.orderId ?? ""
    const txnId     = params.TXNID ?? params.txnId ?? ""
    const txnAmount = params.TXNAMOUNT ?? params.txnAmount ?? "0"
    const status    = (params.STATUS ?? params.status ?? "").toUpperCase()
    const checksum  = params.CHECKSUMHASH ?? params.checksumhash ?? ""

    if (!mid || !orderId) {
        return NextResponse.json({ error: "missing MID / ORDERID" }, { status: 400 })
    }

    const supabase = createServiceRoleClient()

    // ── 2. Resolve the merchant key for this MID ────────────────────────
    // Prefer the tenant's own key (tenant_payment_gateways); fall back to
    // the platform .env creds when the env MID matches — the single-
    // restaurant / dev-testing path.
    let merchantKey: string | null = null
    const { data: gwRow } = await supabase
        .from("tenant_payment_gateways")
        .select("paytm_merchant_key")
        .eq("paytm_mid", mid)
        .maybeSingle()
    merchantKey = (gwRow as { paytm_merchant_key?: string | null } | null)?.paytm_merchant_key ?? null
    if (!merchantKey) {
        const envCreds = paytmEnvCreds()
        if (envCreds && envCreds.mid === mid) merchantKey = envCreds.merchantKey
    }
    if (!merchantKey) {
        logWarn("paytm webhook: no merchant key for MID", { mid })
        // 200 so Paytm stops retrying a callback we can never handle.
        return NextResponse.json({ ok: true, ignored: "unknown_mid" })
    }

    // ── 3. Verify the checksum ──────────────────────────────────────────
    // Build the param set Paytm signed — everything EXCEPT the checksum.
    if (!checksum) {
        return NextResponse.json({ error: "missing checksum" }, { status: 401 })
    }
    const signedParams: Record<string, string> = { ...params }
    delete signedParams.CHECKSUMHASH
    delete signedParams.checksumhash
    if (!paytmVerifySignature(signedParams, merchantKey, checksum)) {
        logError(new Error("paytm webhook: checksum verification failed"), { mid, orderId })
        return NextResponse.json({ error: "invalid checksum" }, { status: 401 })
    }

    // ── 4. Find our tracked event ───────────────────────────────────────
    const { data: evRow } = await supabase
        .from("paytm_payment_events")
        .select("paytm_order_id, tenant_id, order_id, display_session_id, amount, currency, flow, status")
        .eq("paytm_order_id", orderId)
        .maybeSingle()
    const ev = evRow as {
        paytm_order_id: string
        tenant_id: string
        order_id: string | null
        display_session_id: string | null
        amount: number
        currency: string | null
        flow: string
        status: string
    } | null
    if (!ev) {
        logWarn("paytm webhook: no tracked event for ORDERID", { mid, orderId })
        return NextResponse.json({ ok: true, ignored: "unknown_order" })
    }

    // ── 5. Idempotency — Paytm retries notifications ────────────────────
    if (ev.status === "SUCCESS") {
        return NextResponse.json({ ok: true, deduped: orderId })
    }

    // ── 6a. Failed / cancelled payment ──────────────────────────────────
    if (status !== "TXN_SUCCESS") {
        await supabase
            .from("paytm_payment_events")
            .update({
                status: "FAILED",
                paytm_txn_id: txnId || null,
                raw: params as never,
                processed_at: new Date().toISOString(),
            } as never)
            .eq("paytm_order_id", orderId)
        logInfo("paytm webhook: payment not successful", { orderId, status })
        return NextResponse.json({ ok: true, status })
    }

    // ── 6b. Successful payment → finalise the bill ──────────────────────
    // Shared with the reconciliation job (`/api/payments/paytm/reconcile`)
    // so a webhook-driven payment and a recovered one are billed the same
    // way. `finalizePaytmPayment` routes to the right confirm RPC, records
    // the payment as PAYTM, and marks the event SUCCESS.
    const gross = Number(txnAmount) || Number(ev.amount) || 0
    const { billId, error: confirmErr } = await finalizePaytmPayment(
        supabase, ev, txnId, gross, params,
    )
    if (confirmErr) {
        logError(new Error(confirmErr), { route: "/api/webhooks/paytm", step: "finalize", orderId })
        return NextResponse.json({ error: confirmErr }, { status: 500 })
    }

    // Refresh the public bill cache so the customer's /b/:slug/:invoice
    // page reflects PAID immediately.
    try {
        const { revalidateTag } = await import("next/cache")
        revalidateTag("public-bill", "max")
    } catch { /* best-effort */ }

    logInfo("paytm webhook: payment captured", {
        tenantId: ev.tenant_id, orderId, txnId, amount: gross, billId,
    })
    return NextResponse.json({ ok: true, bill_id: billId })
}
