import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, History as HistoryIcon } from "lucide-react"

import { PermissionGuard } from "@/components/auth/permission-guard"
import { getCurrentUserAndTenant } from "@/lib/auth/current-user"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { Card, CardContent } from "@/components/ui/card"
import { PERMISSION_META } from "@/lib/rbac/permissions"
import { HistoryFilters, type HistoryRow } from "./history-filters"

/**
 * /settings/role-templates/history
 *
 * Action history of every role-template change in this tenant.
 *
 * Sources (defined in migration 48):
 *   - Trigger on role_templates    → TEMPLATE_CREATED / UPDATED / DELETED
 *   - RPC log_role_template_assignment (called from the staff create +
 *     assign-template routes)      → USER_TEMPLATE_ASSIGNED
 *
 * RLS lets only OWNER read the audit table, but we gate via
 * <PermissionGuard staff.manage> here so a non-OWNER with staff.manage
 * (none exist today, but the matrix could change) sees the
 * NoPermissionScreen instead of a silent 0-row table.
 */
export default async function RoleTemplateHistoryPage() {
    return (
        <PermissionGuard permission="staff.manage">
            <Body />
        </PermissionGuard>
    )
}

async function Body() {
    const { appUser } = await getCurrentUserAndTenant()
    if (!appUser?.tenant_id) notFound()

    const service = createServiceRoleClient()
    const { data, error } = await service
        .from("role_template_audit_log")
        .select("id, tenant_id, actor_user_id, actor_email, action, template_id, template_name, target_user_id, target_user_email, diff, created_at")
        .eq("tenant_id", appUser.tenant_id)
        .order("created_at", { ascending: false })
        .limit(500)

    if (error && /role_template_audit_log|does not exist/i.test(error.message)) {
        return (
            <div className="container mx-auto py-6 md:py-8 px-4 max-w-5xl space-y-4">
                <Header />
                <Card className="border-warning/40 bg-warning/[0.04]">
                    <CardContent className="py-4 text-sm text-muted-foreground">
                        Action history isn&apos;t enabled yet — apply migration 48
                        (<code className="text-xs">48_role_template_audit_log.sql</code>,
                        or re-apply <code className="text-xs">combined_schema.sql</code>).
                    </CardContent>
                </Card>
            </div>
        )
    }

    const rows = (data ?? []) as HistoryRow[]
    // Pre-compute a permission key → human label map for the client to
    // render "Refund bills" instead of "bill.void" in diffs. The set is
    // small, baking it here avoids shipping PERMISSION_META as a dep.
    const permLabels: Record<string, string> = {}
    for (const [k, v] of Object.entries(PERMISSION_META)) {
        permLabels[k] = v.label
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-5xl space-y-4">
            <Header />
            <HistoryFilters rows={rows} permLabels={permLabels} />
        </div>
    )
}

function Header() {
    return (
        <div>
            <Link
                href="/settings/role-templates"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
                <ArrowLeft className="h-3 w-3" /> Back to templates
            </Link>
            <h1 className="text-2xl font-bold tracking-tight mt-2 flex items-center gap-2">
                <HistoryIcon className="h-5 w-5 text-primary" />
                Role-template history
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
                Every change to a template and every time someone&apos;s template was reassigned. Most recent first.
            </p>
        </div>
    )
}
