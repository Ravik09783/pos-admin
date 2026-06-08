import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { logError, logInfo } from "@/lib/errors"
import {
    pollPaytmStatus,
    paytmEnvCreds,
    resolveTenantPaytmCreds,
    type PaytmCreds,
    type TenantPaytmRow,
} from "@/lib/billing/paytm"

/**
 * GET /api/payments/paytm/reconcile — the missed-webhook safety net (Paytm).
 *
 * Sweeps PENDING paytm_payment_events a few minutes old, polls Paytm's order-
 * status API, and finalises the ones that actually succeeded — billed
 * identically to the webhook path (confirm_qr_order_system for QR_ORDER,
 * confirm_display_checkout_payment for POS, both with p_method='PAYTM').
 * Idempotent via the WHERE status='PENDING' guard + idempotent confirm RPCs.
 *
 * Schedule ~every 10 min. Protected by CRON_SECRET (Authorization: Bearer …).
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

const MIN_AGE_MS = 3 * 60_000
const MAX_AGE_MS = 24 * 60 * 60_000
const BATCH = 50

interface EventRow {
    paytm_order_id: string
    tenant_id: string
    order_id: string | null
    display_session_id: string | null
    bill_id: string | null
    amount: number
    flow: "POS" | "QR_ORDER"
}

export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET
    if (!secret) {
        return NextResponse.json({ error: "Reconciliation is not configured — set CRON_SECRET." }, { status: 503 })
    }
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }

    const service = createServiceRoleClient()
    const now = Date.now()

    const { data: rows, error } = await service
        .from("paytm_payment_events")
        .select("paytm_order_id, tenant_id, order_id, display_session_id, bill_id, amount, flow")
        .eq("status", "PENDING")
        .lt("created_at", new Date(now - MIN_AGE_MS).toISOString())
        .gt("created_at", new Date(now - MAX_AGE_MS).toISOString())
        .order("created_at", { ascending: true })
        .limit(BATCH) as { data: EventRow[] | null; error: unknown }

    if (error) {
        logError(error, { route: "/api/payments/paytm/reconcile", stage: "load_pending" })
        return NextResponse.json({ error: "couldn't load pending events" }, { status: 500 })
    }
    if (!rows || rows.length === 0) {
        return NextResponse.json({ ok: true, swept: 0, succeeded: 0, failed: 0, still_pending: 0 })
    }

    const credsCache = new Map<string, PaytmCreds | null>()
    async function credsFor(tenantId: string): Promise<PaytmCreds | null> {
        if (credsCache.has(tenantId)) return credsCache.get(tenantId)!
        const { data: gw } = await service
            .from("tenant_payment_gateways")
            .select("paytm_mid, paytm_merchant_key, paytm_mid_staging, paytm_merchant_key_staging, paytm_enabled, paytm_env")
            .eq("tenant_id", tenantId)
            .maybeSingle() as { data: TenantPaytmRow | null }
        const creds = resolveTenantPaytmCreds(gw) ?? paytmEnvCreds()
        credsCache.set(tenantId, creds)
        return creds
    }

    let succeeded = 0, failed = 0, stillPending = 0

    for (const row of rows) {
        const creds = await credsFor(row.tenant_id)
        if (!creds) { stillPending++; continue }

        const status = await pollPaytmStatus(creds, row.paytm_order_id)
        if (!status.ok) { stillPending++; continue }
        const isSuccess = status.state === "COMPLETED"
        const isFailed = status.state === "FAILED"
        if (!isSuccess && !isFailed) { stillPending++; continue }

        const newStatus = isSuccess ? "SUCCESS" : "FAILED"
        const { error: updateErr } = await service
            .from("paytm_payment_events")
            .update({ status: newStatus, paytm_txn_id: status.providerTxnId ?? null, raw: status.raw, processed_at: new Date().toISOString() } as never)
            .eq("paytm_order_id", row.paytm_order_id)
            .eq("status", "PENDING")
        if (updateErr) { stillPending++; continue }
        if (newStatus === "FAILED") { failed++; continue }

        try {
            if (!row.order_id) { succeeded++; continue }
            const amount = status.amount ?? Number(row.amount)
            let billId: string | null = null
            let invoiceNumber: string | null = null
            if (row.flow === "QR_ORDER") {
                const { data: rpcRes, error: rpcErr } = await service.rpc("confirm_qr_order_system" as never, {
                    p_order_id: row.order_id, p_razorpay_payment_id: status.providerTxnId ?? row.paytm_order_id, p_amount: amount, p_method: "PAYTM",
                } as never) as { data: { bill_id?: string; invoice_number?: string } | null; error: unknown }
                if (rpcErr) throw rpcErr
                billId = rpcRes?.bill_id ?? null
                invoiceNumber = rpcRes?.invoice_number ?? null
            } else {
                const { data: rpcRes, error: rpcErr } = await service.rpc("confirm_display_checkout_payment" as never, {
                    p_order_id: row.order_id, p_display_session_id: row.display_session_id, p_stripe_intent_id: status.providerTxnId ?? row.paytm_order_id,
                    p_gross_amount: amount, p_platform_fee: 0, p_currency: "inr", p_method: "PAYTM",
                } as never) as { data: { bill_id?: string; invoice_number?: string } | null; error: unknown }
                if (rpcErr) throw rpcErr
                billId = rpcRes?.bill_id ?? null
                invoiceNumber = rpcRes?.invoice_number ?? null
            }
            if (billId) {
                await service.from("paytm_payment_events").update({ bill_id: billId } as never).eq("paytm_order_id", row.paytm_order_id)
            }
            if (row.flow === "POS" && row.display_session_id && invoiceNumber) {
                await service.from("pos_display_sessions").update({ status: "PAID", invoice_number: invoiceNumber } as never).eq("id", row.display_session_id)
            }
            succeeded++
        } catch (e) {
            logError(e, { route: "/api/payments/paytm/reconcile", paytmOrderId: row.paytm_order_id, flow: row.flow, stage: "finalise" })
            succeeded++
        }
    }

    const summary = { ok: true, swept: rows.length, succeeded, failed, still_pending: stillPending }
    logInfo("[paytm reconcile] sweep complete", summary)
    return NextResponse.json(summary)
}
