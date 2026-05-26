/**
 * Tiny helper module for platform-side Stripe (the SaaS billing we charge
 * the restaurant). NOT the Connect account. All APIs here POST against
 * api.stripe.com directly — same fetch pattern the rest of the codebase
 * already uses, no Stripe Node SDK to keep the bundle slim.
 */

const STRIPE_API = "https://api.stripe.com/v1"

/** Pin the Stripe API version. Stripe rolls forward semantically without
 *  much notice ("acacia", "amber", etc. release cadence) — pinning here
 *  keeps webhook payload shapes + API request shapes consistent across
 *  the codebase even as Stripe defaults move. Bump intentionally when
 *  we adopt new behavior. */
export const STRIPE_API_VERSION = "2024-11-20.acacia"

/** Form-urlencode helper. Stripe expects `application/x-www-form-urlencoded`
 *  with bracket-notation for nested params, e.g. `metadata[tenant_id]=…`. */
export function stripeForm(obj: Record<string, string | number | boolean | null | undefined>): URLSearchParams {
    const out = new URLSearchParams()
    for (const [k, v] of Object.entries(obj)) {
        if (v === null || v === undefined) continue
        out.append(k, String(v))
    }
    return out
}

/** Wrap fetch with a 15s AbortController. A platform-Stripe outage
 *  shouldn't be allowed to hang a settings page indefinitely.
 *
 *  `extraHeaders` is the escape hatch for caller-specific headers — the
 *  one that matters here is `Idempotency-Key`. Passing it on
 *  customers.create / subscriptions.create / refunds.create makes Stripe
 *  return the EXISTING object on retry instead of creating a duplicate,
 *  which is the main thing standing between us and orphan `cus_…` rows
 *  when two browser tabs race the "Add card" flow. */
export async function stripeFetch(
    path: string,
    body: URLSearchParams | undefined,
    // DELETE is used by the super-admin tenant-delete flow to cancel a
    // subscription immediately. Stripe's REST API accepts it on a
    // handful of resources (/subscriptions/:id is the one we hit); for
    // everything else we stay on POST.
    method: "GET" | "POST" | "DELETE" = "POST",
    extraHeaders?: Record<string, string>,
): Promise<{ ok: boolean; status: number; data: unknown; rawText: string }> {
    const secret = process.env.STRIPE_SECRET_KEY
    if (!secret) {
        return { ok: false, status: 500, data: { error: { message: "Stripe not configured" } }, rawText: "" }
    }
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 15000)
    try {
        const r = await fetch(`${STRIPE_API}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${secret}`,
                "Content-Type": "application/x-www-form-urlencoded",
                "Stripe-Version": STRIPE_API_VERSION,
                ...(extraHeaders ?? {}),
            },
            body: method === "POST" ? body : undefined,
            signal: ac.signal,
        })
        const rawText = await r.text()
        let data: unknown
        try { data = JSON.parse(rawText) } catch { data = { error: { message: rawText } } }
        return { ok: r.ok, status: r.status, data, rawText }
    } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError"
        return {
            ok: false,
            status: aborted ? 504 : 502,
            data: { error: { message: aborted ? "Stripe is slow — try again." : "Couldn't reach Stripe." } },
            rawText: "",
        }
    } finally {
        clearTimeout(timer)
    }
}

/** Pull the human-readable message out of a Stripe error response. */
export function stripeErrorMessage(data: unknown, fallback = "Stripe rejected the request."): string {
    const j = data as { error?: { message?: string } } | null
    return j?.error?.message ?? fallback
}
