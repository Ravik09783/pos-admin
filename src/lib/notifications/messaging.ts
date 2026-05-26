/**
 * Server-side resolver: which Twilio credentials should a tenant's messages
 * go out on?
 *
 *   1. The tenant's OWN account (Settings → Notifications), if configured
 *      and enabled — preferred, so messages are on their brand + bill.
 *   2. The platform-wide env account (TWILIO_*), as a fallback.
 *   3. Nothing — messaging is unavailable.
 *
 * The tenant's `twilio_auth_token` is a secret, so this MUST run server-side
 * only — it reads `tenant_messaging` with the service-role client.
 */

import "server-only"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { envTwilioCreds, type TwilioCreds } from "./twilio"

/** Non-secret view of a tenant's stored config — safe to send to the browser. */
export interface MessagingConfig {
    provider: string
    enabled: boolean
    /** Twilio Account SID — not secret (it's the username), shown in the UI. */
    account_sid: string | null
    /** Whether an auth token is on file — the token itself is never returned. */
    has_auth_token: boolean
    whatsapp_from: string | null
    sms_from: string | null
}

export interface ResolvedMessaging {
    /** The credentials to actually send with, or null when none exist. */
    creds: TwilioCreds | null
    /** Where `creds` came from — drives the "using your account / platform
     *  default / not set up" hint in the UI. */
    source: "tenant" | "env" | "none"
    /** The tenant's stored config, secret-free — for the settings form. */
    config: MessagingConfig
}

export async function resolveTwilioCreds(tenantId: string): Promise<ResolvedMessaging> {
    const service = createServiceRoleClient()
    const { data } = await service
        .from("tenant_messaging")
        .select("provider, enabled, twilio_account_sid, twilio_auth_token, whatsapp_from, sms_from")
        .eq("tenant_id", tenantId)
        .maybeSingle()
    const row = data as {
        provider: string
        enabled: boolean
        twilio_account_sid: string | null
        twilio_auth_token: string | null
        whatsapp_from: string | null
        sms_from: string | null
    } | null

    const config: MessagingConfig = {
        provider: row?.provider ?? "twilio",
        enabled: !!row?.enabled,
        account_sid: row?.twilio_account_sid ?? null,
        has_auth_token: !!row?.twilio_auth_token,
        whatsapp_from: row?.whatsapp_from ?? null,
        sms_from: row?.sms_from ?? null,
    }

    // The tenant's own account wins when it's enabled and complete.
    if (row?.enabled && row.twilio_account_sid && row.twilio_auth_token) {
        return {
            creds: {
                accountSid: row.twilio_account_sid,
                authToken: row.twilio_auth_token,
                whatsappFrom: row.whatsapp_from,
                smsFrom: row.sms_from,
            },
            source: "tenant",
            config,
        }
    }

    const env = envTwilioCreds()
    return { creds: env, source: env ? "env" : "none", config }
}
