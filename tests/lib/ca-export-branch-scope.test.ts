import { describe, expect, it } from "vitest"

import { buildSalesCsv } from "@/lib/ca-export/csv"
import { scopeLabel, showBranchColumn } from "@/lib/ca-export/locale"
import type { ExportDataset, SalesRow } from "@/lib/ca-export/types"

function salesRow(overrides: Partial<SalesRow> = {}): SalesRow {
    return {
        invoice_number: "INV-001",
        invoice_date: "2026-06-01T12:00:00Z",
        branch_name: "Indiranagar",
        customer_name: "Asha",
        customer_gstin: "29ABCDE1234F1Z5",
        customer_state_code: "29",
        place_of_supply: "29",
        is_inter_state: false,
        taxable_amount: 100,
        cgst_amount: 2.5,
        sgst_amount: 2.5,
        igst_amount: 0,
        cess_amount: 0,
        service_charge: 0,
        grand_total: 105,
        bill_status: "PAID",
        payment_methods: "UPI:105.00",
        items: [],
        ...overrides,
    }
}

function dataset(overrides: Partial<ExportDataset> = {}): ExportDataset {
    return {
        period: {
            fromDate: "2026-06-01T00:00:00.000Z",
            toDate: "2026-07-01T00:00:00.000Z",
            label: "June 2026",
            fyLabel: "2026-27",
            monthNum: 6,
            yearNum: 2026,
        },
        branch: null,
        branches_total: 2,
        tenant: {
            name: "Spice Route",
            country: "India",
            gstin: "29ABCDE1234F1Z5",
            pan: null,
            fssai: null,
            state: "Karnataka",
            state_code: "29",
            address: null,
            city: null,
            pincode: null,
        },
        sales: [salesRow()],
        purchases: [],
        expenses: [],
        balance_sheet: [],
        summary: {
            gross_sales: 105,
            void_count: 0,
            taxable_outward: 100,
            cgst_collected: 2.5,
            sgst_collected: 2.5,
            igst_collected: 0,
            taxable_b2b: 100,
            taxable_b2c: 0,
            purchase_value: 0,
            itc_cgst: 0,
            itc_sgst: 0,
            itc_igst: 0,
            net_tax_payable: 5,
            total_expenses_pl: 0,
            gross_profit: 100,
            net_profit: 100,
        },
        hsn_summary: [],
        pl: [],
        by_slab: [],
        ...overrides,
    }
}

describe("scopeLabel / showBranchColumn", () => {
    it("names the branch when the export is scoped to one location", () => {
        const d = dataset({ branch: { id: "b1", name: "Indiranagar" } })
        expect(scopeLabel(d)).toBe("Indiranagar")
        expect(showBranchColumn(d)).toBe(false)
    })

    it("says 'All locations' for the multi-branch tenant-wide view and shows the column", () => {
        const d = dataset({ branch: null, branches_total: 3 })
        expect(scopeLabel(d)).toBe("All locations")
        expect(showBranchColumn(d)).toBe(true)
    })

    it("stays silent for single-outlet tenants with no branches set up", () => {
        const d = dataset({ branch: null, branches_total: 0 })
        expect(scopeLabel(d)).toBeNull()
        expect(showBranchColumn(d)).toBe(false)
    })
})

describe("buildSalesCsv — branch + completeness columns", () => {
    it("adds a Branch column on the multi-location view", () => {
        const csv = buildSalesCsv(dataset({ branch: null, branches_total: 2 }))
        const [header, first] = csv.split("\n")
        expect(header).toContain("Branch")
        expect(first).toContain("Indiranagar")
    })

    it("omits the Branch column when scoped to a single location", () => {
        const csv = buildSalesCsv(dataset({ branch: { id: "b1", name: "Indiranagar" } }))
        expect(csv.split("\n")[0]).not.toContain("Branch")
    })

    it("carries customer tax id and payment breakdown on every row", () => {
        const csv = buildSalesCsv(dataset())
        const [header, first] = csv.split("\n")
        expect(header).toContain("Customer GSTIN")
        expect(header).toContain("Payment")
        expect(first).toContain("29ABCDE1234F1Z5")
        expect(first).toContain("UPI:105.00")
    })
})
