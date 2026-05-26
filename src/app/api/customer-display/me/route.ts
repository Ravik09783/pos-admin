import { NextResponse } from "next/server"

import { appOrigin } from "@/lib/app-origin"
import { createClient, createServiceRoleClient } from "@/lib/supabase/server"

/**
 * GET /api/customer-display/me
 *
 * Returns the calling user's display token + the fully-qualified
 * customer-display URL they can mount on a tablet.
 *
 *   { token, url, tenant_slug, user_name }
 *
 * Authorization: any signed-in tenant user — every staff member gets
 * their own URL. Service-role client is used to read the tenants slug
 * regardless of the caller's RLS scope (a fresh user mid-onboarding
 * might not have tenant_id propagated through RLS yet).
 */
export async function GET(req: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const service = createServiceRoleClient()
    const { data: row } = await service
        .from("users")
        .select("id, full_name, display_token, tenant_id, tenant:tenants(slug)")
        .eq("id", user.id)
        .maybeSingle()
    const r = row as {
        id: string
        full_name: string | null
        display_token: string | null
        tenant_id: string | null
        tenant: { slug: string | null } | { slug: string | null }[] | null
    } | null
    if (!r?.display_token) {
        // Pre-migration-27 user — the trigger backfills on next insert,
        // but existing rows already got a token in the backfill UPDATE.
        // If this hits, the migration hasn't been applied yet.
        return NextResponse.json({
            error: "No display token on file. Run migration 27 against the database.",
        }, { status: 500 })
    }
    const tenantSlug = Array.isArray(r.tenant) ? r.tenant[0]?.slug : r.tenant?.slug
    if (!tenantSlug) {
        return NextResponse.json({ error: "no_tenant" }, { status: 403 })
    }

    // Build the absolute URL the staffer should open on the tablet.
    // `appOrigin(req)` prefers the request's origin so localhost dev
    // hands back a localhost URL and production hands back a production
    // URL — see src/lib/app-origin.ts for the precedence rule.
    const origin = appOrigin(req)
    const url = `${origin}/display/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(r.display_token)}`

    return NextResponse.json({
        token: r.display_token,
        url,
        tenant_slug: tenantSlug,
        user_name: r.full_name,
    })
}
