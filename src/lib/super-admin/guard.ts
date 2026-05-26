import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { isSuperAdminFromAuth } from "@/lib/super-admin/auth"

/**
 * Server-side guard for every `/api/super-admin/*` route. Re-checks
 * what the layout does + returns NextResponse on failure so the route
 * handler can just `if (!guard.ok) return guard.response`.
 *
 * Accepts EITHER a `public.users.role = 'SUPER_ADMIN'` row OR an
 * email match against `RESTOPOS_SUPER_ADMIN_EMAILS`. Defaults to 404
 * on failure so the endpoint stays invisible to non-admins.
 */
export async function requireSuperAdmin(): Promise<{
    ok: true
    email: string
} | { ok: false; response: NextResponse }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return {
            ok: false,
            response: NextResponse.json({ error: "not_found" }, { status: 404 }),
        }
    }
    const isAdmin = await isSuperAdminFromAuth(user, supabase)
    if (!isAdmin) {
        return {
            ok: false,
            response: NextResponse.json({ error: "not_found" }, { status: 404 }),
        }
    }
    return { ok: true, email: user.email ?? "" }
}
