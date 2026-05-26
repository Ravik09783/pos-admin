/**
 * Country-aware presentation for the CA / tax-export bundle.
 *
 * The export builders (excel.ts, pdf.ts, the CSV in tax-reports/registry.ts)
 * were originally written India-first: hard-coded ₹, CGST/SGST/IGST columns,
 * "GSTR-1 / GSTR-3B" sheet names, "GSTIN / PAN / FSSAI" identity labels. That
 * is correct for an Indian restaurant and meaningless — or outright wrong —
 * for a UK / US / UAE one.
 *
 * This helper turns a tenant's country into the labels, currency and tax-
 * column layout each builder needs, so a single code path produces a
 * jurisdiction-correct file:
 *
 *   - India  (taxModel "split")  → ₹, three tax columns CGST/SGST/IGST,
 *                                  the full GSTR statutory pack.
 *   - VAT / Sales-Tax countries  (taxModel "single") → local currency, ONE
 *                                  combined tax column ("VAT" / "Sales Tax" …).
 *   - "Other / no tax"           (taxModel "none")    → no tax columns at all.
 *
 * Source of truth for every country fact is src/lib/tax/locale-config.ts.
 */

import { getTaxConfig, type CountryTaxConfig, type TaxModel } from "@/lib/tax/locale-config"

export interface ExportLocale {
    cfg: CountryTaxConfig
    /** True only for India — gates the GST statutory artefacts (GSTR-1 JSON,
     *  GSTR-3B working sheet, "Table 4/7/12" references, HSN summary). */
    isIndia: boolean
    taxModel: TaxModel
    /** ISO-4217 code — pass to formatCurrency(). */
    currency: string
    /** Symbol only ("₹", "$", "£", "€" …) for Excel number formats. */
    currencySymbol: string
    /** Excel numFmt string for money, e.g. '"$"#,##0.00'. */
    excelCurrencyFmt: string
    /** Generic tax name — "GST", "VAT", "Sales Tax", "TVA" … */
    taxName: string
    /** Heading for the tax-registration number — "GSTIN", "VAT Number" … */
    taxIdLabel: string
    /** Column headings for the tax breakdown in registers:
     *  split  → ["CGST", "SGST", "IGST"]
     *  single → ["VAT"] (or whatever the country calls its single rate)
     *  none   → []  */
    taxColumns: string[]
}

/** Best-effort currency symbol via Intl; falls back to the ISO code. */
function symbolFor(currency: string): string {
    try {
        const parts = new Intl.NumberFormat("en", { style: "currency", currency })
            .formatToParts(0)
        return parts.find((p) => p.type === "currency")?.value ?? currency
    } catch {
        return currency
    }
}

export function exportLocale(country: string | null | undefined): ExportLocale {
    const cfg = getTaxConfig(country)
    const symbol = symbolFor(cfg.currency)
    const taxColumns =
        cfg.taxModel === "split"
            ? [cfg.taxLabels.cgst ?? "CGST", cfg.taxLabels.sgst ?? "SGST", cfg.taxLabels.igst ?? "IGST"]
            : cfg.taxModel === "single"
                ? [cfg.taxLabels.single ?? cfg.taxShortName]
                : []
    return {
        cfg,
        isIndia: cfg.code === "IN",
        taxModel: cfg.taxModel,
        currency: cfg.currency,
        currencySymbol: symbol,
        excelCurrencyFmt: `"${symbol}"#,##0.00`,
        taxName: cfg.taxShortName,
        taxIdLabel: cfg.taxIdLabel,
        taxColumns,
    }
}

type TaxTriple = { cgst_amount: number; sgst_amount: number; igst_amount: number }

/**
 * Tax amounts aligned 1:1 with `taxColumns`.
 *   split  → [cgst, sgst, igst]
 *   single → [cgst + sgst + igst]   (single-rate bills carry the whole tax in
 *            igst_amount — see generate_bill's `v_use_igst` path — so summing
 *            all three is correct and order-independent)
 *   none   → []
 */
export function taxCells(loc: ExportLocale, t: TaxTriple): number[] {
    if (loc.taxModel === "split") return [t.cgst_amount, t.sgst_amount, t.igst_amount]
    if (loc.taxModel === "single") return [combinedTax(t)]
    return []
}

/** Total tax on a row regardless of model — cgst + sgst + igst. */
export function combinedTax(t: TaxTriple): number {
    return t.cgst_amount + t.sgst_amount + t.igst_amount
}
