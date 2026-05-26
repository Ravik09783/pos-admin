import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { sendPushToTenant } from "@/lib/notifications/push"

/**
 * POST /api/notifications/push/test
 *
 * Fires a sample push to every device subscribed for the current user's
 * tenant. Used by the "🔔 Enable alerts" flow to confirm the
 * subscription is actually working — saves the user from having to
 * place a real QR order to verify.
 *
 * Auth: signed in. Scoped to the caller's tenant so it can't be used
 * to spam other restaurants' devices.
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { data: row } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle()
    const tenantId = (row as { tenant_id?: string } | null)?.tenant_id
    if (!tenantId) return NextResponse.json({ error: "no_tenant" }, { status: 400 })

    const result = await sendPushToTenant(tenantId, {
        title: "🛎️ Test notification",
        body: "Push alerts are set up correctly. New QR orders will look like this.",
        tag: "push-test",
        url: "/dashboard",
    })

    return NextResponse.json({ ok: true, ...result })
}
