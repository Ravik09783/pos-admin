"use client"

/**
 * Multi-format download for the /reports analytics page — CSV, Excel and
 * PDF renderings of the same branch-scoped stats the page displays
 * (summary KPIs, top items, payment split, daily trend, hourly revenue).
 *
 * The page computes the numbers (already scoped to the active location via
 * scopeQueryToBranch) and hands them over; this module only formats. The
 * CSV builder is pure so it can be unit-tested without a DOM.
 *
 * Heavy libraries (ExcelJS, jsPDF, file-saver) are lazy-imported so the
 * reports page's initial bundle doesn't pay for them until the admin
 * actually clicks a download.
 */

import { formatCurrency } from "@/lib/utils"

export interface SalesReportExport {
    /** ISO dates (yyyy-mm-dd), inclusive range as shown on the page. */
    from: string
    to: string
    /** Active location name; null = all locations / single-outlet tenant. */
    branchName: string | null
    /** ISO-4217 — from getTaxConfig(tenant.country).currency. */
    currency: string
    /** Country tax wording, e.g. "GST" / "VAT" — labels the tax KPI. */
    taxLabel: string
    revenue: number
    totalTax: number
    avgBill: number
    validCount: number
    voidCount: number
    topItems: Array<{ name: string; qty: number; revenue: number }>
    byPayment: Array<{ method: string; amount: number }>
    /** Revenue per hour-of-day, index 0–23. */
    hours: number[]
    /** [yyyy-mm-dd, revenue] pairs, ascending. */
    days: Array<[string, number]>
}

export type SalesReportFormat = "csv" | "xlsx" | "pdf"

function slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "")
}

export function salesReportFilename(d: SalesReportExport, ext: SalesReportFormat): string {
    const branch = d.branchName ? `_${slugify(d.branchName)}` : ""
    return `sales_report${branch}_${d.from}_to_${d.to}.${ext}`
}

function scopeLine(d: SalesReportExport): string {
    return d.branchName ?? "All locations"
}

// ── CSV ────────────────────────────────────────────────────────────────

/** Section-per-block CSV — opens cleanly in any spreadsheet. Pure. */
export function buildSalesReportCsv(d: SalesReportExport): string {
    const esc = (cell: string | number) => {
        const s = String(cell ?? "")
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const line = (...cells: Array<string | number>) => cells.map(esc).join(",")

    const out: string[] = [
        line("Sales report"),
        line("Location", scopeLine(d)),
        line("From", d.from),
        line("To", d.to),
        "",
        line("Summary"),
        line("Revenue", d.revenue.toFixed(2)),
        line(`${d.taxLabel} collected`, d.totalTax.toFixed(2)),
        line("Bills", d.validCount),
        line("Voided bills", d.voidCount),
        line("Avg bill value", d.avgBill.toFixed(2)),
        "",
        line("Top items by revenue"),
        line("Item", "Qty sold", "Revenue"),
        ...d.topItems.map((it) => line(it.name, it.qty, it.revenue.toFixed(2))),
        "",
        line("Payment methods"),
        line("Method", "Amount"),
        ...d.byPayment.map((p) => line(p.method, p.amount.toFixed(2))),
        "",
        line("Daily revenue"),
        line("Date", "Revenue"),
        ...d.days.map(([day, amt]) => line(day, amt.toFixed(2))),
        "",
        line("Hourly revenue"),
        line("Hour", "Revenue"),
        ...d.hours.map((amt, h) => line(`${String(h).padStart(2, "0")}:00`, amt.toFixed(2))),
    ]
    return out.join("\n")
}

// ── Excel ──────────────────────────────────────────────────────────────

async function buildSalesReportXlsx(d: SalesReportExport): Promise<ArrayBuffer> {
    const ExcelJS = (await import("exceljs")).default
    const wb = new ExcelJS.Workbook()
    wb.creator = "RestoPOS"
    wb.title = `Sales report — ${scopeLine(d)} — ${d.from} to ${d.to}`

    const headerStyle = (row: import("exceljs").Row) => {
        row.eachCell((cell) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } }
            cell.font = { bold: true, color: { argb: "FFFFFFFF" } }
        })
    }
    const moneyFmt = "#,##0.00"

    // Summary
    const s = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] })
    s.columns = [{ width: 28 }, { width: 22 }]
    const rows: Array<[string, string | number]> = [
        ["Location", scopeLine(d)],
        ["From", d.from],
        ["To", d.to],
        ["Revenue", d.revenue],
        [`${d.taxLabel} collected`, d.totalTax],
        ["Bills", d.validCount],
        ["Voided bills", d.voidCount],
        ["Avg bill value", d.avgBill],
    ]
    s.getCell("A1").value = "Sales report"
    s.getCell("A1").font = { bold: true, size: 16 }
    rows.forEach(([k, v], i) => {
        s.getCell(`A${i + 3}`).value = k
        const cell = s.getCell(`B${i + 3}`)
        cell.value = v
        cell.font = { bold: true }
        if (typeof v === "number" && !Number.isInteger(v)) cell.numFmt = moneyFmt
    })

    // Top items
    const items = wb.addWorksheet("Top Items")
    items.columns = [
        { header: "Item", key: "name", width: 36 },
        { header: "Qty sold", key: "qty", width: 12 },
        { header: "Revenue", key: "revenue", width: 16 },
    ]
    headerStyle(items.getRow(1))
    d.topItems.forEach((it) => items.addRow(it))
    items.getColumn("revenue").numFmt = moneyFmt

    // Payment methods
    const pay = wb.addWorksheet("Payment Methods")
    pay.columns = [
        { header: "Method", key: "method", width: 20 },
        { header: "Amount", key: "amount", width: 16 },
        { header: "Share %", key: "pct", width: 12 },
    ]
    headerStyle(pay.getRow(1))
    d.byPayment.forEach((p) =>
        pay.addRow({ ...p, pct: d.revenue > 0 ? (p.amount / d.revenue) * 100 : 0 }),
    )
    pay.getColumn("amount").numFmt = moneyFmt
    pay.getColumn("pct").numFmt = "0.0"

    // Daily trend
    const daily = wb.addWorksheet("Daily Trend")
    daily.columns = [
        { header: "Date", key: "day", width: 14 },
        { header: "Revenue", key: "amt", width: 16 },
    ]
    headerStyle(daily.getRow(1))
    d.days.forEach(([day, amt]) => daily.addRow({ day, amt }))
    daily.getColumn("amt").numFmt = moneyFmt

    // Hourly
    const hourly = wb.addWorksheet("Hourly Revenue")
    hourly.columns = [
        { header: "Hour", key: "h", width: 10 },
        { header: "Revenue", key: "amt", width: 16 },
    ]
    headerStyle(hourly.getRow(1))
    d.hours.forEach((amt, h) => hourly.addRow({ h: `${String(h).padStart(2, "0")}:00`, amt }))
    hourly.getColumn("amt").numFmt = moneyFmt

    return await wb.xlsx.writeBuffer()
}

// ── PDF ────────────────────────────────────────────────────────────────

async function buildSalesReportPdf(d: SalesReportExport): Promise<Uint8Array> {
    const { default: jsPDF } = await import("jspdf")
    const { default: autoTable } = await import("jspdf-autotable")
    const money = (v: number) => formatCurrency(v, d.currency)

    const doc = new jsPDF({ unit: "pt", format: "a4" })
    const w = doc.internal.pageSize.getWidth()

    doc.setFillColor(31, 78, 120)
    doc.rect(0, 0, w, 70, "F")
    doc.setTextColor(255, 255, 255)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(18)
    doc.text("Sales report", 40, 32)
    doc.setFontSize(10)
    doc.setFont("helvetica", "normal")
    doc.text(`${scopeLine(d)} — ${d.from} to ${d.to}`, 40, 52)
    doc.setTextColor(0, 0, 0)

    autoTable(doc, {
        startY: 90,
        head: [["Metric", "Value"]],
        body: [
            ["Location", scopeLine(d)],
            ["Revenue", money(d.revenue)],
            [`${d.taxLabel} collected`, money(d.totalTax)],
            ["Bills", String(d.validCount)],
            ["Voided bills", String(d.voidCount)],
            ["Avg bill value", money(d.avgBill)],
        ],
        theme: "grid",
        headStyles: { fillColor: [31, 78, 120] },
    })

    type DocWithAutoTable = typeof doc & { lastAutoTable?: { finalY: number } }
    const nextY = () => ((doc as DocWithAutoTable).lastAutoTable?.finalY ?? 90) + 24

    autoTable(doc, {
        startY: nextY(),
        head: [["Item", "Qty sold", "Revenue"]],
        body: d.topItems.map((it) => [it.name, String(it.qty), money(it.revenue)]),
        theme: "striped",
        headStyles: { fillColor: [46, 117, 182] },
        styles: { fontSize: 8 },
    })

    autoTable(doc, {
        startY: nextY(),
        head: [["Payment method", "Amount", "Share"]],
        body: d.byPayment.map((p) => [
            p.method,
            money(p.amount),
            d.revenue > 0 ? `${((p.amount / d.revenue) * 100).toFixed(1)}%` : "—",
        ]),
        theme: "grid",
        headStyles: { fillColor: [84, 130, 53] },
    })

    autoTable(doc, {
        startY: nextY(),
        head: [["Date", "Revenue"]],
        body: d.days.map(([day, amt]) => [day, money(amt)]),
        theme: "striped",
        headStyles: { fillColor: [198, 89, 17] },
        styles: { fontSize: 8 },
    })

    autoTable(doc, {
        startY: nextY(),
        head: [["Hour", "Revenue"]],
        body: d.hours.map((amt, h) => [`${String(h).padStart(2, "0")}:00`, money(amt)]),
        theme: "striped",
        headStyles: { fillColor: [143, 170, 220] },
        styles: { fontSize: 8 },
    })

    const total = doc.getNumberOfPages()
    for (let i = 1; i <= total; i++) {
        doc.setPage(i)
        doc.setFontSize(8)
        doc.setTextColor(140)
        doc.text(`Page ${i} of ${total}`, w - 70, doc.internal.pageSize.getHeight() - 20)
        doc.text("Generated by RestoPOS", 40, doc.internal.pageSize.getHeight() - 20)
    }
    return new Uint8Array(doc.output("arraybuffer"))
}

// ── Entry point ────────────────────────────────────────────────────────

export async function downloadSalesReport(d: SalesReportExport, format: SalesReportFormat): Promise<void> {
    const { saveAs } = await import("file-saver")
    const filename = salesReportFilename(d, format)
    if (format === "csv") {
        // BOM prefix so Excel opens UTF-8 (₹, é, …) correctly on Windows.
        saveAs(new Blob(["﻿" + buildSalesReportCsv(d)], { type: "text/csv;charset=utf-8" }), filename)
    } else if (format === "xlsx") {
        const buf = await buildSalesReportXlsx(d)
        saveAs(
            new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
            filename,
        )
    } else {
        const buf = await buildSalesReportPdf(d)
        saveAs(new Blob([buf as BlobPart], { type: "application/pdf" }), filename)
    }
}
