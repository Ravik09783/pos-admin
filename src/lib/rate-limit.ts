/**
 * Rate limiter. Uses Upstash Redis if UPSTASH_REDIS_REST_URL is set, otherwise
 * an in-memory token bucket scoped to this server instance.
 *
 * The in-memory fallback is leaky — across multiple Vercel functions / serverless
 * instances each has its own counter — but it's better than nothing and protects
 * against the most common single-attacker hammering one endpoint.
 */

interface RateLimitResult {
    allowed: boolean
    remaining: number
    resetAt: number
}

const buckets = new Map<string, { count: number; resetAt: number }>()

export async function rateLimit(
    key: string,
    limit: number,
    windowMs: number,
): Promise<RateLimitResult> {
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN

    if (upstashUrl && upstashToken) {
        try {
            // INCR + EXPIRE in a single pipeline
            const r = await fetch(`${upstashUrl}/pipeline`, {
                method: "POST",
                headers: { Authorization: `Bearer ${upstashToken}`, "Content-Type": "application/json" },
                body: JSON.stringify([
                    ["INCR", `rl:${key}`],
                    ["PEXPIRE", `rl:${key}`, String(windowMs), "NX"],
                    ["PTTL", `rl:${key}`],
                ]),
                cache: "no-store",
            })
            if (r.ok) {
                const data = await r.json() as Array<{ result: number }>
                const count = data[0]?.result ?? 0
                const ttl = data[2]?.result ?? windowMs
                return {
                    allowed: count <= limit,
                    remaining: Math.max(0, limit - count),
                    resetAt: Date.now() + Math.max(0, ttl),
                }
            }
        } catch {
            // fall through to in-memory
        }
    }

    // In-memory fallback
    const now = Date.now()
    const cur = buckets.get(key)
    if (!cur || cur.resetAt < now) {
        const reset = now + windowMs
        buckets.set(key, { count: 1, resetAt: reset })
        return { allowed: true, remaining: limit - 1, resetAt: reset }
    }
    cur.count++
    return {
        allowed: cur.count <= limit,
        remaining: Math.max(0, limit - cur.count),
        resetAt: cur.resetAt,
    }
}

/** Best-effort client IP from common proxy headers. */
export function getClientIp(req: Request): string {
    const xff = req.headers.get("x-forwarded-for")
    if (xff) return xff.split(",")[0]!.trim()
    const realIp = req.headers.get("x-real-ip")
    if (realIp) return realIp.trim()
    return "unknown"
}
