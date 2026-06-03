/**
 * Resolve the absolute origin to use when minting URLs that the caller
 * (or another browser they own) will open shortly afterwards.
 *
 * Resolution order, most-trustworthy first:
 *   1. **Forwarded headers.** `x-forwarded-host` + `x-forwarded-proto`
 *      reflect the exact URL the browser actually hit, even when our
 *      Next.js server is behind a proxy (Vercel, fly.io, nginx). When
 *      these are set we trust them above anything else — so a request
 *      that came in on `https://staging.foo.com` produces a staging
 *      URL, even though the internal `req.url` might read
 *      `http://localhost:3000` on the platform's inner network.
 *   2. **Request origin.** If no forwarded headers, derive from
 *      `new URL(req.url).origin` — works for direct dev requests.
 *   3. **`NEXT_PUBLIC_APP_URL`.** Background-job / cron / no-request
 *      fallback only.
 *   4. **`http://localhost:3000`.** Last-ditch sentinel so a totally
 *      mis-configured dev env still produces a clickable URL.
 *
 * Used by impersonation magic links, customer-display invitations,
 * webhooks-with-action-URL, etc. — anything that round-trips a URL
 * back to the user's browser.
 *
 * Trailing slashes are stripped so callers can safely do `${origin}/foo`.
 *
 * Usage:
 *   const origin = appOrigin(req)
 *   const url = `${origin}/display/${slug}/${token}`
 */
export function appOrigin(req?: Request | null): string {
    if (req) {
        // 1) Forwarded headers (most reliable behind any proxy).
        const fwdHost = req.headers.get("x-forwarded-host")
        const fwdProto = req.headers.get("x-forwarded-proto") || "https"
        if (fwdHost) {
            // `x-forwarded-host` can be a comma-separated list when
            // multiple proxies chain — the first entry is the one the
            // browser actually used.
            const host = fwdHost.split(",")[0]!.trim()
            return `${fwdProto.split(",")[0]!.trim()}://${host}`.replace(/\/$/, "")
        }
        // 2) Plain `req.url` origin — fine for direct local dev hits.
        try {
            const fromReq = new URL(req.url).origin
            if (fromReq) return fromReq.replace(/\/$/, "")
        } catch {
            /* malformed req.url — fall through to env */
        }
    }
    // 3) Env-only fallback (cron / scheduled jobs / no request).
    const env = process.env.NEXT_PUBLIC_APP_URL
    if (env && env.trim()) return env.trim().replace(/\/$/, "")
    // 4) Last-ditch sentinel.
    return "http://localhost:3000"
}
