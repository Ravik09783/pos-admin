import { notFound } from "next/navigation"
import Link from "next/link"
import { History, Plus, ShieldCheck, Users } from "lucide-react"

import { PermissionGuard } from "@/components/auth/permission-guard"
import { getCurrentUserAndTenant } from "@/lib/auth/current-user"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/app-shell/page-header"
import { ALL_PERMISSIONS } from "@/lib/rbac/permissions"
import { ROLE_LABELS } from "@/lib/rbac/permissions"
import type { RoleTemplate, UserRole } from "@/types/database"
import { CreateTemplateButton } from "./create-template-button"

/**
 * /settings/role-templates
 *
 * Lists every template in the tenant + a "+ Create template" button.
 * System templates (seeded per role) get a "Defaults" tag and a lock
 * icon — they can be edited but not renamed or deleted. Each card
 * shows the assigned-user count so admins know what they'll affect.
 *
 * Gated on `staff.manage` — only the Owner can manage templates today.
 * Anyone with `manage_users` can still ASSIGN templates from the staff
 * list, they just can't author new ones.
 */
export default async function RoleTemplatesPage() {
    return (
        <PermissionGuard permission="staff.manage">
            <RoleTemplatesPageBody />
        </PermissionGuard>
    )
}

async function RoleTemplatesPageBody() {
    const { appUser } = await getCurrentUserAndTenant()
    if (!appUser?.tenant_id) notFound()
    const tenantId = appUser.tenant_id as string

    const service = createServiceRoleClient()
    const [{ data: rawTemplates }, { data: rawAssignedCounts }, { data: rawCallerTemplate }] = await Promise.all([
        service.from("role_templates")
            .select("id, tenant_id, name, description, base_role, permissions, is_system, created_by, created_at, updated_at")
            .eq("tenant_id", tenantId)
            .order("is_system", { ascending: false })
            .order("base_role", { ascending: true })
            .order("name", { ascending: true }),
        // Group-by via grouped select — Supabase v2 doesn't expose .group(),
        // so we run a small aggregate via an RPC-style SQL view... but the
        // simpler path is "fetch users + count client-side". Tens of users
        // per tenant: fine.
        service.from("users")
            .select("role_template_id")
            .eq("tenant_id", tenantId),
        service.from("users")
            .select("role_template:role_templates!users_role_template_id_fkey(permissions)")
            .eq("id", appUser.id)
            .maybeSingle(),
    ])

    const templates = (rawTemplates ?? []) as RoleTemplate[]
    const assignedRows = (rawAssignedCounts ?? []) as { role_template_id: string | null }[]
    const assignedByTemplate = new Map<string, number>()
    for (const r of assignedRows) {
        if (!r.role_template_id) continue
        assignedByTemplate.set(r.role_template_id, (assignedByTemplate.get(r.role_template_id) ?? 0) + 1)
    }

    const callerTplRow = rawCallerTemplate as { role_template: { permissions: string[] } | { permissions: string[] }[] | null } | null
    const callerTpl = Array.isArray(callerTplRow?.role_template) ? callerTplRow?.role_template[0] : callerTplRow?.role_template
    const callerPerms = (callerTpl?.permissions ?? ALL_PERMISSIONS) as string[]

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-5xl space-y-6">
            <PageHeader
                kicker="Configure"
                title="Role templates"
                highlight="for every staff seat"
                description="Define named bundles of permissions and assign them to staff. Edit a template and every assigned user updates immediately — no per-user toggles to drift out of sync."
                actions={
                    <>
                        <Button asChild variant="outline">
                            <Link href="/settings/role-templates/history">
                                <History className="h-4 w-4" /> History
                            </Link>
                        </Button>
                        <CreateTemplateButton callerPerms={callerPerms} />
                    </>
                }
            />

            <Card>
                <CardContent className="py-4 text-sm flex items-start gap-3 bg-card/40 border-border/60">
                    <ShieldCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <div className="text-muted-foreground">
                        <strong className="text-foreground">How it works:</strong>{" "}
                        Each template has a <em>base role</em> (drives branch scoping and DB-level checks)
                        and an explicit list of permissions (drives what appears in the UI).
                        Anyone with <code className="text-xs">manage_users</code> can assign templates,
                        but only ones whose permissions are a subset of their own.
                    </div>
                </CardContent>
            </Card>

            {templates.length === 0 ? (
                <Card>
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">
                        No templates yet. Click <strong>Create template</strong> to add one.
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-3">
                    {templates.map((t) => (
                        <TemplateCard
                            key={t.id}
                            template={t}
                            assignedCount={assignedByTemplate.get(t.id) ?? 0}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

function TemplateCard({ template, assignedCount }: { template: RoleTemplate; assignedCount: number }) {
    const permCount = template.permissions.length
    return (
        <Link href={`/settings/role-templates/${template.id}`} className="block">
            <Card className="transition-colors hover:border-primary/40">
                <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <div className="font-semibold">{template.name}</div>
                                {template.is_system && (
                                    <Badge variant="outline" className="text-[10px]">Defaults</Badge>
                                )}
                                <Badge variant="secondary" className="text-[10px]">
                                    Base: {ROLE_LABELS[template.base_role as UserRole] ?? template.base_role}
                                </Badge>
                            </div>
                            {template.description && (
                                <p className="text-xs text-muted-foreground mt-1 max-w-2xl">{template.description}</p>
                            )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                            <span className="inline-flex items-center gap-1">
                                <ShieldCheck className="h-3 w-3" /> {permCount} permission{permCount === 1 ? "" : "s"}
                            </span>
                            <span className="inline-flex items-center gap-1">
                                <Users className="h-3 w-3" /> {assignedCount} assigned
                            </span>
                            <Plus className="h-3 w-3 rotate-45 text-primary" />
                        </div>
                    </div>
                </CardContent>
            </Card>
        </Link>
    )
}
