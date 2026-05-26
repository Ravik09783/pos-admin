import { NextResponse } from "next/server"

import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"

/**
 * POST /api/admin/staff/reset-password
 *
 * Admin-initiated password reset for a staff member. Uses the service-role
 * key (Postgres can't hash auth passwords directly).
 *
 * Authorization:
 *   - Caller must be OWNER or MANAGER in the target's tenant.
 *   - Target must NOT be an OWNER — by policy, OWNER passwords are only
 *     resettable via the email-based /forgot-password flow, so one OWNER
 *     can't silently lock another out.
 *   - Self-reset is rejected — the user can use /reset-password themselves.
 *
 * After the password update we sign the target out globally so any existing
 * session is invalidated and they're forced to use the new password.
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const body = (await req.json().catch(() => null)) as { user_id?: string; password?: string } | null
    if (!body || !body.user_id || !body.password) {
        return NextResponse.json({ error: "invalid body" }, { status: 400 })
    }
    if (body.password.length < 8) {
        return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 })
    }
    if (body.user_id === user.id) {
        return NextResponse.json({ error: "Change your own password from your profile" }, { status: 400 })
    }

    const { data: caller } = await supabase
        .from("users").select("role, tenant_id").eq("id", user.id).maybeSingle()
    const callerRole = (caller as { role?: string } | null)?.role
    const callerTenant = (caller as { tenant_id?: string } | null)?.tenant_id
    if (!callerRole || !callerTenant || (callerRole !== "OWNER" && callerRole !== "MANAGER")) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const { data: target } = await supabase
        .from("users").select("role, tenant_id").eq("id", body.user_id).maybeSingle()
    const targetRole = (target as { role?: string } | null)?.role
    const targetTenant = (target as { tenant_id?: string } | null)?.tenant_id
    if (!targetRole || targetTenant !== callerTenant) {
        return NextResponse.json({ error: "not found" }, { status: 404 })
    }
    if (targetRole === "OWNER") {
        return NextResponse.json(
            { error: "Owner passwords can only be reset via the 'Forgot password' email flow." },
            { status: 403 },
        )
    }

    const admin = createServiceRoleClient()
    const { error: pwErr } = await admin.auth.admin.updateUserById(body.user_id, {
        password: body.password,
    })
    if (pwErr) {
        logError(pwErr, { route: "/api/admin/staff/reset-password" })
        return NextResponse.json({ error: pwErr.message }, { status: 500 })
    }

    try { await admin.auth.admin.signOut(body.user_id, "global") } catch { /* ignore */ }

    return NextResponse.json({ ok: true })
}
