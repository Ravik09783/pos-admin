import { describe, expect, it } from "vitest"

import {
    COUNTRY_OPTIONS, TAX_CONFIGS, defaultRateFor, getStateConfig, getTaxConfig, taxRatesFor,
} from "@/lib/tax/locale-config"
import { computeOrder } from "@/lib/gst/calculator"

describe("locale-config — getTaxConfig", () => {
    it("looks up by ISO code", () => {
        expect(getTaxConfig("IN").name).toBe("India")
        expect(getTaxConfig("AE").name).toBe("United Arab Emirates")
        expect(getTaxConfig("gb").code).toBe("GB")  // case-insensitive
    })

    it("looks up by full country name (how tenants.country stores it)", () => {
        expect(getTaxConfig("India").code).toBe("IN")
        expect(getTaxConfig("United Kingdom").code).toBe("GB")
    })

    it("falls back to India for unknown / null", () => {
        expect(getTaxConfig(null).code).toBe("IN")
        expect(getTaxConfig(undefined).code).toBe("IN")
        expect(getTaxConfig("Atlantis").code).toBe("IN")
    })

    it("India is the only 'split' country here; the rest are 'single' or 'none'", () => {
        expect(getTaxConfig("IN").taxModel).toBe("split")
        expect(getTaxConfig("GB").taxModel).toBe("single")
        expect(getTaxConfig("AE").taxModel).toBe("single")
        expect(getTaxConfig("OTHER").taxModel).toBe("none")
    })

    it("service charge is disallowed in India, allowed elsewhere", () => {
        expect(getTaxConfig("IN").serviceChargeAllowed).toBe(false)
        for (const c of ["AE", "GB", "US", "SG", "AU", "CA"]) {
            expect(getTaxConfig(c).serviceChargeAllowed, c).toBe(true)
        }
    })

    it("India config gets its states injected from INDIAN_STATES", () => {
        const india = getTaxConfig("IN")
        expect((india.states?.length ?? 0)).toBeGreaterThan(30)
        // codes are the 2-digit GST state codes
        expect(india.states?.every((s) => /^\d{2}$/.test(s.code))).toBe(true)
    })

    it("fiscal year start months are sane", () => {
        expect(getTaxConfig("IN").fiscalYearStartMonth).toBe(4)
        expect(getTaxConfig("AU").fiscalYearStartMonth).toBe(7)
        expect(getTaxConfig("AE").fiscalYearStartMonth).toBe(1)
    })
})

describe("locale-config — state helpers", () => {
    it("taxRatesFor includes the state's default rate even if not in the base list", () => {
        const us = getTaxConfig("US")
        const rates = taxRatesFor(us, "CA")  // California 7.25%
        expect(rates).toContain(7.25)
    })

    it("defaultRateFor uses the state default when present, else the country default", () => {
        const us = getTaxConfig("US")
        expect(defaultRateFor(us, "CA")).toBe(7.25)
        expect(defaultRateFor(us, undefined)).toBe(us.defaultRate)
        const india = getTaxConfig("IN")
        expect(defaultRateFor(india, "29")).toBe(india.defaultRate)  // India states have no per-state rate
    })

    it("getStateConfig returns null for unknown / no-state countries", () => {
        expect(getStateConfig(getTaxConfig("AE"), "XX")).toBeNull()
        expect(getStateConfig(getTaxConfig("US"), "ZZ")).toBeNull()
        expect(getStateConfig(getTaxConfig("US"), "CA")?.name).toBe("California")
    })
})

describe("locale-config — COUNTRY_OPTIONS", () => {
    it("lists India first and 'Other' last", () => {
        expect(COUNTRY_OPTIONS[0]?.code).toBe("IN")
        expect(COUNTRY_OPTIONS.at(-1)?.code).toBe("OTHER")
    })
    it("covers every config except duplicates", () => {
        expect(COUNTRY_OPTIONS.length).toBe(Object.keys(TAX_CONFIGS).length)
    })
})

describe("locale-config — US states & European countries", () => {
    it("the US ships all 50 states + DC", () => {
        const us = getTaxConfig("US")
        expect(us.states?.length).toBe(51)
        // a few spot checks
        expect(getStateConfig(us, "TX")?.name).toBe("Texas")
        expect(getStateConfig(us, "NY")?.defaultRate).toBe(4)
        // the no-sales-tax states are present with a 0 default
        for (const code of ["AK", "DE", "MT", "NH", "OR"]) {
            expect(getStateConfig(us, code)?.defaultRate, code).toBe(0)
        }
    })

    it("European countries use their local tax wording, not 'GST'", () => {
        expect(getTaxConfig("FR").taxShortName).toBe("TVA")
        expect(getTaxConfig("DE").taxShortName).toBe("USt.")
        expect(getTaxConfig("IT").taxShortName).toBe("IVA")
        expect(getTaxConfig("ES").taxShortName).toBe("IVA")
        expect(getTaxConfig("NL").taxShortName).toBe("BTW")
        expect(getTaxConfig("SE").taxShortName).toBe("Moms")
        // none of them are the Indian "split" model
        for (const c of ["FR", "DE", "IT", "ES", "PT", "NL", "BE", "IE", "AT", "CH", "SE", "DK", "NO", "FI", "GR", "PL", "CZ", "HU"]) {
            expect(getTaxConfig(c).taxModel, c).toBe("single")
            expect(getTaxConfig(c).currency, c).toMatch(/^[A-Z]{3}$/)
        }
    })

    it("France: service charge is included by law, so it's disallowed here", () => {
        expect(getTaxConfig("FR").serviceChargeAllowed).toBe(false)
    })

    it("Spain & Portugal carry their tax-varying sub-regions", () => {
        const es = getTaxConfig("ES")
        expect(es.stateMatters).toBe(true)
        expect(getStateConfig(es, "ES-CN")?.name).toContain("Canary")
        expect(taxRatesFor(es, "ES-CN")).toContain(7)   // IGIC general rate
        const pt = getTaxConfig("PT")
        expect(getStateConfig(pt, "PT-20")?.name).toBe("Azores")
        expect(defaultRateFor(pt, "PT-20")).toBe(9)
    })
})

describe("computeOrder — taxModel", () => {
    const lines = [{ quantity: 1, unit_price: 100, gst_slab: 18 }]

    it("'split' (default) splits CGST + SGST within a state", () => {
        const r = computeOrder({ lines, isInterState: false })
        expect(r.cgst_amount).toBe(9)
        expect(r.sgst_amount).toBe(9)
        expect(r.igst_amount).toBe(0)
        expect(r.grand_total).toBe(118)
    })

    it("'single' puts the whole tax in the IGST slot, cgst/sgst stay 0", () => {
        const r = computeOrder({ lines, isInterState: false, taxModel: "single" })
        expect(r.cgst_amount).toBe(0)
        expect(r.sgst_amount).toBe(0)
        expect(r.igst_amount).toBe(18)
        expect(r.grand_total).toBe(118)
    })

    it("'none' yields zero tax (taxable amount unchanged)", () => {
        const r = computeOrder({ lines, isInterState: false, taxModel: "none" })
        expect(r.cgst_amount + r.sgst_amount + r.igst_amount).toBe(0)
        expect(r.taxable_amount).toBe(100)
        expect(r.grand_total).toBe(100)
    })

    it("a single combined tax with a service charge stacks correctly (e.g. Singapore 9% GST + 10% svc)", () => {
        // 10% service on the ₹100 taxable, then 9% "GST" on the taxable (svc not taxed by computeOrder)
        const r = computeOrder({
            lines: [{ quantity: 1, unit_price: 100, gst_slab: 9 }],
            isInterState: false, taxModel: "single", serviceChargePercent: 10, roundToNearestRupee: false,
        })
        expect(r.igst_amount).toBe(9)
        expect(r.service_charge).toBe(10)
        expect(r.grand_total).toBe(119)  // 100 + 9 + 10
    })
})
