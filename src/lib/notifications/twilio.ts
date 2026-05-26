/**
 * Lightweight Twilio wrapper using fetch directly — avoids pulling the full SDK.
 *
 * Credentials are NO LONGER read from env inside the send functions: each
 * restaurant configures its own Twilio account in Settings → Notifications,
 * stored in `tenant_messaging`. The send route resolves the right credentials
 * (tenant's own, or the platform env fallback) and passes them in here — see
 * `resolveTwilioCreds` in ./messaging.
 *
 * Platform-wide env fallback (used when a tenant hasn't set up their own):
 *   TWILIO_ACCOUNT_SID   ACxxxx...
 *   TWILIO_AUTH_TOKEN    your-token
 *   TWILIO_WHATSAPP_FROM whatsapp:+14155238886
 *   TWILIO_SMS_FROM      +1234567890
 */

/** A resolved Twilio account — either a tenant's own, or the env fallback. */
export interface TwilioCreds {
    accountSid: string
    authToken: string
    /** 'whatsapp:+1...' or '+1...'. Null when WhatsApp isn't set up. */
    whatsappFrom: string | null
    /** '+1...' or an alphanumeric sender ID. Null when SMS isn't set up. */
    smsFrom: string | null
}

type SendArgs = {
    to: string         // E.164 phone (e.g. +919876543210)
    body: string
}

interface SendResult {
    sid: string
    status: string
}

/** Platform-wide credentials from env, or null when none are set. The send
 *  path uses these only when the tenant hasn't configured their own account. */
export function envTwilioCreds(): TwilioCreds | null {
    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    if (!accountSid || !authToken) return null
    return {
        accountSid,
        authToken,
        whatsappFrom: process.env.TWILIO_WHATSAPP_FROM ?? null,
        smsFrom: process.env.TWILIO_SMS_FROM ?? null,
    }
}

/** Whether a given channel can actually send with these credentials. */
export function channelReady(creds: TwilioCreds | null, channel: "whatsapp" | "sms"): boolean {
    if (!creds?.accountSid || !creds.authToken) return false
    return channel === "whatsapp" ? !!creds.whatsappFrom : !!creds.smsFrom
}

async function twilioPost(creds: TwilioCreds, formData: URLSearchParams): Promise<SendResult> {
    const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`, {
        method: "POST",
        headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData,
    })
    if (!r.ok) {
        const text = await r.text()
        throw new Error(`Twilio error: ${r.status} ${text}`)
    }
    const data = await r.json()
    return { sid: data.sid, status: data.status }
}

export async function sendWhatsApp({ to, body }: SendArgs, creds: TwilioCreds): Promise<SendResult> {
    if (!channelReady(creds, "whatsapp")) {
        throw new Error("WhatsApp isn't configured — add your Twilio details in Settings → Notifications")
    }
    const from = creds.whatsappFrom!
    const params = new URLSearchParams({
        From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
        To: `whatsapp:${normalizePhone(to)}`,
        Body: body,
    })
    return twilioPost(creds, params)
}

export async function sendSms({ to, body }: SendArgs, creds: TwilioCreds): Promise<SendResult> {
    if (!channelReady(creds, "sms")) {
        throw new Error("SMS isn't configured — add your Twilio details in Settings → Notifications")
    }
    const params = new URLSearchParams({ From: creds.smsFrom!, To: normalizePhone(to), Body: body })
    return twilioPost(creds, params)
}

export function normalizePhone(phone: string): string {
    const cleaned = phone.replace(/[\s\-()]/g, "")
    if (cleaned.startsWith("+")) return cleaned
    // assume Indian numbers if 10 digits with no country code
    if (/^\d{10}$/.test(cleaned)) return `+91${cleaned}`
    return cleaned.startsWith("00") ? `+${cleaned.slice(2)}` : `+${cleaned}`
}
