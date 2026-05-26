import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

/**
 * GET /api/notifications/status
 * Returns whether each Twilio channel is configured server-side.
 * Auth-gated to staff so we don't leak config presence to anonymous callers.
 */
export async function GET() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const whatsapp = !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN && !!process.env.TWILIO_WHATSAPP_FROM
    const sms = !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN && !!process.env.TWILIO_SMS_FROM
    return NextResponse.json({ whatsapp, sms })
}
