import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { ALL_PERMISSIONS, templateMissingPermissions } from "@/lib/rbac/permissions"
import type { UserRole } from "@/types/database"

// OWNER excluded — see role-templates/route.ts header. Custom OWNER
// templates would escalate users.role to OWNER via the staff-create
// path, and RLS's is_owner() reads users.role directly. SQL constraint
// `role_templates_no_custom_owner` is the belt; this is the suspenders.
const VALID_ROLES: UserRole[] = ["MANAGER", "CASHIER", "CAPTAIN", "KITCHEN", "DELIVERY", "AUDITOR"]
const VALID_PERMS = new Set<string>(ALL_PERMISSIONS)

/**
 * PATCH /api/admin/role-templates/[id]
 *   { name?, description?, base_role?, permissions?: string[] }
 *
 * Edit a template in place. Changes apply IMMEDIATELY to every assigned
 * user (that's the point of templates). RLS gates this to OWNER only;
 * the subset rule is still applied so the call also rejects when an
 * Owner has somehow had their own permission set narrowed.
 *
 * System templates can be edited (admins routinely tweak them) but
 * cannot be renamed or have their base_role changed — both would break
 * the "auto-seeded default" promise. They also can't be deleted.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { id } = await ctx.params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 })

    const body = await req.json().catch(() => null) as {
        name?: string
        description?: string | null
        base_role?: string
        permissions?: string[]
    } | null
    if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 })

    // Explicit caller-tenant fetch first, then a tenant-chained SELECT
    // for the template — defense-in-depth so the route doesn't lean on
    // RLS alone for tenant isolation. Returns 404 indistinguishably
    // whether the template doesn't exist OR belongs to another tenant.
    const { data: caller } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle() as { data: { tenant_id: string | null } | null }
    if (!caller?.tenant_id) return NextResponse.json({ error: "no tenant" }, { status: 400 })

    const { data: existing } = await supabase
        .from("role_templates")
        .select("id, is_system, base_role, tenant_id")
        .eq("id", id)
        .eq("tenant_id", caller.tenant_id)
        .maybeSingle() as { data: { id: string; is_system: boolean; base_role: UserRole; tenant_id: string } | null }
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 })

    const patch: Record<string, unknown> = {}

    if (body.name !== undefined) {
        const name = String(body.name).trim().slice(0, 80)
        if (name.length < 2) return NextResponse.json({ error: "Template name must be at least 2 characters." }, { status: 400 })
        if (existing.is_system) {
            return NextResponse.json({ error: "System templates can't be renamed. Duplicate it instead." }, { status: 400 })
        }
        patch.name = name
    }

    if (body.description !== undefined) {
        const d = (String(body.description ?? "").trim().slice(0, 500)) || null
        patch.description = d
    }

    if (body.base_role !== undefined) {
        if (existing.is_system) {
            return NextResponse.json({ error: "System templates have a fixed base role." }, { status: 400 })
        }
        if (!VALID_ROLES.includes(body.base_role as UserRole)) {
            return NextResponse.json({ error: "Invalid base role." }, { status: 400 })
        }
        patch.base_role = body.base_role
    }

    if (body.permissions !== undefined) {
        const cleaned = Array.from(new Set(
            (body.permissions ?? []).filter((p): p is string => typeof p === "string" && VALID_PERMS.has(p)),
        ))
        // Subset rule against caller's own template.
        const { data: caller } = await supabase
            .from("users")
            .select("role_template:role_templates!users_role_template_id_fkey(permissions)")
            .eq("id", user.id)
            .maybeSingle() as { data: { role_template: { permissions: string[] } | { permissions: string[] }[] | null } | null }
        const callerTpl = Array.isArray(caller?.role_template) ? caller?.role_template[0] : caller?.role_template
        const callerPerms = (callerTpl?.permissions ?? ALL_PERMISSIONS) as string[]
        const missing = templateMissingPermissions(callerPerms, cleaned)
        if (missing.length > 0) {
            return NextResponse.json({
                error: "You can't grant permissions you don't have yourself.",
                missing_permissions: missing,
            }, { status: 403 })
        }
        patch.permissions = cleaned
    }

    if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: "nothing to update" }, { status: 400 })
    }

    const { error } = await supabase
        .from("role_templates")
        .update(patch as never)
        .eq("id", id)

    if (error) {
        if (error.code === "23505") return NextResponse.json({ error: "Another template already has that name." }, { status: 409 })
        if (error.code === "42501") return NextResponse.json({ error: "Only the Owner can edit role templates." }, { status: 403 })
        logError(error, { route: "/api/admin/role-templates/[id] PATCH" })
        return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
}

/**
 * DELETE /api/admin/role-templates/[id]
 *
 * Removes a custom template. System templates can never be deleted.
 * If any users are still assigned to the template, refuse with a count
 * so the UI can prompt the admin to reassign them first.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { id } = await ctx.params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 })

    const { data: caller } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle() as { data: { tenant_id: string | null } | null }
    if (!caller?.tenant_id) return NextResponse.json({ error: "no tenant" }, { status: 400 })

    const { data: existing } = await supabase
        .from("role_templates")
        .select("id, is_system, name")
        .eq("id", id)
        .eq("tenant_id", caller.tenant_id)
        .maybeSingle() as { data: { id: string; is_system: boolean; name: string } | null }
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 })
    if (existing.is_system) {
        return NextResponse.json({ error: "System templates can't be deleted." }, { status: 400 })
    }

    const { count: assignedCount } = await supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("role_template_id", id)
        .eq("tenant_id", caller.tenant_id)
    if ((assignedCount ?? 0) > 0) {
        return NextResponse.json({
            error: `${assignedCount} user${assignedCount === 1 ? "" : "s"} are still assigned to "${existing.name}". Reassign them to another template first.`,
            assigned_count: assignedCount,
        }, { status: 409 })
    }

    const { error } = await supabase
        .from("role_templates")
        .delete()
        .eq("id", id)
        .eq("tenant_id", caller.tenant_id)
    if (error) {
        if (error.code === "42501") return NextResponse.json({ error: "Only the Owner can delete role templates." }, { status: 403 })
        logError(error, { route: "/api/admin/role-templates/[id] DELETE" })
        return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
}
