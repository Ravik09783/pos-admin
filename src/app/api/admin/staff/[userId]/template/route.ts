import { NextResponse } from "next/server"

import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { ALL_PERMISSIONS, templateMissingPermissions } from "@/lib/rbac/permissions"

/**
 * PATCH /api/admin/staff/[userId]/template
 *   { role_template_id: uuid }
 *
 * Reassigns a staff member to a different role template. Caller must
 * have `manage_users` AND their own template must be a superset of the
 * target template's permissions — otherwise the request is rejected
 * with the exact list of missing permissions so the UI can explain
 * what's blocking them.
 *
 * The user's base `role` is also updated to match the template's
 * `base_role`, so RLS / branch scoping stays consistent.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ userId: string }> }) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { userId } = await ctx.params
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return NextResponse.json({ error: "invalid user id" }, { status: 400 })

    const body = await req.json().catch(() => null) as { role_template_id?: string } | null
    const templateId = body?.role_template_id
    if (!templateId || !/^[0-9a-f-]{36}$/i.test(templateId)) {
        return NextResponse.json({ error: "role_template_id is required" }, { status: 400 })
    }

    // Caller's tenant + own permissions.
    const { data: caller } = await supabase
        .from("users")
        .select("tenant_id, role_template:role_templates!users_role_template_id_fkey(permissions)")
        .eq("id", user.id)
        .maybeSingle() as { data: { tenant_id: string | null; role_template: { permissions: string[] } | { permissions: string[] }[] | null } | null }
    if (!caller?.tenant_id) return NextResponse.json({ error: "no tenant" }, { status: 400 })

    const callerTpl = Array.isArray(caller.role_template) ? caller.role_template[0] : caller.role_template
    const callerPerms = (callerTpl?.permissions ?? ALL_PERMISSIONS) as string[]
    if (!callerPerms.includes("manage_users")) {
        return NextResponse.json({
            error: "You don't have permission to manage users.",
            missing_permissions: ["manage_users"],
        }, { status: 403 })
    }

    // Target template — verify it belongs to the same tenant + read its perms + base_role.
    const { data: tpl } = await supabase
        .from("role_templates")
        .select("id, base_role, permissions, tenant_id")
        .eq("id", templateId)
        .maybeSingle() as { data: { id: string; base_role: string; permissions: string[]; tenant_id: string } | null }
    if (!tpl || tpl.tenant_id !== caller.tenant_id) {
        return NextResponse.json({ error: "template not found" }, { status: 404 })
    }

    const missing = templateMissingPermissions(callerPerms, tpl.permissions)
    if (missing.length > 0) {
        return NextResponse.json({
            error: "You can't assign a template with permissions you don't have yourself.",
            missing_permissions: missing,
        }, { status: 403 })
    }

    // Target user — must be in the same tenant. We also read the
    // current template so the audit row can record "from → to".
    const { data: target } = await supabase
        .from("users")
        .select("id, tenant_id, role_template_id")
        .eq("id", userId)
        .maybeSingle() as { data: { id: string; tenant_id: string | null; role_template_id: string | null } | null }
    if (!target || target.tenant_id !== caller.tenant_id) {
        return NextResponse.json({ error: "user not found" }, { status: 404 })
    }
    if (target.role_template_id === tpl.id) {
        // No-op: avoid an empty audit row when the UI accidentally
        // re-assigns the same template.
        return NextResponse.json({ ok: true, unchanged: true })
    }

    // Use the service-role client for the write: RLS on public.users
    // restricts writes to OWNER, but a delegated `manage_users` user
    // (e.g. a custom MANAGER template) must also be able to reassign
    // templates. We've already enforced `manage_users` + the subset
    // rule above, so it's safe to bypass RLS here.
    const admin = createServiceRoleClient()
    const { error } = await admin
        .from("users")
        .update({ role_template_id: tpl.id, role: tpl.base_role } as never)
        .eq("id", userId)
        .eq("tenant_id", caller.tenant_id)

    if (error) {
        logError(error, { route: "/api/admin/staff/[userId]/template PATCH" })
        return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Record the change in the action history. Best-effort: a failure
    // here shouldn't undo a successful reassignment, so we log + swallow.
    const { error: auditErr } = await admin.rpc("log_role_template_assignment" as never, {
        p_actor_user_id: user.id,
        p_target_user_id: userId,
        p_from_template_id: target.role_template_id,
        p_to_template_id: tpl.id,
    } as never)
    if (auditErr) {
        logError(auditErr, { route: "/api/admin/staff/[userId]/template AUDIT" })
    }

    return NextResponse.json({ ok: true })
}
