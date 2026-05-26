import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { requireSuperAdmin } from "@/lib/super-admin/guard"
import { logError } from "@/lib/errors"

/**
 * GET /api/super-admin/tenants
 *
 * Returns one row per registered restaurant with the headline data the
 * super-admin dashboard renders. Wraps the SQL
 * `super_admin_tenant_overview()` RPC which is service-role-gated.
 *
 * Result rows include: id, name, slug, country, currency, plan_tier,
 * subscription_status, trial_ends_at, current_period_end, created_at,
 * owner_email, owner_full_name, branch_count, staff_count, total_bills,
 * total_revenue, last_activity_at.
 */
export async function GET() {
    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    const service = createServiceRoleClient()
    const { data, error } = await service.rpc("super_admin_tenant_overview" as never)
    if (error) {
        logError(error, { route: "/api/super-admin/tenants" })
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ tenants: data ?? [] })
}
