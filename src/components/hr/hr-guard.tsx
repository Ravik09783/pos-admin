"use client"

/**
 * Client-side permission gate for the /hr screens.
 *
 * Why client-side (vs. the server <PermissionGuard>): attendance.manage is
 * DELEGABLE via role templates, and the server guard's `can(role, perm)` only
 * checks role defaults — it would wrongly block a CASHIER whose custom
 * template grants attendance.manage. useMyPermissions() is template-aware, so
 * a delegated "attendance manager" passes. The DB RPCs (user_has_permission)
 * are the real enforcement; this is the matching UI affordance.
 */

import { Loader2 } from "lucide-react"

import { useMyPermissions } from "@/lib/rbac/use-permissions"
import { NoPermissionScreen } from "@/components/auth/no-permission-screen"
import type { Permission } from "@/lib/rbac/permissions"

export function HrGuard({
    permission,
    children,
}: {
    permission: Permission
    children: React.ReactNode
}) {
    const { can, loading } = useMyPermissions()

    if (loading) {
        return (
            <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
        )
    }
    if (!can(permission)) {
        return <NoPermissionScreen permission={permission} />
    }
    return <>{children}</>
}
