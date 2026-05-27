import { NextResponse, type NextRequest } from "next/server"

import { createMiddlewareClient } from "@/lib/supabase/middleware"

/**
 * Next.js 16 proxy (the renamed `middleware`). Runs on the Node runtime
 * before the route handler / RSC tree renders. It has TWO jobs:
 *
 * 1. SESSION REFRESH — on every authenticated route. Supabase access
 *    tokens are short-lived and the refresh token rotates on each use.
 *    Server Components can READ cookies but cannot WRITE them, so the
 *    rotated cookies must be written HERE: `createMiddlewareClient` puts
 *    them on `response` and we return it. Without this the session dies
 *    on a plain page refresh and the user is bounced to /login — exactly
 *    the "refresh /pos → login" bug.
 *
 *    NOTE: `(app)/layout.tsx` also calls getUser(), but as an RSC it
 *    CANNOT persist the rotated cookies — so the proxy must run on the
 *    app routes too, not just /, /login, /signup. The earlier "skip app
 *    routes, the layout already does getUser" reasoning was the bug.
 *
 * 2. AUTHED-VISITOR BOUNCE — a signed-in visitor landing on /login or
 *    /signup is redirected to /menu, so those auth pages stay static
 *    prerenders instead of doing the check in-route. /menu is the
 *    role-aware launcher grid — admin AND staff get the same landing
 *    surface on sign-in (admins still have Dashboard one click away).
 *
 *    `/` is intentionally NOT in the bounce list: a logged-in user
 *    can still visit the marketing landing page (handy for sharing a
 *    link with a colleague, copying marketing copy, or just clicking
 *    the logo to "go home").
 *
 * 3. SUBSCRIPTION LOCKOUT — when a tenant's trial is over and there's no
 *    active subscription, the app is paywalled: EVERY signed-in member
 *    (owner and staff alike) is confined to /settings/billing until
 *    someone pays. Staff can pay too — the billing routes accept any
 *    tenant member — so the restaurant is never stuck because the owner
 *    is unavailable. Driven by the `my_billing_lock_state` RPC. The
 *    money path (generate_bill) is independently gated in SQL, so this
 *    is the UX layer of the same rule.
 *
 * Public surfaces (customer QR ordering, public bill pages, public +
 * webhook APIs, the offline fallback) carry no session, so they're
 * skipped — no needless auth round-trip, and a webhook's body is never
 * touched.
 *
 * Real auth ENFORCEMENT still lives in `(app)/layout.tsx`; the proxy is
 * session upkeep + redirects, and is deliberately fail-open.
 */
const BOUNCE_WHEN_AUTHED = ["/login", "/signup"]
const PUBLIC_PREFIXES = ["/qr", "/b/", "/api/public", "/api/webhooks", "/offline"]

/**
 * Paths exempt from the subscription lockout — auth pages, onboarding,
 * the locked screen itself, the super-admin console, and every API route
 * (the bill-generation RPC is gated in SQL, and the billing page's own
 * API calls must keep working). `/settings/billing` is NOT exempt — it's
 * handled specially: allowed for a locked OWNER, redirected for staff.
 */
function isLockExempt(pathname: string): boolean {
    return (
        pathname.startsWith("/api/") ||
        pathname.startsWith("/super-admin") ||
        pathname.startsWith("/onboarding") ||
        pathname.startsWith("/locked") ||
        pathname.startsWith("/login") ||
        pathname.startsWith("/auth") ||
        pathname.startsWith("/invite") ||
        pathname === "/" ||
        pathname === "/signup"
    )
}

export async function proxy(req: NextRequest) {
    const { pathname } = req.nextUrl

    if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
        return NextResponse.next()
    }

    // ── Fail-open guard ──────────────────────────────────────────────────
    // A thrown proxy 500s every matched route. Auth enforcement is the
    // (app) layout's job, so on any error — missing env var, Supabase
    // auth server unreachable, a bundler/runtime quirk — we pass the
    // request through rather than taking the app down.
    try {
        const { supabase, response } = createMiddlewareClient(req)
        // getUser() refreshes the session when the access token is stale;
        // createMiddlewareClient writes the rotated cookies onto `response`.
        // (Supabase docs warn against getSession() here — it relies on a
        // JWT signature check only and misses server-side revocation.)
        const {
            data: { user },
        } = await supabase.auth.getUser()

        // ── Subscription lockout ─────────────────────────────────────
        // Trial over + no active subscription → the tenant is paywalled.
        // `my_billing_lock_state` reports whether this user's tenant is
        // locked. A failed RPC (e.g. migration 37 not applied) yields no
        // data → no lock → fail-open.
        //
        // Locked → confine EVERYONE (owner and staff) to the billing
        // page; whoever's signed in can pay there to unlock the app.
        if (user && !isLockExempt(pathname)) {
            const { data: lockData } = await supabase.rpc("my_billing_lock_state" as never)
            const lock = lockData as { locked?: boolean } | null
            if (lock?.locked && !pathname.startsWith("/settings/billing")) {
                return NextResponse.redirect(new URL("/settings/billing?locked=1", req.url))
            }
        }

        // Signed-in visitor on /, /login or /signup → send to /menu (the
        // role-aware launcher).
        if (user && BOUNCE_WHEN_AUTHED.includes(pathname)) {
            const url = req.nextUrl.clone()
            url.pathname = "/menu"
            return NextResponse.redirect(url)
        }

        // Everywhere else: return `response` so the refreshed session
        // cookies reach the browser.
        return response
    } catch (err) {
        console.error("[proxy] session refresh failed — passing request through", err)
        return NextResponse.next()
    }
}

export const config = {
    // Run on every route EXCEPT static assets, the icon/manifest, and the
    // service worker — none of those carry a session. The public-path
    // skip at the top of `proxy()` handles QR / webhook / public-API routes.
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.json|llms.txt|sw.js|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?)$).*)",
    ],
}
