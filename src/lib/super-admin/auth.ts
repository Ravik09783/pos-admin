/**
 * Super-admin authorization — gate for the `/super-admin/*` routes and
 * `/api/super-admin/*` endpoints.
 *
 * Super-admins are NOT tenant members. They live outside the multi-tenant
 * model. There are TWO independent ways to flag an account as super-admin:
 *
 *   1. **DB role**: `public.users.role = 'SUPER_ADMIN'` (added by
 *      migration 21). Set by an operator in Supabase Studio after the
 *      user signs up. This is the **primary** path for ops — no redeploy
 *      needed. See `docs/super-admin-setup.md`.
 *
 *   2. **Env-var allow-list**: `RESTOPOS_SUPER_ADMIN_EMAILS` (comma-
 *      separated emails). Used for bootstrap (the very first super-admin,
 *      before anyone is in the DB to flip the role) and break-glass
 *      access if a SUPER_ADMIN row gets accidentally deactivated.
 *
 * `isSuperAdmin()` is a sync predicate that only checks the env var
 * (no DB call). `isSuperAdminFromAuth()` is the async, full check —
 * use it on the server where you have a Supabase client.
 */

import type { User, SupabaseClient } from "@supabase/supabase-js"

/** Comma-separated list of emails that count as super admins. */
function configuredEmails(): string[] {
    return (process.env.RESTOPOS_SUPER_ADMIN_EMAILS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0)
}

/** True when the given email is in the env-configured allow-list. */
export function isSuperAdminEmail(email: string | null | undefined): boolean {
    if (!email) return false
    return configuredEmails().includes(email.trim().toLowerCase())
}

/** Convenience wrapper for the common "got an auth user, is it a super
 *  admin?" check. Returns false when no user is signed in. */
export function isSuperAdmin(user: User | null | undefined): boolean {
    return isSuperAdminEmail(user?.email ?? null)
}

/** True when no super-admin emails are configured at all — used by the
 *  setup page to render a hint when the env var is missing. Returning
 *  false from `isSuperAdmin()` could mean either "wrong user" or
 *  "no one is configured"; this disambiguates for the UI. */
export function superAdminFeatureConfigured(): boolean {
    return configuredEmails().length > 0
}

/**
 * Full async check: is this signed-in user a super-admin via EITHER
 * `public.users.role = 'SUPER_ADMIN'` OR the env allow-list?
 *
 * Returns false when no user is passed in (logged out). The DB lookup
 * uses the passed-in Supabase client — caller decides whether that's
 * a session client (RLS-scoped) or a service-role client. For super-
 * admin gates a session client is fine: the row in `public.users` for
 * `auth.uid()` is always readable to its owner under existing RLS.
 *
 * Either signal is sufficient. We never AND them — if the env path is
 * set and someone removes the DB row by mistake, they can still log in
 * via the env match.
 */
export async function isSuperAdminFromAuth(
    user: User | null | undefined,
    supabase: SupabaseClient,
): Promise<boolean> {
    if (!user) return false

    // Cheap path: env match short-circuits any DB call.
    if (isSuperAdminEmail(user.email)) return true

    // DB path: check public.users.role for this auth user.
    const { data } = await supabase
        .from("users")
        .select("role, is_active")
        .eq("id", user.id)
        .maybeSingle()
    const row = data as { role?: string | null; is_active?: boolean | null } | null
    if (!row) return false
    if (row.is_active === false) return false
    return row.role === "SUPER_ADMIN"
}
