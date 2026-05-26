import "server-only"

import { cache } from "react"

import { createClient } from "@/lib/supabase/server"

/**
 * Per-request cached lookup of the calling user + their tenant.
 *
 * Every (app) route renders through TWO server components:
 *   1. (app)/layout.tsx        — auth gate + tenant fetch for sidebar chrome
 *   2. the specific page.tsx   — many of which used to re-fetch user/tenant
 *
 * Without dedup the same `supabase.auth.getUser()` + `users` query runs
 * twice on every navigation — ~150-300 ms of redundant round-trips that
 * the user perceives as slow page transitions. React's `cache()` makes
 * the second caller within the same request reuse the first call's
 * resolved promise, so the second call is free.
 *
 * Scope: per-request only. Across navigations the cache resets (each
 * nav is a new server request). For cross-request caching we'd need
 * `unstable_cache` + revalidation hooks, which is a much larger
 * surface — not worth it for sub-second freshness on auth data.
 *
 * Returns null when the caller is unauthenticated. Returns the auth
 * user with `appUser = null` when the user is authenticated but has
 * no `public.users` row yet (mid-onboarding). Pages that need a
 * tenant_id should call this, check `appUser?.tenant_id`, and redirect
 * to /onboarding if missing — same pattern the layout uses.
 */
export const getCurrentUserAndTenant = cache(async () => {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { user: null, appUser: null, supabase }

    const { data, error } = await supabase
        .from("users")
        .select(
            "id, tenant_id, role, full_name, email, phone, dob, avatar_url, is_active, created_at, branch_id, tenant:tenants(name, logo_url, country, currency, slug)",
        )
        .eq("id", user.id)
        .maybeSingle()

    // Embedded tenant comes back as an array from PostgREST; collapse
    // to a single object for ergonomic callers.
    type AppUserRow = {
        id: string
        tenant_id: string | null
        role: string | null
        full_name: string | null
        email: string | null
        phone: string | null
        dob: string | null
        avatar_url: string | null
        is_active: boolean | null
        created_at: string
        branch_id: string | null
        tenant: TenantRow | TenantRow[] | null
    }
    type TenantRow = {
        name: string | null
        logo_url: string | null
        country: string | null
        currency: string | null
        slug: string | null
    }
    const row = data as AppUserRow | null
    const tenantEmbed = row?.tenant
    const tenant: TenantRow | null = Array.isArray(tenantEmbed)
        ? tenantEmbed[0] ?? null
        : tenantEmbed ?? null

    return {
        user,
        appUser: row ? { ...row, tenant } : null,
        userErr: error,
        supabase,
    }
})
