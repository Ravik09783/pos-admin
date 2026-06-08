import { describe, expect, it } from "vitest"

import { pdfMoney } from "@/lib/hr/payslip"

describe("pdfMoney — never emits the ₹ glyph (jsPDF core font lacks it)", () => {
    it("formats INR as 'Rs <grouped decimal>' with NO ₹", () => {
        const s = pdfMoney(29423.08, "INR")
        expect(s).toBe("Rs 29,423.08")
        expect(s).not.toContain("₹")
    })

    it("always shows 2 decimals + Indian grouping", () => {
        expect(pdfMoney(31172.31, "INR")).toBe("Rs 31,172.31")
        expect(pdfMoney(100000, "INR")).toBe("Rs 1,00,000.00")
        expect(pdfMoney(0, "INR")).toBe("Rs 0.00")
    })

    it("defaults a blank/garbage currency to INR (no ₹)", () => {
        expect(pdfMoney(50, "")).toBe("Rs 50.00")
        expect(pdfMoney(Number.NaN, "INR")).toBe("Rs 0.00")
    })

    it("leaves non-INR currencies to the normal formatter", () => {
        const usd = pdfMoney(1234.5, "USD")
        expect(usd).toContain("1,234.50")
        expect(usd).not.toContain("₹")
    })
})
