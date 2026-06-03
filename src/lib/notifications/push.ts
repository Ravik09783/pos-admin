/**
 * Server-side Web Push helper. Used by:
 *   - PhonePe webhook (TXN_SUCCESS for QR orders)
 *   - Stripe webhook (payment_intent.succeeded for QR orders)
 *   - Test endpoint (/api/notifications/push/test)
 *
 * One platform-wide VAPID keypair signs every push (set in .env). Each
 * tenant has many subscription rows; sendPushToTenant fans out and
 * cleans up dead endpoints (410 Gone, 404) so the table doesn't grow
 * stale forever.
 */
import webpush from "web-push"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { logError, logInfo, logWarn } from "@/lib/errors"

export interface PushPayload {
    title: string
    body: string
    /** Used to dedupe rapid retries — same tag replaces the on-screen notification. */
    tag?: string
    /** Where notificationclick navigates. */
    url?: string
    icon?: string
    badge?: string
}

let configured = false
function ensureConfigured(): boolean {
    if (configured) return true
    const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    const priv = process.env.VAPID_PRIVATE_KEY
    const subject = process.env.VAPID_SUBJECT || "mailto:support@example.com"
    if (!pub || !priv) {
        logWarn("Web Push: VAPID keys not configured — push notifications disabled")
        return false
    }
    try {
        webpush.setVapidDetails(subject, pub, priv)
        configured = true
        return true
    } catch (e) {
        logError(e, { stage: "vapid-setup" })
        return false
    }
}

/**
 * Send a push to every active subscription for the given tenant.
 * Idempotent w.r.t. the tag — the browser collapses duplicates with
 * the same tag into one on-screen notification.
 *
 * Returns a quick summary so callers can log it. Never throws —
 * push failure must not block the webhook from acking the payment.
 */
export async function sendPushToTenant(tenantId: string, payload: PushPayload) {
    if (!ensureConfigured()) return { sent: 0, deleted: 0, total: 0 }

    const supabase = createServiceRoleClient()
    const { data: subs, error } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("tenant_id", tenantId)
    if (error) {
        logError(error, { stage: "push-fetch-subs", tenantId })
        return { sent: 0, deleted: 0, total: 0 }
    }
    const rows = (subs ?? []) as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>
    if (rows.length === 0) return { sent: 0, deleted: 0, total: 0 }

    const body = JSON.stringify({
        title: payload.title,
        body: payload.body,
        tag: payload.tag,
        url: payload.url,
        icon: payload.icon ?? "/icon.svg",
        badge: payload.badge ?? "/icon.svg",
    })

    // Run all sends in parallel; web-push has its own timeout so a stuck
    // endpoint won't block the others.
    const results = await Promise.allSettled(rows.map(async (sub) => {
        try {
            await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                body,
            )
            return { id: sub.id, ok: true as const }
        } catch (e: unknown) {
            const statusCode = (e as { statusCode?: number }).statusCode ?? 0
            // 404 / 410 mean the subscription is dead — the browser
            // permanently unsubscribed or uninstalled. Drop it so we
            // don't keep retrying.
            const dead = statusCode === 404 || statusCode === 410
            return { id: sub.id, ok: false as const, dead, statusCode, error: (e as Error).message }
        }
    }))

    const deadIds: string[] = []
    let sent = 0
    for (const r of results) {
        if (r.status !== "fulfilled") continue
        if (r.value.ok) sent++
        else if (r.value.dead) deadIds.push(r.value.id)
    }
    if (deadIds.length > 0) {
        await supabase.from("push_subscriptions").delete().in("id", deadIds)
    }
    logInfo("Web Push fanned out", { tenantId, total: rows.length, sent, deleted: deadIds.length })
    return { sent, deleted: deadIds.length, total: rows.length }
}
