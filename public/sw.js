// RestoPOS service worker — minimal cache-first for shell, network-first for data.
//
// Cache version: bump when shipping a change that should force-refresh all
// installed clients (new chunks, breaking HTML changes). Existing tabs
// auto-switch to the new SW on next reload because of skipWaiting +
// clients.claim() below.
// v3: per-URL caching (one failure no longer drops the whole batch) +
// flushes any stale /pos→/login responses cached before the auth fix.
const CACHE_VERSION = "restopos-v3"
const SHELL_CACHE = `${CACHE_VERSION}-shell`
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`

// Auth-safe pages cached on install. Anyone can request these without
// being signed in, so caching them at SW install time doesn't risk storing
// a redirect-to-/login response.
const SHELL_ASSETS = [
    "/",
    "/offline",
    "/login",
    "/signup",
    "/manifest.json",
]

// Authenticated shift pages — pre-fetched only AFTER the user has reached
// the app shell (i.e. they're signed in). The trigger is a postMessage
// from `<WarmServiceWorker />` mounted in (app)/layout.tsx. Without this
// indirection, an SW install for a logged-out visitor would cache the
// `/login` redirect for `/pos`, and later when they signed in + went
// offline the cache would still serve the redirect.
const WARM_ASSETS = [
    "/dashboard",
    "/pos",
    "/kds",
    "/tables",
    "/bills",
    "/my-collections",
]

self.addEventListener("install", (event) => {
    // Cache each asset independently — c.addAll() is atomic, so a single
    // failed request would drop the whole shell. Per-URL caching keeps
    // whatever did succeed.
    event.waitUntil(
        caches.open(SHELL_CACHE).then((c) =>
            Promise.all(SHELL_ASSETS.map((u) => c.add(u).catch(() => {}))),
        ),
    )
    self.skipWaiting()
})

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))),
        ),
    )
    self.clients.claim()
})

self.addEventListener("message", (event) => {
    // Authenticated app shell asking us to pre-cache the heavy-use pages.
    // Per-URL so one page failing (e.g. a role-gated 404) doesn't drop the
    // rest — /pos in particular must survive for offline billing.
    if (event.data && event.data.type === "warm") {
        event.waitUntil(
            caches.open(RUNTIME_CACHE).then((c) =>
                Promise.all(WARM_ASSETS.map((u) => c.add(u).catch(() => {}))),
            ),
        )
    }
})

self.addEventListener("fetch", (event) => {
    const req = event.request
    const url = new URL(req.url)

    // Don't intercept Supabase/api/auth/etc — they need to be live.
    if (req.method !== "GET") return
    if (url.pathname.startsWith("/api/")) return
    if (url.hostname !== self.location.hostname) return

    // Static next assets → cache-first
    if (url.pathname.startsWith("/_next/static/") || /\.(png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(url.pathname)) {
        event.respondWith(cacheFirst(req))
        return
    }

    // HTML pages → network-first with offline fallback
    if (req.headers.get("accept")?.includes("text/html")) {
        event.respondWith(networkFirstWithOffline(req))
        return
    }

    // default: try network, fall back to cache
    event.respondWith(networkFirst(req))
})

async function cacheFirst(req) {
    const cached = await caches.match(req)
    if (cached) return cached
    try {
        const response = await fetch(req)
        const cache = await caches.open(RUNTIME_CACHE)
        cache.put(req, response.clone())
        return response
    } catch {
        return Response.error()
    }
}

async function networkFirst(req) {
    try {
        const response = await fetch(req)
        const cache = await caches.open(RUNTIME_CACHE)
        cache.put(req, response.clone())
        return response
    } catch {
        const cached = await caches.match(req)
        return cached ?? Response.error()
    }
}

async function networkFirstWithOffline(req) {
    try {
        const response = await fetch(req)
        const cache = await caches.open(RUNTIME_CACHE)
        cache.put(req, response.clone())
        return response
    } catch {
        const cached = await caches.match(req)
        if (cached) return cached
        const offline = await caches.match("/offline")
        return offline ?? new Response("Offline", { status: 503 })
    }
}

// Background sync stub — if you want to queue POS orders when offline, expand this.
self.addEventListener("sync", (event) => {
    if (event.tag === "sync-orders") {
        // future: replay queued mutations from IndexedDB
    }
})

// ── Web Push ────────────────────────────────────────────────────────────────
// Fires when the server (via web-push, using the VAPID private key) sends a
// notification to this client's subscription endpoint. Works even when the
// dashboard tab is closed and the browser is in the background.
//
// Payload shape (set by src/lib/notifications/push.ts on the server):
//   { title, body, tag, url, icon?, badge? }
self.addEventListener("push", (event) => {
    let payload = {}
    try {
        payload = event.data ? event.data.json() : {}
    } catch {
        // Some push providers send plain-text payloads; fall back.
        try { payload = { title: "RestoPOS", body: event.data ? event.data.text() : "" } }
        catch { payload = {} }
    }

    const title = payload.title || "🛎️ New QR order"
    const options = {
        body: payload.body || "A new order has arrived.",
        icon: payload.icon || "/icon.svg",
        badge: payload.badge || "/icon.svg",
        tag: payload.tag || "qr-order",
        requireInteraction: true,
        // Carry the url through so notificationclick can route to it.
        data: { url: payload.url || "/bills" },
    }
    event.waitUntil(self.registration.showNotification(title, options))
})

// Click on the notification → focus an existing dashboard tab if one is
// open, otherwise open a new one. Always navigates to the bill detail.
self.addEventListener("notificationclick", (event) => {
    event.notification.close()
    const target = (event.notification.data && event.notification.data.url) || "/bills"
    event.waitUntil((async () => {
        const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
        // Prefer focusing an existing dashboard tab over opening a new one —
        // staff usually has the POS already open.
        for (const c of clientsList) {
            if (c.url.includes(self.location.origin)) {
                await c.focus()
                if ("navigate" in c) await c.navigate(target)
                return
            }
        }
        await self.clients.openWindow(target)
    })())
})

// Subscription got revoked / expired → next subscribe call from the client
// will replace it. Nothing else to do here.
self.addEventListener("pushsubscriptionchange", () => {})
