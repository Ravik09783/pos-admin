import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"

/**
 * POST /api/customer-display/regenerate
 * Body: { user_id?: string }  // omit to rotate your own
 *
 * Rotates the display token. Any old URL stops resolving immediately.
 *
 * Authorization:
 *   - Self-rotate: any signed-in tenant user (cashiers managing their
 *     own tablet).
 *   - Rotate someone else's: OWNER only, and only inside the same
 *     tenant. Enforced inside the SQL RPC; we also check here so the
 *     client gets a clean 403 instead of a generic SQL error.
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    let body: { user_id?: string } = {}
    try { body = await req.json() } catch { body = {} }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const targetUserId = body.user_id?.trim() || user.id

    if (targetUserId !== user.id) {
        // Cross-user rotate — front-line gate. RPC re-checks.
        const { data: caller } = await supabase
            .from("users").select("role").eq("id", user.id).maybeSingle()
        const role = (caller as { role?: string } | null)?.role
        if (role !== "OWNER") {
            return NextResponse.json({ error: "OWNER only" }, { status: 403 })
        }
    }

    const { data, error } = await supabase.rpc(
        "rotate_display_token" as never,
        { p_user_id: targetUserId } as never,
    )
    if (error) {
        logError(error, { route: "/api/customer-display/regenerate", targetUserId })
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({
        ok: true,
        token: (data as { token?: string } | null)?.token ?? null,
    })
}
