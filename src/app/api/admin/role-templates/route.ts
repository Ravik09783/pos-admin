import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { ALL_PERMISSIONS, templateMissingPermissions, type Permission } from "@/lib/rbac/permissions"
import type { UserRole } from "@/types/database"

/**
 * POST /api/admin/role-templates
 *
 * Creates a new role template in the caller's tenant. The caller MUST be
 * an OWNER (the underlying RLS policy only allows OWNER writes — this
 * route doesn't smuggle a service-role client, on purpose). The body's
 * `permissions[]` is further constrained to a SUBSET of the caller's own
 * effective permissions so an Owner who has dropped a permission from
 * their own template still can't accidentally grant it.
 */
interface Body {
    name?: string
    description?: string | null
    base_role?: string
    permissions?: string[]
}

// OWNER is intentionally excluded — only the auto-seeded SYSTEM
// templates carry base_role='OWNER'. Letting a caller create a
// CUSTOM OWNER template would write users.role='OWNER' on assigned
// users, which RLS's is_owner() predicate reads directly: that's a
// DB-level privilege escalation regardless of the template's UI
// permission list. SQL also enforces this via
// `role_templates_no_custom_owner` check constraint (migration 47).
const VALID_ROLES: UserRole[] = ["MANAGER", "CASHIER", "CAPTAIN", "KITCHEN", "DELIVERY", "AUDITOR"]
const VALID_PERMS = new Set<string>(ALL_PERMISSIONS)

export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const body = (await req.json().catch(() => null)) as Body | null
    if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 })

    const name = (body.name ?? "").trim().slice(0, 80)
    const description = ((body.description ?? "") || "").trim().slice(0, 500) || null
    const baseRole = body.base_role as UserRole | undefined
    const perms = Array.isArray(body.permissions) ? body.permissions : []

    if (name.length < 2) {
        return NextResponse.json({ error: "Template name is required (min 2 characters)." }, { status: 400 })
    }
    if (!baseRole || !VALID_ROLES.includes(baseRole)) {
        return NextResponse.json({ error: "Pick a base role." }, { status: 400 })
    }
    const cleanedPerms = Array.from(new Set(perms.filter((p): p is string => typeof p === "string" && VALID_PERMS.has(p))))

    // Subset rule — the caller can only grant what they have themselves.
    const { data: callerRow } = await supabase
        .from("users")
        .select("tenant_id, role_template:role_templates!users_role_template_id_fkey(permissions)")
        .eq("id", user.id)
        .maybeSingle() as { data: { tenant_id: string | null; role_template: { permissions: string[] } | { permissions: string[] }[] | null } | null }
    if (!callerRow?.tenant_id) return NextResponse.json({ error: "no tenant" }, { status: 400 })
    const callerTpl = Array.isArray(callerRow.role_template) ? callerRow.role_template[0] : callerRow.role_template
    const callerPerms = (callerTpl?.permissions ?? ALL_PERMISSIONS) as string[]
    const missing = templateMissingPermissions(callerPerms, cleanedPerms)
    if (missing.length > 0) {
        return NextResponse.json({
            error: "You can't grant permissions you don't have yourself.",
            missing_permissions: missing,
        }, { status: 403 })
    }

    const { data, error } = await supabase
        .from("role_templates")
        .insert({
            tenant_id: callerRow.tenant_id,
            name,
            description,
            base_role: baseRole,
            permissions: cleanedPerms,
            is_system: false,
            created_by: user.id,
        } as never)
        .select("id")
        .single()

    if (error) {
        if (error.code === "23505") {
            return NextResponse.json({ error: "A template with this name already exists." }, { status: 409 })
        }
        if (error.code === "42501") {
            // RLS denial — only OWNER can write.
            return NextResponse.json({ error: "Only the Owner can create role templates." }, { status: 403 })
        }
        logError(error, { route: "/api/admin/role-templates POST" })
        return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true, id: (data as { id: string }).id })
}

export type { Permission }
