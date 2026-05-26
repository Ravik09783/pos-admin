import { describe, expect, it } from "vitest"

import {
    BILL_TEMPLATES, defaultTemplateId, getTemplate, groupByCategory,
    recommendedTemplates, templatesForCountry,
} from "@/lib/bill/templates"

describe("bill templates — catalog", () => {
    it("ships a healthy number of formats (the user asked for 20–50+)", () => {
        expect(BILL_TEMPLATES.length).toBeGreaterThanOrEqual(40)
    })

    it("template ids are unique", () => {
        const ids = BILL_TEMPLATES.map((t) => t.id)
        expect(new Set(ids).size).toBe(ids.length)
    })

    it("region-specific templates declare an explicit country list; the rest are GLOBAL", () => {
        for (const t of BILL_TEMPLATES) {
            if (t.category === "region" && t.id !== "generic-no-tax") {
                expect(Array.isArray(t.regions), t.id).toBe(true)
            }
        }
        // every non-region template is available everywhere
        for (const t of BILL_TEMPLATES.filter((t) => t.category !== "region")) {
            expect(t.regions, t.id).toBe("GLOBAL")
        }
    })

    it("recommendedFor is always a subset of regions", () => {
        for (const t of BILL_TEMPLATES) {
            if (t.regions === "GLOBAL") continue
            for (const cc of t.recommendedFor) expect(t.regions, t.id).toContain(cc)
        }
    })
})

describe("bill templates — country lookups", () => {
    it("templatesForCountry includes the GLOBAL ones plus that country's region layouts", () => {
        const inT = templatesForCountry("IN")
        expect(inT.some((t) => t.id === "in-gst-thermal")).toBe(true)
        expect(inT.some((t) => t.id === "thermal-modern-80")).toBe(true)   // GLOBAL
        // a US restaurant should NOT see India's GST thermal slip
        const usT = templatesForCountry("US")
        expect(usT.some((t) => t.id === "in-gst-thermal")).toBe(false)
        expect(usT.some((t) => t.id === "us-guest-check")).toBe(true)
        expect(usT.some((t) => t.id === "thermal-modern-80")).toBe(true)
    })

    it("recommendedTemplates returns the country's picks, region layouts first", () => {
        const rec = recommendedTemplates("IN")
        expect(rec.length).toBeGreaterThan(0)
        expect(rec[0]?.category).toBe("region")          // India's GST layout leads
        expect(rec.every((t) => templatesForCountry("IN").includes(t))).toBe(true)
        // EU country gets the EU VAT invoice as a recommendation
        expect(recommendedTemplates("DE").some((t) => t.id === "eu-vat-invoice")).toBe(true)
        // a country with no explicit picks falls back to a sane global set
        const fallback = recommendedTemplates("ZZ" as string)
        expect(fallback.length).toBeGreaterThan(0)
        expect(fallback.every((t) => t.regions === "GLOBAL")).toBe(true)
    })

    it("defaultTemplateId resolves to a real template for every catalogued country", () => {
        for (const cc of ["IN", "US", "GB", "AE", "SA", "DE", "FR", "AU", "CA", "ZA", "SG", "OTHER"]) {
            const id = defaultTemplateId(cc)
            expect(getTemplate(id), cc).toBeDefined()
        }
    })

    it("groupByCategory keeps the catalogue order and drops empty groups", () => {
        const groups = groupByCategory(templatesForCountry("US"))
        expect(groups.map((g) => g.key)).toEqual(["region", "thermal", "a4", "boutique", "qsr"])
        expect(groups.every((g) => g.items.length > 0)).toBe(true)
    })
})
