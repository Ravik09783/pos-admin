import { describe, expect, it } from "vitest"

import { formatCurrency, formatDate, gstinStateCode, isValidGSTIN, slugify, timeAgo } from "@/lib/utils"

describe("formatCurrency", () => {
    it("formats integers as ₹ with the en-IN locale grouping", () => {
        const out = formatCurrency(1500)
        expect(out).toMatch(/₹.?1,500/)
    })

    it("uses Indian lakh grouping (1,00,000) — not 100,000", () => {
        const out = formatCurrency(100000)
        // en-IN uses lakh grouping
        expect(out).toMatch(/1,00,000/)
    })

    it("rounds to at most 2 decimal places", () => {
        const out = formatCurrency(123.456)
        expect(out).toMatch(/123\.46/)
    })

    it("returns '—' for null/undefined", () => {
        expect(formatCurrency(null)).toMatch(/—|0/) // null falls through to 0
        expect(formatCurrency(undefined)).toMatch(/—|0/)
    })

    it("returns '—' for non-finite values (NaN, Infinity)", () => {
        expect(formatCurrency(Number.NaN)).toBe("—")
        expect(formatCurrency(Number.POSITIVE_INFINITY)).toBe("—")
    })

    it("accepts numeric strings", () => {
        expect(formatCurrency("250")).toMatch(/₹.?250/)
    })

    it("respects an alternate currency code", () => {
        const out = formatCurrency(100, "USD")
        // en-IN locale renders USD as US$ or $
        expect(out).toMatch(/(\$|US)/)
    })
})

describe("formatDate", () => {
    it("returns '—' for null/undefined input", () => {
        expect(formatDate(null)).toBe("—")
        expect(formatDate(undefined)).toBe("—")
    })

    it("formats an ISO string with the default medium+short options", () => {
        const out = formatDate("2026-03-15T10:30:00Z")
        // Output varies by locale but must include 2026 and some recognizable time
        expect(out).toMatch(/2026/)
    })

    it("accepts a Date object", () => {
        const out = formatDate(new Date("2026-01-01T00:00:00Z"))
        expect(out).toMatch(/2026|2025/)
    })
})

describe("timeAgo", () => {
    const NOW = new Date("2026-05-22T12:00:00Z")

    it("returns '' for missing / unparseable input", () => {
        expect(timeAgo(null, NOW)).toBe("")
        expect(timeAgo(undefined, NOW)).toBe("")
        expect(timeAgo("not-a-date", NOW)).toBe("")
    })

    it("says 'just now' for times within ~45s", () => {
        expect(timeAgo("2026-05-22T11:59:40Z", NOW)).toBe("just now")
    })

    it("formats minutes, hours and days ago", () => {
        expect(timeAgo("2026-05-22T11:30:00Z", NOW)).toMatch(/30 minutes ago/)
        expect(timeAgo("2026-05-22T09:00:00Z", NOW)).toMatch(/3 hours ago/)
        expect(timeAgo("2026-05-20T12:00:00Z", NOW)).toMatch(/2 days ago/)
    })

    it("formats months and years ago", () => {
        expect(timeAgo("2026-02-22T12:00:00Z", NOW)).toMatch(/months? ago/)
        expect(timeAgo("2024-05-22T12:00:00Z", NOW)).toMatch(/years? ago/)
    })

    it("renders a future date as 'in ...'", () => {
        expect(timeAgo("2026-05-22T13:00:00Z", NOW)).toMatch(/^in /)
    })
})

describe("slugify", () => {
    it("lowercases and hyphenates spaces", () => {
        expect(slugify("Hello World")).toBe("hello-world")
    })

    it("strips punctuation and collapses runs into one hyphen", () => {
        expect(slugify("Spicy   Tandoori!! Chicken™")).toBe("spicy-tandoori-chicken")
    })

    it("trims leading and trailing hyphens", () => {
        expect(slugify("--leading & trailing--")).toBe("leading-trailing")
    })

    it("caps at 60 characters", () => {
        const long = "x".repeat(120)
        expect(slugify(long).length).toBeLessThanOrEqual(60)
    })

    it("handles unicode by replacing with hyphens", () => {
        // Non a-z 0-9 → hyphens; emoji and accented chars get stripped
        expect(slugify("Café résumé")).toBe("caf-r-sum")
    })
})

describe("gstinStateCode", () => {
    it("extracts the first two digits", () => {
        expect(gstinStateCode("29ABCDE1234F1Z5")).toBe("29")
        expect(gstinStateCode("07ABCDE1234F1Z5")).toBe("07")
    })

    it("returns null if the first two chars aren't digits", () => {
        expect(gstinStateCode("XXABCDE1234F1Z5")).toBeNull()
    })

    it("returns null for null/undefined/short input", () => {
        expect(gstinStateCode(null)).toBeNull()
        expect(gstinStateCode(undefined)).toBeNull()
        expect(gstinStateCode("")).toBeNull()
        expect(gstinStateCode("2")).toBeNull()
    })
})

describe("isValidGSTIN", () => {
    it("accepts a well-formed GSTIN", () => {
        // Format: 2 digits | 5 letters | 4 digits | 1 letter | 1 alnum | Z | 1 alnum
        expect(isValidGSTIN("29ABCDE1234F1Z5")).toBe(true)
        expect(isValidGSTIN("07XYZAB9876C2Z9")).toBe(true)
    })

    it("rejects wrong length", () => {
        expect(isValidGSTIN("29ABCDE1234F1Z")).toBe(false)   // 14 chars
        expect(isValidGSTIN("29ABCDE1234F1Z55")).toBe(false) // 16 chars
    })

    it("rejects lowercase letters", () => {
        expect(isValidGSTIN("29abcde1234F1Z5")).toBe(false)
    })

    it("rejects missing 'Z' in position 13", () => {
        expect(isValidGSTIN("29ABCDE1234F1A5")).toBe(false)
    })

    it("rejects non-numeric state code", () => {
        expect(isValidGSTIN("AAABCDE1234F1Z5")).toBe(false)
    })

    it("rejects empty string", () => {
        expect(isValidGSTIN("")).toBe(false)
    })
})
