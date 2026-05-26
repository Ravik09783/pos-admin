import { describe, expect, it } from "vitest"

import { computeAge } from "@/lib/profile/age"

describe("computeAge", () => {
    const REF = new Date("2026-05-13T10:00:00Z")

    it("returns null for missing / empty inputs", () => {
        expect(computeAge(null, REF)).toBeNull()
        expect(computeAge(undefined, REF)).toBeNull()
        expect(computeAge("", REF)).toBeNull()
    })

    it("returns null for unparseable strings", () => {
        expect(computeAge("not-a-date", REF)).toBeNull()
        expect(computeAge("13/05/1990", REF)).toBeNull()    // wrong format
    })

    it("ignores time component, accepts YYYY-MM-DD", () => {
        expect(computeAge("1990-05-13", REF)).toBe(36)        // birthday already passed
    })

    it("subtracts one when birthday hasn't happened yet this year", () => {
        // Birthday May 14, ref date May 13 — not yet 36.
        expect(computeAge("1990-05-14", REF)).toBe(35)
        // Birthday in December
        expect(computeAge("1990-12-31", REF)).toBe(35)
    })

    it("counts birthday day as the year tick", () => {
        // Born exactly today
        expect(computeAge("1990-05-13", REF)).toBe(36)
        // Born yesterday — still that age
        expect(computeAge("1990-05-12", REF)).toBe(36)
    })

    it("rejects future and absurd dates", () => {
        expect(computeAge("2050-01-01", REF)).toBeNull()        // future → negative
        expect(computeAge("1800-01-01", REF)).toBeNull()        // > 150
    })
})
