/**
 * Pure aggregation logic for the end-of-shift collection report. The page
 * fetches raw payment rows from Supabase and pipes them through here — keeps
 * the UI dumb and the math testable.
 *
 * The two buckets the user actually cares about at the cash drawer:
 *
 *   - CASH      → physical money they need to hand over / count.
 *   - ONLINE    → digital settlement (UPI, card, bank transfer, Razorpay,
 *                 Stripe, PhonePe, Paytm). They didn't touch it; the bank
 *                 did. Useful for matching the gateway dashboard, not the
 *                 cash drawer.
 *   - OTHER     → loyalty / gift-card redemption / complimentary / on-credit.
 *                 Not real money in or out — broken out separately so the
 *                 totals make sense to an auditor.
 *
 * Refunded/void payments aren't subtracted automatically — we don't have a
 * refund row model in v1. When that lands, plug it in here.
 */

export type PaymentMethod =
    | "CASH" | "UPI" | "CARD" | "RAZORPAY" | "PHONEPE" | "PAYTM" | "STRIPE"
    | "BANK_TRANSFER" | "CREDIT" | "COMPLIMENTARY" | "OTHER"
    | "GIFT_CARD" | "LOYALTY"

export type CollectionGroup = "cash" | "online" | "other"

const GROUPS: Record<PaymentMethod, CollectionGroup> = {
    CASH: "cash",
    UPI: "online", CARD: "online", RAZORPAY: "online", PHONEPE: "online",
    PAYTM: "online", STRIPE: "online", BANK_TRANSFER: "online",
    GIFT_CARD: "other", LOYALTY: "other", COMPLIMENTARY: "other",
    CREDIT: "other", OTHER: "other",
}

export const GROUP_LABEL: Record<CollectionGroup, string> = {
    cash: "Cash",
    online: "Online",
    other: "Other",
}

export interface PaymentRow {
    id: string
    method: PaymentMethod
    amount: number | string
    received_by: string | null
    bill_id: string | null
    created_at: string
}

export interface MethodTotal {
    method: PaymentMethod
    label: string
    count: number
    amount: number
}

export interface CollectionSummary {
    /** Totals by the high-level bucket (cash / online / other). */
    groups: { group: CollectionGroup; label: string; amount: number; count: number }[]
    /** Per-method detail for the report grid. */
    methods: MethodTotal[]
    /** Sum of cash + online (i.e. real money handled). */
    realTotal: number
    /** Grand total including 'other' bucket. */
    grandTotal: number
    /** How many payment rows were considered. */
    paymentCount: number
}

export const METHOD_LABEL: Record<PaymentMethod, string> = {
    CASH: "Cash",
    UPI: "UPI",
    CARD: "Card",
    RAZORPAY: "Razorpay",
    PHONEPE: "PhonePe",
    PAYTM: "Paytm",
    STRIPE: "Stripe",
    BANK_TRANSFER: "Bank transfer",
    CREDIT: "On account",
    COMPLIMENTARY: "Complimentary",
    OTHER: "Other",
    GIFT_CARD: "Gift card",
    LOYALTY: "Loyalty points",
}

export function groupOf(method: PaymentMethod): CollectionGroup {
    return GROUPS[method] ?? "other"
}

/** Aggregate a flat list of payment rows into the shift-summary shape. */
export function summarise(rows: PaymentRow[]): CollectionSummary {
    const methodBuckets = new Map<PaymentMethod, MethodTotal>()
    const groupBuckets = new Map<CollectionGroup, { amount: number; count: number }>()

    for (const r of rows) {
        const amt = typeof r.amount === "string" ? Number(r.amount) : r.amount
        if (!Number.isFinite(amt)) continue

        const m = r.method
        const cur = methodBuckets.get(m) ?? { method: m, label: METHOD_LABEL[m] ?? m, count: 0, amount: 0 }
        cur.count += 1
        cur.amount += amt
        methodBuckets.set(m, cur)

        const g = groupOf(m)
        const gcur = groupBuckets.get(g) ?? { amount: 0, count: 0 }
        gcur.amount += amt
        gcur.count += 1
        groupBuckets.set(g, gcur)
    }

    const methods = Array.from(methodBuckets.values()).sort((a, b) => b.amount - a.amount)
    const groups: CollectionSummary["groups"] = (["cash", "online", "other"] as CollectionGroup[])
        .map((g) => ({
            group: g,
            label: GROUP_LABEL[g],
            amount: groupBuckets.get(g)?.amount ?? 0,
            count: groupBuckets.get(g)?.count ?? 0,
        }))

    const cashAmt = groupBuckets.get("cash")?.amount ?? 0
    const onlineAmt = groupBuckets.get("online")?.amount ?? 0
    const otherAmt = groupBuckets.get("other")?.amount ?? 0

    return {
        groups,
        methods,
        realTotal: round(cashAmt + onlineAmt),
        grandTotal: round(cashAmt + onlineAmt + otherAmt),
        paymentCount: rows.length,
    }
}

/** Group rows by the staff member who handled them, for the team view.
 *  Unattributed rows (webhook / system payments with received_by null) get
 *  bucketed under a synthetic "auto" key so they don't disappear. */
export function summariseByStaff(
    rows: PaymentRow[],
    staffNames: Record<string, string>,
): { staffId: string | null; staffName: string; summary: CollectionSummary }[] {
    const byStaff = new Map<string | null, PaymentRow[]>()
    for (const r of rows) {
        const k = r.received_by
        const arr = byStaff.get(k) ?? []
        arr.push(r)
        byStaff.set(k, arr)
    }
    return Array.from(byStaff.entries())
        .map(([staffId, rs]) => ({
            staffId,
            staffName: staffId == null
                ? "Auto (webhook / system)"
                : staffNames[staffId] ?? "Unknown staff",
            summary: summarise(rs),
        }))
        .sort((a, b) => b.summary.realTotal - a.summary.realTotal)
}

/** Compare the cash the staff member actually has in hand against the
 *  expected amount from `summarise`. Positive variance = extra cash on hand;
 *  negative = short. */
export function cashVariance(expected: number, counted: number): { variance: number; status: "short" | "match" | "over" } {
    const v = round(counted - expected)
    if (Math.abs(v) < 0.005) return { variance: 0, status: "match" }
    return { variance: v, status: v < 0 ? "short" : "over" }
}

function round(n: number): number {
    return Math.round(n * 100) / 100
}
