/**
 * GST tax engine for Indian restaurant invoices.
 *
 * Rules of thumb baked in here:
 *  - Intra-state supply  → CGST + SGST split equally
 *  - Inter-state supply  → IGST charged at full slab
 *  - Round half-up to 2 decimals (matches govt portal expectations)
 *  - Supports tax-inclusive line pricing (back-out the tax from gross)
 */

import Decimal from "decimal.js"

Decimal.set({ rounding: Decimal.ROUND_HALF_UP })

export interface LineInput {
    /** Numeric id (only used to round-trip results back to the caller). */
    line_id?: string | number
    /** Quantity ordered. Must be > 0. */
    quantity: number
    /** Per-unit price. Either net (excluding tax) or gross (inclusive of tax). */
    unit_price: number
    /** Sum of modifier price-deltas, applied per-unit. */
    modifier_total?: number
    /** Discount applied to (unit_price + modifier_total) * quantity. Pre-tax. */
    discount_amount?: number
    /** GST slab percent — 0, 5, 12, 18, 28 (etc.). */
    gst_slab: number
    /** True if `unit_price` already includes tax. */
    tax_inclusive?: boolean
}

export interface LineResult {
    line_id?: string | number
    /** Effective unit price = unit_price + modifier_total. Net of tax. */
    unit_price: number
    /** Total quantity * unit_price minus discount, NET of tax. */
    taxable_amount: number
    cgst_amount: number
    sgst_amount: number
    igst_amount: number
    /** taxable_amount + cgst + sgst + igst — what the customer pays for this line. */
    line_total: number
    discount_amount: number
}

export interface OrderTotals {
    subtotal: number              // pre-discount, pre-tax
    item_discount: number
    order_discount: number
    taxable_amount: number
    cgst_amount: number
    sgst_amount: number
    igst_amount: number
    service_charge: number
    round_off: number
    grand_total: number
    /** GST split per slab — used by GSTR-1 / GSTR-3B working. */
    by_slab: SlabBreakup[]
}

export interface SlabBreakup {
    gst_slab: number
    taxable: number
    cgst: number
    sgst: number
    igst: number
    total_tax: number
}

const D = (v: number | string) => new Decimal(v ?? 0)
const round = (d: Decimal): number => Number(d.toDecimalPlaces(2).toString())

export function computeLine(line: LineInput, isInterState: boolean): LineResult {
    const qty = D(line.quantity)
    const baseUnit = D(line.unit_price).plus(D(line.modifier_total ?? 0))
    const slab = D(line.gst_slab)
    const discount = D(line.discount_amount ?? 0)

    let taxablePerUnit: Decimal
    if (line.tax_inclusive) {
        // back-out tax: net = gross / (1 + slab/100)
        const factor = D(1).plus(slab.div(100))
        taxablePerUnit = baseUnit.div(factor)
    } else {
        taxablePerUnit = baseUnit
    }

    const taxableTotal = taxablePerUnit.mul(qty).minus(discount).toDecimalPlaces(2)
    const taxRatio = slab.div(100)
    const totalTax = taxableTotal.mul(taxRatio).toDecimalPlaces(2)

    let cgst = D(0), sgst = D(0), igst = D(0)
    if (isInterState) {
        igst = totalTax
    } else {
        // split halves, ensure they sum to totalTax (handle the 0.01 rounding gap)
        const half = totalTax.div(2).toDecimalPlaces(2)
        cgst = half
        sgst = totalTax.minus(half)
    }

    const lineTotal = taxableTotal.plus(cgst).plus(sgst).plus(igst)

    return {
        line_id: line.line_id,
        unit_price: round(taxablePerUnit),
        taxable_amount: round(taxableTotal),
        cgst_amount: round(cgst),
        sgst_amount: round(sgst),
        igst_amount: round(igst),
        line_total: round(lineTotal),
        discount_amount: round(discount),
    }
}

/**
 * How the destination country structures consumption tax:
 *   "split"  — India: CGST + SGST within a state, IGST across (use `isInterState`).
 *   "single" — one combined rate (VAT / Sales Tax / GST elsewhere). The whole
 *              tax lands in the `igst_amount` slot; cgst/sgst stay 0. Callers
 *              relabel that column per the country's config.
 *   "none"   — no automatic tax (same effect as `noGst`).
 */
export type TaxModel = "split" | "single" | "none"

export interface ComputeOrderInput {
    lines: LineInput[]
    isInterState: boolean
    orderDiscount?: number
    serviceChargePercent?: number
    /** Apply a final round-off so grand_total ends in .00 / nearest rupee. */
    roundToNearestRupee?: boolean
    /** "Bill without GST" — every line is treated as a 0% slab, so taxable
     *  amounts stay (the price is the price) but CGST/SGST/IGST come out 0. */
    noGst?: boolean
    /** Country tax model; defaults to "split" (India). */
    taxModel?: TaxModel
}

export function computeOrder(input: ComputeOrderInput): OrderTotals {
    const model = input.taxModel ?? "split"
    const zeroTax = input.noGst || model === "none"
    // A single combined tax behaves exactly like an "inter-state" supply in the
    // split model: the whole amount goes to the IGST slot.
    const inter = model === "single" ? true : input.isInterState
    const lines = zeroTax
        ? input.lines.map((l) => ({ ...l, gst_slab: 0 }))
        : input.lines
    const computed = lines.map((l) => computeLine(l, inter))

    const subtotal     = computed.reduce((a, l) => a.plus(D(l.unit_price).mul(D(l.taxable_amount).gt(0) ? 1 : 0).plus(0)), D(0))
    // simpler: subtotal is sum of (taxable + discount) since taxable is already (unit*qty - discount)
    const subtotalSum  = computed.reduce(
        (a, l) => a.plus(D(l.taxable_amount)).plus(D(l.discount_amount)),
        D(0),
    )
    const itemDiscount = computed.reduce((a, l) => a.plus(D(l.discount_amount)), D(0))
    const taxablePre   = computed.reduce((a, l) => a.plus(D(l.taxable_amount)), D(0))

    // Invoice-level discount reduces the taxable base; tax then applies to
    // the post-discount amount. This mirrors generate_bill's server-side
    // math so the cashier's preview matches the bill the RPC produces.
    // For a 100%-off coupon the discount ratio is 1.0 and all tax collapses
    // to 0 — both India GST and Swiss MWST (and most VAT regimes) treat
    // upfront invoice discounts this way: no consideration, no tax.
    const orderDiscRaw = D(input.orderDiscount ?? 0)
    const orderDisc    = Decimal.min(orderDiscRaw, taxablePre)
    const discRatio    = taxablePre.gt(0) ? orderDisc.div(taxablePre) : D(0)
    const oneMinusR    = D(1).minus(discRatio)

    const cgst = computed.reduce((a, l) => a.plus(D(l.cgst_amount).mul(oneMinusR)), D(0))
    const sgst = computed.reduce((a, l) => a.plus(D(l.sgst_amount).mul(oneMinusR)), D(0))
    const igst = computed.reduce((a, l) => a.plus(D(l.igst_amount).mul(oneMinusR)), D(0))
    const taxable = taxablePre.minus(orderDisc)

    const svcPct       = D(input.serviceChargePercent ?? 0)
    const serviceCharge = taxable.mul(svcPct).div(100).toDecimalPlaces(2)

    let grand = taxable.plus(cgst).plus(sgst).plus(igst).plus(serviceCharge)

    let roundOff = D(0)
    if (input.roundToNearestRupee) {
        const rounded = grand.toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        roundOff = rounded.minus(grand)
        grand = rounded
    }

    // group by slab for GSTR-1 / 3B working — also scaled by the discount
    // ratio so the per-slab summary on the receipt matches the bill total.
    const slabMap = new Map<number, SlabBreakup>()
    for (let i = 0; i < lines.length; i++) {
        const slab = Number(lines[i]!.gst_slab)
        const r = computed[i]!
        const cur = slabMap.get(slab) ?? { gst_slab: slab, taxable: 0, cgst: 0, sgst: 0, igst: 0, total_tax: 0 }
        cur.taxable   = round(D(cur.taxable).plus(D(r.taxable_amount).mul(oneMinusR)))
        cur.cgst      = round(D(cur.cgst).plus(D(r.cgst_amount).mul(oneMinusR)))
        cur.sgst      = round(D(cur.sgst).plus(D(r.sgst_amount).mul(oneMinusR)))
        cur.igst      = round(D(cur.igst).plus(D(r.igst_amount).mul(oneMinusR)))
        cur.total_tax = round(D(cur.cgst).plus(cur.sgst).plus(cur.igst))
        slabMap.set(slab, cur)
    }

    return {
        subtotal:       round(subtotalSum),
        item_discount:  round(itemDiscount),
        order_discount: round(orderDisc),
        taxable_amount: round(taxable),
        cgst_amount:    round(cgst),
        sgst_amount:    round(sgst),
        igst_amount:    round(igst),
        service_charge: round(serviceCharge),
        round_off:      round(roundOff),
        grand_total:    round(grand),
        by_slab:        Array.from(slabMap.values()).sort((a, b) => a.gst_slab - b.gst_slab),
    }
}

export function lineCalcsForDb(lines: LineInput[], isInterState: boolean) {
    return lines.map((l) => {
        const r = computeLine(l, isInterState)
        return {
            line_id: l.line_id,
            unit_price: r.unit_price,
            quantity: l.quantity,
            discount_amount: r.discount_amount,
            taxable_amount: r.taxable_amount,
            cgst_amount: r.cgst_amount,
            sgst_amount: r.sgst_amount,
            igst_amount: r.igst_amount,
            line_total: r.line_total,
        }
    })
}
