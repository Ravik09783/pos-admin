import { NextResponse } from "next/server"

import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { resolveTwilioCreds } from "@/lib/notifications/messaging"
import { channelReady } from "@/lib/notifications/twilio"

/**
 * /api/notifications/credentials
 *
 * GET  — the tenant's messaging config for the Settings UI. NEVER returns the
 *        Twilio auth token — only `has_auth_token: boolean`. Any tenant
 *        member may read (so the page can show status); only the OWNER may
 *        write (see POST + the tenant_messaging RLS).
 *
 * POST — save the tenant's Twilio credentials. OWNER only. A blank
 *        `auth_token` means "keep the saved one" so the owner doesn't have
 *        to re-paste the secret to tweak a sender number.
 *
 * The token reaches the server over HTTPS, is stored in `tenant_messaging`
 * (owner-only RLS), and is read back only by the send path's service-role
 * client — it never travels to the browser again.
 */

interface SaveBody {
    account_sid?: string
    auth_token?: string
    whatsapp_from?: string
    sms_from?: string
    enabled?: boolean
}

export async function GET() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { data: appUser } = await supabase
        .from("users").select("tenant_id, role").eq("id", user.id).maybeSingle()
    const u = appUser as { tenant_id?: string; role?: string } | null
    if (!u?.tenant_id) return NextResponse.json({ error: "no_tenant" }, { status: 403 })

    const resolved = await resolveTwilioCreds(u.tenant_id)
    return NextResponse.json({
        ...resolved.config,                                  // provider, enabled, account_sid, has_auth_token, *_from
        source: resolved.source,                             // "tenant" | "env" | "none"
        whatsapp_ready: channelReady(resolved.creds, "whatsapp"),
        sms_ready: channelReady(resolved.creds, "sms"),
        can_edit: u.role === "OWNER",
    })
}

export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { data: appUser } = await supabase
        .from("users").select("tenant_id, role").eq("id", user.id).maybeSingle()
    const u = appUser as { tenant_id?: string; role?: string } | null
    if (!u?.tenant_id) return NextResponse.json({ error: "no_tenant" }, { status: 403 })
    if (u.role !== "OWNER") {
        return NextResponse.json({ error: "Only the owner can change messaging credentials" }, { status: 403 })
    }

    const body = (await req.json().catch(() => null)) as SaveBody | null
    if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 })

    const service = createServiceRoleClient()
    const { data: existing } = await service
        .from("tenant_messaging").select("twilio_auth_token").eq("tenant_id", u.tenant_id).maybeSingle()
    const existingToken = (existing as { twilio_auth_token?: string | null } | null)?.twilio_auth_token ?? null

    const accountSid  = (body.account_sid ?? "").trim() || null
    // Blank token field = keep the saved secret.
    const authToken   = (body.auth_token ?? "").trim() || existingToken
    const whatsappFrom = (body.whatsapp_from ?? "").trim() || null
    const smsFrom     = (body.sms_from ?? "").trim() || null
    const enabled     = !!body.enabled

    if (enabled && (!accountSid || !authToken)) {
        return NextResponse.json(
            { error: "Account SID and Auth Token are required to turn messaging on." },
            { status: 400 },
        )
    }
    if (enabled && !whatsappFrom && !smsFrom) {
        return NextResponse.json(
            { error: "Add at least one sender — a WhatsApp number or an SMS number." },
            { status: 400 },
        )
    }

    const { error } = await service
        .from("tenant_messaging")
        .upsert({
            tenant_id: u.tenant_id,
            provider: "twilio",
            twilio_account_sid: accountSid,
            twilio_auth_token: authToken,
            whatsapp_from: whatsappFrom,
            sms_from: smsFrom,
            enabled,
        } as never, { onConflict: "tenant_id" })
    if (error) {
        logError(error, { route: "/api/notifications/credentials", tenantId: u.tenant_id })
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
}
