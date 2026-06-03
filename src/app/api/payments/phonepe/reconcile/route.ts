import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { logError, logInfo } from "@/lib/errors"
import {
    pollPhonePeStatus,
    phonepeEnvCreds,
    resolveTenantPhonePeCreds,
    type PhonePeCreds,
    type TenantPhonePeRow,
} from "@/lib/billing/phonepe"

/**
 * GET /api/payments/phonepe/reconcile  — the missed-webhook safety net.
 *
 * Normally the PhonePe webhook (`/api/webhooks/phonepe`) confirms a
 * payment the instant the customer pays. But if a callback is dropped,
 * the URL is misconfigured, or PhonePe has an outage, a genuinely-paid
 * transaction would sit forever as a PENDING `phonepe_payment_events`
 * row with no bill ever materialising.
 *
 * This job sweeps those: for every PENDING event that's a few minutes
 * old it polls PhonePe's status API and finalises the ones that
 * actually succeeded — billed identically to the webhook path (same
 * downstream `confirm_qr_order_system` RPC for QR_ORDER flow, same
 * `pos_display_sessions.status = 'PAID'` flip for POS flow).
 *
 * Idempotent: the webhook + the cron compete for the same PENDING
 * rows, but the row update is guarded by `WHERE status = 'PENDING'`,
 * so racing each other is harmless — whichever side gets there first
 * wins, the other one no-ops.
 *
 * Schedule it every ~10 minutes. Protected by `CRON_SECRET`: the
 * caller must send `Authorization: Bearer <CRON_SECRET>`. Vercel
 * Cron sends that header automatically; any other scheduler can hit
 * the URL with the same header. Without CRON_SECRET set the endpoint
 * refuses to run.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
// Vercel default is 10s; status polling for 50 events @ ~600ms each
// can run close to 30s on a bad day. 60s is the Hobby ceiling.
export const maxDuration = 60

/** PENDING events older than this are worth polling — a webhook would
 *  normally have landed within a couple of minutes. */
const MIN_AGE_MS = 3 * 60_000
/** Stop polling events older than this — a day-old PENDING is abandoned. */
const MAX_AGE_MS = 24 * 60 * 60_000
/** Cap per run so a backlog can't make one invocation run unbounded. */
const BATCH = 50

interface EventRow {
    merchant_transaction_id: string
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
        .from("phonepe_payment_events")
        .select("merchant_transaction_id, tenant_id, order_id, display_session_id, bill_id, amount, flow")
        .eq("status", "PENDING")
        .lt("created_at", new Date(now - MIN_AGE_MS).toISOString())
        .gt("created_at", new Date(now - MAX_AGE_MS).toISOString())
        .order("created_at", { ascending: true })
        .limit(BATCH) as { data: EventRow[] | null; error: unknown }

    if (error) {
        logError(error, { route: "/api/payments/phonepe/reconcile", stage: "load_pending" })
        return NextResponse.json({ error: "couldn't load pending events" }, { status: 500 })
    }
    if (!rows || rows.length === 0) {
        return NextResponse.json({ ok: true, swept: 0, succeeded: 0, failed: 0, still_pending: 0 })
    }

    // Cache creds per-tenant — multiple PENDING rows for the same
    // tenant don't need to re-load the gateway row.
    const tenantCredsCache = new Map<string, PhonePeCreds | null>()
    async function credsFor(tenantId: string): Promise<PhonePeCreds | null> {
        if (tenantCredsCache.has(tenantId)) return tenantCredsCache.get(tenantId)!
        const { data: gw } = await service
            .from("tenant_payment_gateways")
            .select("phonepe_mid, phonepe_merchant_key, phonepe_salt_index, phonepe_mid_staging, phonepe_merchant_key_staging, phonepe_salt_index_staging, phonepe_enabled, phonepe_env")
            .eq("tenant_id", tenantId)
            .maybeSingle() as { data: TenantPhonePeRow | null }
        const creds = resolveTenantPhonePeCreds(gw) ?? phonepeEnvCreds()
        tenantCredsCache.set(tenantId, creds)
        return creds
    }

    let succeeded = 0
    let failed = 0
    let stillPending = 0

    for (const row of rows) {
        const creds = await credsFor(row.tenant_id)
        if (!creds) {
            // Without credentials we can't poll — leave the row PENDING
            // for now. Operator needs to either reconnect PhonePe or
            // manually FAIL these rows.
            stillPending++
            continue
        }

        const status = await pollPhonePeStatus(creds, row.merchant_transaction_id)
        if (!status.ok) {
            stillPending++
            logError(`poll status returned !ok for ${row.merchant_transaction_id}: ${status.message}`, {
                route: "/api/payments/phonepe/reconcile",
                tenant_id: row.tenant_id,
                merchantTxnId: row.merchant_transaction_id,
            })
            continue
        }

        const isSuccess = status.state === "COMPLETED"
        const isFailed = status.state === "FAILED"
        if (!isSuccess && !isFailed) {
            // Still PENDING on PhonePe's side — leave alone.
            stillPending++
            continue
        }

        const newStatus = isSuccess ? "SUCCESS" : "FAILED"
        const { error: updateErr } = await service
            .from("phonepe_payment_events")
            .update({
                status: newStatus,
                provider_txn_id: status.providerTxnId ?? null,
                raw: status.raw,
                processed_at: new Date().toISOString(),
            } as never)
            .eq("merchant_transaction_id", row.merchant_transaction_id)
            // Same `WHERE status = 'PENDING'` guard as the webhook —
            // means the webhook + cron can race safely.
            .eq("status", "PENDING")
        if (updateErr) {
            logError(updateErr, {
                route: "/api/payments/phonepe/reconcile",
                merchantTxnId: row.merchant_transaction_id,
                stage: "update_event",
            })
            stillPending++
            continue
        }

        if (newStatus === "FAILED") {
            failed++
            continue
        }

        // SUCCESS — call the same RPC the webhook uses. Idempotent on
        // order_id (returns the existing bill if one was already minted),
        // so a webhook + cron racing the same event is harmless: only
        // the first call inserts; the second sees the bill already
        // exists and returns. POS and QR_ORDER both flow through here.
        try {
            if (!row.order_id) {
                logError(
                    `reconcile saw SUCCESS event without order_id — manual fixup required: ${row.merchant_transaction_id}`,
                    { route: "/api/payments/phonepe/reconcile", merchantTxnId: row.merchant_transaction_id, flow: row.flow },
                )
                // Count as succeeded so the cron metric reflects what we recovered,
                // but the operator must reconcile by hand.
                succeeded++
                continue
            }
            const { data: rpcRes, error: rpcErr } = await service.rpc("confirm_phonepe_payment" as never, {
                p_order_id: row.order_id,
                p_provider_txn_id: status.providerTxnId ?? row.merchant_transaction_id,
                p_amount: status.amount ?? Number(row.amount),
            } as never) as {
                data: { ok?: boolean; bill_id?: string; invoice_number?: string } | null
                error: unknown
            }
            if (rpcErr) throw rpcErr

            // Mirror the bill_id onto the event row + flip the POS
            // display so the cashier UI catches up when they next look.
            if (rpcRes?.bill_id) {
                await service
                    .from("phonepe_payment_events")
                    .update({ bill_id: rpcRes.bill_id } as never)
                    .eq("merchant_transaction_id", row.merchant_transaction_id)
            }
            if (row.flow === "POS" && row.display_session_id) {
                await service
                    .from("pos_display_sessions")
                    .update({
                        status: "PAID",
                        invoice_number: rpcRes?.invoice_number ?? null,
                    } as never)
                    .eq("id", row.display_session_id)
            }
            succeeded++
        } catch (e) {
            logError(e, {
                route: "/api/payments/phonepe/reconcile",
                merchantTxnId: row.merchant_transaction_id,
                flow: row.flow,
                stage: "finalise",
            })
            // Event is marked SUCCESS — operator will need to re-run
            // finalisation by hand. Count it as succeeded for the
            // summary so the cron metric reflects how many we recovered.
            succeeded++
        }
    }

    const summary = { ok: true, swept: rows.length, succeeded, failed, still_pending: stillPending }
    logInfo("[phonepe reconcile] sweep complete", summary)
    return NextResponse.json(summary)
}
