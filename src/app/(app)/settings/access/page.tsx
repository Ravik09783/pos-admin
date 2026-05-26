import { notFound } from "next/navigation"
import Link from "next/link"

import { PermissionGuard } from "@/components/auth/permission-guard"
import { getCurrentUserAndTenant } from "@/lib/auth/current-user"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/app-shell/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { History, ShieldCheck } from "lucide-react"
import { PERMISSION_META, ROLE_LABELS } from "@/lib/rbac/permissions"
import type { AppUser, RoleTemplate, UserRole } from "@/types/database"
import { AccessOverview, type AccessRow, type PermissionMeta } from "./access-overview"

/**
 * /settings/access
 *
 * Visual roster of every staff member with WHAT they can do (template +
 * expanded permission chips) and WHERE they can do it (home branch +
 * any extra branches granted via user_branch_access).
 *
 * Gated on `manage_users` (not staff.manage) so that a delegated manager
 * who can create accounts also gets to see the current access map —
 * they're the people the OWNER asks "who's at the Pune branch on the
 * Floor Manager template?".
 */
export default async function AccessOverviewPage() {
    return (
        <PermissionGuard permission="manage_users">
            <Body />
        </PermissionGuard>
    )
}

async function Body() {
    const { appUser } = await getCurrentUserAndTenant()
    if (!appUser?.tenant_id) notFound()
    const tenantId = appUser.tenant_id as string

    const service = createServiceRoleClient()
    const [usersRes, templatesRes, branchesRes, accessRes] = await Promise.all([
        service.from("users")
            .select("id, full_name, email, role, branch_id, role_template_id, is_active, avatar_url, phone, created_at")
            .eq("tenant_id", tenantId)
            .order("is_active", { ascending: false })
            .order("role", { ascending: true })
            .order("full_name", { ascending: true }),
        service.from("role_templates")
            .select("id, tenant_id, name, description, base_role, permissions, is_system, created_by, created_at, updated_at")
            .eq("tenant_id", tenantId),
        service.from("branches")
            .select("id, name, is_main, is_active")
            .eq("tenant_id", tenantId),
        service.from("user_branch_access")
            .select("user_id, branch_id")
            .eq("tenant_id", tenantId),
    ])

    const users = (usersRes.data ?? []) as AppUser[]
    const templates = (templatesRes.data ?? []) as RoleTemplate[]
    const branches = (branchesRes.data ?? []) as { id: string; name: string; is_main: boolean; is_active: boolean }[]
    const accessGrants = (accessRes.data ?? []) as { user_id: string; branch_id: string }[]

    const templateById = new Map(templates.map((t) => [t.id, t]))
    const branchById = new Map(branches.map((b) => [b.id, b]))
    const grantsByUser = new Map<string, string[]>()
    for (const g of accessGrants) {
        const list = grantsByUser.get(g.user_id) ?? []
        list.push(g.branch_id)
        grantsByUser.set(g.user_id, list)
    }

    // Resolve every user → AccessRow with friendly labels in place of ids.
    const rows: AccessRow[] = users.map((u) => {
        const tpl = u.role_template_id ? templateById.get(u.role_template_id) ?? null : null
        const homeBranch = u.branch_id ? branchById.get(u.branch_id) ?? null : null
        const extras = (grantsByUser.get(u.id) ?? [])
            .filter((bid) => bid !== u.branch_id)
            .map((bid) => branchById.get(bid))
            .filter((b): b is { id: string; name: string; is_main: boolean; is_active: boolean } => Boolean(b))
        const tplRoleLabel = (tpl?.base_role ?? u.role) as UserRole
        return {
            id: u.id,
            name: u.full_name ?? u.email ?? "Staff",
            email: u.email,
            avatarUrl: u.avatar_url ?? null,
            role: u.role as UserRole,
            roleLabel: ROLE_LABELS[tplRoleLabel] ?? tplRoleLabel,
            isActive: u.is_active !== false,
            templateId: tpl?.id ?? null,
            templateName: tpl?.name ?? "(no template)",
            templateIsSystem: tpl?.is_system ?? false,
            permissions: (tpl?.permissions ?? []) as string[],
            homeBranch: homeBranch ? { id: homeBranch.id, name: homeBranch.name, isMain: homeBranch.is_main } : null,
            extraBranches: extras.map((b) => ({ id: b.id, name: b.name, isMain: b.is_main })),
            isAllBranches: u.role === "OWNER" || u.role === "MANAGER" || u.role === "AUDITOR",
        }
    })

    // Permission metadata for the client (flat map: key → {label, category}).
    const permMeta: Record<string, PermissionMeta> = {}
    for (const [k, v] of Object.entries(PERMISSION_META)) {
        permMeta[k] = { label: v.label, category: v.category }
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-6xl space-y-6">
            <PageHeader
                kicker="Configure"
                title="Access overview"
                highlight="who can do what, where"
                description="Glance-view of every staff member's permissions and branch access. Click anyone to change their assignment."
                actions={
                    <>
                        <Button asChild variant="outline">
                            <Link href="/settings/role-templates/history">
                                <History className="h-4 w-4" /> History
                            </Link>
                        </Button>
                        <Button asChild variant="outline">
                            <Link href="/settings/role-templates">
                                <ShieldCheck className="h-4 w-4" /> Templates
                            </Link>
                        </Button>
                    </>
                }
            />

            {rows.length === 0 ? (
                <Card>
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">
                        No staff yet. Add some via Settings &rarr; Staff.
                    </CardContent>
                </Card>
            ) : (
                <AccessOverview rows={rows} permMeta={permMeta} />
            )}
        </div>
    )
}
