import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { logError, logInfo } from "@/lib/errors"
import { GET as phonepeReconcile } from "@/app/api/payments/phonepe/reconcile/route"
import { GET as paytmReconcile } from "@/app/api/payments/paytm/reconcile/route"

/**
 * GET /api/cron/daily — the single daily maintenance tick.
 *
 * Vercel's Hobby plan allows at most 2 cron jobs, each firing once a day —
 * so instead of one schedule per task, this endpoint runs every periodic
 * job in sequence:
 *
 *   1. PhonePe reconcile  — finalises paid-but-webhook-missed transactions.
 *   2. Paytm reconcile    — same safety net for Paytm.
 *   3. HR auto-checkout   — staff who punched in but forgot to punch out
 *                           get checked out automatically once their
 *                           expected shift + a 2-hour grace has passed
 *                           (worked time = the expected shift, source
 *                           SYSTEM, audit-logged).
 *
 * Each step is isolated — a failure in one logs and moves on, so a PhonePe
 * outage can never block the attendance sweep. Auth: same CRON_SECRET
 * bearer the individual reconcile routes use. On a paid Vercel plan you can
 * still point an every-10-minutes schedule at the reconcile routes directly
 * for faster payment recovery; this daily tick stays correct either way.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET
    if (!secret) {
        return NextResponse.json({ error: "Cron not configured — set CRON_SECRET." }, { status: 503 })
    }
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }

    const results: Record<string, unknown> = {}
    const authedReq = () => new Request("http://cron.local/", {
        headers: { authorization: `Bearer ${secret}` },
    })

    // 1 + 2 — payment reconciles (each handler owns its own error handling).
    try {
        results.phonepe = await (await phonepeReconcile(authedReq())).json()
    } catch (e) {
        logError(e, { route: "/api/cron/daily", step: "phonepe" })
        results.phonepe = { error: "failed" }
    }
    try {
        results.paytm = await (await paytmReconcile(authedReq())).json()
    } catch (e) {
        logError(e, { route: "/api/cron/daily", step: "paytm" })
        results.paytm = { error: "failed" }
    }

    // 3 — HR auto-checkout sweep (SECURITY DEFINER RPC, service-role only).
    try {
        const service = createServiceRoleClient()
        const { data, error } = await service.rpc("hr_auto_checkout" as never)
        if (error) throw error
        results.hr_auto_checkout = data
    } catch (e) {
        logError(e, { route: "/api/cron/daily", step: "hr_auto_checkout" })
        results.hr_auto_checkout = { error: "failed" }
    }

    logInfo("[cron/daily] complete", results)
    return NextResponse.json({ ok: true, ...results })
}
