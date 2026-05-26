import { describe, expect, it } from "vitest"

import { FOOD_QUOTES, quoteForSeed } from "@/lib/food-quotes"

describe("FOOD_QUOTES", () => {
    it("has at least 20 quotes (each table card should have a real chance of a unique one)", () => {
        expect(FOOD_QUOTES.length).toBeGreaterThanOrEqual(20)
    })

    it("every quote has both text and author", () => {
        for (const q of FOOD_QUOTES) {
            expect(q.text).toBeTruthy()
            expect(q.text.length).toBeGreaterThan(3)
            expect(q.author).toBeTruthy()
        }
    })

    it("no duplicate quote text", () => {
        const seen = new Set<string>()
        for (const q of FOOD_QUOTES) {
            expect(seen.has(q.text), `Duplicate quote: ${q.text}`).toBe(false)
            seen.add(q.text)
        }
    })
})

describe("quoteForSeed", () => {
    it("is deterministic — same seed → same quote", () => {
        const a = quoteForSeed("table-a")
        const b = quoteForSeed("table-a")
        expect(a).toEqual(b)
    })

    it("different seeds (usually) yield different quotes", () => {
        // Sample 10 distinct seeds; expect at least 3 distinct quotes — the
        // hash is well-distributed enough that 10 colliding to 1 is essentially
        // impossible with a 30-quote pool.
        const seeds = ["seed-1", "seed-2", "seed-3", "seed-4", "seed-5",
                       "seed-6", "seed-7", "seed-8", "seed-9", "seed-10"]
        const picks = new Set(seeds.map((s) => quoteForSeed(s).text))
        expect(picks.size).toBeGreaterThanOrEqual(3)
    })

    it("always returns a quote from the pool (never undefined)", () => {
        const q = quoteForSeed("anything")
        expect(FOOD_QUOTES.some((p) => p.text === q.text)).toBe(true)
    })

    it("handles empty seed safely (falls back to first quote)", () => {
        const q = quoteForSeed("")
        expect(q).toEqual(FOOD_QUOTES[0])
    })

    it("UUIDs produce stable quotes across calls", () => {
        const uuid = "d41d8cd9-8f00-b204-e980-0998ecf8427e"
        const calls = Array.from({ length: 50 }, () => quoteForSeed(uuid).text)
        const unique = new Set(calls)
        expect(unique.size).toBe(1)
    })
})
