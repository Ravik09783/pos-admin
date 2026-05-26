/**
 * Resolve the absolute origin to use when minting URLs that the caller
 * (or another browser they own) will open shortly afterwards.
 *
 * The rule:
 *   1. **Request origin wins.** If we have a `Request`, its origin is
 *      the URL the browser actually used to hit us — so when the user
 *      is on `localhost:3000`, the URLs we hand back are localhost
 *      URLs; when they're on production, the URLs are production. This
 *      is the right behaviour 99 % of the time.
 *   2. **`NEXT_PUBLIC_APP_URL` is a fallback,** only used when there's
 *      no request context (background jobs, scheduled tasks, places
 *      that don't have a `Request` to inspect).
 *   3. **`http://localhost:3000` is the floor** so a misconfigured
 *      dev env still produces *something* clickable instead of `undefined/...`.
 *
 * This is the inverse of what the codebase used to do (env-first,
 * request-fallback). The old order caused the "I'm running locally but
 * Open Customer Screen points at production" bug — staff on dev with a
 * production `NEXT_PUBLIC_APP_URL` would get a production URL from
 * every API that built one. Flipping the precedence kills that bug
 * everywhere in one place.
 *
 * Trailing slashes are stripped so callers can safely do `${origin}/foo`.
 *
 * Usage:
 *   const origin = appOrigin(req)
 *   const url = `${origin}/display/${slug}/${token}`
 */
export function appOrigin(req?: Request | null): string {
    if (req) {
        try {
            const fromReq = new URL(req.url).origin
            if (fromReq) return fromReq.replace(/\/$/, "")
        } catch {
            /* malformed req.url — fall through to env */
        }
    }
    const env = process.env.NEXT_PUBLIC_APP_URL
    if (env && env.trim()) return env.trim().replace(/\/$/, "")
    return "http://localhost:3000"
}
