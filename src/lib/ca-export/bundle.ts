"use client"

import JSZip from "jszip"
import { saveAs } from "file-saver"

import { formatCurrency } from "@/lib/utils"
import { buildExcelWorkbook } from "./excel"
import { buildGSTR1Json } from "./gst-portal"
import { exportLocale, type ExportLocale } from "./locale"
import { buildPdfReport } from "./pdf"
import { buildTallyXml } from "./tally"
import type { ExportDataset } from "./types"

interface BundleOptions {
    excel?: boolean
    tally?: boolean
    gstPortal?: boolean
    pdf?: boolean
    /** Include README.txt with filing instructions. */
    readme?: boolean
}

/**
 * Generate the full bundle and trigger a browser download. Returns the ZIP blob
 * for callers that want to upload/email it instead.
 *
 * The default contents depend on the tenant's country: the Tally XML and
 * GSTR-1 JSON are Indian-GST artefacts, so they are only bundled for Indian
 * restaurants. A UK / US / UAE restaurant gets the universal Excel + PDF
 * (their accountant can't file an Indian GSTR-1). Callers can still force a
 * file in/out via the explicit `opts` flags.
 */
export async function downloadCABundle(
    data: ExportDataset,
    opts?: BundleOptions,
): Promise<Blob> {
    const loc = exportLocale(data.tenant.country)
    // Country-aware defaults: India-only formats off for everyone else.
    const include: Required<BundleOptions> = {
        excel: opts?.excel ?? true,
        pdf: opts?.pdf ?? true,
        readme: opts?.readme ?? true,
        tally: opts?.tally ?? loc.isIndia,
        gstPortal: opts?.gstPortal ?? loc.isIndia,
    }

    const zip = new JSZip()
    const slug = `${slugify(data.tenant.name)}_${data.period.fyLabel}_${String(data.period.monthNum).padStart(2, "0")}`

    if (include.excel) {
        const buf = await buildExcelWorkbook(data)
        zip.file(`${slug}_Tax_Filing.xlsx`, buf)
    }
    if (include.tally) {
        zip.file(`${slug}_Tally_Vouchers.xml`, buildTallyXml(data))
    }
    if (include.gstPortal) {
        zip.file(`${slug}_GSTR1_Portal.json`, buildGSTR1Json(data))
    }
    if (include.pdf) {
        zip.file(`${slug}_Filing_Summary.pdf`, buildPdfReport(data))
    }
    if (include.readme) {
        zip.file(`README.txt`, buildReadme(data, loc, include))
    }

    const blob = await zip.generateAsync({ type: "blob" })
    saveAs(blob, `${slug}_Tax_Bundle.zip`)
    return blob
}

function slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "")
}

function buildReadme(data: ExportDataset, loc: ExportLocale, include: Required<BundleOptions>): string {
    const netPayable = formatCurrency(data.summary.net_tax_payable, loc.currency)

    // File list — only mention the files that were actually bundled.
    const files: string[] = []
    let n = 1
    if (include.excel) {
        files.push(`${n++}. *_Tax_Filing.xlsx        — Multi-sheet workbook
                              · Summary
                              · Sales Register
                              · Sales Item Detail
                              · ${loc.isIndia ? "GSTR-1 Working (Tables 4, 7, 12)" : "Tax Working (B2B / B2C / by rate)"}
                              · ${loc.isIndia ? "GSTR-3B Working" : "Tax Summary"}
                              · Purchase Register
                              · Expenses
                              · P&L Statement
                              · Balance Sheet inputs`)
    }
    if (include.tally) {
        files.push(`${n++}. *_Tally_Vouchers.xml     — Tally Prime / ERP 9 import file
                              · Sales vouchers (one per invoice)
                              · Purchase vouchers (one per vendor invoice)
                              · Use Tally → Gateway → Import → XML`)
    }
    if (include.gstPortal) {
        files.push(`${n++}. *_GSTR1_Portal.json      — GSTR-1 in offline-utility schema (v3.0.4)
                              · Validate via gst.gov.in offline tool
                              · Tables: B2B (4), B2C-Large (5), B2C-Small (7),
                                HSN (12), Document Issued summary`)
    }
    if (include.pdf) {
        files.push(`${n++}. *_Filing_Summary.pdf     — Human-readable filing summary`)
    }

    // Filing checklist — India keeps the statutory GSTR deadlines; everyone
    // else gets generic guidance (deadlines vary by jurisdiction).
    const checklist = loc.isIndia
        ? `[ ] Open the .xlsx and verify totals on the "Summary" sheet
[ ] Check the "GSTR-3B" sheet for net tax payable
[ ] Validate the GSTR-1 JSON in the offline utility
[ ] Review purchase register for ITC eligibility flags
[ ] Confirm balance sheet entries are populated for the FY
[ ] File GSTR-1 (by 11th of next month)
[ ] File GSTR-3B and pay tax (by 20th of next month)
[ ] Sign and reconcile the P&L`
        : `[ ] Open the .xlsx and verify totals on the "Summary" sheet
[ ] Check the "Tax Summary" sheet for net ${loc.taxName} payable
[ ] Review the purchase register for input-tax-credit eligibility
[ ] Confirm balance sheet entries are populated for the FY
[ ] File your ${loc.taxName} return with ${authorityFor(loc)} by your jurisdiction's deadline
[ ] Sign and reconcile the P&L`

    return `RestoPOS — Tax Filing Bundle
============================
Restaurant : ${data.tenant.name}
Country    : ${loc.cfg.name}
${loc.taxIdLabel.padEnd(11)}: ${data.tenant.gstin ?? "—"}
Period     : ${data.period.label}
FY         : ${data.period.fyLabel}
Generated  : ${new Date().toISOString()}

Files in this bundle
--------------------
${files.join("\n\n")}

Filing checklist
----------------
${checklist}

Net ${loc.taxName} payable for ${data.period.label}: ${netPayable}

Note: these files are a working pack for your accountant to review and file —
they are not a signed, submitted return. Tax rates, return formats and
deadlines are those configured for ${loc.cfg.name}; confirm them with a
qualified accountant before filing.

Questions? Contact the restaurant owner — every bill in the Sales Register has
a full audit trail viewable from the RestoPOS dashboard.
`
}

/** A friendly authority name for the README, mirroring the report registry. */
function authorityFor(loc: ExportLocale): string {
    const map: Record<string, string> = {
        GB: "HMRC", AE: "the FTA", SA: "ZATCA", US: "the IRS / your state",
        AU: "the ATO", SG: "IRAS", CA: "the CRA", NZ: "the IRD",
    }
    return map[loc.cfg.code] ?? "your tax authority"
}
