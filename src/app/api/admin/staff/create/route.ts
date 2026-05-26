import { NextResponse } from "next/server"

import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { ALL_PERMISSIONS, templateMissingPermissions } from "@/lib/rbac/permissions"

/**
 * POST /api/admin/staff/create
 *
 * Creates a staff account + assigns a role template.
 *
 * Caller requirements:
 *   1. Must have `manage_users` in their own role template (Owner has
 *      it by default; can be granted to delegated managers).
 *   2. Must pass the SUBSET CHECK against the target template — the
 *      template's permissions must be contained in the caller's own
 *      permissions. Otherwise we return 403 + `missing_permissions[]`
 *      so the UI can explain exactly what's blocking the assignment.
 *
 * Two-step Supabase flow:
 *   1. service-role  → auth.admin.createUser    (mints the auth user)
 *   2. authenticated → rpc("create_staff_profile") (writes public.users
 *                       under the caller's tenant, honouring RLS)
 *   3. authenticated → updates the new public.users row with the
 *                       template assignment (so subsequent reads see it).
 *
 * If step 2 or 3 fails after step 1 succeeded, we roll the auth user
 * back so we don't leak orphan accounts.
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { data: callerRow } = await supabase
        .from("users")
        .select("tenant_id, role_template:role_templates!users_role_template_id_fkey(permissions)")
        .eq("id", user.id)
        .maybeSingle() as { data: { tenant_id: string | null; role_template: { permissions: string[] } | { permissions: string[] }[] | null } | null }

    const callerTenant = callerRow?.tenant_id
    if (!callerTenant) return NextResponse.json({ error: "forbidden" }, { status: 403 })

    const callerTpl = Array.isArray(callerRow?.role_template) ? callerRow?.role_template[0] : callerRow?.role_template
    const callerPerms = (callerTpl?.permissions ?? ALL_PERMISSIONS) as string[]
    if (!callerPerms.includes("manage_users")) {
        return NextResponse.json({
            error: "You don't have permission to create staff accounts.",
            missing_permissions: ["manage_users"],
        }, { status: 403 })
    }

    const body = (await req.json().catch(() => null)) as {
        email?: string
        password?: string
        full_name?: string
        /** Required. Drives both the template assignment AND the base role
         *  the user is created with (so RLS / branch scoping is correct). */
        role_template_id?: string
        dob?: string | null
        phone?: string | null
        avatar_url?: string | null
        /** Optional branch assignment. Required on the UI side when the
         *  tenant has 2+ branches; ignored when there's only one. The
         *  RPC validates that the branch belongs to the caller's tenant. */
        branch_id?: string | null
    } | null
    if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 })

    const email = (body.email ?? "").trim().toLowerCase()
    const password = body.password ?? ""
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: "invalid email" }, { status: 400 })
    }
    if (password.length < 8) {
        return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 })
    }

    const templateId = body.role_template_id
    if (!templateId || !/^[0-9a-f-]{36}$/i.test(templateId)) {
        return NextResponse.json({ error: "Pick a role template for the new user." }, { status: 400 })
    }

    // Resolve template + run subset check before any auth side-effects.
    const { data: tplRow } = await supabase
        .from("role_templates")
        .select("id, base_role, permissions, tenant_id")
        .eq("id", templateId)
        .maybeSingle() as { data: { id: string; base_role: string; permissions: string[]; tenant_id: string } | null }
    if (!tplRow || tplRow.tenant_id !== callerTenant) {
        return NextResponse.json({ error: "Role template not found." }, { status: 404 })
    }
    const missing = templateMissingPermissions(callerPerms, tplRow.permissions)
    if (missing.length > 0) {
        return NextResponse.json({
            error: "You can't create a user with permissions you don't have yourself.",
            missing_permissions: missing,
        }, { status: 403 })
    }

    // ── Plan-cap pre-flight ─────────────────────────────────────────────
    if (body.branch_id) {
        const { data: ok, error: capErr } = await supabase.rpc(
            "can_invite_staff" as never,
            { p_branch_id: body.branch_id } as never,
        )
        if (!capErr && ok === false) {
            return NextResponse.json({
                error: "Your plan has reached its staff-per-outlet limit. Upgrade your plan or pick a different outlet.",
                code: "plan_limit",
            }, { status: 403 })
        }
    }

    // ── Step 1. auth.admin.createUser ──────────────────────────────────
    const admin = createServiceRoleClient()
    const { data: createRes, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: body.full_name ?? null },
    })

    if (createErr || !createRes?.user) {
        const msg = createErr?.message ?? "Failed to create auth user"
        if (/already (registered|exists)/i.test(msg)) {
            return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 })
        }
        logError(createErr ?? new Error(msg), { route: "/api/admin/staff/create" })
        return NextResponse.json({ error: msg }, { status: 500 })
    }

    const newUserId = createRes.user.id

    // ── Step 2. create_staff_profile RPC ───────────────────────────────
    const { data: profileRes, error: profileErr } = await supabase.rpc("create_staff_profile" as never, {
        p_user_id: newUserId,
        p_email: email,
        p_full_name: body.full_name ?? null,
        p_role: tplRow.base_role,
        p_dob: body.dob ?? null,
        p_phone: body.phone ?? null,
        p_avatar_url: body.avatar_url ?? null,
        p_branch_id: body.branch_id ?? null,
    } as never)

    if (profileErr) {
        try { await admin.auth.admin.deleteUser(newUserId) } catch { /* best effort */ }
        logError(profileErr, { route: "/api/admin/staff/create", step: "rpc" })
        return NextResponse.json({ error: profileErr.message }, { status: 400 })
    }

    // ── Step 3. attach role_template_id ────────────────────────────────
    // create_staff_profile sets the base role but doesn't know about
    // templates. Patch it on now using the service role — RLS on
    // public.users only allows the user themselves OR an OWNER to write,
    // and we want any manage_users delegate to be able to assign too.
    const { error: tplErr } = await admin
        .from("users")
        .update({ role_template_id: tplRow.id } as never)
        .eq("id", newUserId)

    if (tplErr) {
        try { await admin.auth.admin.deleteUser(newUserId) } catch { /* best effort */ }
        logError(tplErr, { route: "/api/admin/staff/create", step: "template-assign" })
        return NextResponse.json({ error: "Couldn't assign the role template — staff was not created." }, { status: 500 })
    }

    // Record the first-time assignment in the action history. The
    // BEFORE-INSERT auto-assign trigger has already attached a system
    // template by the time we get here, so `from_template_id` is the
    // system default that we're overwriting with the admin's pick.
    // Best-effort: don't undo a successful create on audit failure.
    const { error: auditErr } = await admin.rpc("log_role_template_assignment" as never, {
        p_actor_user_id: user.id,
        p_target_user_id: newUserId,
        p_from_template_id: null,
        p_to_template_id: tplRow.id,
    } as never)
    if (auditErr) {
        logError(auditErr, { route: "/api/admin/staff/create", step: "audit" })
    }

    return NextResponse.json({
        ok: true,
        user_id: newUserId,
        email,
        profile: profileRes ?? null,
    })
}
