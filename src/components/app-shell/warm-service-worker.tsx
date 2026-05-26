"use client"

/**
 * Mounted inside (app)/layout.tsx so it only renders for authenticated
 * users. On mount it asks the service worker to pre-cache the heavy-use
 * shift pages (/pos, /kds, /tables, /bills, /my-collections, /dashboard)
 * so the user can keep working through a network drop.
 *
 * We deliberately do NOT pre-cache these at SW install time — a logged-out
 * visitor who installs the PWA would otherwise cache the `/login` redirect
 * response for `/pos`, and later when signed in + offline they'd be served
 * that stale redirect instead of the page.
 *
 * Idempotent: the SW re-caches each page on every "warm" message, so
 * calling this repeatedly just refreshes the entries.
 */

import { useEffect } from "react"

export function WarmServiceWorker() {
    useEffect(() => {
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
        // The controller is null until the SW has activated. After it does,
        // either we already have one or `controllerchange` will fire.
        function postWarm() {
            navigator.serviceWorker.controller?.postMessage({ type: "warm" })
        }
        if (navigator.serviceWorker.controller) {
            postWarm()
        } else {
            navigator.serviceWorker.addEventListener("controllerchange", postWarm, { once: true })
        }
    }, [])
    return null
}
