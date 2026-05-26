import { notFound } from "next/navigation"

import { PermissionGuard } from "@/components/auth/permission-guard"
import { getCurrentUserAndTenant } from "@/lib/auth/current-user"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { ALL_PERMISSIONS } from "@/lib/rbac/permissions"
import type { RoleTemplate } from "@/types/database"
import { TemplateEditor, type AssignedUser } from "./template-editor"

/**
 * /settings/role-templates/[id]
 *
 * Full template editor. Lets the OWNER toggle each permission, rename
 * the template (unless it's a system default), change base role, and
 * delete it. Saves apply IMMEDIATELY to every user assigned to the
 * template — the editor surfaces an "affects N users" banner so the
 * admin sees the blast radius before saving.
 */
export default async function RoleTemplateEditorPage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    return (
        <PermissionGuard permission="staff.manage">
            <Body params={params} />
        </PermissionGuard>
    )
}

async function Body({ params }: { params: Promise<{ id: string }> }) {
    const { appUser } = await getCurrentUserAndTenant()
    if (!appUser?.tenant_id) notFound()
    const tenantId = appUser.tenant_id as string
    const { id } = await params

    const service = createServiceRoleClient()
    const [{ data: rawTemplate }, { data: rawAssigned }, { data: rawCallerTemplate }, { data: rawBranches }, { data: rawAccess }] = await Promise.all([
        service.from("role_templates")
            .select("id, tenant_id, name, description, base_role, permissions, is_system, created_by, created_at, updated_at")
            .eq("id", id)
            .maybeSingle(),
        service.from("users")
            .select("id, full_name, email, avatar_url, branch_id, is_active")
            .eq("role_template_id", id)
            .eq("tenant_id", tenantId)
            .order("is_active", { ascending: false })
            .order("full_name", { ascending: true }),
        service.from("users")
            .select("role_template:role_templates!users_role_template_id_fkey(permissions)")
            .eq("id", appUser.id)
            .maybeSingle(),
        service.from("branches")
            .select("id, name, is_main")
            .eq("tenant_id", tenantId),
        service.from("user_branch_access")
            .select("user_id, branch_id")
            .eq("tenant_id", tenantId),
    ])

    const template = rawTemplate as RoleTemplate | null
    if (!template || template.tenant_id !== tenantId) notFound()

    const callerTplRow = rawCallerTemplate as { role_template: { permissions: string[] } | { permissions: string[] }[] | null } | null
    const callerTpl = Array.isArray(callerTplRow?.role_template) ? callerTplRow?.role_template[0] : callerTplRow?.role_template
    const callerPerms = (callerTpl?.permissions ?? ALL_PERMISSIONS) as string[]

    // Resolve assigned-user rows with friendly branch labels for the
    // editor's "Assigned to" roster section.
    const assignedRaw = (rawAssigned ?? []) as { id: string; full_name: string | null; email: string | null; avatar_url: string | null; branch_id: string | null; is_active: boolean | null }[]
    const branches = (rawBranches ?? []) as { id: string; name: string; is_main: boolean }[]
    const branchById = new Map(branches.map((b) => [b.id, b]))
    const grants = (rawAccess ?? []) as { user_id: string; branch_id: string }[]
    const grantsByUser = new Map<string, string[]>()
    for (const g of grants) {
        const list = grantsByUser.get(g.user_id) ?? []
        list.push(g.branch_id)
        grantsByUser.set(g.user_id, list)
    }
    const assigned: AssignedUser[] = assignedRaw.map((u) => {
        const home = u.branch_id ? branchById.get(u.branch_id) ?? null : null
        const extras = (grantsByUser.get(u.id) ?? [])
            .filter((bid) => bid !== u.branch_id)
            .map((bid) => branchById.get(bid))
            .filter((b): b is { id: string; name: string; is_main: boolean } => Boolean(b))
        return {
            id: u.id,
            name: u.full_name ?? u.email ?? "Staff",
            email: u.email,
            avatarUrl: u.avatar_url,
            isActive: u.is_active !== false,
            homeBranchName: home ? `${home.name}${home.is_main ? " (main)" : ""}` : null,
            extraBranchNames: extras.map((b) => b.name),
        }
    })

    return (
        <TemplateEditor
            template={template}
            assignedCount={assigned.length}
            assigned={assigned}
            callerPerms={callerPerms}
        />
    )
}
