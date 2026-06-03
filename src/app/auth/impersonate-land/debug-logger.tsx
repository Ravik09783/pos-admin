"use client"

import { useEffect } from "react"

/**
 * Tiny client-side logger for the impersonate landing page. Runs
 * once on first paint and dumps the URL the browser actually
 * received — including the hash fragment, which the server can't
 * see. Pair this with the `[auth-hash]` logs from `AuthHashHandler`
 * to triangulate where impersonation falls over:
 *
 *   • Logger here shows `hash` empty → Supabase didn't include
 *     tokens (allowlist reject, project-flow mismatch, expired link)
 *   • Logger here shows `hash` populated, but `[auth-hash]` says
 *     "no token hash" → some intermediary stripped the fragment
 *     between tab open and React mount (browser extension, service
 *     worker, etc.)
 *   • Both show the hash, `setSession` errors → token is invalid /
 *     expired / project mismatch.
 */
export function ImpersonateLandDebugLogger() {
    useEffect(() => {
        if (typeof window === "undefined") return
        console.log("[impersonate-land] page mounted", {
            href: window.location.href,
            pathname: window.location.pathname,
            search: window.location.search,
            // We don't log the full hash (contains tokens), just
            // structural info enough to debug routing.
            hashLength: window.location.hash.length,
            hashHasAccessToken: window.location.hash.includes("access_token="),
            hashHasError: window.location.hash.includes("error="),
            referrer: document.referrer,
        })
    }, [])
    return null
}
