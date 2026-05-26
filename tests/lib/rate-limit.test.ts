import { beforeEach, describe, expect, it, vi } from "vitest"

import { getClientIp, rateLimit } from "@/lib/rate-limit"

// Force the in-memory fallback path by ensuring Upstash env vars are unset.
beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.useRealTimers()
})

describe("rateLimit (in-memory fallback)", () => {
    it("allows requests under the limit", async () => {
        const key = `test:${Math.random()}`
        const r1 = await rateLimit(key, 3, 1000)
        expect(r1.allowed).toBe(true)
        expect(r1.remaining).toBe(2)
    })

    it("denies requests over the limit within the window", async () => {
        const key = `test:${Math.random()}`
        await rateLimit(key, 2, 1000)  // 1
        await rateLimit(key, 2, 1000)  // 2
        const r = await rateLimit(key, 2, 1000)  // 3 — over
        expect(r.allowed).toBe(false)
        expect(r.remaining).toBe(0)
    })

    it("resets the bucket after the window expires", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
        const key = `test:${Math.random()}`
        await rateLimit(key, 1, 1000)
        const denied = await rateLimit(key, 1, 1000)
        expect(denied.allowed).toBe(false)

        vi.setSystemTime(new Date("2026-01-01T00:00:02Z")) // 2s later, window passed
        const allowedAgain = await rateLimit(key, 1, 1000)
        expect(allowedAgain.allowed).toBe(true)
    })

    it("keys are independent", async () => {
        const a = `keyA:${Math.random()}`
        const b = `keyB:${Math.random()}`
        await rateLimit(a, 1, 1000) // consume key A
        const denyA = await rateLimit(a, 1, 1000)
        const allowB = await rateLimit(b, 1, 1000)
        expect(denyA.allowed).toBe(false)
        expect(allowB.allowed).toBe(true)
    })

    it("exposes resetAt timestamp in the future", async () => {
        const key = `test:${Math.random()}`
        const start = Date.now()
        const r = await rateLimit(key, 5, 60_000)
        expect(r.resetAt).toBeGreaterThanOrEqual(start)
        expect(r.resetAt).toBeLessThanOrEqual(start + 60_500)
    })
})

describe("getClientIp", () => {
    it("returns the first IP from x-forwarded-for", () => {
        const req = new Request("http://localhost", {
            headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
        })
        expect(getClientIp(req)).toBe("203.0.113.5")
    })

    it("trims whitespace around the IP", () => {
        const req = new Request("http://localhost", {
            headers: { "x-forwarded-for": "  203.0.113.5  , 10.0.0.1" },
        })
        expect(getClientIp(req)).toBe("203.0.113.5")
    })

    it("falls back to x-real-ip when x-forwarded-for is missing", () => {
        const req = new Request("http://localhost", {
            headers: { "x-real-ip": "198.51.100.7" },
        })
        expect(getClientIp(req)).toBe("198.51.100.7")
    })

    it("returns 'unknown' when no proxy headers are present", () => {
        const req = new Request("http://localhost")
        expect(getClientIp(req)).toBe("unknown")
    })
})
