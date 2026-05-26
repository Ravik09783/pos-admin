import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { logError, logInfo } from "@/lib/errors"
import { paytmEnvCreds, paytmTransactionStatus, resolveTenantPaytmCreds, type PaytmCreds, type TenantPaytmRow } from "@/lib/billing/paytm"
import { finalizePaytmPayment } from "@/lib/billing/paytm-confirm"

/**
 * GET /api/payments/paytm/reconcile  — the missed-webhook safety net.
 *
 * Normally the Paytm webhook (`/api/webhooks/paytm`) confirms a payment
 * the instant the customer pays. But if a callback is dropped, the URL is
 * misconfigured, or Paytm has an outage, a genuinely-paid order would sit
 * forever as a PENDING `paytm_payment_events` row with no invoice.
 *
 * This job sweeps those: for every PENDING event that's a few minutes old
 * it polls Paytm's order-status API and finalises the ones that actually
 * succeeded — billed identically to the webhook path (same shared
 * `finalizePaytmPayment`). Idempotent: the confirm RPCs return the
 * existing bill for an already-billed order, so racing the webhook is
 * harmless.
 *
 * Schedule it every ~10 minutes. It's protected by `CRON_SECRET`:
 * the caller must send `Authorization: Bearer <CRON_SECRET>`. Vercel Cron
 * sends that header automatically (see vercel.json); any other scheduler
 * can hit the URL with the same header. Without CRON_SECRET set the
 * endpoint refuses to run, so it can't be triggered anonymously.
 */
export const dynamic = "force-dynamic"

/** PENDING events older than this are worth polling — a webhook would
 *  normally have landed within a couple of minutes. */
const MIN_AGE_MS = 3 * 60_000
/** Stop polling events older than this — a day-old PENDING is abandoned. */
const MAX_AGE_MS = 24 * 60 * 60_000
/** Cap per run so a backlog can't make one invocation run unbounded. */
const BATCH = 50

export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET
    if (!secret) {
        return NextResponse.json(
            { error: "Reconciliation is not configured — set CRON_SECRET in the environment." },
            { status: 503 },
        )
    }
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }

    const service = createServiceRoleClient()
    const now = Date.now()

    const { data: rows, error } = await service
        .from("paytm_payment_events")
        .select("paytm_order_id, tenant_id, order_id, display_session_id, amount, currency, flow, status")
        .eq("status", "PENDING")
        .lt("created_at", new Date(now - MIN_AGE_MS).toISOString())
        .gt("created_at", new Date(now - MAX_AGE_MS).toISOString())
        .order("created_at", { ascending: true })
        .limit(BATCH)
    if (error) {
        logError(error, { route: "/api/payments/paytm/reconcile", step: "load_pending" })
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const pending = (rows ?? []) as Array<{
        paytm_order_id: string
        tenant_id: string
        order_id: string | null
        display_session_id: string | null
        amount: number
        currency: string | null
        flow: string
        status: string
    }>

    let confirmed = 0, failed = 0, stillPending = 0, errored = 0
    // One creds lookup per tenant, reused across that tenant's events.
    const credsByTenant = new Map<string, PaytmCreds | null>()

    for (const ev of pending) {
        let creds = credsByTenant.get(ev.tenant_id)
        if (creds === undefined) {
            const { data: gw } = await service
                .from("tenant_payment_gateways")
                .select("paytm_mid, paytm_merchant_key, paytm_mid_staging, paytm_merchant_key_staging, paytm_enabled, paytm_env")
                .eq("tenant_id", ev.tenant_id)
                .maybeSingle()
            // Helper picks the right pair (production vs staging) per
            // `paytm_env`; falls back to platform .env creds.
            creds = resolveTenantPaytmCreds(gw as TenantPaytmRow | null) ?? paytmEnvCreds()
            credsByTenant.set(ev.tenant_id, creds)
        }
        if (!creds) { errored++; continue }

        const res = await paytmTransactionStatus(creds, ev.paytm_order_id)
        const txnStatus = res.data?.txnStatus ?? ""

        if (txnStatus === "TXN_SUCCESS") {
            const gross = Number(res.data?.txnAmount) || Number(ev.amount) || 0
            const { error: cErr } = await finalizePaytmPayment(
                service, ev, res.data?.txnId ?? "", gross,
                { source: "reconcile", ...(res.data ?? {}) } as Record<string, unknown>,
            )
            if (cErr) {
                errored++
                logError(new Error(cErr), {
                    route: "/api/payments/paytm/reconcile", orderId: ev.paytm_order_id,
                })
            } else {
                confirmed++
            }
        } else if (txnStatus === "TXN_FAILURE") {
            await service
                .from("paytm_payment_events")
                .update({
                    status: "FAILED",
                    processed_at: new Date().toISOString(),
                    raw: { source: "reconcile", ...(res.data ?? {}) } as never,
                } as never)
                .eq("paytm_order_id", ev.paytm_order_id)
            failed++
        } else {
            // Still PENDING at Paytm (customer hasn't paid) — leave it.
            stillPending++
        }
    }

    const summary = { checked: pending.length, confirmed, failed, stillPending, errored }
    if (pending.length > 0) logInfo("paytm reconcile run", summary)
    return NextResponse.json({ ok: true, ...summary })
}
