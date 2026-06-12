"use client"

import { createClient } from "@/lib/supabase/client"
import { getTaxConfig } from "@/lib/tax/locale-config"
import type {
    BalanceSheetSnapshot,
    ExportDataset,
    ExportPeriod,
    ExpenseRow,
    HsnSummaryRow,
    PLBucket,
    PurchaseRow,
    SalesRow,
} from "./types"

/**
 * Build the ExportPeriod for the given calendar year + month (1-indexed).
 *
 * `fyStartMonth` decides the fiscal-year label only (the from/to date range
 * is always the plain calendar month). It defaults to 4 (April) — correct for
 * India and the UK — but the CA-export flow re-derives it from the tenant's
 * country via `getTaxConfig().fiscalYearStartMonth` (US/EU = January,
 * Australia = July, etc.) so the "FY 2025-26" label and the balance-sheet
 * lookup match what the restaurant actually files.
 */
export function buildPeriod(year: number, month: number, fyStartMonth = 4): ExportPeriod {
    const from = new Date(Date.UTC(year, month - 1, 1))
    const to = new Date(Date.UTC(year, month, 1))
    const label = from.toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })
    const fyStartYear = month >= fyStartMonth ? year : year - 1
    const fyLabel = `${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, "0")}`
    return {
        fromDate: from.toISOString(),
        toDate: to.toISOString(),
        label,
        fyLabel,
        monthNum: month,
        yearNum: year,
    }
}

export interface ExportScope {
    /** Restrict SALES to one branch ("location"). Null/undefined = every
     *  branch the caller can read. Purchases / expenses / balance sheet have
     *  no branch column in the schema and always stay tenant-wide. */
    branchId?: string | null
}

export async function fetchExportDataset(periodIn: ExportPeriod, scope?: ExportScope): Promise<ExportDataset> {
    const supabase = createClient()
    const branchId = scope?.branchId ?? null

    const { data: u } = await supabase.auth.getUser()
    if (!u.user) throw new Error("Not signed in")
    const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
    if (!row?.tenant_id) throw new Error("No tenant context")

    const [{ data: tenant }, { data: branchRows }] = await Promise.all([
        supabase.from("tenants").select("*").eq("id", row.tenant_id).maybeSingle(),
        supabase.from("branches").select("id, name").eq("is_active", true),
    ])
    if (!tenant) throw new Error("Tenant not found")

    const branchNames = new Map<string, string>(
        ((branchRows ?? []) as Array<{ id: string; name: string }>).map((b) => [b.id, b.name]),
    )

    // The CA-export page builds the period with the April default; re-derive
    // it now that we know the tenant so the FY label (and the balance-sheet
    // lookup below) match the restaurant's real fiscal year — January for the
    // US/EU, July for Australia, April for India/UK.
    //
    // Use the tenant's stored `fy_start_month` first: that's the same value
    // the /accounting page stamps onto expense + balance-sheet `fy_label`s,
    // so the CA export joins to exactly the rows the owner already entered.
    // Fall back to the country default if the column was never populated.
    const fyStartMonth =
        (tenant as { fy_start_month?: number | null }).fy_start_month
        ?? getTaxConfig(tenant.country).fiscalYearStartMonth
    const period = buildPeriod(periodIn.yearNum, periodIn.monthNum, fyStartMonth)

    // ----- bills + items + payments -----
    // "Bill without GST" rows (gst_excluded) are deliberately kept out of the
    // CA bundle — they never reach the accountant. neq(..., true) also matches
    // NULL, so bills from before this column existed are still included.
    let billsQ = supabase
        .from("bills")
        .select("*")
        .gte("created_at", period.fromDate)
        .lt("created_at", period.toDate)
        .neq("gst_excluded", true)
    // Same semantics as scopeQueryToBranch(): a chosen branch filters
    // strictly on bills.branch_id; "All branches" applies no filter.
    if (branchId) billsQ = billsQ.eq("branch_id", branchId)
    const { data: bills } = await billsQ.order("created_at")
    const billIds = (bills ?? []).map((b) => b.id)
    const orderIds = (bills ?? []).map((b) => b.order_id)

    const [{ data: items }, { data: payments }] = await Promise.all([
        orderIds.length > 0
            ? supabase.from("order_items").select("*").in("order_id", orderIds)
            : Promise.resolve({ data: [] }),
        billIds.length > 0
            ? supabase.from("payments").select("*").in("bill_id", billIds)
            : Promise.resolve({ data: [] }),
    ])

    const itemsByOrder = new Map<string, Array<typeof items extends Array<infer R> ? R : never>>()
    for (const it of (items ?? []) as Array<{ order_id: string }>) {
        const list = itemsByOrder.get(it.order_id) ?? []
        list.push(it as never)
        itemsByOrder.set(it.order_id, list)
    }
    const paymentsByBill = new Map<string, Array<{ method: string; amount: number }>>()
    for (const p of (payments ?? []) as Array<{ bill_id: string; method: string; amount: number }>) {
        const list = paymentsByBill.get(p.bill_id) ?? []
        list.push(p)
        paymentsByBill.set(p.bill_id, list)
    }

    const sales: SalesRow[] = (bills ?? []).map((b) => {
        const lineItems = (itemsByOrder.get(b.order_id) ?? []) as Array<{
            item_name: string
            hsn_code: string | null
            quantity: number
            unit_price: number
            gst_slab: number
            taxable_amount: number
            cgst_amount: number
            sgst_amount: number
            igst_amount: number
            is_void: boolean
        }>
        const ps = paymentsByBill.get(b.id) ?? []
        return {
            invoice_number: b.invoice_number,
            invoice_date: b.created_at,
            branch_name: b.branch_id ? branchNames.get(b.branch_id) ?? null : null,
            customer_name: b.customer_name,
            customer_gstin: b.customer_gstin,
            customer_state_code: b.customer_state_code,
            place_of_supply: b.customer_state_code ?? tenant.state_code,
            is_inter_state: !!b.is_inter_state,
            taxable_amount: Number(b.taxable_amount),
            cgst_amount: Number(b.cgst_amount),
            sgst_amount: Number(b.sgst_amount),
            igst_amount: Number(b.igst_amount),
            cess_amount: Number(b.cess_amount ?? 0),
            service_charge: Number(b.service_charge ?? 0),
            grand_total: Number(b.grand_total),
            bill_status: b.bill_status,
            payment_methods: ps.map((p) => `${p.method}:${p.amount.toFixed(2)}`).join(", "),
            items: lineItems
                .filter((l) => !l.is_void)
                .map((l) => ({
                    item_name: l.item_name,
                    hsn_code: l.hsn_code,
                    quantity: Number(l.quantity),
                    unit_price: Number(l.unit_price),
                    gst_slab: Number(l.gst_slab),
                    taxable_amount: Number(l.taxable_amount),
                    cgst_amount: Number(l.cgst_amount),
                    sgst_amount: Number(l.sgst_amount),
                    igst_amount: Number(l.igst_amount),
                })),
        }
    })

    // ----- purchases -----
    const { data: purchases } = await supabase
        .from("purchases")
        .select("*, vendors:vendor_id(name, gstin)")
        .gte("vendor_invoice_date", period.fromDate.slice(0, 10))
        .lt("vendor_invoice_date", period.toDate.slice(0, 10))
        .order("vendor_invoice_date")
    const purchaseRows: PurchaseRow[] = (purchases ?? []).map((p) => ({
        purchase_number: p.purchase_number,
        vendor_invoice_no: p.vendor_invoice_no,
        invoice_date: p.vendor_invoice_date,
        vendor_name: (p as unknown as { vendors?: { name?: string } }).vendors?.name ?? "—",
        vendor_gstin: (p as unknown as { vendors?: { gstin?: string | null } }).vendors?.gstin ?? null,
        is_inter_state: !!p.is_inter_state,
        taxable_amount: Number(p.taxable_amount),
        cgst_amount: Number(p.cgst_amount),
        sgst_amount: Number(p.sgst_amount),
        igst_amount: Number(p.igst_amount),
        cess_amount: Number(p.cess_amount ?? 0),
        grand_total: Number(p.grand_total),
        itc_eligible: !!p.itc_eligible,
        itc_claimed: !!p.itc_claimed,
    }))

    // ----- expenses -----
    const { data: expenses } = await supabase
        .from("expenses")
        .select("*, expense_categories:category_id(name, pl_group)")
        .gte("expense_date", period.fromDate.slice(0, 10))
        .lt("expense_date", period.toDate.slice(0, 10))
        .order("expense_date")
    const expenseRows: ExpenseRow[] = (expenses ?? []).map((e) => ({
        expense_date: e.expense_date,
        description: e.description,
        pl_group:
            (e as unknown as { expense_categories?: { pl_group?: string } }).expense_categories?.pl_group ?? "OTHER",
        category:
            (e as unknown as { expense_categories?: { name?: string } }).expense_categories?.name ?? "Uncategorised",
        vendor_name: e.vendor_name,
        amount: Number(e.amount),
        gst_amount: Number(e.gst_amount ?? 0),
    }))

    // ----- balance sheet -----
    const { data: bs } = await supabase
        .from("balance_sheet_entries")
        .select("*")
        .eq("fy_label", period.fyLabel)
    const balanceSheet: BalanceSheetSnapshot[] = (bs ?? []).map((r) => ({
        section: r.section,
        sub_section: r.sub_section,
        head: r.head,
        opening: Number(r.opening_balance),
        closing: Number(r.closing_balance),
    }))

    // ===== aggregate =====
    const validSales = sales.filter((s) => s.bill_status !== "VOID")
    const gross_sales = validSales.reduce((s, r) => s + r.grand_total, 0)
    const taxable_outward = validSales.reduce((s, r) => s + r.taxable_amount, 0)
    const cgst_collected = validSales.reduce((s, r) => s + r.cgst_amount, 0)
    const sgst_collected = validSales.reduce((s, r) => s + r.sgst_amount, 0)
    const igst_collected = validSales.reduce((s, r) => s + r.igst_amount, 0)
    const taxable_b2b = validSales.filter((s) => s.customer_gstin).reduce((s, r) => s + r.taxable_amount, 0)
    const taxable_b2c = taxable_outward - taxable_b2b

    const purchase_value = purchaseRows.reduce((s, r) => s + r.taxable_amount, 0)
    const itc_cgst = purchaseRows.filter((r) => r.itc_eligible).reduce((s, r) => s + r.cgst_amount, 0)
    const itc_sgst = purchaseRows.filter((r) => r.itc_eligible).reduce((s, r) => s + r.sgst_amount, 0)
    const itc_igst = purchaseRows.filter((r) => r.itc_eligible).reduce((s, r) => s + r.igst_amount, 0)

    const net_tax_payable =
        cgst_collected + sgst_collected + igst_collected - (itc_cgst + itc_sgst + itc_igst)

    // by-slab summary
    const slabMap = new Map<number, { slab: number; taxable: number; cgst: number; sgst: number; igst: number }>()
    for (const s of validSales) {
        for (const it of s.items) {
            const cur = slabMap.get(it.gst_slab) ?? { slab: it.gst_slab, taxable: 0, cgst: 0, sgst: 0, igst: 0 }
            cur.taxable += it.taxable_amount
            cur.cgst += it.cgst_amount
            cur.sgst += it.sgst_amount
            cur.igst += it.igst_amount
            slabMap.set(it.gst_slab, cur)
        }
    }

    // HSN summary (GSTR-1 Table 12)
    const hsnMap = new Map<string, HsnSummaryRow>()
    for (const s of validSales) {
        for (const it of s.items) {
            const code = it.hsn_code ?? "996331"
            const cur =
                hsnMap.get(code) ??
                ({
                    hsn_code: code,
                    description: "",
                    uqc: "NOS",
                    total_quantity: 0,
                    total_value: 0,
                    taxable_amount: 0,
                    igst: 0,
                    cgst: 0,
                    sgst: 0,
                    cess: 0,
                } as HsnSummaryRow)
            cur.total_quantity += it.quantity
            cur.total_value += it.taxable_amount + it.cgst_amount + it.sgst_amount + it.igst_amount
            cur.taxable_amount += it.taxable_amount
            cur.cgst += it.cgst_amount
            cur.sgst += it.sgst_amount
            cur.igst += it.igst_amount
            hsnMap.set(code, cur)
        }
    }

    // P&L
    const plBuckets = new Map<string, PLBucket>()
    plBuckets.set("REVENUE", { group: "Revenue", amount: 0, rows: [] })
    plBuckets.set("COGS", { group: "Cost of goods sold (Purchases)", amount: 0, rows: [] })
    for (const e of expenseRows) {
        const k = e.pl_group
        const b = plBuckets.get(k) ?? { group: prettyGroup(k), amount: 0, rows: [] }
        b.amount += e.amount
        b.rows.push({ description: e.description, amount: e.amount })
        plBuckets.set(k, b)
    }
    const revenue = plBuckets.get("REVENUE")!
    revenue.amount = taxable_outward
    revenue.rows.push({ description: "Sales (taxable)", amount: taxable_outward })

    const cogs = plBuckets.get("COGS")!
    cogs.amount = purchase_value
    cogs.rows.push({ description: "Purchases (taxable)", amount: purchase_value })

    const total_expenses_pl = Array.from(plBuckets.values())
        .filter((b) => !["Revenue", "Cost of goods sold (Purchases)"].includes(b.group))
        .reduce((s, b) => s + b.amount, 0)
    const gross_profit = taxable_outward - purchase_value
    const net_profit = gross_profit - total_expenses_pl

    return {
        period,
        branch: branchId
            ? { id: branchId, name: branchNames.get(branchId) ?? "Selected location" }
            : null,
        branches_total: branchNames.size,
        tenant: {
            name: tenant.name,
            country: tenant.country ?? null,
            gstin: tenant.gstin,
            pan: tenant.pan,
            fssai: tenant.fssai,
            state: tenant.state,
            state_code: tenant.state_code,
            address: tenant.address_line1,
            city: tenant.city,
            pincode: tenant.pincode,
        },
        sales,
        purchases: purchaseRows,
        expenses: expenseRows,
        balance_sheet: balanceSheet,
        summary: {
            gross_sales,
            void_count: sales.length - validSales.length,
            taxable_outward,
            cgst_collected,
            sgst_collected,
            igst_collected,
            taxable_b2b,
            taxable_b2c,
            purchase_value,
            itc_cgst,
            itc_sgst,
            itc_igst,
            net_tax_payable,
            total_expenses_pl,
            gross_profit,
            net_profit,
        },
        hsn_summary: Array.from(hsnMap.values()).sort((a, b) => a.hsn_code.localeCompare(b.hsn_code)),
        pl: Array.from(plBuckets.values()),
        by_slab: Array.from(slabMap.values()).sort((a, b) => a.slab - b.slab),
    }
}

function prettyGroup(group: string): string {
    return (
        ({
            COGS: "Cost of goods sold",
            OPERATING: "Operating expenses",
            SALARIES: "Salaries & Wages",
            RENT: "Rent",
            UTILITIES: "Utilities",
            MARKETING: "Marketing",
            FINANCE: "Finance costs",
            DEPRECIATION: "Depreciation",
            OTHER: "Other expenses",
        } as Record<string, string>)[group] ?? group
    )
}
