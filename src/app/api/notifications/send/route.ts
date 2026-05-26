import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { sendSms, sendWhatsApp } from "@/lib/notifications/twilio"
import { resolveTwilioCreds } from "@/lib/notifications/messaging"
import { templates } from "@/lib/notifications/templates"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { rateLimit } from "@/lib/rate-limit"

interface Body {
    template:
        | "billGenerated"
        | "paymentReceived"
        | "reservationConfirmed"
        | "reservationReminder"
        | "lowStock"
        | "orderReady"
        | "marketing"
    channel: "whatsapp" | "sms"
    to: string
    args: Record<string, unknown>
}

/**
 * POST /api/notifications/send
 * Body: { template, channel, to, args }
 *
 * Sends a transactional message via Twilio. Auth-gated to staff with billing
 * permission to prevent abuse / spam.
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    // Rate limit per user — prevents marketing-spam loops
    const rl = await rateLimit(`notif:${user.id}`, 200, 60 * 60_000) // 200 / hour
    if (!rl.allowed) {
        return NextResponse.json({ error: "rate limit (200/hr) exceeded" }, {
            status: 429,
            headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
        })
    }

    const { data: appUser } = await supabase.from("users").select("tenant_id, role").eq("id", user.id).maybeSingle()
    const role = (appUser as { role?: string } | null)?.role
    if (!role || !["OWNER", "MANAGER", "CASHIER"].includes(role)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const tenantId = (appUser as { tenant_id: string }).tenant_id

    const body = (await req.json()) as Body
    if (!body.template || !body.channel || !body.to) {
        return NextResponse.json({ error: "missing fields" }, { status: 400 })
    }

    const renderer = templates[body.template] as ((args: unknown) => string) | undefined
    if (!renderer) return NextResponse.json({ error: "unknown template" }, { status: 400 })

    let message: string
    try {
        // Convert ISO date strings back to Date
        const args = { ...(body.args as Record<string, unknown>) }
        if (typeof args.when === "string") args.when = new Date(args.when as string)
        message = renderer(args)
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "render error" }, { status: 400 })
    }

    // Resolve which Twilio account to send on — the tenant's own (Settings →
    // Notifications) or the platform env fallback. See resolveTwilioCreds.
    const { creds } = await resolveTwilioCreds(tenantId)
    if (!creds) {
        return NextResponse.json({
            error: "Messaging isn't set up. Add your WhatsApp / SMS details in Settings → Notifications.",
        }, { status: 400 })
    }

    try {
        const result = body.channel === "whatsapp"
            ? await sendWhatsApp({ to: body.to, body: message }, creds)
            : await sendSms({ to: body.to, body: message }, creds)

        await supabase.from("activity_log").insert({
            tenant_id: tenantId,
            user_id: user.id,
            action: `notification.${body.channel}.${body.template}`,
            metadata: { to: body.to, template: body.template, sid: result.sid, status: result.status } as never,
        } as never)

        return NextResponse.json({ ok: true, sid: result.sid })
    } catch (e: unknown) {
        logError(e, { route: "/api/notifications/send", tenantId, userId: user.id, template: body.template, channel: body.channel })
        return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 500 })
    }
}
