/**
 * Sales-register CSV — one row per bill, columns following the tenant's
 * country: three tax columns (CGST/SGST/IGST) for India, one combined
 * column for single-tax countries (VAT/GST/Sales Tax), none for "no tax".
 *
 * Shared by the standalone "Sales register (CSV)" download in
 * src/lib/tax-reports/registry.ts AND the full bundle ZIP in bundle.ts —
 * one implementation so the two can never drift.
 */

import { exportLocale, showBranchColumn, taxCells } from "./locale"
import type { ExportDataset } from "./types"

export function buildSalesCsv(dataset: ExportDataset): string {
    const loc = exportLocale(dataset.tenant.country)
    // A per-row Branch column only when the export spans multiple locations;
    // a single-location export names its branch in the filename + README.
    const withBranch = showBranchColumn(dataset)
    const rows = [
        [
            "Invoice", "Date",
            ...(withBranch ? ["Branch"] : []),
            "Customer",
            ...(loc.taxModel !== "none" ? [`Customer ${loc.taxIdLabel}`] : []),
            ...(loc.isIndia ? ["Place of supply"] : []),
            "Taxable", ...loc.taxColumns, "Service charge", "Grand total", "Status", "Payment",
        ],
        ...dataset.sales.map((s) => [
            s.invoice_number,
            s.invoice_date,
            ...(withBranch ? [s.branch_name ?? ""] : []),
            s.customer_name ?? "",
            ...(loc.taxModel !== "none" ? [s.customer_gstin ?? ""] : []),
            ...(loc.isIndia ? [s.place_of_supply ?? ""] : []),
            s.taxable_amount.toFixed(2),
            ...taxCells(loc, s).map((n) => n.toFixed(2)),
            s.service_charge.toFixed(2),
            s.grand_total.toFixed(2),
            s.bill_status,
            s.payment_methods,
        ]),
    ]
    // Lightweight CSV — quotes around any field containing comma/quote/newline.
    return rows.map((r) =>
        r.map((cell) => {
            const s = String(cell ?? "")
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        }).join(","),
    ).join("\n")
}
