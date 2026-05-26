/**
 * Client-side helpers to register the browser for Web Push and persist
 * the subscription on the server. Called once after the user grants
 * notification permission.
 *
 * Flow:
 *   1. Make sure the service worker is registered (it usually already is
 *      via <SwRegister />, but we wait on it here defensively).
 *   2. Read NEXT_PUBLIC_VAPID_PUBLIC_KEY and convert to the Uint8Array
 *      shape the Push API expects.
 *   3. Subscribe the worker to push.
 *   4. POST the resulting endpoint + keys to /api/notifications/push/subscribe
 *      so the server can fan out pushes to it later.
 *
 * The browser handles the actual push routing — we just hold its
 * endpoint as the "address" to push to.
 */

export interface SubscribeResult {
    ok: boolean
    reason?: "unsupported" | "no_vapid" | "no_sw" | "denied" | "subscribe_failed" | "persist_failed"
    endpoint?: string
}

export async function subscribeToWebPush(): Promise<SubscribeResult> {
    if (typeof window === "undefined") return { ok: false, reason: "unsupported" }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        return { ok: false, reason: "unsupported" }
    }
    if (Notification.permission !== "granted") {
        return { ok: false, reason: "denied" }
    }
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!publicKey) return { ok: false, reason: "no_vapid" }

    const registration = await navigator.serviceWorker.ready.catch(() => null)
    if (!registration) return { ok: false, reason: "no_sw" }

    // If the browser already has a subscription for this SW we can
    // reuse it — saves a round-trip and avoids the rare race where the
    // OS revokes-then-recreates an endpoint.
    let subscription = await registration.pushManager.getSubscription().catch(() => null)
    if (!subscription) {
        try {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey),
            })
        } catch {
            return { ok: false, reason: "subscribe_failed" }
        }
    }

    const json = subscription.toJSON() as {
        endpoint?: string
        keys?: { p256dh?: string; auth?: string }
    }
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        return { ok: false, reason: "subscribe_failed" }
    }

    try {
        const r = await fetch("/api/notifications/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
        })
        if (!r.ok) return { ok: false, reason: "persist_failed", endpoint: json.endpoint }
    } catch {
        return { ok: false, reason: "persist_failed", endpoint: json.endpoint }
    }
    return { ok: true, endpoint: json.endpoint }
}

export async function unsubscribeFromWebPush(): Promise<void> {
    if (typeof window === "undefined") return
    if (!("serviceWorker" in navigator)) return
    const registration = await navigator.serviceWorker.ready.catch(() => null)
    if (!registration) return
    const subscription = await registration.pushManager.getSubscription().catch(() => null)
    if (!subscription) return

    // Tell the server first so it stops trying to push to this endpoint
    // even if the browser-side unsubscribe later fails.
    try {
        await fetch("/api/notifications/push/unsubscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
    } catch { /* swallow */ }
    try { await subscription.unsubscribe() } catch { /* swallow */ }
}

/** Convert a base64url VAPID public key into the buffer the Push API's
 *  subscribe() accepts. Return as ArrayBuffer (not Uint8Array<SAB>) so
 *  it satisfies TS's BufferSource constraint on applicationServerKey. */
function urlBase64ToUint8Array(base64: string): ArrayBuffer {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4)
    const cleaned = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
    const raw = atob(cleaned)
    const buf = new ArrayBuffer(raw.length)
    const view = new Uint8Array(buf)
    for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
    return buf
}
