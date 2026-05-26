import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { planOverrideUnlimited } from "@/lib/billing/plans"

/**
 * GET /api/billing/plan-overage
 *
 * Wraps the SQL `plan_overage(tenant_id)` RPC and adds the stored plan
 * tier alongside the count of locked-out branches and staff. Used by
 * the OWNER-only `<PlanOverageBanner />` to render:
 *
 *   "2 outlets and 5 staff seats are locked by your plan — Upgrade →"
 *
 * Empty response (zeros + locked:false) means everything fits — banner
 * silently doesn't render.
 *
 * When the global env override `RESTOPOS_PLAN_OVERRIDE=unlimited` is set,
 * we skip the RPC entirely and return all-zeros so no banner ever shows.
 */
export async function GET() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { data: row } = await supabase
        .from("users").select("tenant_id, role").eq("id", user.id).maybeSingle()
    const tenantId = (row as { tenant_id?: string } | null)?.tenant_id
    const role     = (row as { role?: string } | null)?.role
    if (!tenantId) return NextResponse.json({ error: "no_tenant" }, { status: 403 })

    // Cheap exit: env says we don't enforce plans, so no overage is
    // possible — return the empty shape without DB round-tripping.
    if (planOverrideUnlimited()) {
        return NextResponse.json({
            extra_branches: 0, extra_staff: 0, locked: false,
            plan_tier: null, max_branches: null, max_staff_per_branch: null,
            override: "unlimited",
        })
    }

    const [overageRes, tenantRes] = await Promise.all([
        supabase.rpc("plan_overage" as never, { p_tenant_id: tenantId } as never),
        supabase.from("tenants")
            .select("plan_tier, plan_max_branches, plan_max_staff_per_br")
            .eq("id", tenantId)
            .maybeSingle(),
    ])
    if (overageRes.error) {
        return NextResponse.json({ error: overageRes.error.message }, { status: 500 })
    }
    const tenant = tenantRes.data as {
        plan_tier?: string | null
        plan_max_branches?: number | null
        plan_max_staff_per_br?: number | null
    } | null
    const overage = (overageRes.data ?? {}) as Record<string, unknown>

    return NextResponse.json({
        extra_branches: Number(overage.extra_branches ?? 0),
        extra_staff: Number(overage.extra_staff ?? 0),
        locked: Boolean(overage.locked),
        plan_tier: tenant?.plan_tier ?? null,
        max_branches: tenant?.plan_max_branches ?? null,
        max_staff_per_branch: tenant?.plan_max_staff_per_br ?? null,
        role,
    })
}
