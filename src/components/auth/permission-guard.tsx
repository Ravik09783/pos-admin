import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { can, type Permission } from "@/lib/rbac/permissions"
import type { UserRole } from "@/types/database"
import { NoPermissionScreen } from "./no-permission-screen"

/**
 * Async server-component wrapper for permission-gated routes. Usage:
 *
 *     <PermissionGuard permission="reports.view">
 *         ...page content...
 *     </PermissionGuard>
 *
 * Behaviour:
 *   - Not signed in        → /login
 *   - Signed in, no tenant → /onboarding
 *   - Signed in but lacks  → renders <NoPermissionScreen> with the list of
 *     the permission         people who CAN do it (phone + email), so the
 *                            blocked staffer can contact someone on shift.
 *   - Otherwise            → renders `children`.
 *
 * Use this instead of the older `requirePermission()` helper for any
 * route where we'd rather explain than silently redirect.
 */
export async function PermissionGuard({
    permission,
    children,
}: {
    permission: Permission
    children: React.ReactNode
}) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/login")

    const { data: appUser } = await supabase
        .from("users")
        .select("role, tenant_id")
        .eq("id", user.id)
        .maybeSingle()
    const a = appUser as { role?: UserRole; tenant_id?: string } | null

    if (!a?.tenant_id) redirect("/onboarding")
    if (!can(a.role ?? null, permission)) {
        return <NoPermissionScreen permission={permission} />
    }

    return <>{children}</>
}
