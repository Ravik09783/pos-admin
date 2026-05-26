/**
 * CSRF mitigation: validate that mutating requests originate from our own
 * domain. We compare the Origin (or Referer) header against
 * NEXT_PUBLIC_APP_URL.
 *
 * Apply via `assertSameOrigin(req)` at the top of mutating API routes.
 * Skips check in dev so localhost callers work.
 */

export function assertSameOrigin(req: Request): { ok: true } | { ok: false; reason: string } {
    if (process.env.NODE_ENV !== "production") return { ok: true }
    const expected = process.env.NEXT_PUBLIC_APP_URL
    if (!expected) return { ok: true } // not configured, skip
    const origin = req.headers.get("origin")
    const referer = req.headers.get("referer")
    const source = origin ?? referer ?? ""
    try {
        const expectedOrigin = new URL(expected).origin
        const sourceOrigin = source ? new URL(source).origin : ""
        if (sourceOrigin !== expectedOrigin) {
            return { ok: false, reason: `Origin mismatch (got ${sourceOrigin || "none"})` }
        }
    } catch {
        return { ok: false, reason: "Invalid Origin/Referer header" }
    }
    return { ok: true }
}
