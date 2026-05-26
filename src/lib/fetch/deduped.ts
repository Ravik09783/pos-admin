"use client"

/**
 * Module-level fetch deduplicator.
 *
 * Two problems this solves:
 *   1. React Strict Mode in dev mounts every component twice → every
 *      `useEffect` that calls `fetch()` fires the network request twice.
 *      In prod that doesn't happen, but the noise makes the dev network
 *      tab nearly unreadable.
 *   2. Two component instances rendering the same banner (e.g. desktop +
 *      mobile copies of OfflineBanner / NavBody) each fire their own
 *      fetch. The data is the same — they should share.
 *
 * Strategy:
 *   - Coalesce concurrent calls to the same (method, url) into one
 *     in-flight Promise.
 *   - Cache the most recent response for `DEDUP_WINDOW_MS` so a
 *     Strict-Mode unmount → remount within the same render cycle reuses
 *     the previous response instead of firing a fresh request.
 *
 * The cache is intentionally short-lived (500 ms). It's not a real
 * HTTP cache — components that need data freshness past this window
 * should fetch again themselves. We just want to collapse the
 * "duplicate within the same tick" case.
 */
const DEDUP_WINDOW_MS = 500

const inFlight = new Map<string, Promise<Response>>()
const recent = new Map<string, { body: ArrayBuffer; status: number; headers: HeadersInit; expiry: number }>()

function key(url: string, init?: RequestInit): string {
    return `${init?.method ?? "GET"} ${url}`
}

function freshResponse(entry: { body: ArrayBuffer; status: number; headers: HeadersInit }) {
    // Construct a fresh Response each call so the caller can call .json() etc.
    return new Response(entry.body, { status: entry.status, headers: entry.headers })
}

/**
 * Drop-in replacement for `fetch` that collapses duplicate concurrent
 * calls to the same URL and serves recent (≤500 ms) repeats from
 * memory. Use it for any `useEffect`-driven banner/status fetch.
 */
export async function dedupedFetch(url: string, init?: RequestInit): Promise<Response> {
    const k = key(url, init)

    const cached = recent.get(k)
    if (cached && cached.expiry > Date.now()) {
        return freshResponse(cached)
    }

    const existing = inFlight.get(k)
    if (existing) return (await existing).clone()

    const promise = fetch(url, init).then(async (r) => {
        // Materialise the body once so concurrent callers don't fight
        // over the underlying ReadableStream. Future calls within the
        // dedup window read from this snapshot.
        try {
            const body = await r.clone().arrayBuffer()
            const headers: Record<string, string> = {}
            r.headers.forEach((v, name) => { headers[name] = v })
            recent.set(k, {
                body,
                status: r.status,
                headers,
                expiry: Date.now() + DEDUP_WINDOW_MS,
            })
        } catch { /* best-effort cache */ }
        inFlight.delete(k)
        return r
    }).catch((e) => {
        inFlight.delete(k)
        throw e
    })

    inFlight.set(k, promise)
    return (await promise).clone()
}
