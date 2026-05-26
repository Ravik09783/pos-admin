/** Shared data types for the CA Export bundle. */

export interface ExportPeriod {
    /** ISO date — first day of the month inclusive. */
    fromDate: string
    /** ISO date — first day of the NEXT month (exclusive upper bound). */
    toDate: string
    /** Human label e.g. "April 2025". */
    label: string
    /** FY label e.g. "2025-26". */
    fyLabel: string
    monthNum: number
    yearNum: number
}

export interface SalesRow {
    invoice_number: string
    invoice_date: string
    customer_name: string | null
    customer_gstin: string | null
    customer_state_code: string | null
    place_of_supply: string | null
    is_inter_state: boolean
    taxable_amount: number
    cgst_amount: number
    sgst_amount: number
    igst_amount: number
    cess_amount: number
    service_charge: number
    grand_total: number
    bill_status: string
    payment_methods: string
    items: Array<{
        item_name: string
        hsn_code: string | null
        quantity: number
        unit_price: number
        gst_slab: number
        taxable_amount: number
        cgst_amount: number
        sgst_amount: number
        igst_amount: number
    }>
}

export interface PurchaseRow {
    purchase_number: string
    vendor_invoice_no: string | null
    invoice_date: string
    vendor_name: string
    vendor_gstin: string | null
    is_inter_state: boolean
    taxable_amount: number
    cgst_amount: number
    sgst_amount: number
    igst_amount: number
    cess_amount: number
    grand_total: number
    itc_eligible: boolean
    itc_claimed: boolean
}

export interface ExpenseRow {
    expense_date: string
    description: string
    pl_group: string
    category: string
    vendor_name: string | null
    amount: number
    gst_amount: number
}

export interface HsnSummaryRow {
    hsn_code: string
    description: string
    uqc: string                  // unit of measure
    total_quantity: number
    total_value: number
    taxable_amount: number
    igst: number
    cgst: number
    sgst: number
    cess: number
}

export interface PLBucket {
    group: string
    amount: number
    rows: Array<{ description: string; amount: number }>
}

export interface BalanceSheetSnapshot {
    section: "ASSETS" | "LIABILITIES" | "EQUITY"
    sub_section: string
    head: string
    opening: number
    closing: number
}

export interface ExportDataset {
    period: ExportPeriod
    tenant: {
        name: string
        /** Country name as stored on tenants.country (e.g. "India", "United Kingdom").
         *  Drives which tax-report formats are offered in the CA-export page —
         *  the registry in src/lib/tax-reports/registry.ts looks this up. */
        country: string | null
        gstin: string | null
        pan: string | null
        fssai: string | null
        state: string | null
        state_code: string | null
        address: string | null
        city: string | null
        pincode: string | null
    }
    sales: SalesRow[]
    purchases: PurchaseRow[]
    expenses: ExpenseRow[]
    balance_sheet: BalanceSheetSnapshot[]
    /** Aggregations cached for re-use across formats. */
    summary: {
        gross_sales: number
        void_count: number
        taxable_outward: number
        cgst_collected: number
        sgst_collected: number
        igst_collected: number
        taxable_b2b: number
        taxable_b2c: number
        purchase_value: number
        itc_cgst: number
        itc_sgst: number
        itc_igst: number
        net_tax_payable: number
        total_expenses_pl: number
        gross_profit: number
        net_profit: number
    }
    hsn_summary: HsnSummaryRow[]
    pl: PLBucket[]
    by_slab: Array<{
        slab: number
        taxable: number
        cgst: number
        sgst: number
        igst: number
    }>
}
