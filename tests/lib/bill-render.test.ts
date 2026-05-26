import { describe, expect, it } from "vitest"

import { billToRenderData } from "@/lib/bill/render"
import { DEFAULT_DESIGN, getTemplate, resolveBillDesign } from "@/lib/bill/templates"
import { getTaxConfig } from "@/lib/tax/locale-config"

const baseBill = {
    invoice_number: "INV-2025-26-00042",
    created_at: "2026-05-12T10:00:00Z",
    fy_label: "2025-26",
    bill_status: "PAID",
    gst_excluded: false,
    subtotal: 1000,
    item_discount: 0,
    order_discount: 50,
    taxable_amount: 950,
    cgst_amount: 23.75,
    sgst_amount: 23.75,
    igst_amount: 0,
    is_inter_state: false,
    service_charge: 0,
    round_off: 0,
    grand_total: 997.5,
    customer_name: "Asha",
    customer_phone: "9876543210",
    customer_gstin: "29ABCDE1234F1Z5",
}
const items = [
    { item_name: "Pizza", hsn_code: "996331", quantity: 1, unit_price: 600, gst_slab: 5, line_total: 600, is_void: false },
    { item_name: "Coke", hsn_code: "996331", quantity: 2, unit_price: 200, gst_slab: 5, line_total: 400, is_void: false },
    { item_name: "Cancelled", hsn_code: null, quantity: 1, unit_price: 99, gst_slab: 5, line_total: 99, is_void: true },
]

describe("billToRenderData", () => {
    it("India intra-state, split design → CGST + SGST lines", () => {
        const cfg = getTaxConfig("IN")
        const r = billToRenderData({ bill: baseBill, items, cfg, design: { ...DEFAULT_DESIGN, tax_breakup: "split" } })
        expect(r.taxLines.map((l) => l.label)).toEqual(["CGST", "SGST"])
        expect(r.taxLines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(47.5)
        expect(r.items).toHaveLength(2)            // voided line dropped
        expect(r.discount).toBe(50)
        expect(r.customer?.taxId).toBe("29ABCDE1234F1Z5")
        expect(r.taxExcluded).toBe(false)
    })

    it("India intra-state, combined design → one GST line", () => {
        const cfg = getTaxConfig("IN")
        const r = billToRenderData({ bill: baseBill, items, cfg, design: { ...DEFAULT_DESIGN, tax_breakup: "combined" } })
        expect(r.taxLines).toEqual([{ label: "GST", amount: 47.5 }])
    })

    it("inter-state → a single IGST line regardless of the design", () => {
        const cfg = getTaxConfig("IN")
        const inter = { ...baseBill, is_inter_state: true, cgst_amount: 0, sgst_amount: 0, igst_amount: 47.5 }
        const r = billToRenderData({ bill: inter, items, cfg, design: { ...DEFAULT_DESIGN, tax_breakup: "split" } })
        expect(r.taxLines).toEqual([{ label: "IGST", amount: 47.5 }])
    })

    it("single-tax country (UK) → one VAT line with the local label", () => {
        const cfg = getTaxConfig("GB")
        const uk = { ...baseBill, cgst_amount: 0, sgst_amount: 0, igst_amount: 190 }
        const r = billToRenderData({ bill: uk, items, cfg, design: DEFAULT_DESIGN })
        expect(r.taxLines).toEqual([{ label: "VAT", amount: 190 }])
    })

    it("no-tax country → no tax lines, taxExcluded", () => {
        const cfg = getTaxConfig("OTHER")
        const r = billToRenderData({ bill: { ...baseBill, cgst_amount: 0, sgst_amount: 0 }, items, cfg, design: DEFAULT_DESIGN })
        expect(r.taxLines).toEqual([])
        expect(r.taxExcluded).toBe(true)
    })

    it("gst_excluded bill → no tax lines even in India", () => {
        const cfg = getTaxConfig("IN")
        const r = billToRenderData({ bill: { ...baseBill, gst_excluded: true }, items, cfg, design: DEFAULT_DESIGN })
        expect(r.taxLines).toEqual([])
        expect(r.taxExcluded).toBe(true)
    })

    it("design.show_tax_breakup=false → suppresses tax lines", () => {
        const cfg = getTaxConfig("IN")
        const r = billToRenderData({ bill: baseBill, items, cfg, design: { ...DEFAULT_DESIGN, show_tax_breakup: false } })
        expect(r.taxLines).toEqual([])
    })

    it("passes through paid / balanceDue extras", () => {
        const cfg = getTaxConfig("IN")
        const r = billToRenderData({ bill: baseBill, items, cfg, design: DEFAULT_DESIGN, extra: { paid: 500, balanceDue: 497.5 } })
        expect(r.paid).toBe(500)
        expect(r.balanceDue).toBe(497.5)
    })
})

describe("resolveBillDesign", () => {
    it("uses the saved bill_design, migrating the old show_gstin key", () => {
        const d = resolveBillDesign({ bill_design: { layout: "card-boutique", show_gstin: false, footer_message: "x" } })
        expect(d.layout).toBe("card-boutique")
        expect(d.show_tax_id).toBe(false)            // migrated from show_gstin
        expect(d.footer_message).toBe("x")
        expect(d.density).toBe(DEFAULT_DESIGN.density) // missing fields filled from the default
    })

    it("falls back to the picked template's design when no bill_design is saved", () => {
        const d = resolveBillDesign({ bill_template_id: "in-gst-thermal" })
        expect(d).toEqual(getTemplate("in-gst-thermal")!.design)
    })

    it("falls back to DEFAULT_DESIGN when settings are empty / missing", () => {
        expect(resolveBillDesign(null)).toEqual(DEFAULT_DESIGN)
        expect(resolveBillDesign({})).toEqual(DEFAULT_DESIGN)
        expect(resolveBillDesign({ bill_design: {} })).toEqual(DEFAULT_DESIGN)
    })
})
