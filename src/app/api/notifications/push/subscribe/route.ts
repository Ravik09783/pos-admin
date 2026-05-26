import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"

/**
 * POST /api/notifications/push/subscribe
 * Body: { endpoint, keys: { p256dh, auth } }
 *
 * Called by the client after the user grants notification permission
 * AND the service worker registers a PushSubscription. We upsert one
 * row per endpoint — re-subscribing from the same browser/device
 * replaces the row instead of duplicating it.
 *
 * Auth: must be signed in. The row is scoped to (tenant_id, user_id)
 * so the webhook can fan out to every device of every staff member.
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const body = (await req.json()) as {
        endpoint?: string
        keys?: { p256dh?: string; auth?: string }
    }
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
        return NextResponse.json({ error: "invalid_subscription" }, { status: 400 })
    }

    // Look up the user's tenant — push notifications are scoped per
    // tenant so cross-tenant fan-out is impossible.
    const { data: row } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle()
    const tenantId = (row as { tenant_id?: string } | null)?.tenant_id
    if (!tenantId) return NextResponse.json({ error: "no_tenant" }, { status: 400 })

    // User agent is just a friendly label for the (future) device list UI.
    const ua = req.headers.get("user-agent")?.slice(0, 200) ?? null

    const { error } = await supabase
        .from("push_subscriptions")
        .upsert({
            tenant_id: tenantId,
            user_id: user.id,
            endpoint: body.endpoint,
            p256dh: body.keys.p256dh,
            auth: body.keys.auth,
            user_agent: ua,
            last_seen_at: new Date().toISOString(),
        } as never, { onConflict: "endpoint" })

    if (error) {
        logError(error, { route: "/api/notifications/push/subscribe", userId: user.id })
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
}
