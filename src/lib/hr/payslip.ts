"use client"

/**
 * Salary-slip design + PDF renderer.
 *
 * The admin picks a TEMPLATE and customises it on /settings/payslip-design;
 * the resolved `PayslipDesign` (template + options + accent) is stored under
 * `tenants.settings.payslip_design` (mirrors bill-design). Staff always
 * download in the SAVED format — or the professional default ("classic") when
 * the admin hasn't chosen one. Three genuinely distinct, formal layouts so the
 * slip reads as a real, employer-issued document (logo, reference number, pay
 * period + pay date, net-in-words, authorised-signatory line, system-generated
 * footnote) — never a flimsy/forged-looking page.
 */

import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

import { formatCurrency } from "@/lib/utils"
import { amountInWords } from "@/lib/hr/salary"
import { formatMinutesAsHours } from "@/lib/hr/attendance"
import type { HrEmployee, HrPayslip } from "@/types/database"

export type PayslipTemplate = "classic" | "modern" | "corporate"

export interface PayslipDesign {
    template: PayslipTemplate
    accent_color: string
    show_logo: boolean
    show_employee_code: boolean
    show_designation: boolean
    show_department: boolean
    show_doj: boolean
    show_pay_date: boolean
    show_attendance_summary: boolean
    show_bank_details: boolean
    show_pan: boolean
    show_net_in_words: boolean
    show_signatory: boolean
    signatory_label: string
    footer_message: string
}

export const DEFAULT_PAYSLIP_DESIGN: PayslipDesign = {
    template: "classic",
    accent_color: "#1f4e78",
    show_logo: true,
    show_employee_code: true,
    show_designation: true,
    show_department: true,
    show_doj: true,
    show_pay_date: true,
    show_attendance_summary: true,
    show_bank_details: true,
    show_pan: true,
    show_net_in_words: true,
    show_signatory: true,
    signatory_label: "Authorised Signatory",
    footer_message: "This is a computer-generated payslip and does not require a signature.",
}

/** Selectable formats shown as tiles in the designer. Each carries the
 *  partial design tweaks that define its look; the admin's toggles + accent
 *  layer on top. */
export interface PayslipTemplateMeta {
    id: PayslipTemplate
    name: string
    blurb: string
    accent: string
}
export const PAYSLIP_TEMPLATES: PayslipTemplateMeta[] = [
    { id: "classic", name: "Classic", blurb: "Bold colour header band, two-column breakdown. The safe corporate default.", accent: "#1f4e78" },
    { id: "modern", name: "Modern", blurb: "Clean minimal header with a side accent and roomy typography.", accent: "#0f766e" },
    { id: "corporate", name: "Corporate", blurb: "Fully bordered, formal document with a centred title and signatory block.", accent: "#334155" },
]

export function migratePayslipDesign(stored: Record<string, unknown> | undefined | null): PayslipDesign {
    return { ...DEFAULT_PAYSLIP_DESIGN, ...(stored ?? {}) } as PayslipDesign
}

// ── Logo loading (async; the page calls this before download) ───────────────
export interface LoadedLogo { dataUrl: string; width: number; height: number; format: "PNG" | "JPEG" }

export async function fetchLogo(url: string | null | undefined): Promise<LoadedLogo | null> {
    if (!url) return null
    try {
        const res = await fetch(url)
        if (!res.ok) return null
        const blob = await res.blob()
        const dataUrl = await new Promise<string>((resolve, reject) => {
            const r = new FileReader()
            r.onloadend = () => resolve(r.result as string)
            r.onerror = reject
            r.readAsDataURL(blob)
        })
        const dims = await new Promise<{ w: number; h: number }>((resolve) => {
            const img = new Image()
            img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 })
            img.onerror = () => resolve({ w: 1, h: 1 })
            img.src = dataUrl
        })
        return { dataUrl, width: dims.w, height: dims.h, format: blob.type.includes("png") ? "PNG" : "JPEG" }
    } catch {
        return null
    }
}

// ── Shared helpers ──────────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex ?? "").trim())
    if (!m) return [31, 78, 120]
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

export function periodLabel(periodMonth: string): string {
    const [y, m] = periodMonth.split("-").map(Number)
    return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })
}

function payslipRef(periodMonth: string, empCode: string | null, id: string): string {
    const ym = periodMonth.slice(0, 7).replace("-", "")
    const tail = (empCode && empCode.trim()) ? empCode.trim().toUpperCase() : id.slice(0, 6).toUpperCase()
    return `PS-${ym}-${tail}`
}

function finalY(doc: jsPDF): number {
    return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
}

/**
 * Money formatted for the PDF. jsPDF's built-in Helvetica has NO ₹ (U+20B9)
 * glyph — it renders as a broken box and wrecks digit kerning (the "¹29,423.0"
 * artefact). For INR we therefore build the amount as a PLAIN grouped decimal
 * and prefix an ASCII "Rs " — the ₹ symbol is never produced, so there's
 * nothing for the font to choke on. Other currencies ($, £, €) are in the
 * core font's WinAnsi set, so `formatCurrency` is fine for them.
 */
export function pdfMoney(value: number, currency: string): string {
    const n = Number(value)
    const safe = Number.isFinite(n) ? n : 0
    if ((currency || "INR").toUpperCase() === "INR") {
        const num = new Intl.NumberFormat("en-IN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(safe)
        return `Rs ${num}`
    }
    return formatCurrency(safe, currency)
}

/** First wrapped line of `text` within `maxWidth` — keeps a long company
 *  address to a single line so it can't overlap the row below it. */
function firstLine(doc: jsPDF, text: string, maxWidth: number): string {
    const lines = doc.splitTextToSize(text, maxWidth) as string[]
    return lines[0] ?? text
}

export interface PayslipPdfInput {
    tenant: { name: string; addressLines: string[]; currency: string; gstin?: string | null }
    employee: Pick<HrEmployee,
        "full_name" | "emp_code" | "designation" | "department" | "date_of_joining" |
        "bank_name" | "bank_account" | "bank_ifsc" | "pan">
    payslip: HrPayslip
    design: PayslipDesign
    logo?: LoadedLogo | null
}

interface Ctx {
    doc: jsPDF
    w: number
    h: number
    accent: [number, number, number]
    money: (v: number) => string
    refNo: string
    input: PayslipPdfInput
}

export function buildPayslipPdf(input: PayslipPdfInput): Uint8Array {
    const { payslip, tenant } = input
    const doc = new jsPDF({ unit: "pt", format: "a4" })
    const ctx: Ctx = {
        doc,
        w: doc.internal.pageSize.getWidth(),
        h: doc.internal.pageSize.getHeight(),
        accent: hexToRgb(input.design.accent_color),
        money: (v: number) => pdfMoney(v, payslip.currency || tenant.currency),
        refNo: payslipRef(payslip.period_month, input.employee.emp_code, payslip.id),
        input,
    }

    let bodyTop: number
    if (input.design.template === "modern") bodyTop = renderModernHeader(ctx)
    else if (input.design.template === "corporate") bodyTop = renderCorporateHeader(ctx)
    else bodyTop = renderClassicHeader(ctx)

    const afterDetails = renderEmployeeBlock(ctx, bodyTop)
    const afterAtt = renderAttendance(ctx, afterDetails)
    const afterBreak = renderBreakdown(ctx, afterAtt)
    const afterNet = renderNet(ctx, afterBreak)
    renderFooter(ctx, afterNet)

    return new Uint8Array(doc.output("arraybuffer"))
}

// ── Headers (per template) ──────────────────────────────────────────────────
function drawLogo(ctx: Ctx, x: number, y: number, maxH: number): number {
    const { doc, input } = ctx
    const logo = input.logo
    if (!input.design.show_logo || !logo) return 0
    const ratio = logo.width / logo.height
    const hh = maxH
    const ww = Math.min(120, hh * ratio)
    try { doc.addImage(logo.dataUrl, logo.format, x, y, ww, hh) } catch { /* ignore broken logo */ }
    return ww
}

function renderClassicHeader(ctx: Ctx): number {
    const { doc, w, accent, input, refNo } = ctx
    doc.setFillColor(accent[0], accent[1], accent[2])
    doc.rect(0, 0, w, 92, "F")
    // logo top-right (works on the colour band when the logo has its own bg)
    drawLogo(ctx, w - 150, 16, 40)
    doc.setTextColor(255, 255, 255)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(18)
    doc.text(input.tenant.name, 40, 36)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8.5)
    const addr = input.tenant.addressLines.filter(Boolean).join(", ")
    if (addr) doc.text(firstLine(doc, addr, w - 200), 40, 52)
    if (input.tenant.gstin) doc.text(`GSTIN: ${input.tenant.gstin}`, 40, 64)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(12)
    doc.text(`Payslip — ${periodLabel(input.payslip.period_month)}`, 40, 82)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.text(`Ref: ${refNo}`, w - 40, 82, { align: "right" })
    doc.setTextColor(0, 0, 0)
    return 112
}

function renderModernHeader(ctx: Ctx): number {
    const { doc, w, h, accent, input, refNo } = ctx
    // side accent bar
    doc.setFillColor(accent[0], accent[1], accent[2])
    doc.rect(0, 0, 10, h, "F")
    let x = 40
    const logoW = drawLogo(ctx, x, 30, 38)
    if (logoW) x += logoW + 12
    doc.setTextColor(20, 20, 20)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(20)
    doc.text(input.tenant.name, x, 46)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8.5)
    doc.setTextColor(110, 110, 110)
    const addr = input.tenant.addressLines.filter(Boolean).join(", ")
    if (addr) doc.text(firstLine(doc, addr, w - x - 40), x, 60)
    // accent rule + title
    doc.setDrawColor(accent[0], accent[1], accent[2])
    doc.setLineWidth(2)
    doc.line(40, 78, w - 40, 78)
    doc.setTextColor(accent[0], accent[1], accent[2])
    doc.setFont("helvetica", "bold")
    doc.setFontSize(13)
    doc.text(`PAYSLIP · ${periodLabel(input.payslip.period_month).toUpperCase()}`, 40, 96)
    doc.setTextColor(110, 110, 110)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.text(`Ref: ${refNo}`, w - 40, 96, { align: "right" })
    doc.setTextColor(0, 0, 0)
    return 114
}

function renderCorporateHeader(ctx: Ctx): number {
    const { doc, w, h, accent, input, refNo } = ctx
    // full page frame
    doc.setDrawColor(accent[0], accent[1], accent[2])
    doc.setLineWidth(1.2)
    doc.rect(24, 24, w - 48, h - 48)
    const logoW = drawLogo(ctx, 40, 40, 42)
    const tx = 40 + (logoW ? logoW + 12 : 0)
    doc.setTextColor(30, 30, 30)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(15)
    doc.text(input.tenant.name, tx, 56)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.setTextColor(90, 90, 90)
    const addr = input.tenant.addressLines.filter(Boolean).join(", ")
    if (addr) doc.text(firstLine(doc, addr, w - tx - 40), tx, 70)
    if (input.tenant.gstin) doc.text(firstLine(doc, `GSTIN: ${input.tenant.gstin}`, w - tx - 40), tx, 81)
    // centred title with rule
    doc.setDrawColor(accent[0], accent[1], accent[2])
    doc.setLineWidth(0.8)
    doc.line(40, 94, w - 40, 94)
    doc.setTextColor(accent[0], accent[1], accent[2])
    doc.setFont("helvetica", "bold")
    doc.setFontSize(13)
    doc.text("SALARY SLIP", w / 2, 112, { align: "center" })
    doc.setTextColor(70, 70, 70)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.text(`Pay period: ${periodLabel(input.payslip.period_month)}`, 40, 128)
    doc.text(`Ref: ${refNo}`, w - 40, 128, { align: "right" })
    doc.setTextColor(0, 0, 0)
    return 142
}

// ── Sections ────────────────────────────────────────────────────────────────
function renderEmployeeBlock(ctx: Ctx, top: number): number {
    const { doc, w, input } = ctx
    const e = input.employee
    const d = input.design
    const p = input.payslip
    const left: string[][] = [["Employee", e.full_name]]
    if (d.show_employee_code && e.emp_code) left.push(["Code", e.emp_code])
    if (d.show_designation && e.designation) left.push(["Designation", e.designation])
    if (d.show_department && e.department) left.push(["Department", e.department])

    const right: string[][] = []
    if (d.show_doj && e.date_of_joining) right.push(["Date of joining", e.date_of_joining])
    if (d.show_pay_date) right.push(["Pay date", p.finalized_at ? p.finalized_at.slice(0, 10) : "—"])
    if (d.show_pan && e.pan) right.push(["PAN", e.pan])
    right.push(["Pay period", periodLabel(p.period_month)])

    const theme = input.design.template === "corporate" ? "grid" : "plain"
    autoTable(doc, {
        startY: top,
        body: left,
        theme,
        styles: { fontSize: 9, cellPadding: input.design.template === "corporate" ? 4 : 2 },
        columnStyles: { 0: { fontStyle: "bold", textColor: [90, 90, 90], cellWidth: 90 } },
        margin: { left: 40, right: w / 2 + 6 },
        tableWidth: w / 2 - 46,
    })
    const leftEnd = finalY(doc)
    autoTable(doc, {
        startY: top,
        body: right,
        theme,
        styles: { fontSize: 9, cellPadding: input.design.template === "corporate" ? 4 : 2 },
        columnStyles: { 0: { fontStyle: "bold", textColor: [90, 90, 90], cellWidth: 90 } },
        margin: { left: w / 2 + 6, right: 40 },
        tableWidth: w / 2 - 46,
    })
    return Math.max(leftEnd, finalY(doc)) + 12
}

function renderAttendance(ctx: Ctx, top: number): number {
    const { doc, w, accent, input } = ctx
    if (!input.design.show_attendance_summary) return top
    const p = input.payslip
    autoTable(doc, {
        startY: top,
        head: [["Working", "Present", "Half", "Leave", "Holiday", "Wk-off", "Absent", "Payable", "Worked"]],
        body: [[
            String(p.working_days), String(p.present_days), String(p.half_days), String(p.leave_days),
            String(p.holiday_days), String(p.weekly_off_days), String(p.absent_days), String(p.payable_days),
            formatMinutesAsHours(p.worked_minutes),
        ]],
        theme: "grid",
        headStyles: { fillColor: accent, fontSize: 7.5, halign: "center" },
        styles: { fontSize: 8, halign: "center" },
        margin: { left: 40, right: 40 },
        tableWidth: w - 80,
    })
    return finalY(doc) + 12
}

function renderBreakdown(ctx: Ctx, top: number): number {
    const { doc, w, accent, input, money } = ctx
    const p = input.payslip
    const theme = input.design.template === "modern" ? "striped" : "grid"

    const earnRows = p.earnings.map((l) => [l.name, money(l.amount)])
    earnRows.push(["Gross earnings", money(p.gross_earnings)])
    const dedRows = p.deductions.length ? p.deductions.map((l) => [l.name, money(l.amount)]) : [["No deductions", money(0)]]
    dedRows.push(["Total deductions", money(p.total_deductions)])

    autoTable(doc, {
        startY: top,
        head: [["Earnings", "Amount"]],
        body: earnRows,
        theme,
        headStyles: { fillColor: accent, halign: "left", textColor: 255 },
        columnStyles: { 1: { halign: "right" } },
        styles: { fontSize: 9 },
        margin: { left: 40, right: w / 2 + 6 },
        tableWidth: w / 2 - 46,
        didParseCell: (data) => { if (data.section === "body" && data.row.index === earnRows.length - 1) data.cell.styles.fontStyle = "bold" },
    })
    const earnEnd = finalY(doc)
    autoTable(doc, {
        startY: top,
        head: [["Deductions", "Amount"]],
        body: dedRows,
        theme,
        headStyles: { fillColor: accent, halign: "left", textColor: 255 },
        columnStyles: { 1: { halign: "right" } },
        styles: { fontSize: 9 },
        margin: { left: w / 2 + 6, right: 40 },
        tableWidth: w / 2 - 46,
        didParseCell: (data) => { if (data.section === "body" && data.row.index === dedRows.length - 1) data.cell.styles.fontStyle = "bold" },
    })
    return Math.max(earnEnd, finalY(doc)) + 14
}

function renderNet(ctx: Ctx, top: number): number {
    const { doc, w, accent, input, money } = ctx
    const p = input.payslip
    doc.setFillColor(accent[0], accent[1], accent[2])
    doc.rect(40, top, w - 80, 30, "F")
    doc.setTextColor(255, 255, 255)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(12)
    doc.text("NET PAY", 54, top + 20)
    doc.text(money(p.net_pay), w - 54, top + 20, { align: "right" })
    let y = top + 30
    doc.setTextColor(0, 0, 0)
    if (input.design.show_net_in_words) {
        doc.setFont("helvetica", "italic")
        doc.setFontSize(9)
        doc.text(amountInWords(p.net_pay, p.currency), 40, y + 16, { maxWidth: w - 80 })
        y += 22
    }
    return y
}

function renderFooter(ctx: Ctx, top: number) {
    const { doc, w, h, input } = ctx
    const e = input.employee
    const d = input.design
    let y = top + 6
    if (d.show_bank_details && (e.bank_account || e.bank_name)) {
        const parts = [e.bank_name, e.bank_account ? `A/C ${e.bank_account}` : null, e.bank_ifsc ? `IFSC ${e.bank_ifsc}` : null].filter(Boolean)
        doc.setFont("helvetica", "normal")
        doc.setFontSize(8.5)
        doc.setTextColor(70, 70, 70)
        doc.text(`Bank: ${parts.join("  ·  ")}`, 40, y + 8)
        y += 16
    }
    // Authorised signatory — bottom-right, above the footnote.
    if (d.show_signatory) {
        const sy = h - 78
        doc.setDrawColor(120, 120, 120)
        doc.setLineWidth(0.6)
        doc.line(w - 200, sy, w - 40, sy)
        doc.setTextColor(90, 90, 90)
        doc.setFont("helvetica", "normal")
        doc.setFontSize(8.5)
        doc.text(d.signatory_label, w - 120, sy + 14, { align: "center" })
        doc.text(input.tenant.name, w - 120, sy + 26, { align: "center" })
    }
    if (d.footer_message) {
        doc.setFont("helvetica", "italic")
        doc.setFontSize(7.5)
        doc.setTextColor(140, 140, 140)
        doc.text(d.footer_message, w / 2, h - 34, { align: "center", maxWidth: w - 80 })
    }
}

/** Build + trigger a browser download. */
export function downloadPayslip(input: PayslipPdfInput) {
    const bytes = buildPayslipPdf(input)
    // Cast: a Uint8Array is a valid BlobPart at runtime; the DOM lib's
    // ArrayBufferLike-vs-ArrayBuffer typing is stricter than reality.
    const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    const safeName = input.employee.full_name.replace(/[^\w]+/g, "-")
    a.href = url
    a.download = `payslip-${safeName}-${input.payslip.period_month.slice(0, 7)}.pdf`
    a.click()
    URL.revokeObjectURL(url)
}
