import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { requireSuperAdmin } from "@/lib/super-admin/guard"
import { logError, logInfo } from "@/lib/errors"

/**
 * POST /api/super-admin/tenant/[id]/extend-trial
 *
 * Push out a tenant's `trial_ends_at` so they get more free time on
 * the platform before billing kicks in. Two body shapes are accepted:
 *
 *   { days: 30 }                          → bumps trial_ends_at to
 *                                            max(now, current) + 30 days
 *   { trial_ends_at: "2030-12-31" }       → sets explicit date (must be
 *                                            in the future, capped at
 *                                            +20 years to catch typos)
 *
 * When `days` is passed, the math anchors on `now` when the current
 * trial is already expired — so "extend by 30 days" on a 2-day-overdue
 * trial gives 30 future days, not 28. When the current trial is still
 * running we add days on top of it.
 *
 * If the tenant's subscription_status is CANCELED or SUSPENDED we also
 * flip it back to TRIAL so the user can sign back in without
 * separately reactivating. ACTIVE / PAST_DUE stays unchanged — those
 * tenants have a live Stripe sub and shouldn't be downgraded to TRIAL
 * here by accident.
 *
 * Authorization: super-admin only (same guard as the other routes).
 * Audit: every successful call logs the before/after dates + caller.
 */
export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    const { id: tenantId } = await params
    if (!tenantId || tenantId.length < 8) {
        return NextResponse.json({ error: "invalid tenant id" }, { status: 400 })
    }

    const body = (await req.json().catch(() => null)) as {
        days?: number
        trial_ends_at?: string
    } | null
    if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 })

    // ── Resolve the target date ────────────────────────────────────────
    const now = Date.now()
    const MAX_FUTURE_MS = 20 * 365 * 24 * 3600 * 1000 // 20 years
    let targetMs: number

    if (typeof body.days === "number") {
        if (!Number.isFinite(body.days) || body.days <= 0 || body.days > 20 * 365) {
            return NextResponse.json({
                error: "days must be a positive number ≤ 7300 (20 years)",
            }, { status: 400 })
        }
        // Read current trial_ends_at to anchor the math.
        const service = createServiceRoleClient()
        const { data: row, error: readErr } = await service
            .from("tenants")
            .select("trial_ends_at")
            .eq("id", tenantId)
            .maybeSingle()
        if (readErr || !row) {
            return NextResponse.json({ error: readErr?.message ?? "tenant not found" }, { status: 404 })
        }
        const current = (row as { trial_ends_at?: string | null }).trial_ends_at
        const anchor = current ? Math.max(now, new Date(current).getTime()) : now
        targetMs = anchor + body.days * 24 * 3600 * 1000
    } else if (typeof body.trial_ends_at === "string") {
        const parsed = new Date(body.trial_ends_at).getTime()
        if (!Number.isFinite(parsed)) {
            return NextResponse.json({ error: "trial_ends_at must be a valid date string" }, { status: 400 })
        }
        if (parsed <= now) {
            return NextResponse.json({ error: "trial_ends_at must be in the future" }, { status: 400 })
        }
        if (parsed - now > MAX_FUTURE_MS) {
            return NextResponse.json({ error: "trial_ends_at can be at most 20 years from now" }, { status: 400 })
        }
        targetMs = parsed
    } else {
        return NextResponse.json({
            error: "body must include either { days } or { trial_ends_at }",
        }, { status: 400 })
    }

    const newDate = new Date(targetMs).toISOString()

    // ── Persist + optional status revival ───────────────────────────────
    const service = createServiceRoleClient()
    const { data: before } = await service
        .from("tenants")
        .select("trial_ends_at, subscription_status")
        .eq("id", tenantId)
        .maybeSingle()
    const prevStatus = (before as { subscription_status?: string | null } | null)?.subscription_status ?? null
    const prevTrialEnd = (before as { trial_ends_at?: string | null } | null)?.trial_ends_at ?? null

    // Bring CANCELED / SUSPENDED tenants back to TRIAL. ACTIVE /
    // PAST_DUE / TRIAL stay as they are — extending trial_ends_at on
    // an ACTIVE Stripe sub is unusual but harmless; we don't want to
    // accidentally flip a paying customer off their paid plan.
    const reviveToTrial = prevStatus === "CANCELED" || prevStatus === "SUSPENDED"

    const updatePayload: Record<string, unknown> = { trial_ends_at: newDate }
    if (reviveToTrial) updatePayload.subscription_status = "TRIAL"

    const { error: updErr } = await service
        .from("tenants")
        .update(updatePayload as never)
        .eq("id", tenantId)
    if (updErr) {
        logError(updErr, { route: "extend-trial", tenantId })
        return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

    logInfo("super-admin extended tenant trial", {
        superAdminEmail: guard.email,
        tenantId,
        prevTrialEnd,
        newTrialEnd: newDate,
        prevStatus,
        revivedToTrial: reviveToTrial,
        addedDays: typeof body.days === "number" ? body.days : null,
    })

    return NextResponse.json({
        ok: true,
        trial_ends_at: newDate,
        subscription_status: reviveToTrial ? "TRIAL" : prevStatus,
        revived: reviveToTrial,
    })
}
