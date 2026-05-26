import { describe, expect, it } from "vitest"

import { computeLine, computeOrder, lineCalcsForDb } from "@/lib/gst/calculator"

// =============================================================================
// computeLine — intra-state (CGST + SGST split)
// =============================================================================
describe("computeLine — intra-state", () => {
    it("applies 5% GST split equally between CGST and SGST", () => {
        const r = computeLine({ quantity: 1, unit_price: 100, gst_slab: 5 }, false)
        expect(r.taxable_amount).toBe(100)
        expect(r.cgst_amount).toBe(2.5)
        expect(r.sgst_amount).toBe(2.5)
        expect(r.igst_amount).toBe(0)
        expect(r.line_total).toBe(105)
    })

    it("applies 18% GST as 9% CGST + 9% SGST", () => {
        const r = computeLine({ quantity: 2, unit_price: 250, gst_slab: 18 }, false)
        expect(r.taxable_amount).toBe(500)
        expect(r.cgst_amount).toBe(45)
        expect(r.sgst_amount).toBe(45)
        expect(r.igst_amount).toBe(0)
        expect(r.line_total).toBe(590)
    })

    it("applies modifier_total per-unit before tax", () => {
        // Base ₹100, modifier +₹20, qty 3 → ₹360 taxable, 5% GST = ₹18 → ₹378
        const r = computeLine({
            quantity: 3,
            unit_price: 100,
            modifier_total: 20,
            gst_slab: 5,
        }, false)
        expect(r.taxable_amount).toBe(360)
        expect(r.line_total).toBe(378)
    })

    it("applies pre-tax discount before computing tax", () => {
        const r = computeLine({
            quantity: 2,
            unit_price: 100,
            discount_amount: 50,
            gst_slab: 18,
        }, false)
        expect(r.taxable_amount).toBe(150) // 200 - 50
        expect(r.cgst_amount).toBe(13.5)
        expect(r.sgst_amount).toBe(13.5)
        expect(r.line_total).toBe(177)
    })

    it("handles zero-slab items (exempt goods) with no tax", () => {
        const r = computeLine({ quantity: 1, unit_price: 99, gst_slab: 0 }, false)
        expect(r.cgst_amount).toBe(0)
        expect(r.sgst_amount).toBe(0)
        expect(r.igst_amount).toBe(0)
        expect(r.line_total).toBe(99)
    })
})

// =============================================================================
// computeLine — inter-state (IGST only)
// =============================================================================
describe("computeLine — inter-state", () => {
    it("charges full IGST and zero CGST/SGST when isInterState=true", () => {
        const r = computeLine({ quantity: 1, unit_price: 1000, gst_slab: 18 }, true)
        expect(r.cgst_amount).toBe(0)
        expect(r.sgst_amount).toBe(0)
        expect(r.igst_amount).toBe(180)
        expect(r.line_total).toBe(1180)
    })

    it("handles 28% slab correctly (luxury items)", () => {
        const r = computeLine({ quantity: 1, unit_price: 1000, gst_slab: 28 }, true)
        expect(r.igst_amount).toBe(280)
        expect(r.line_total).toBe(1280)
    })
})

// =============================================================================
// computeLine — tax-inclusive (gross price)
// =============================================================================
describe("computeLine — tax-inclusive pricing", () => {
    it("backs out 5% GST from gross ₹105 to net ₹100", () => {
        const r = computeLine({
            quantity: 1,
            unit_price: 105,
            gst_slab: 5,
            tax_inclusive: true,
        }, false)
        expect(r.unit_price).toBe(100)
        expect(r.taxable_amount).toBe(100)
        expect(r.cgst_amount).toBe(2.5)
        expect(r.sgst_amount).toBe(2.5)
        expect(r.line_total).toBe(105)
    })

    it("backs out 18% GST from gross ₹118 to net ₹100", () => {
        const r = computeLine({
            quantity: 1,
            unit_price: 118,
            gst_slab: 18,
            tax_inclusive: true,
        }, false)
        expect(r.unit_price).toBe(100)
        expect(r.cgst_amount).toBe(9)
        expect(r.sgst_amount).toBe(9)
        expect(r.line_total).toBe(118)
    })
})

// =============================================================================
// computeLine — rounding edge cases
// =============================================================================
describe("computeLine — rounding (half-up to 2dp)", () => {
    it("splits odd-paisa tax with CGST half rounded and SGST taking the remainder", () => {
        // 5% on ₹99.99 = ₹4.9995 → 4.9995/2 = 2.49975 → 2.50 CGST, total 5.00, SGST = 5.00 - 2.50 = 2.50
        // Actually 5% of 99.99 = 4.9995 → rounded HALF_UP to 5.00. So cgst = 2.50, sgst = 2.50.
        const r = computeLine({ quantity: 1, unit_price: 99.99, gst_slab: 5 }, false)
        expect(r.cgst_amount).toBeCloseTo(2.5, 2)
        expect(r.sgst_amount).toBeCloseTo(2.5, 2)
        // The function guarantees cgst + sgst === totalTax (no 0.01 drift)
        const sum = Number((r.cgst_amount + r.sgst_amount).toFixed(2))
        const tax = Number((r.line_total - r.taxable_amount).toFixed(2))
        expect(sum).toBe(tax)
    })

    it("guarantees CGST + SGST always sums exactly to total tax (no 0.01 drift)", () => {
        // Multiple values where the half might create a rounding mismatch
        const cases = [
            { qty: 1, price: 33.33, slab: 18 },
            { qty: 7, price: 11.11, slab: 5 },
            { qty: 3, price: 17.50, slab: 12 },
            { qty: 1, price: 0.01, slab: 28 },
        ]
        for (const c of cases) {
            const r = computeLine({ quantity: c.qty, unit_price: c.price, gst_slab: c.slab }, false)
            const taxFromSplit = Number((r.cgst_amount + r.sgst_amount).toFixed(2))
            const taxFromLine = Number((r.line_total - r.taxable_amount).toFixed(2))
            expect(taxFromSplit).toBe(taxFromLine)
        }
    })
})

// =============================================================================
// computeOrder — multi-line aggregation
// =============================================================================
describe("computeOrder — aggregation", () => {
    it("sums taxable, tax, and grand total across lines", () => {
        const r = computeOrder({
            isInterState: false,
            lines: [
                { quantity: 2, unit_price: 100, gst_slab: 5 },
                { quantity: 1, unit_price: 200, gst_slab: 18 },
            ],
        })
        expect(r.taxable_amount).toBe(400)
        expect(r.cgst_amount).toBe(23)  // 5 + 18
        expect(r.sgst_amount).toBe(23)
        expect(r.igst_amount).toBe(0)
        expect(r.grand_total).toBe(446)
    })

    it("groups by_slab for GSTR-1 output", () => {
        const r = computeOrder({
            isInterState: false,
            lines: [
                { quantity: 1, unit_price: 100, gst_slab: 5 },
                { quantity: 1, unit_price: 200, gst_slab: 5 },
                { quantity: 1, unit_price: 500, gst_slab: 18 },
            ],
        })
        expect(r.by_slab).toHaveLength(2)
        const s5 = r.by_slab.find((s) => s.gst_slab === 5)!
        const s18 = r.by_slab.find((s) => s.gst_slab === 18)!
        expect(s5.taxable).toBe(300)
        expect(s5.total_tax).toBe(15)
        expect(s18.taxable).toBe(500)
        expect(s18.total_tax).toBe(90)
    })

    it("sorts by_slab in ascending order", () => {
        const r = computeOrder({
            isInterState: false,
            lines: [
                { quantity: 1, unit_price: 100, gst_slab: 28 },
                { quantity: 1, unit_price: 100, gst_slab: 5 },
                { quantity: 1, unit_price: 100, gst_slab: 18 },
            ],
        })
        expect(r.by_slab.map((s) => s.gst_slab)).toEqual([5, 18, 28])
    })

    it("applies service charge to (taxable - order_discount) at the percentage given", () => {
        const r = computeOrder({
            isInterState: false,
            lines: [{ quantity: 1, unit_price: 1000, gst_slab: 5 }],
            orderDiscount: 0,
            serviceChargePercent: 10,
        })
        expect(r.service_charge).toBe(100) // 10% of ₹1000
        // grand = taxable (1000) - orderDisc (0) + cgst (25) + sgst (25) + svc (100) = 1150
        expect(r.grand_total).toBe(1150)
    })

    it("applies order_discount before service charge calculation", () => {
        const r = computeOrder({
            isInterState: false,
            lines: [{ quantity: 1, unit_price: 1000, gst_slab: 5 }],
            orderDiscount: 100,
            serviceChargePercent: 10,
        })
        expect(r.service_charge).toBe(90) // 10% of (1000 - 100)
        expect(r.taxable_amount).toBe(900) // taxable - orderDisc
    })

    it("rounds grand_total to nearest rupee when roundToNearestRupee=true", () => {
        const r = computeOrder({
            isInterState: false,
            lines: [{ quantity: 1, unit_price: 99.50, gst_slab: 5 }],
            roundToNearestRupee: true,
        })
        // 99.50 + 2.49 + 2.49 ≈ 104.48 (or 104.49 depending on splitting)
        // round to nearest rupee → 104
        expect(Number.isInteger(r.grand_total)).toBe(true)
        // round_off should reflect the adjustment
        expect(Math.abs(r.round_off)).toBeLessThanOrEqual(0.5)
    })

    it("preserves round_off=0 when roundToNearestRupee=false", () => {
        const r = computeOrder({
            isInterState: false,
            lines: [{ quantity: 1, unit_price: 99.50, gst_slab: 5 }],
        })
        expect(r.round_off).toBe(0)
    })

    it("handles an empty order", () => {
        const r = computeOrder({ isInterState: false, lines: [] })
        expect(r.subtotal).toBe(0)
        expect(r.grand_total).toBe(0)
        expect(r.by_slab).toEqual([])
    })
})

// =============================================================================
// computeOrder — inter-state full coverage
// =============================================================================
describe("computeOrder — inter-state", () => {
    it("routes all tax to IGST and zeroes CGST/SGST", () => {
        const r = computeOrder({
            isInterState: true,
            lines: [
                { quantity: 1, unit_price: 1000, gst_slab: 18 },
                { quantity: 2, unit_price: 500, gst_slab: 5 },
            ],
        })
        expect(r.cgst_amount).toBe(0)
        expect(r.sgst_amount).toBe(0)
        expect(r.igst_amount).toBe(230) // 180 + 50
        expect(r.grand_total).toBe(2230)
    })
})

// =============================================================================
// lineCalcsForDb — DB serialization shape
// =============================================================================
describe("lineCalcsForDb", () => {
    it("returns one row per input line with all required columns", () => {
        const rows = lineCalcsForDb([
            { line_id: "a", quantity: 2, unit_price: 100, gst_slab: 5 },
            { line_id: "b", quantity: 1, unit_price: 500, gst_slab: 18 },
        ], false)
        expect(rows).toHaveLength(2)
        expect(rows[0]).toMatchObject({
            line_id: "a",
            quantity: 2,
            unit_price: 100,
            taxable_amount: 200,
            cgst_amount: 5,
            sgst_amount: 5,
            igst_amount: 0,
            line_total: 210,
        })
        expect(rows[1]).toMatchObject({
            line_id: "b",
            taxable_amount: 500,
            cgst_amount: 45,
            sgst_amount: 45,
        })
    })

    it("passes isInterState through to each line", () => {
        const rows = lineCalcsForDb([
            { quantity: 1, unit_price: 100, gst_slab: 18 },
        ], true)
        expect(rows[0]?.igst_amount).toBe(18)
        expect(rows[0]?.cgst_amount).toBe(0)
    })
})
