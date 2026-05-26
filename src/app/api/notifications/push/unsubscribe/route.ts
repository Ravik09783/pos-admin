import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"

/**
 * POST /api/notifications/push/unsubscribe
 * Body: { endpoint }
 *
 * Removes a single device's subscription. Called when the user toggles
 * notifications off, signs out, or the service worker reports the push
 * subscription was lost. Returns 200 even if the row didn't exist —
 * an unsubscribe should be idempotent.
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { endpoint } = (await req.json()) as { endpoint?: string }
    if (!endpoint) return NextResponse.json({ error: "endpoint_required" }, { status: 400 })

    // RLS already ensures we can only delete our own rows; the user_id
    // filter is belt-and-suspenders.
    await supabase
        .from("push_subscriptions")
        .delete()
        .eq("endpoint", endpoint)
        .eq("user_id", user.id)

    return NextResponse.json({ ok: true })
}
