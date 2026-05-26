import { NextResponse } from "next/server"

import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"

/**
 * POST /api/admin/staff/set-active
 *
 * Toggles a staff member between Active and Inactive at THREE layers so the
 * deactivation is enforced, not cosmetic:
 *   1. Supabase Auth ban_duration → blocks signInWithPassword.
 *   2. auth.admin.signOut(global)  → kills any live session right now.
 *   3. public.users.is_active      → the (app)/ layout's defensive check.
 *
 * On deactivate we also null the user's pin (shared-device quick-login) and
 * best-effort release their unclaimed invoice reservations so they don't
 * sit idle for 7 days and become invoice-number gaps.
 *
 * Authorization:
 *   - Caller must be OWNER or MANAGER in the target's tenant.
 *   - MANAGER cannot toggle an OWNER.
 *   - Self-toggle is forbidden (avoids the obvious "deactivate yourself" footgun).
 */

const BAN_DURATION = "876000h" // ~100 years, Supabase's idiomatic "ban indefinitely"

export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const body = (await req.json().catch(() => null)) as { user_id?: string; active?: boolean } | null
    if (!body || !body.user_id || typeof body.active !== "boolean") {
        return NextResponse.json({ error: "invalid body" }, { status: 400 })
    }
    const targetId = body.user_id
    const active = body.active

    if (targetId === user.id) {
        return NextResponse.json({ error: "You can't change your own active status" }, { status: 400 })
    }

    const { data: caller } = await supabase
        .from("users")
        .select("role, tenant_id")
        .eq("id", user.id)
        .maybeSingle()
    const callerRole = (caller as { role?: string } | null)?.role
    const callerTenant = (caller as { tenant_id?: string } | null)?.tenant_id
    if (!callerRole || !callerTenant || (callerRole !== "OWNER" && callerRole !== "MANAGER")) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const { data: target } = await supabase
        .from("users")
        .select("role, tenant_id")
        .eq("id", targetId)
        .maybeSingle()
    const targetRole = (target as { role?: string } | null)?.role
    const targetTenant = (target as { tenant_id?: string } | null)?.tenant_id
    if (!targetRole || targetTenant !== callerTenant) {
        return NextResponse.json({ error: "not found" }, { status: 404 })
    }
    if (callerRole === "MANAGER" && targetRole === "OWNER") {
        return NextResponse.json({ error: "Manager can't toggle an Owner" }, { status: 403 })
    }

    // ── Plan-cap guard on REACTIVATION ──────────────────────────────────
    // The OWNER could have onboarded a replacement after deactivating
    // this user — flipping the old row back on would silently put the
    // branch over its per-seat cap. The SQL RPC returns TRUE during
    // TRIAL and when the cap is unlimited, so this only fires when
    // we're truly at-cap on a paid plan.
    if (active) {
        const { data: ok, error: capErr } = await supabase.rpc(
            "can_reactivate_user" as never,
            { p_user_id: targetId } as never,
        )
        if (!capErr && ok === false) {
            return NextResponse.json({
                error: "Your plan has reached its staff-per-outlet limit. Deactivate another staff member at this branch, or upgrade your plan, before reactivating this one.",
                code: "plan_limit",
            }, { status: 403 })
        }
    }

    const admin = createServiceRoleClient()

    const { error: banErr } = await admin.auth.admin.updateUserById(targetId, {
        ban_duration: active ? "none" : BAN_DURATION,
    })
    if (banErr) {
        logError(banErr, { route: "/api/admin/staff/set-active", step: "ban" })
        return NextResponse.json({ error: banErr.message }, { status: 500 })
    }

    if (!active) {
        // Best-effort; failure here doesn't unwind the ban.
        try { await admin.auth.admin.signOut(targetId, "global") } catch { /* ignore */ }
    }

    const { error: updErr } = await supabase
        .from("users")
        .update({
            is_active: active,
            // Clear the quick-login PIN on deactivate so a shared device can't
            // be used to sneak past the email-based block.
            ...(active ? {} : { pin: null }),
        } as never)
        .eq("id", targetId)
    if (updErr) {
        logError(updErr, { route: "/api/admin/staff/set-active", step: "update_user" })
        return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

    let freed = 0
    if (!active) {
        try {
            const { data } = await supabase.rpc("release_user_reservations" as never, { p_user_id: targetId } as never)
            freed = typeof data === "number" ? data : 0
        } catch { /* best effort */ }
    }

    return NextResponse.json({ ok: true, freed })
}
