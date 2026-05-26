/**
 * Turns a stored bill + its line items into the shape `<BillPreview>` renders.
 * This is where the country tax model and the chosen `BillDesign` decide which
 * tax lines to print and what to call them — never a hard-coded "GST".
 */

import type { CountryTaxConfig } from "@/lib/tax/locale-config"
import type { BillDesign } from "@/lib/bill/templates"

export interface RenderedBillLine {
    name: string
    hsn?: string | null
    qty: number
    rate: number
    /** Per-line tax rate (%) — used only if the design shows the tax column. */
    taxPct: number
    lineTotal: number
    notes?: string | null
}

export interface RenderedBillData {
    invoiceNumber: string
    date: string | Date
    fyLabel?: string | null
    /** "PAID" | "VOID" | "GENERATED" | … */
    status?: string | null
    /** True for "bill without tax" — suppresses all tax lines & the tax column. */
    taxExcluded?: boolean
    items: RenderedBillLine[]
    subtotal: number
    discount?: number
    taxableAmount?: number
    /** Resolved tax lines to print, in order, with country-correct labels. */
    taxLines: { label: string; amount: number }[]
    serviceCharge?: number
    roundOff?: number
    grandTotal: number
    paid?: number
    balanceDue?: number
    customer?: { name?: string | null; phone?: string | null; taxId?: string | null } | null
    tableNo?: string | null
    serverName?: string | null
}

interface BillLike {
    invoice_number: string
    created_at: string
    fy_label?: string | null
    bill_status?: string | null
    gst_excluded?: boolean | null
    subtotal: number | string
    item_discount?: number | string | null
    order_discount?: number | string | null
    taxable_amount: number | string
    cgst_amount: number | string
    sgst_amount: number | string
    igst_amount: number | string
    is_inter_state?: boolean | null
    service_charge?: number | string | null
    round_off?: number | string | null
    grand_total: number | string
    customer_name?: string | null
    customer_phone?: string | null
    customer_gstin?: string | null
}

interface ItemLike {
    item_name: string
    hsn_code?: string | null
    quantity: number | string
    unit_price: number | string
    gst_slab: number | string
    line_total: number | string
    is_void?: boolean | null
    notes?: string | null
}

const n = (v: number | string | null | undefined) => (typeof v === "string" ? Number(v) : (v ?? 0))

export function billToRenderData(opts: {
    bill: BillLike
    items: ItemLike[]
    cfg: CountryTaxConfig
    design: BillDesign
    extra?: { tableNo?: string | null; serverName?: string | null; paid?: number; balanceDue?: number }
}): RenderedBillData {
    const { bill, items, cfg, design, extra } = opts
    const taxExcluded = !!bill.gst_excluded || cfg.taxModel === "none" || !design.show_tax_breakup

    const cgst = n(bill.cgst_amount)
    const sgst = n(bill.sgst_amount)
    const igst = n(bill.igst_amount)

    let taxLines: { label: string; amount: number }[] = []
    if (!taxExcluded) {
        if (cfg.taxModel === "split") {
            if (bill.is_inter_state) {
                taxLines = [{ label: cfg.taxLabels.igst ?? "IGST", amount: igst }]
            } else if (design.tax_breakup === "combined") {
                taxLines = [{ label: "GST", amount: cgst + sgst }]
            } else {
                taxLines = [
                    { label: cfg.taxLabels.cgst ?? "CGST", amount: cgst },
                    { label: cfg.taxLabels.sgst ?? "SGST", amount: sgst },
                ]
            }
        } else {
            taxLines = [{ label: cfg.taxLabels.single ?? cfg.taxShortName, amount: cgst + sgst + igst }]
        }
    }

    const discount = n(bill.item_discount) + n(bill.order_discount)

    return {
        invoiceNumber: bill.invoice_number,
        date: bill.created_at,
        fyLabel: bill.fy_label ?? null,
        status: bill.bill_status ?? null,
        taxExcluded,
        items: items
            .filter((it) => !it.is_void)
            .map((it) => ({
                name: it.item_name,
                hsn: it.hsn_code ?? null,
                qty: n(it.quantity),
                rate: n(it.unit_price),
                taxPct: n(it.gst_slab),
                lineTotal: n(it.line_total),
                notes: it.notes ?? null,
            })),
        subtotal: n(bill.subtotal),
        discount: discount > 0 ? discount : 0,
        taxableAmount: n(bill.taxable_amount),
        taxLines,
        serviceCharge: n(bill.service_charge),
        roundOff: n(bill.round_off),
        grandTotal: n(bill.grand_total),
        paid: extra?.paid,
        balanceDue: extra?.balanceDue,
        customer: bill.customer_name
            ? { name: bill.customer_name, phone: bill.customer_phone ?? null, taxId: bill.customer_gstin ?? null }
            : null,
        tableNo: extra?.tableNo ?? null,
        serverName: extra?.serverName ?? null,
    }
}
