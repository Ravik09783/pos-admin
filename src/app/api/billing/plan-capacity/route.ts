import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { planOverrideUnlimited } from "@/lib/billing/plans"

/**
 * GET /api/billing/plan-capacity
 *
 * Returns the `plan_capacity_summary(tenant_id)` JSON for the caller's
 * tenant (migration 29). Powers the in-app "seats used per outlet"
 * meter on /settings/staff and the "outlets used" meter on
 * /settings/branches.
 *
 * Shape (mirrors the SQL function exactly):
 *   {
 *     tier: string | null,
 *     status: "TRIAL" | "ACTIVE" | "PAST_DUE" | ...,
 *     unlimited: boolean,
 *     max_branches: number | null,
 *     active_branches: number,
 *     inactive_branches: number,
 *     max_staff_per_branch: number | null,
 *     branches_at_cap: boolean,
 *     branches: [{
 *       id, name, is_main, is_active,
 *       active_staff, inactive_staff, staff_at_cap
 *     }]
 *   }
 *
 * Unlike `/plan-overage` (which only surfaces seats OVER the cap), this
 * endpoint always returns the full capacity picture so the UI can show
 * "2 of 3 used" even when nothing is over.
 *
 * Env-override (`RESTOPOS_PLAN_OVERRIDE=unlimited`) collapses every cap
 * to the unlimited path — same shape, just `unlimited: true`.
 */
export async function GET() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { data: row } = await supabase
        .from("users").select("tenant_id").eq("id", user.id).maybeSingle()
    const tenantId = (row as { tenant_id?: string } | null)?.tenant_id
    if (!tenantId) return NextResponse.json({ error: "no_tenant" }, { status: 403 })

    if (planOverrideUnlimited()) {
        return NextResponse.json({
            tier: null,
            status: "ACTIVE",
            unlimited: true,
            max_branches: null,
            active_branches: 0,
            inactive_branches: 0,
            max_staff_per_branch: null,
            branches_at_cap: false,
            branches: [],
            override: "unlimited",
        })
    }

    const { data, error } = await supabase.rpc(
        "plan_capacity_summary" as never,
        { p_tenant_id: tenantId } as never,
    )
    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json(data ?? {})
}
