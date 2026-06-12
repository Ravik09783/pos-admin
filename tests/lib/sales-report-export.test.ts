import { describe, expect, it } from "vitest"

import {
    buildSalesReportCsv,
    salesReportFilename,
    type SalesReportExport,
} from "@/lib/reports/sales-report-export"

function input(overrides: Partial<SalesReportExport> = {}): SalesReportExport {
    return {
        from: "2026-06-01",
        to: "2026-06-12",
        branchName: "Koramangala",
        currency: "INR",
        taxLabel: "GST",
        revenue: 12500.5,
        totalTax: 625.25,
        avgBill: 250.01,
        validCount: 50,
        voidCount: 2,
        topItems: [
            { name: "Paneer Tikka", qty: 40, revenue: 8000 },
            { name: 'Veg "Special", Thali', qty: 18, revenue: 4500.5 },
        ],
        byPayment: [
            { method: "UPI", amount: 9000 },
            { method: "CASH", amount: 3500.5 },
        ],
        hours: new Array(24).fill(0),
        days: [
            ["2026-06-01", 4000],
            ["2026-06-02", 8500.5],
        ],
        ...overrides,
    }
}

describe("buildSalesReportCsv", () => {
    it("includes every section with the location and range header", () => {
        const csv = buildSalesReportCsv(input())
        expect(csv).toContain("Location,Koramangala")
        expect(csv).toContain("From,2026-06-01")
        expect(csv).toContain("To,2026-06-12")
        expect(csv).toContain("Revenue,12500.50")
        expect(csv).toContain("GST collected,625.25")
        expect(csv).toContain("Top items by revenue")
        expect(csv).toContain("Paneer Tikka,40,8000.00")
        expect(csv).toContain("Payment methods")
        expect(csv).toContain("UPI,9000.00")
        expect(csv).toContain("Daily revenue")
        expect(csv).toContain("2026-06-02,8500.50")
        expect(csv).toContain("Hourly revenue")
        expect(csv).toContain("23:00,0.00")
    })

    it("labels the all-locations view and the country's tax word", () => {
        const csv = buildSalesReportCsv(input({ branchName: null, taxLabel: "VAT" }))
        expect(csv).toContain("Location,All locations")
        expect(csv).toContain("VAT collected,625.25")
    })

    it("escapes commas and quotes per RFC 4180", () => {
        const csv = buildSalesReportCsv(input())
        expect(csv).toContain('"Veg ""Special"", Thali",18,4500.50')
    })
})

describe("salesReportFilename", () => {
    it("carries the branch slug so per-outlet downloads don't collide", () => {
        expect(salesReportFilename(input(), "xlsx")).toBe("sales_report_koramangala_2026-06-01_to_2026-06-12.xlsx")
    })

    it("drops the branch slug for the all-locations view", () => {
        expect(salesReportFilename(input({ branchName: null }), "pdf")).toBe("sales_report_2026-06-01_to_2026-06-12.pdf")
    })
})
