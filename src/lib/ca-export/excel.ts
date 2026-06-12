"use client"

import ExcelJS from "exceljs"

import { BRANCH_SCOPE_NOTE, exportLocale, scopeLabel, showBranchColumn, taxCells, type ExportLocale } from "./locale"
import type { ExportDataset } from "./types"

const HEADER_FILL: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F4E78" },
}
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } }
const HEADER_BORDER: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FF1F4E78" } },
    bottom: { style: "thin", color: { argb: "FF1F4E78" } },
    left: { style: "thin", color: { argb: "FF1F4E78" } },
    right: { style: "thin", color: { argb: "FF1F4E78" } },
}

function applyHeader(row: ExcelJS.Row) {
    row.eachCell((cell) => {
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = { vertical: "middle", horizontal: "left" }
        cell.border = HEADER_BORDER
    })
    row.height = 22
}

/** Bold SUM(...) totals row across the given column keys. */
function totalsRow(
    sheet: ExcelJS.Worksheet,
    label: string,
    sumKeys: string[],
    lastDataRow: number,
    currencyFmt: string,
) {
    const r = sheet.lastRow!.number + 1
    sheet.getCell(`A${r}`).value = label
    sheet.getCell(`A${r}`).font = { bold: true }
    for (const key of sumKeys) {
        const letter = sheet.getColumn(key).letter
        const cell = sheet.getCell(`${letter}${r}`)
        cell.value = { formula: `SUM(${letter}2:${letter}${lastDataRow})` }
        cell.numFmt = currencyFmt
        cell.font = { bold: true }
    }
}

function addCoverSheet(wb: ExcelJS.Workbook, data: ExportDataset, loc: ExportLocale) {
    const s = wb.addWorksheet("Summary", {
        properties: { tabColor: { argb: "FF1F4E78" } },
        views: [{ showGridLines: false }],
    })
    s.columns = [{ width: 32 }, { width: 24 }]

    s.getCell("A1").value = data.tenant.name
    s.getCell("A1").font = { bold: true, size: 22 }
    s.getCell("A2").value = "Tax Export — Monthly Filing Bundle"
    s.getCell("A2").font = { italic: true, color: { argb: "FF888888" } }

    let r = 4
    const put = (label: string, value: string | number) => {
        s.getCell(`A${r}`).value = label
        s.getCell(`A${r}`).font = { color: { argb: "FF666666" } }
        s.getCell(`B${r}`).value = value
        s.getCell(`B${r}`).font = { bold: true }
        r++
    }

    put("Country", loc.cfg.name)
    const location = scopeLabel(data)
    if (location) put("Location", location)
    put("Period", data.period.label)
    put("FY", data.period.fyLabel)
    put(loc.taxIdLabel, data.tenant.gstin ?? "—")
    // PAN / FSSAI are India-only registrations — omit them for everyone else.
    if (loc.isIndia) {
        put("PAN", data.tenant.pan ?? "—")
        put("FSSAI", data.tenant.fssai ?? "—")
    }
    if (loc.cfg.stateMatters) {
        put("State", `${data.tenant.state ?? ""} (${data.tenant.state_code ?? ""})`)
    }
    put("Address", `${data.tenant.address ?? ""}${data.tenant.city ? ", " + data.tenant.city : ""}${data.tenant.pincode ? " - " + data.tenant.pincode : ""}`)
    if (data.branch) {
        s.getCell(`A${r}`).value = BRANCH_SCOPE_NOTE
        s.getCell(`A${r}`).font = { italic: true, color: { argb: "FF888888" } }
        r++
    }
    r++
    s.getCell(`A${r}`).value = loc.isIndia
        ? "GSTR-1 / 3B working summary"
        : `${loc.taxName} working summary`
    s.getCell(`A${r}`).font = { bold: true, size: 14 }
    r += 2

    const fmtCurrency = (k: string, v: number) => {
        s.getCell(`A${r}`).value = k
        s.getCell(`A${r}`).font = { color: { argb: "FF666666" } }
        s.getCell(`B${r}`).value = v
        s.getCell(`B${r}`).numFmt = loc.excelCurrencyFmt
        s.getCell(`B${r}`).font = { bold: true }
        r++
    }
    fmtCurrency("Gross sales (incl. tax)", data.summary.gross_sales)
    fmtCurrency("Voided bills (count)", data.summary.void_count)
    fmtCurrency("Taxable outward supplies", data.summary.taxable_outward)
    fmtCurrency(`  • B2B (with ${loc.taxIdLabel})`, data.summary.taxable_b2b)
    fmtCurrency("  • B2C / retail", data.summary.taxable_b2c)

    const taxCollected = data.summary.cgst_collected + data.summary.sgst_collected + data.summary.igst_collected
    const itcTotal = data.summary.itc_cgst + data.summary.itc_sgst + data.summary.itc_igst
    if (loc.taxModel === "split") {
        fmtCurrency("CGST collected", data.summary.cgst_collected)
        fmtCurrency("SGST collected", data.summary.sgst_collected)
        fmtCurrency("IGST collected", data.summary.igst_collected)
        r++
        fmtCurrency("Purchase value (taxable)", data.summary.purchase_value)
        fmtCurrency("ITC — CGST", data.summary.itc_cgst)
        fmtCurrency("ITC — SGST", data.summary.itc_sgst)
        fmtCurrency("ITC — IGST", data.summary.itc_igst)
        r++
        fmtCurrency("NET GST PAYABLE", data.summary.net_tax_payable)
        s.getCell(`B${r - 1}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE699" } }
    } else if (loc.taxModel === "single") {
        fmtCurrency(`${loc.taxName} collected (output)`, taxCollected)
        r++
        fmtCurrency("Purchase value (taxable)", data.summary.purchase_value)
        fmtCurrency(`Input ${loc.taxName} credit`, itcTotal)
        r++
        fmtCurrency(`NET ${loc.taxName} PAYABLE`, data.summary.net_tax_payable)
        s.getCell(`B${r - 1}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE699" } }
    } else {
        // taxModel "none" — no consumption tax to summarise.
        fmtCurrency("Purchase value", data.summary.purchase_value)
    }
    r++
    fmtCurrency("Gross profit (Revenue − COGS)", data.summary.gross_profit)
    fmtCurrency("Operating expenses", data.summary.total_expenses_pl)
    fmtCurrency("Net profit (before tax)", data.summary.net_profit)
}

function addSalesRegister(wb: ExcelJS.Workbook, data: ExportDataset, loc: ExportLocale) {
    const s = wb.addWorksheet("Sales Register", { properties: { tabColor: { argb: "FF2E75B6" } } })

    const taxKeys = loc.taxColumns.map((_, i) => `tax${i}`)
    const withBranch = showBranchColumn(data)
    const cols: Partial<ExcelJS.Column>[] = [
        { header: "Invoice #", key: "inv", width: 18 },
        { header: "Date", key: "date", width: 12 },
    ]
    if (withBranch) cols.push({ header: "Branch", key: "branch", width: 18 })
    cols.push({ header: "Customer", key: "cust", width: 20 })
    if (loc.taxModel !== "none") {
        cols.push({ header: `Customer ${loc.taxIdLabel}`, key: "cgstin", width: 18 })
    }
    if (loc.isIndia) {
        cols.push({ header: "POS", key: "pos", width: 6 })
        cols.push({ header: "Inter-state", key: "is", width: 10 })
    }
    cols.push({ header: "Taxable", key: "tax", width: 14 })
    loc.taxColumns.forEach((label, i) => cols.push({ header: label, key: taxKeys[i]!, width: 12 }))
    cols.push({ header: "Service charge", key: "svc", width: 14 })
    cols.push({ header: "Grand total", key: "tot", width: 14 })
    cols.push({ header: "Status", key: "stat", width: 12 })
    cols.push({ header: "Payment", key: "pay", width: 24 })
    s.columns = cols
    applyHeader(s.getRow(1))

    for (const r of data.sales) {
        const cells = taxCells(loc, r)
        const taxObj: Record<string, number> = {}
        taxKeys.forEach((k, i) => (taxObj[k] = cells[i] ?? 0))
        s.addRow({
            inv: r.invoice_number,
            date: new Date(r.invoice_date),
            ...(withBranch ? { branch: r.branch_name ?? "—" } : {}),
            cust: r.customer_name ?? "Walk-in",
            cgstin: r.customer_gstin ?? "",
            pos: r.place_of_supply ?? "",
            is: r.is_inter_state ? "YES" : "NO",
            tax: r.taxable_amount,
            ...taxObj,
            svc: r.service_charge,
            tot: r.grand_total,
            stat: r.bill_status,
            pay: r.payment_methods,
        })
    }
    s.getColumn("date").numFmt = "dd-mmm-yyyy"
    ;["tax", ...taxKeys, "svc", "tot"].forEach((k) => (s.getColumn(k).numFmt = loc.excelCurrencyFmt))
    s.views = [{ state: "frozen", ySplit: 1 }]
    s.autoFilter = { from: "A1", to: { row: 1, column: s.columnCount } }
    if (data.sales.length > 0) {
        totalsRow(s, "TOTAL", ["tax", ...taxKeys, "svc", "tot"], data.sales.length + 1, loc.excelCurrencyFmt)
    }
}

function addItemDetail(wb: ExcelJS.Workbook, data: ExportDataset, loc: ExportLocale) {
    const s = wb.addWorksheet("Sales Item Detail", { properties: { tabColor: { argb: "FF9DC3E6" } } })

    const taxKeys = loc.taxColumns.map((_, i) => `tax${i}`)
    const withBranch = showBranchColumn(data)
    const cols: Partial<ExcelJS.Column>[] = [
        { header: "Invoice #", key: "inv", width: 18 },
        { header: "Date", key: "date", width: 12 },
    ]
    if (withBranch) cols.push({ header: "Branch", key: "branch", width: 18 })
    cols.push({ header: "Item", key: "item", width: 32 })
    if (loc.isIndia) cols.push({ header: "HSN/SAC", key: "hsn", width: 12 })
    cols.push({ header: "Qty", key: "qty", width: 8 })
    cols.push({ header: "Rate", key: "rate", width: 12 })
    cols.push({ header: `${loc.taxName} %`, key: "slab", width: 8 })
    cols.push({ header: "Taxable", key: "tax", width: 14 })
    loc.taxColumns.forEach((label, i) => cols.push({ header: label, key: taxKeys[i]!, width: 12 }))
    s.columns = cols
    applyHeader(s.getRow(1))

    for (const r of data.sales) {
        for (const it of r.items) {
            const cells = taxCells(loc, it)
            const taxObj: Record<string, number> = {}
            taxKeys.forEach((k, i) => (taxObj[k] = cells[i] ?? 0))
            s.addRow({
                inv: r.invoice_number,
                date: new Date(r.invoice_date),
                ...(withBranch ? { branch: r.branch_name ?? "—" } : {}),
                item: it.item_name,
                hsn: it.hsn_code ?? "",
                qty: it.quantity,
                rate: it.unit_price,
                slab: it.gst_slab,
                tax: it.taxable_amount,
                ...taxObj,
            })
        }
    }
    s.getColumn("date").numFmt = "dd-mmm-yyyy"
    ;["rate", "tax", ...taxKeys].forEach((k) => (s.getColumn(k).numFmt = loc.excelCurrencyFmt))
    s.views = [{ state: "frozen", ySplit: 1 }]
    s.autoFilter = { from: "A1", to: { row: 1, column: s.columnCount } }
}

/**
 * India: the GSTR-1 working sheet (statutory Tables 4 / 7 / 12).
 * Elsewhere: a generic "Tax Working" sheet — B2B vs B2C split + a by-rate
 * breakdown, with the country's own tax labels and no GSTR table numbers.
 */
function addTaxWorking(wb: ExcelJS.Workbook, data: ExportDataset, loc: ExportLocale) {
    const sheetName = loc.isIndia ? "GSTR-1 Working" : "Tax Working"
    const s = wb.addWorksheet(sheetName, { properties: { tabColor: { argb: "FF548235" } } })

    // Tax columns for these tables; India uses the GSTR order IGST/CGST/SGST.
    const taxHeads = loc.isIndia ? ["IGST", "CGST", "SGST"] : loc.taxColumns
    const totalCols = 2 + taxHeads.length // label + taxable + tax cols
    const lastCol = String.fromCharCode("A".charCodeAt(0) + totalCols - 1)
    s.columns = Array.from({ length: totalCols }, (_, i) => ({ width: i === 0 ? 36 : 18 }))

    let r = 1
    const title = (t: string) => {
        s.mergeCells(`A${r}:${lastCol}${r}`)
        s.getCell(`A${r}`).value = t
        s.getCell(`A${r}`).font = { bold: true, size: 13, color: { argb: "FF548235" } }
        r++
    }
    const head = (labels: string[]) => {
        s.getRow(r).values = labels
        applyHeader(s.getRow(r))
        r++
    }
    const note = (t: string) => {
        s.getCell(`A${r}`).value = t
        s.getCell(`A${r}`).font = { italic: true, color: { argb: "FF888888" } }
        r++
    }
    // values: [label, taxable, ...tax]; India reorders tax to IGST/CGST/SGST.
    const row = (label: string, taxable: number, t: { cgst_amount: number; sgst_amount: number; igst_amount: number }) => {
        const taxVals = loc.isIndia
            ? [t.igst_amount, t.cgst_amount, t.sgst_amount]
            : taxCells(loc, t)
        s.getRow(r).values = [label, taxable, ...taxVals]
        for (let c = 2; c <= totalCols; c++) {
            s.getCell(`${String.fromCharCode(64 + c)}${r}`).numFmt = loc.excelCurrencyFmt
        }
        r++
    }

    title(loc.isIndia ? "Table 4 — B2B Outward (with GSTIN)" : `B2B sales (registered customers)`)
    head([`Customer ${loc.taxIdLabel}`, "Taxable", ...taxHeads])
    const b2b = data.sales.filter((x) => x.customer_gstin && x.bill_status !== "VOID")
    if (b2b.length === 0) note("No B2B invoices.")
    for (const x of b2b) row(x.customer_gstin!, x.taxable_amount, x)
    r++

    if (loc.isIndia) {
        title("Table 7 — B2C (Other) — consolidated")
        head(["Place of supply", "Taxable", ...taxHeads])
        const b2cByPos = new Map<string, { taxable: number; cgst_amount: number; sgst_amount: number; igst_amount: number }>()
        for (const x of data.sales.filter((x) => !x.customer_gstin && x.bill_status !== "VOID")) {
            const k = x.place_of_supply ?? "—"
            const cur = b2cByPos.get(k) ?? { taxable: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0 }
            cur.taxable += x.taxable_amount
            cur.cgst_amount += x.cgst_amount
            cur.sgst_amount += x.sgst_amount
            cur.igst_amount += x.igst_amount
            b2cByPos.set(k, cur)
        }
        if (b2cByPos.size === 0) note("No B2C invoices.")
        b2cByPos.forEach((agg, pos) => row(`State ${pos}`, agg.taxable, agg))
        r++

        title("Table 12 — HSN Summary")
        head(["HSN/SAC", "Taxable", ...taxHeads])
        for (const h of data.hsn_summary) {
            row(h.hsn_code, h.taxable_amount, { cgst_amount: h.cgst, sgst_amount: h.sgst, igst_amount: h.igst })
        }
    } else {
        title("B2C / retail sales")
        head(["Customer type", "Taxable", ...taxHeads])
        const b2c = data.sales.filter((x) => !x.customer_gstin && x.bill_status !== "VOID")
        const agg = b2c.reduce(
            (a, x) => ({
                taxable: a.taxable + x.taxable_amount,
                cgst_amount: a.cgst_amount + x.cgst_amount,
                sgst_amount: a.sgst_amount + x.sgst_amount,
                igst_amount: a.igst_amount + x.igst_amount,
            }),
            { taxable: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0 },
        )
        if (b2c.length === 0) note("No retail invoices.")
        else row("Retail / walk-in (consolidated)", agg.taxable, agg)
        r++

        title(`By ${loc.taxName} rate`)
        head(["Rate", "Taxable", ...taxHeads])
        for (const sl of data.by_slab) {
            row(`${sl.slab}%`, sl.taxable, {
                cgst_amount: sl.cgst,
                sgst_amount: sl.sgst,
                igst_amount: sl.igst,
            })
        }
    }
}

/**
 * India: the GSTR-3B working sheet (statutory boxes 3.1 / 4 / 5).
 * Elsewhere: a plain "Tax Summary" — output tax − input credit = net payable.
 */
function addTaxReturn(wb: ExcelJS.Workbook, data: ExportDataset, loc: ExportLocale) {
    if (loc.isIndia) {
        addGSTR3B(wb, data, loc)
        return
    }
    if (loc.taxModel === "none") return // no consumption tax → no return sheet

    const s = wb.addWorksheet("Tax Summary", { properties: { tabColor: { argb: "FF70AD47" } } })
    s.columns = [{ width: 50 }, { width: 18 }]
    let r = 1
    const line = (label: string, value: number, bold = false) => {
        s.getCell(`A${r}`).value = label
        s.getCell(`B${r}`).value = value
        s.getCell(`B${r}`).numFmt = loc.excelCurrencyFmt
        if (bold) {
            s.getCell(`A${r}`).font = { bold: true, size: 12 }
            s.getCell(`B${r}`).font = { bold: true, size: 12 }
        }
        r++
    }
    s.getCell(`A${r}`).value = `${loc.taxName} return working — ${data.period.label}`
    s.getCell(`A${r}`).font = { bold: true, size: 13, color: { argb: "FF548235" } }
    r += 2
    const taxCollected = data.summary.cgst_collected + data.summary.sgst_collected + data.summary.igst_collected
    const itcTotal = data.summary.itc_cgst + data.summary.itc_sgst + data.summary.itc_igst
    line("Taxable outward supplies", data.summary.taxable_outward)
    line(`Output ${loc.taxName} collected`, taxCollected)
    line(`Input ${loc.taxName} credit (on purchases)`, itcTotal)
    r++
    line(`NET ${loc.taxName} PAYABLE`, data.summary.net_tax_payable, true)
    s.getCell(`B${r - 1}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE699" } }
}

function addGSTR3B(wb: ExcelJS.Workbook, data: ExportDataset, loc: ExportLocale) {
    const s = wb.addWorksheet("GSTR-3B", { properties: { tabColor: { argb: "FF70AD47" } } })
    s.columns = [{ width: 50 }, { width: 18 }]

    let r = 1
    const head = (t: string) => {
        s.getCell(`A${r}`).value = t
        s.getCell(`A${r}`).font = { bold: true, size: 13, color: { argb: "FF548235" } }
        r++
    }
    const sub = (t: string) => {
        s.getCell(`A${r}`).value = t
        s.getCell(`A${r}`).font = { bold: true }
        s.getCell(`A${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } }
        s.getCell(`B${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } }
        r++
    }
    const line = (label: string, value: number) => {
        s.getCell(`A${r}`).value = label
        s.getCell(`B${r}`).value = value
        s.getCell(`B${r}`).numFmt = loc.excelCurrencyFmt
        r++
    }

    head(`GSTR-3B Working — ${data.period.label}`)
    r++

    sub("3.1 Outward supplies and inward supplies liable to reverse charge")
    line("(a) Outward taxable supplies (other than zero-rated/nil rated/exempted)", data.summary.taxable_outward)
    line("        IGST", data.summary.igst_collected)
    line("        CGST", data.summary.cgst_collected)
    line("        SGST/UTGST", data.summary.sgst_collected)
    r++

    sub("4. Eligible ITC")
    line("(A) ITC Available", 0)
    line("        Inputs (IGST)", data.summary.itc_igst)
    line("        Inputs (CGST)", data.summary.itc_cgst)
    line("        Inputs (SGST)", data.summary.itc_sgst)
    r++

    sub("5. Net tax payable (Output tax − ITC)")
    line("Net IGST payable", Math.max(0, data.summary.igst_collected - data.summary.itc_igst))
    line("Net CGST payable", Math.max(0, data.summary.cgst_collected - data.summary.itc_cgst))
    line("Net SGST payable", Math.max(0, data.summary.sgst_collected - data.summary.itc_sgst))
    r++
    s.getCell(`A${r}`).value = "Total tax payable"
    s.getCell(`B${r}`).value = data.summary.net_tax_payable
    s.getCell(`B${r}`).numFmt = loc.excelCurrencyFmt
    s.getCell(`A${r}`).font = { bold: true, size: 12 }
    s.getCell(`B${r}`).font = { bold: true, size: 12 }
    s.getCell(`B${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE699" } }
}

function addPurchaseRegister(wb: ExcelJS.Workbook, data: ExportDataset, loc: ExportLocale) {
    const s = wb.addWorksheet("Purchase Register", { properties: { tabColor: { argb: "FFC65911" } } })

    const taxKeys = loc.taxColumns.map((_, i) => `tax${i}`)
    const cols: Partial<ExcelJS.Column>[] = [
        { header: "Purchase #", key: "pn", width: 16 },
        { header: "Vendor invoice #", key: "vi", width: 18 },
        { header: "Date", key: "date", width: 12 },
        { header: "Vendor", key: "v", width: 24 },
    ]
    if (loc.taxModel !== "none") {
        cols.push({ header: `Vendor ${loc.taxIdLabel}`, key: "vg", width: 18 })
    }
    if (loc.isIndia) cols.push({ header: "Inter-state", key: "is", width: 10 })
    cols.push({ header: "Taxable", key: "tax", width: 14 })
    loc.taxColumns.forEach((label, i) => cols.push({ header: label, key: taxKeys[i]!, width: 12 }))
    cols.push({ header: "Total", key: "tot", width: 14 })
    cols.push({ header: loc.taxModel === "none" ? "Notes" : "ITC eligible?", key: "itc", width: 12 })
    s.columns = cols
    applyHeader(s.getRow(1))

    for (const r of data.purchases) {
        const cells = taxCells(loc, r)
        const taxObj: Record<string, number> = {}
        taxKeys.forEach((k, i) => (taxObj[k] = cells[i] ?? 0))
        s.addRow({
            pn: r.purchase_number,
            vi: r.vendor_invoice_no ?? "",
            date: new Date(r.invoice_date),
            v: r.vendor_name,
            vg: r.vendor_gstin ?? "",
            is: r.is_inter_state ? "YES" : "NO",
            tax: r.taxable_amount,
            ...taxObj,
            tot: r.grand_total,
            itc: loc.taxModel === "none" ? "" : r.itc_eligible ? "YES" : "NO",
        })
    }
    s.getColumn("date").numFmt = "dd-mmm-yyyy"
    ;["tax", ...taxKeys, "tot"].forEach((k) => (s.getColumn(k).numFmt = loc.excelCurrencyFmt))
    s.views = [{ state: "frozen", ySplit: 1 }]
    s.autoFilter = { from: "A1", to: { row: 1, column: s.columnCount } }
    if (data.purchases.length > 0) {
        totalsRow(s, "TOTAL", ["tax", ...taxKeys, "tot"], data.purchases.length + 1, loc.excelCurrencyFmt)
    }
}

function addExpenses(wb: ExcelJS.Workbook, data: ExportDataset, loc: ExportLocale) {
    const s = wb.addWorksheet("Expenses", { properties: { tabColor: { argb: "FFFFC000" } } })
    s.columns = [
        { header: "Date", key: "date", width: 12 },
        { header: "Description", key: "desc", width: 32 },
        { header: "Vendor", key: "v", width: 20 },
        { header: "Category", key: "cat", width: 16 },
        { header: "P&L Group", key: "g", width: 14 },
        { header: "Amount", key: "amt", width: 14 },
        { header: `${loc.taxName} included`, key: "gst", width: 14 },
    ]
    applyHeader(s.getRow(1))
    for (const e of data.expenses) {
        s.addRow({
            date: new Date(e.expense_date),
            desc: e.description,
            v: e.vendor_name ?? "",
            cat: e.category,
            g: e.pl_group,
            amt: e.amount,
            gst: e.gst_amount,
        })
    }
    s.getColumn("date").numFmt = "dd-mmm-yyyy"
    ;(["amt", "gst"] as const).forEach((k) => (s.getColumn(k).numFmt = loc.excelCurrencyFmt))
    s.views = [{ state: "frozen", ySplit: 1 }]
}

function addPL(wb: ExcelJS.Workbook, data: ExportDataset, loc: ExportLocale) {
    const s = wb.addWorksheet("P&L", { properties: { tabColor: { argb: "FF8FAADC" } } })
    s.columns = [{ width: 36 }, { width: 18 }]

    let r = 1
    s.getCell(`A${r}`).value = `Profit & Loss — ${data.period.label}`
    s.getCell(`A${r}`).font = { bold: true, size: 16 }
    r += 2

    const head = (t: string) => {
        s.getRow(r).values = [t, loc.currencySymbol]
        applyHeader(s.getRow(r))
        r++
    }
    const total = (t: string, v: number, bold = true) => {
        s.getCell(`A${r}`).value = t
        s.getCell(`B${r}`).value = v
        s.getCell(`B${r}`).numFmt = loc.excelCurrencyFmt
        if (bold) {
            s.getCell(`A${r}`).font = { bold: true }
            s.getCell(`B${r}`).font = { bold: true }
        }
        r++
    }
    const detail = (t: string, v: number) => {
        s.getCell(`A${r}`).value = `    ${t}`
        s.getCell(`A${r}`).font = { color: { argb: "FF666666" } }
        s.getCell(`B${r}`).value = v
        s.getCell(`B${r}`).numFmt = loc.excelCurrencyFmt
        r++
    }

    head("Income / expense")
    for (const b of data.pl) {
        for (const sub of b.rows) detail(sub.description, sub.amount)
        total(b.group, b.amount)
        r++
    }
    s.getCell(`A${r}`).value = "Net profit (before tax)"
    s.getCell(`B${r}`).value = data.summary.net_profit
    s.getCell(`B${r}`).numFmt = loc.excelCurrencyFmt
    s.getCell(`A${r}`).font = { bold: true, size: 13 }
    s.getCell(`B${r}`).font = { bold: true, size: 13 }
    s.getCell(`B${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6E0B4" } }
}

function addBalanceSheet(wb: ExcelJS.Workbook, data: ExportDataset, loc: ExportLocale) {
    const s = wb.addWorksheet("Balance Sheet", { properties: { tabColor: { argb: "FFB4A7D6" } } })
    s.columns = [{ width: 18 }, { width: 28 }, { width: 28 }, { width: 16 }, { width: 16 }]

    let r = 1
    s.getCell(`A${r}`).value = `Balance Sheet inputs — FY ${data.period.fyLabel}`
    s.getCell(`A${r}`).font = { bold: true, size: 16 }
    r += 2

    s.getRow(r).values = ["Section", "Sub-section", "Head", "Opening", "Closing"]
    applyHeader(s.getRow(r))
    r++

    if (data.balance_sheet.length === 0) {
        s.getCell(`A${r}`).value = "No balance sheet entries — fill in /accounting → Balance Sheet."
        s.getCell(`A${r}`).font = { italic: true, color: { argb: "FF888888" } }
    } else {
        for (const b of data.balance_sheet) {
            s.getRow(r).values = [b.section, b.sub_section, b.head, b.opening, b.closing]
            ;(["D", "E"] as const).forEach((col) => (s.getCell(`${col}${r}`).numFmt = loc.excelCurrencyFmt))
            r++
        }
    }
}

export async function buildExcelWorkbook(data: ExportDataset): Promise<ArrayBuffer> {
    const loc = exportLocale(data.tenant.country)

    const wb = new ExcelJS.Workbook()
    wb.creator = "RestoPOS"
    wb.lastModifiedBy = "RestoPOS"
    wb.created = new Date()
    wb.title = `${data.tenant.name} — ${data.period.label}`

    addCoverSheet(wb, data, loc)
    addSalesRegister(wb, data, loc)
    addItemDetail(wb, data, loc)
    if (loc.taxModel !== "none") {
        addTaxWorking(wb, data, loc)
        addTaxReturn(wb, data, loc)
    }
    addPurchaseRegister(wb, data, loc)
    addExpenses(wb, data, loc)
    addPL(wb, data, loc)
    addBalanceSheet(wb, data, loc)

    return await wb.xlsx.writeBuffer()
}
