import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { logError, logInfo } from "@/lib/errors"
import {
    paytmEnvCreds,
    resolveTenantPaytmCreds,
    verifyPaytmWebhook,
    type PaytmCreds,
    type TenantPaytmRow,
} from "@/lib/billing/paytm"

/**
 * POST /api/webhooks/paytm
 *
 * One shared callback URL for every restaurant — the payload's MID + ORDERID
 * do the targeting. On each callback we:
 *   1. Parse the params (Paytm posts form-encoded; we also accept JSON).
 *   2. Find our paytm_payment_events row by ORDERID → gives us the tenant +
 *      order/display-session + flow.
 *   3. Resolve that tenant's Paytm key and VERIFY the CHECKSUMHASH. A forged
 *      "TXN_SUCCESS" is the whole attack surface — reject on mismatch (401).
 *   4. Flip the event row SUCCESS/FAILED (idempotent: paytm_order_id PK +
 *      status='PENDING' guard make webhook retries safe no-ops).
 *   5. On SUCCESS, materialise the bill via the same confirm RPCs the Stripe
 *      flow uses, passing p_method='PAYTM':
 *         flow='QR_ORDER' → confirm_qr_order_system(order_id, txnId, amount, 'PAYTM')
 *         flow='POS'      → confirm_display_checkout_payment(order_id, session, txnId, amount, 0, 'inr', 'PAYTM')
 *      Both atomically create bills + payments(method='PAYTM') and are
 *      idempotent on order_id, so a webhook + reconcile-cron race only ever
 *      mints ONE bill.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** Endpoint-existence probe (Paytm dashboard validates the URL with a GET). */
export async function GET() {
    return NextResponse.json({
        ok: true,
        endpoint: "paytm-webhook",
        method: "POST",
        message: "Send Paytm transaction-status callbacks here via POST. GET is for endpoint probes only.",
    })
}

export async function POST(req: Request) {
    // Parse params — Paytm posts application/x-www-form-urlencoded; accept JSON too.
    const contentType = req.headers.get("content-type") ?? ""
    let params: Record<string, string> = {}
    try {
        if (contentType.includes("application/json")) {
            params = (await req.json()) as Record<string, string>
        } else {
            const form = await req.formData()
            for (const [k, v] of form.entries()) params[k] = String(v)
        }
    } catch {
        return NextResponse.json({ error: "couldn't parse callback body" }, { status: 400 })
    }

    const orderId = params.ORDERID ?? params.orderId
    if (!orderId) {
        return NextResponse.json({ error: "missing ORDERID" }, { status: 400 })
    }

    const service = createServiceRoleClient()

    const { data: eventRow, error: eventErr } = await service
        .from("paytm_payment_events")
        .select("paytm_order_id, tenant_id, order_id, display_session_id, bill_id, amount, flow, status")
        .eq("paytm_order_id", orderId)
        .maybeSingle() as { data: {
            paytm_order_id: string
            tenant_id: string
            order_id: string | null
            display_session_id: string | null
            bill_id: string | null
            amount: number
            flow: "POS" | "QR_ORDER"
            status: "PENDING" | "SUCCESS" | "FAILED"
        } | null; error: unknown }

    if (eventErr || !eventRow) {
        logError(eventErr ?? `no paytm event for ${orderId}`, { route: "/api/webhooks/paytm", orderId })
        return NextResponse.json({ error: "unknown transaction" }, { status: 404 })
    }

    if (eventRow.status !== "PENDING") {
        return NextResponse.json({ ok: true, alreadyProcessed: true })
    }

    // Resolve this tenant's Paytm credentials (per-tenant first, then platform .env).
    const { data: gw } = await service
        .from("tenant_payment_gateways")
        .select("paytm_mid, paytm_merchant_key, paytm_mid_staging, paytm_merchant_key_staging, paytm_enabled, paytm_env")
        .eq("tenant_id", eventRow.tenant_id)
        .maybeSingle() as { data: TenantPaytmRow | null }
    const creds: PaytmCreds | null = resolveTenantPaytmCreds(gw) ?? paytmEnvCreds()
    if (!creds) {
        logError(`no paytm creds for tenant ${eventRow.tenant_id}`, { route: "/api/webhooks/paytm", orderId })
        return NextResponse.json({ error: "credentials unavailable" }, { status: 500 })
    }

    // CRITICAL trust boundary — verify CHECKSUMHASH before touching any state.
    if (!verifyPaytmWebhook(params, creds.key)) {
        logError("[paytm webhook] CHECKSUMHASH mismatch — refusing", {
            route: "/api/webhooks/paytm", orderId, tenant_id: eventRow.tenant_id,
        })
        return NextResponse.json({ error: "signature invalid" }, { status: 401 })
    }

    // Trusted from here.
    const status = (params.STATUS ?? params.status ?? "").toUpperCase()
    const providerTxnId = params.TXNID ?? params.txnId ?? null
    const providerAmount = params.TXNAMOUNT != null ? Number(params.TXNAMOUNT) : null
    const isSuccess = status === "TXN_SUCCESS"
    const isFailed = status === "TXN_FAILURE"

    const newStatus = isSuccess ? "SUCCESS" : isFailed ? "FAILED" : "PENDING"
    if (newStatus === "PENDING") {
        await service.from("paytm_payment_events").update({ raw: params } as never).eq("paytm_order_id", orderId)
        return NextResponse.json({ ok: true, state: status })
    }

    const { error: updateErr } = await service
        .from("paytm_payment_events")
        .update({
            status: newStatus,
            paytm_txn_id: providerTxnId,
            raw: params,
            processed_at: new Date().toISOString(),
        } as never)
        .eq("paytm_order_id", orderId)
        .eq("status", "PENDING")  // race guard with the reconcile cron
    if (updateErr) {
        logError(updateErr, { route: "/api/webhooks/paytm", orderId })
        return NextResponse.json({ error: "couldn't update event" }, { status: 500 })
    }

    if (newStatus === "FAILED") {
        logInfo("[paytm webhook] payment failed", { orderId, tenant_id: eventRow.tenant_id, status })
        return NextResponse.json({ ok: true, state: "FAILED" })
    }

    // SUCCESS — materialise the bill via the flow-specific confirm RPC.
    try {
        if (!eventRow.order_id) {
            logError(`paytm success without order_id: ${orderId}`, { route: "/api/webhooks/paytm", orderId })
            return NextResponse.json({ ok: true, warning: "payment recorded but order_id missing — manual reconciliation needed" })
        }
        const amount = providerAmount ?? Number(eventRow.amount)
        let billId: string | null = null
        let invoiceNumber: string | null = null

        if (eventRow.flow === "QR_ORDER") {
            const { data: rpcRes, error: rpcErr } = await service.rpc("confirm_qr_order_system" as never, {
                p_order_id: eventRow.order_id,
                p_razorpay_payment_id: providerTxnId ?? orderId,
                p_amount: amount,
                p_method: "PAYTM",
            } as never) as { data: { bill_id?: string; invoice_number?: string } | null; error: unknown }
            if (rpcErr) throw rpcErr
            billId = rpcRes?.bill_id ?? null
            invoiceNumber = rpcRes?.invoice_number ?? null
        } else {
            const { data: rpcRes, error: rpcErr } = await service.rpc("confirm_display_checkout_payment" as never, {
                p_order_id: eventRow.order_id,
                p_display_session_id: eventRow.display_session_id,
                p_stripe_intent_id: providerTxnId ?? orderId,
                p_gross_amount: amount,
                p_platform_fee: 0,
                p_currency: "inr",
                p_method: "PAYTM",
            } as never) as { data: { bill_id?: string; invoice_number?: string } | null; error: unknown }
            if (rpcErr) throw rpcErr
            billId = rpcRes?.bill_id ?? null
            invoiceNumber = rpcRes?.invoice_number ?? null
        }

        if (billId) {
            await service.from("paytm_payment_events").update({ bill_id: billId } as never).eq("paytm_order_id", orderId)
        }
        // confirm_display_checkout_payment already flips the display session to
        // PAID; this is a no-op safety net for the invoice mirror.
        if (eventRow.flow === "POS" && eventRow.display_session_id && invoiceNumber) {
            await service.from("pos_display_sessions")
                .update({ status: "PAID", invoice_number: invoiceNumber } as never)
                .eq("id", eventRow.display_session_id)
        }
    } catch (e) {
        logError(e, { route: "/api/webhooks/paytm", orderId, flow: eventRow.flow, stage: "finalize" })
        return NextResponse.json({ ok: true, warning: "finalised event but downstream failed" })
    }

    logInfo("[paytm webhook] payment success finalised", { orderId, tenant_id: eventRow.tenant_id, flow: eventRow.flow })
    return NextResponse.json({ ok: true })
}
