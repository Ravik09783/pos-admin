"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"

/**
 * Catches Supabase auth tokens delivered in the URL hash (`#access_token=…
 * &refresh_token=…&type=magiclink`) and exchanges them for a real
 * session before letting the page render the regular content.
 *
 * WHY THIS IS NEEDED
 *   Supabase's `auth.admin.generateLink()` (used by our super-admin
 *   impersonation flow at `/api/super-admin/impersonate`) returns a
 *   magic link whose verification endpoint redirects back to the app
 *   with tokens **in the URL hash**, not as a `?code=…` query param.
 *   Our existing `/auth/callback` route only handles the `?code=…`
 *   PKCE shape, so without this hash handler the user lands on the
 *   page, the tokens sit in the URL doing nothing, and they appear
 *   unauthenticated.
 *
 *   Mounted at the root layout level so it runs on EVERY page —
 *   especially needed when Supabase's "Allowed Redirect URLs"
 *   allow-list rejects the explicit `redirectTo` we asked for and
 *   falls back to the project's Site URL (often `/`).
 *
 * WHAT IT DOES
 *   1. Read `window.location.hash` on first paint.
 *   2. If it contains `access_token=…`, parse + persist via
 *      `supabase.auth.setSession({ access_token, refresh_token })`.
 *      That call writes the cookies the rest of the app reads, so
 *      subsequent navigations + server components see the new user.
 *   3. Replace the URL (drop the hash, keep pathname + search) so
 *      tokens don't linger in the address bar or browser history.
 *   4. Hard-navigate to the post-auth landing target (default `/menu`,
 *      the launcher) and refresh so server components re-evaluate.
 *
 *   Guarded by a ref so React Strict-Mode's double-effect doesn't
 *   fire `setSession` twice.
 */
export function AuthHashHandler() {
    const ranRef = useRef(false)
    useEffect(() => {
        if (typeof window === "undefined") return

        // Debug logs — prefixed `[auth-hash]` so you can filter the
        // console. Tells us where in the handshake we land if a magic
        // link or impersonation handoff stalls. Safe to leave in: we
        // never log the raw tokens, only flags + the URL pieces.
        console.log("[auth-hash] mounted at", window.location.pathname, {
            hasHash: window.location.hash.length > 0,
            hashLen: window.location.hash.length,
            hashLooksLikeTokens: window.location.hash.includes("access_token="),
            hashLooksLikeError: window.location.hash.includes("error="),
        })

        if (ranRef.current) {
            console.log("[auth-hash] skipping — already ran on this mount")
            return
        }
        const hash = window.location.hash
        if (!hash || !hash.includes("access_token=")) {
            // Helpful for "stuck on landing page" debugging: if Supabase
            // redirected without tokens it usually appended `?error=…`
            // to the URL instead, or the hash was stripped by a 3xx
            // redirect along the way.
            const searchHasError = window.location.search.includes("error")
            console.log("[auth-hash] no token hash present — nothing to exchange.", {
                searchHasError,
                search: window.location.search,
            })
            return
        }
        ranRef.current = true

        // Hash format: "#access_token=…&refresh_token=…&type=magiclink…"
        const params = new URLSearchParams(hash.replace(/^#/, ""))
        const accessToken = params.get("access_token")
        const refreshToken = params.get("refresh_token")
        const error = params.get("error") || params.get("error_description")
        const type = params.get("type")

        console.log("[auth-hash] parsed hash params", {
            hasAccessToken: !!accessToken,
            accessTokenLen: accessToken?.length ?? 0,
            hasRefreshToken: !!refreshToken,
            refreshTokenLen: refreshToken?.length ?? 0,
            type,
            error,
        })

        if (error) {
            // Common cases: link expired, link already used, signup
            // confirmation flow failed. Surface and clear the hash so
            // the user isn't stuck looking at a noisy URL.
            console.warn("[auth-hash] Supabase reported an error in the hash:", error)
            toast.error(`Authentication link failed: ${decodeURIComponent(error)}`)
            window.history.replaceState(null, "", window.location.pathname + window.location.search)
            return
        }
        if (!accessToken || !refreshToken) {
            console.warn("[auth-hash] hash had access_token but is missing one of the required fields — aborting", {
                hasAccessToken: !!accessToken, hasRefreshToken: !!refreshToken,
            })
            return
        }

        const supabase = createClient()
        void (async () => {
            try {
                // ── Save the OUTGOING session before swap, only when
                //    this looks like a super-admin impersonation handoff
                //    (the dedicated landing path). Lets us show a
                //    "Return to my account" banner later. We persist
                //    the refresh_token so even an expired access_token
                //    can be refreshed when the admin clicks Return.
                if (window.location.pathname === "/auth/impersonate-land") {
                    try {
                        const { data: prev } = await supabase.auth.getSession()
                        if (prev.session && prev.session.user.email) {
                            const payload = {
                                access_token: prev.session.access_token,
                                refresh_token: prev.session.refresh_token,
                                email: prev.session.user.email,
                                savedAt: Date.now(),
                            }
                            window.localStorage.setItem(
                                "restopos:impersonator-session",
                                JSON.stringify(payload),
                            )
                            console.log("[auth-hash] saved outgoing session for impersonation return", {
                                email: payload.email,
                            })
                        }
                    } catch (saveErr) {
                        console.warn("[auth-hash] couldn't save outgoing session — return path will be unavailable", saveErr)
                    }
                }

                console.log("[auth-hash] calling supabase.auth.setSession…")
                const { data, error: setErr } = await supabase.auth.setSession({
                    access_token: accessToken,
                    refresh_token: refreshToken,
                })
                if (setErr) throw setErr
                console.log("[auth-hash] setSession ok", {
                    userId: data.user?.id,
                    userEmail: data.user?.email,
                    sessionExpiresAt: data.session?.expires_at,
                })
                // Magic-link from impersonation → land on /menu (the
                // role-aware launcher). Other auth flows (signup
                // confirmation, etc.) also land there safely — the
                // `(app)` layout will reroute to /onboarding for users
                // who haven't picked a tenant yet.
                const dest = type === "recovery" ? "/settings/profile" : "/menu"
                console.log("[auth-hash] hard-navigating to", dest)
                // HARD navigation — NOT `router.replace`. The cookies
                // just changed (super-admin → impersonated user) so we
                // need a full document fetch so the proxy, layouts
                // and RSC tree all re-evaluate with the new session.
                // `router.replace` reuses the client cache (still
                // built against the old session) and frequently
                // leaves the tab stuck on the landing page — that
                // was the "Signing you in…" spinner that never went
                // away. `replace()` (vs `assign()`) also keeps the
                // landing URL out of browser history.
                window.location.replace(dest)
            } catch (e) {
                console.error("[auth-hash] Failed to exchange hash tokens for a session:", e)
                toast.error(e instanceof Error ? e.message : "Couldn't complete sign-in.")
                window.history.replaceState(null, "", window.location.pathname + window.location.search)
            }
        })()
    }, [])
    return null
}
