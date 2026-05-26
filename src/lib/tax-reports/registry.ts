/**
 * Tax-report registry — single source of truth for "given a restaurant's
 * country, which downloadable report formats should the CA-export page
 * offer, and what does each one produce?"
 *
 * Why this file exists
 * --------------------
 * The original CA-export was hard-coded to India: GSTR-1 JSON, Tally XML,
 * the GST-portal Excel workbook. A UK restaurant clicking "GSTR-1 JSON"
 * would get a file their accountant can't use. This registry tells the
 * page which downloads are RELEVANT to the tenant's country and what to
 * label each button with.
 *
 * Adding a new country / format
 * -----------------------------
 *   1. Pick or create a format function that turns an ExportDataset into a
 *      Blob (or a build-XXX function that returns bytes / a string).
 *   2. Register a `ReportFormat` entry — `id`, `label`, `description`,
 *      `fileExtension`, and a `build()` that returns `{ blob, filename }`.
 *      Format ids must be globally unique (used as React keys + URL slugs).
 *   3. Add the format to the country block in `REPORT_REGISTRY` below, in
 *      the order you want it to appear in the UI. The FIRST format is the
 *      "default" — its label is what the big primary button shows.
 *
 * What lives where
 * ----------------
 *   - The actual file builders (Excel, PDF, JSON, XML) stay in
 *     src/lib/ca-export/*.ts — this file just maps them to country lists.
 *   - The CA-export page imports `getReportFormatsForCountry()` and
 *     `BUNDLE_FORMAT` and renders them. It doesn't know about countries.
 */

import { getTaxConfig } from "@/lib/tax/locale-config"
import { exportLocale, taxCells } from "@/lib/ca-export/locale"
import type { ExportDataset } from "@/lib/ca-export/types"

/** Loose enum of the file types we produce. Used for icon selection in the UI. */
export type ReportFileExtension = "pdf" | "xlsx" | "json" | "xml" | "zip" | "csv"

export interface ReportFormat {
    /** Globally unique id — used as React key and stable across deploys. */
    id: string
    /** Short label, shown on the download card and dropdown. Country-specific
     *  so an admin knows what they're getting — e.g. "GSTR-1 JSON" for India,
     *  "MTD VAT Return" for UK. Localised to the tenant's tax authority. */
    label: string
    /** One-line explainer for tooltips / card body. What the file is for. */
    description: string
    /** Drives the icon picked in the UI (Excel / PDF / JSON / XML / ZIP). */
    fileExtension: ReportFileExtension
    /** Produces the file. Implementations live in src/lib/ca-export/*. */
    build: (dataset: ExportDataset) => Promise<{ blob: Blob; filename: string }>
    /** Hidden from the per-country cards but selectable via the
     *  "Download in any format" dropdown. Use for niche / experimental
     *  formats you don't want to default-promote. Default false. */
    advanced?: boolean
}

export interface CountryReportConfig {
    /** ISO 3166-1 alpha-2 code. "OTHER" is the fallback bucket. */
    countryCode: string
    /** Display label for the country in any UI banner. */
    countryLabel: string
    /** What the tax authority is called in this country — used in the
     *  CA-export page header ("Tax reports for HMRC / GST council / IRS"). */
    authorityLabel: string
    /** Available formats, in display order. The first entry is the
     *  "default" — its label feeds the primary button. */
    formats: ReportFormat[]
}

// =========================================================================
//  Filename helper — every builder slugs the same way
// =========================================================================

function slugFilename(dataset: ExportDataset, name: string, ext: string): string {
    const tenantSlug = dataset.tenant.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/(^_|_$)/g, "") || "restaurant"
    const month = String(dataset.period.monthNum).padStart(2, "0")
    return `${tenantSlug}_${dataset.period.fyLabel}_${month}_${name}.${ext}`
}

// =========================================================================
//  Format adapters — wrap the existing builders
//
//  Each adapter is async + lazy-imports the heavy library so the CA-export
//  page's initial bundle stays small. The browser only downloads ExcelJS /
//  jsPDF / JSZip when the admin actually clicks a button that uses them.
// =========================================================================

/** Indian GSTR-1 in offline-utility JSON schema. */
const formatGstr1Json: ReportFormat = {
    id: "in-gstr1-json",
    label: "GSTR-1 JSON",
    description: "GSTR-1 in offline-utility format (v3.0.4) — uploads straight into the GST portal validator.",
    fileExtension: "json",
    async build(dataset) {
        const { buildGSTR1Json } = await import("@/lib/ca-export/gst-portal")
        const json = buildGSTR1Json(dataset)
        return {
            blob: new Blob([json], { type: "application/json" }),
            filename: slugFilename(dataset, "GSTR1_Portal", "json"),
        }
    },
}

/** Tally Prime / ERP 9 voucher XML. */
const formatTallyXml: ReportFormat = {
    id: "in-tally-xml",
    label: "Tally XML",
    description: "Sales + purchase vouchers ready to import via Tally → Gateway → Import → XML.",
    fileExtension: "xml",
    async build(dataset) {
        const { buildTallyXml } = await import("@/lib/ca-export/tally")
        const xml = buildTallyXml(dataset)
        return {
            blob: new Blob([xml], { type: "application/xml" }),
            filename: slugFilename(dataset, "Tally_Vouchers", "xml"),
        }
    },
}

/** Universal: a multi-sheet Excel workbook with sales, GST/VAT working,
 *  purchase register, P&L and balance sheet. Useful in every country. */
const formatExcelWorkbook: ReportFormat = {
    id: "excel-workbook",
    label: "Excel workbook",
    description: "Sales + tax working + purchase register + P&L + balance sheet in one .xlsx file.",
    fileExtension: "xlsx",
    async build(dataset) {
        const { buildExcelWorkbook } = await import("@/lib/ca-export/excel")
        const buf = await buildExcelWorkbook(dataset)
        return {
            blob: new Blob(
                [buf],
                { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
            ),
            filename: slugFilename(dataset, "Tax_Filing", "xlsx"),
        }
    },
}

/** Universal: PDF summary, human-readable, printable. */
const formatPdfSummary: ReportFormat = {
    id: "pdf-filing-summary",
    label: "PDF summary",
    description: "Human-readable filing summary with all tables — ready to print or email.",
    fileExtension: "pdf",
    async build(dataset) {
        const { buildPdfReport } = await import("@/lib/ca-export/pdf")
        const buf = buildPdfReport(dataset)
        return {
            blob: new Blob([buf as BlobPart], { type: "application/pdf" }),
            filename: slugFilename(dataset, "Filing_Summary", "pdf"),
        }
    },
}

/** Universal: sales register as plain CSV. Handy when the accountant has a
 *  spreadsheet template of their own and just needs the raw rows. The tax
 *  columns follow the tenant's country — three (CGST/SGST/IGST) for India,
 *  one combined column for VAT/Sales-Tax countries, none for "no tax". */
const formatSalesCsv: ReportFormat = {
    id: "sales-csv",
    label: "Sales register (CSV)",
    description: "One row per bill, all amounts + tax columns. Opens in Excel / Google Sheets / Numbers.",
    fileExtension: "csv",
    advanced: true,
    async build(dataset) {
        const loc = exportLocale(dataset.tenant.country)
        const rows = [
            [
                "Invoice", "Date", "Customer",
                ...(loc.isIndia ? ["Place of supply"] : []),
                "Taxable", ...loc.taxColumns, "Service charge", "Grand total", "Status",
            ],
            ...dataset.sales.map((s) => [
                s.invoice_number,
                s.invoice_date,
                s.customer_name ?? "",
                ...(loc.isIndia ? [s.place_of_supply ?? ""] : []),
                s.taxable_amount.toFixed(2),
                ...taxCells(loc, s).map((n) => n.toFixed(2)),
                s.service_charge.toFixed(2),
                s.grand_total.toFixed(2),
                s.bill_status,
            ]),
        ]
        // Lightweight CSV — quotes around any field containing comma/quote/newline.
        const csv = rows.map((r) =>
            r.map((cell) => {
                const s = String(cell ?? "")
                return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
            }).join(","),
        ).join("\n")
        return {
            blob: new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }),
            filename: slugFilename(dataset, "Sales_Register", "csv"),
        }
    },
}

/** Universal: the full ZIP bundle. Lives outside REPORT_REGISTRY because
 *  the CA-export page renders it as a separate big "Download everything"
 *  card. Re-using the bundle.ts logic verbatim. */
export const BUNDLE_FORMAT: ReportFormat = {
    id: "bundle-zip",
    label: "Full bundle (ZIP)",
    description: "Every supported format for this country in a single ZIP — attach to an email and your CA has everything.",
    fileExtension: "zip",
    async build(dataset) {
        // The existing bundle.ts uses file-saver directly and triggers the
        // download itself; we wrap it here for API consistency with the
        // other formats. The page just calls the builder and is done.
        const { downloadCABundle } = await import("@/lib/ca-export/bundle")
        await downloadCABundle(dataset)
        // bundle.ts already streamed to the user; return an empty blob
        // (the page won't try to saveAs() it — see the special-case in
        // the page handler).
        return { blob: new Blob(), filename: slugFilename(dataset, "CA_Bundle", "zip") }
    },
}

// =========================================================================
//  Country → formats
//
//  Add a block per country you want full coverage for. Anything not listed
//  falls into OTHER, which still produces the universal Excel + PDF + CSV.
// =========================================================================

/** Universal formats every country gets, regardless of tax model. */
const UNIVERSAL_FORMATS: ReportFormat[] = [
    formatExcelWorkbook,
    formatPdfSummary,
    formatSalesCsv,
]

export const REPORT_REGISTRY: Record<string, CountryReportConfig> = {
    IN: {
        countryCode: "IN",
        countryLabel: "India",
        authorityLabel: "GST Council / Tally",
        formats: [
            formatGstr1Json,
            formatTallyXml,
            formatExcelWorkbook,
            formatPdfSummary,
            formatSalesCsv,
        ],
    },
    // Other supported tax-jurisdictions get the universal trio for now.
    // Add country-specific authority formats (e.g. UK MTD VAT, UAE FAF,
    // Singapore IAF, EU SAF-T) by registering new ReportFormat entries
    // above and listing them here in display order.
    GB: {
        countryCode: "GB",
        countryLabel: "United Kingdom",
        authorityLabel: "HMRC",
        formats: UNIVERSAL_FORMATS,
    },
    AE: {
        countryCode: "AE",
        countryLabel: "United Arab Emirates",
        authorityLabel: "FTA",
        formats: UNIVERSAL_FORMATS,
    },
    SA: {
        countryCode: "SA",
        countryLabel: "Saudi Arabia",
        authorityLabel: "ZATCA",
        formats: UNIVERSAL_FORMATS,
    },
    US: {
        countryCode: "US",
        countryLabel: "United States",
        authorityLabel: "IRS",
        formats: UNIVERSAL_FORMATS,
    },
    AU: {
        countryCode: "AU",
        countryLabel: "Australia",
        authorityLabel: "ATO",
        formats: UNIVERSAL_FORMATS,
    },
    SG: {
        countryCode: "SG",
        countryLabel: "Singapore",
        authorityLabel: "IRAS",
        formats: UNIVERSAL_FORMATS,
    },
    OTHER: {
        countryCode: "OTHER",
        countryLabel: "Other",
        authorityLabel: "your tax authority",
        formats: UNIVERSAL_FORMATS,
    },
}

/**
 * Look up the report config for a tenant's country (or fall back to the
 * universal OTHER bucket). Accepts either an ISO code or a country name —
 * we route through `getTaxConfig()` so any string the onboarding accepts
 * resolves to the right bucket.
 */
export function getReportFormatsForCountry(
    countryNameOrCode: string | null | undefined,
): CountryReportConfig {
    const cfg = getTaxConfig(countryNameOrCode)
    // getTaxConfig returns a 2-letter `code`; the registry is keyed by that.
    return REPORT_REGISTRY[cfg.code] ?? REPORT_REGISTRY.OTHER!
}
