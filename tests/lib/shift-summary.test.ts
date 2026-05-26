import { describe, expect, it } from "vitest"

import {
    cashVariance, groupOf, summarise, summariseByStaff,
    type PaymentMethod, type PaymentRow,
} from "@/lib/reports/shift-summary"

function row(method: PaymentMethod, amount: number, received_by: string | null = "user-1"): PaymentRow {
    return {
        id: `p-${Math.random()}`,
        method,
        amount,
        received_by,
        bill_id: "bill-1",
        created_at: "2026-05-13T10:00:00Z",
    }
}

describe("groupOf — payment-method routing", () => {
    it("CASH → cash", () => { expect(groupOf("CASH")).toBe("cash") })
    it("digital methods → online", () => {
        for (const m of ["UPI", "CARD", "RAZORPAY", "STRIPE", "BANK_TRANSFER", "PHONEPE", "PAYTM"] as PaymentMethod[]) {
            expect(groupOf(m), m).toBe("online")
        }
    })
    it("loyalty / gift card / complimentary / credit → other (not real money)", () => {
        for (const m of ["LOYALTY", "GIFT_CARD", "COMPLIMENTARY", "CREDIT", "OTHER"] as PaymentMethod[]) {
            expect(groupOf(m), m).toBe("other")
        }
    })
})

describe("summarise", () => {
    it("groups, sums and counts payments correctly", () => {
        const r = summarise([
            row("CASH", 200),
            row("CASH", 50),
            row("UPI", 320),
            row("CARD", 1500),
            row("RAZORPAY", 800),
            row("LOYALTY", 100),
            row("GIFT_CARD", 250),
        ])
        expect(r.paymentCount).toBe(7)
        expect(r.groups.find((g) => g.group === "cash")?.amount).toBe(250)
        expect(r.groups.find((g) => g.group === "online")?.amount).toBe(2620)
        expect(r.groups.find((g) => g.group === "other")?.amount).toBe(350)
        expect(r.realTotal).toBe(2870)            // cash + online
        expect(r.grandTotal).toBe(3220)           // everything
    })

    it("methods are sorted by amount descending", () => {
        const r = summarise([row("CASH", 100), row("CARD", 999), row("UPI", 200)])
        expect(r.methods.map((m) => m.method)).toEqual(["CARD", "UPI", "CASH"])
    })

    it("string amounts (PostgREST numeric) parse correctly", () => {
        const r = summarise([
            { id: "p1", method: "CASH", amount: "120.50", received_by: null, bill_id: null, created_at: "x" },
            { id: "p2", method: "UPI",  amount: "79.99",  received_by: null, bill_id: null, created_at: "x" },
        ])
        expect(r.groups.find((g) => g.group === "cash")?.amount).toBe(120.5)
        expect(r.groups.find((g) => g.group === "online")?.amount).toBeCloseTo(79.99)
    })

    it("skips rows with non-finite amounts instead of poisoning totals", () => {
        const r = summarise([
            row("CASH", 100),
            { id: "x", method: "CARD", amount: "not-a-number", received_by: null, bill_id: null, created_at: "x" },
        ])
        expect(r.groups.find((g) => g.group === "cash")?.amount).toBe(100)
        expect(r.groups.find((g) => g.group === "online")?.amount).toBe(0)
    })

    it("empty input returns zeros, never undefined", () => {
        const r = summarise([])
        expect(r.realTotal).toBe(0)
        expect(r.grandTotal).toBe(0)
        expect(r.groups).toHaveLength(3)
        expect(r.methods).toHaveLength(0)
    })
})

describe("summariseByStaff", () => {
    it("attributes rows to staff and buckets webhook (null) rows as Auto", () => {
        const rows = [
            row("CASH", 200, "user-1"),
            row("UPI",  300, "user-1"),
            row("CASH", 100, "user-2"),
            row("RAZORPAY", 500, null),      // webhook
        ]
        const res = summariseByStaff(rows, { "user-1": "Aanya", "user-2": "Karan" })
        const aanya = res.find((r) => r.staffId === "user-1")!
        const karan = res.find((r) => r.staffId === "user-2")!
        const auto  = res.find((r) => r.staffId === null)!
        expect(aanya.staffName).toBe("Aanya")
        expect(aanya.summary.realTotal).toBe(500)
        expect(karan.summary.realTotal).toBe(100)
        expect(auto.staffName).toMatch(/Auto/)
        expect(auto.summary.realTotal).toBe(500)
        // Default sort puts the biggest collector first.
        expect(res[0].staffId).toBe("user-1")
    })

    it("falls back to 'Unknown staff' when the id isn't in the name map", () => {
        const res = summariseByStaff([row("CASH", 50, "ghost-id")], {})
        expect(res[0].staffName).toBe("Unknown staff")
    })
})

describe("cashVariance", () => {
    it("flags shortages (counted less than expected)", () => {
        expect(cashVariance(1000, 950)).toEqual({ variance: -50, status: "short" })
    })
    it("flags overage (counted more than expected — extra tip in drawer?)", () => {
        expect(cashVariance(1000, 1020)).toEqual({ variance: 20, status: "over" })
    })
    it("treats sub-paisa rounding as a match", () => {
        expect(cashVariance(1000, 1000.004)).toEqual({ variance: 0, status: "match" })
    })
})
