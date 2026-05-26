"use client"

import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

import { formatCurrency } from "@/lib/utils"
import { exportLocale, taxCells, combinedTax } from "./locale"
import type { ExportDataset } from "./types"

export function buildPdfReport(data: ExportDataset): Uint8Array {
    const loc = exportLocale(data.tenant.country)
    const money = (v: number) => formatCurrency(v, loc.currency)

    const doc = new jsPDF({ unit: "pt", format: "a4" })
    const w = doc.internal.pageSize.getWidth()

    // Title
    doc.setFillColor(31, 78, 120)
    doc.rect(0, 0, w, 80, "F")
    doc.setTextColor(255, 255, 255)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(20)
    doc.text(data.tenant.name, 40, 36)
    doc.setFontSize(11)
    doc.setFont("helvetica", "normal")
    doc.text(`Tax Export — ${data.period.label} (FY ${data.period.fyLabel})`, 40, 56)
    if (data.tenant.gstin) doc.text(`${loc.taxIdLabel}: ${data.tenant.gstin}`, 40, 72)

    let y = 110
    doc.setTextColor(0, 0, 0)

    // ---- Filing summary ----
    section(doc, "Filing summary", y); y += 18
    const summaryBody: string[][] = [
        ["Gross sales (incl. tax)", money(data.summary.gross_sales)],
        ["Voided bills", String(data.summary.void_count)],
        ["Taxable outward supplies", money(data.summary.taxable_outward)],
        [`    • B2B (with ${loc.taxIdLabel})`, money(data.summary.taxable_b2b)],
        ["    • B2C / retail", money(data.summary.taxable_b2c)],
    ]
    if (loc.taxModel === "split") {
        summaryBody.push(
            ["CGST collected", money(data.summary.cgst_collected)],
            ["SGST collected", money(data.summary.sgst_collected)],
            ["IGST collected", money(data.summary.igst_collected)],
        )
    } else if (loc.taxModel === "single") {
        const collected = data.summary.cgst_collected + data.summary.sgst_collected + data.summary.igst_collected
        summaryBody.push([`${loc.taxName} collected (output)`, money(collected)])
    }
    summaryBody.push(["Purchase value (taxable)", money(data.summary.purchase_value)])
    if (loc.taxModel !== "none") {
        const itc = data.summary.itc_cgst + data.summary.itc_sgst + data.summary.itc_igst
        summaryBody.push(
            [loc.isIndia ? "ITC available" : `Input ${loc.taxName} credit`, money(itc)],
            [`NET ${loc.taxName} PAYABLE`, money(data.summary.net_tax_payable)],
        )
    }
    autoTable(doc, {
        startY: y,
        head: [["Metric", `Amount (${loc.currency})`]],
        body: summaryBody,
        theme: "grid",
        headStyles: { fillColor: [31, 78, 120] },
    })

    // ---- Sales register ----
    doc.addPage()
    section(doc, "Sales register", 50)
    autoTable(doc, {
        startY: 70,
        head: [["Invoice", "Date", "Customer", "Taxable", ...loc.taxColumns, "Total"]],
        body: data.sales.map((s) => [
            s.invoice_number,
            fmtDate(s.invoice_date, loc.cfg.locale),
            s.customer_name ?? "Walk-in",
            money(s.taxable_amount),
            ...taxCells(loc, s).map(money),
            money(s.grand_total),
        ]),
        theme: "striped",
        headStyles: { fillColor: [46, 117, 182] },
        styles: { fontSize: 8 },
    })

    // ---- Tax breakdown by rate / HSN ----
    if (loc.taxModel !== "none") {
        doc.addPage()
        if (loc.isIndia) {
            section(doc, "HSN summary (GSTR-1 Table 12)", 50)
            autoTable(doc, {
                startY: 70,
                head: [["HSN/SAC", "Qty", "Taxable", "CGST", "SGST", "IGST"]],
                body: data.hsn_summary.map((h) => [
                    h.hsn_code,
                    h.total_quantity.toFixed(2),
                    money(h.taxable_amount),
                    money(h.cgst),
                    money(h.sgst),
                    money(h.igst),
                ]),
                theme: "grid",
                headStyles: { fillColor: [84, 130, 53] },
            })
        } else {
            section(doc, `${loc.taxName} collected by rate`, 50)
            autoTable(doc, {
                startY: 70,
                head: [["Rate", "Taxable", ...loc.taxColumns]],
                body: data.by_slab.map((sl) => [
                    `${sl.slab}%`,
                    money(sl.taxable),
                    ...taxCells(loc, {
                        cgst_amount: sl.cgst,
                        sgst_amount: sl.sgst,
                        igst_amount: sl.igst,
                    }).map(money),
                ]),
                theme: "grid",
                headStyles: { fillColor: [84, 130, 53] },
            })
        }
    }

    // ---- Purchases ----
    if (data.purchases.length > 0) {
        doc.addPage()
        section(doc, "Purchase register", 50)
        autoTable(doc, {
            startY: 70,
            head: [["Purchase #", "Vendor inv", "Date", "Vendor", loc.taxIdLabel, "Taxable", "Tax", "Total"]],
            body: data.purchases.map((p) => [
                p.purchase_number,
                p.vendor_invoice_no ?? "",
                fmtDate(p.invoice_date, loc.cfg.locale),
                p.vendor_name,
                p.vendor_gstin ?? "",
                money(p.taxable_amount),
                money(combinedTax(p)),
                money(p.grand_total),
            ]),
            theme: "striped",
            headStyles: { fillColor: [198, 89, 17] },
            styles: { fontSize: 8 },
        })
    }

    // ---- P&L ----
    doc.addPage()
    section(doc, `Profit & Loss — ${data.period.label}`, 50)
    const plRows: string[][] = []
    for (const b of data.pl) {
        for (const sub of b.rows) plRows.push([`    ${sub.description}`, money(sub.amount)])
        plRows.push([b.group, money(b.amount)])
    }
    plRows.push(["Net profit (before tax)", money(data.summary.net_profit)])
    autoTable(doc, {
        startY: 70,
        head: [["Description", `Amount (${loc.currency})`]],
        body: plRows,
        theme: "grid",
        headStyles: { fillColor: [143, 170, 220] },
    })

    // ---- Balance Sheet ----
    if (data.balance_sheet.length > 0) {
        doc.addPage()
        section(doc, `Balance Sheet inputs — FY ${data.period.fyLabel}`, 50)
        autoTable(doc, {
            startY: 70,
            head: [["Section", "Sub-section", "Head", "Opening", "Closing"]],
            body: data.balance_sheet.map((b) => [
                b.section,
                b.sub_section,
                b.head,
                money(b.opening),
                money(b.closing),
            ]),
            theme: "grid",
            headStyles: { fillColor: [180, 167, 214] },
        })
    }

    // Footer with page numbers
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

function fmtDate(iso: string, locale: string): string {
    try {
        return new Date(iso).toLocaleDateString(locale)
    } catch {
        return new Date(iso).toLocaleDateString("en-GB")
    }
}

function section(doc: jsPDF, title: string, y: number) {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    doc.setTextColor(31, 78, 120)
    doc.text(title, 40, y)
    doc.setTextColor(0, 0, 0)
    doc.setFont("helvetica", "normal")
}
