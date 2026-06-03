import { Loader2 } from "lucide-react"

import { ImpersonateLandDebugLogger } from "./debug-logger"

/**
 * Landing page for super-admin impersonation magic links.
 *
 * WHY THIS EXISTS
 *   The impersonate route mints a magic link whose `redirectTo` used
 *   to be `/dashboard?impersonated=1`. Two problems with that:
 *
 *     1. `/dashboard` lives inside the `(app)` route group, whose
 *        layout runs a super-admin short-circuit: if the cookie-derived
 *        session is a SUPER_ADMIN, it `redirect("/super-admin")`.
 *        The new tab opens with the super-admin's cookies (same
 *        origin — cookies are shared across tabs), so the layout
 *        immediately bounces.
 *     2. That bounce is a server-side 3xx, and some browsers
 *        (Safari/WebKit in particular) DROP the URL fragment across
 *        HTTP redirects. The `#access_token=…&refresh_token=…` hash
 *        that Supabase appended is gone by the time the browser
 *        lands on `/super-admin`, so `AuthHashHandler` has nothing
 *        to exchange and the session never gets swapped.
 *
 *   This page lives OUTSIDE the `(app)` route group on purpose. It
 *   triggers no auth guard, no redirect, and is also exempted from
 *   `proxy.ts` so the super-admin cookies stay untouched on the
 *   way in. The `AuthHashHandler` mounted in the root layout reads
 *   the hash tokens, calls `setSession(...)` (which overwrites the
 *   cookies with the impersonated user's session), and navigates
 *   to `/menu` — at which point every other auth check sees the
 *   impersonated user, not the super-admin.
 *
 *   Server component — no client logic of its own. The whole
 *   redirect dance is owned by `AuthHashHandler`; this page just
 *   gives the user a "we're working on it" beat instead of a
 *   blank flash.
 */
export default function ImpersonateLandPage() {
    return (
        <div className="min-h-dvh grid place-items-center bg-background p-6">
            {/* Debug logger — runs once on mount, captures the URL the
              * browser actually received (incl. hash) so we can tell
              * whether Supabase delivered the tokens or not. */}
            <ImpersonateLandDebugLogger />
            <div className="text-center space-y-3 max-w-sm">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                <h1 className="text-xl font-bold tracking-tight">Signing you in…</h1>
                <p className="text-sm text-muted-foreground">
                    Swapping to the impersonated session. You&apos;ll land on the menu in a moment.
                </p>
            </div>
        </div>
    )
}
