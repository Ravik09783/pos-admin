/**
 * Local queue of bills that were generated while offline and still need to
 * be persisted to the server. Each entry carries everything `generate_bill`
 * needs as parameters PLUS the pre-allocated invoice number that was already
 * printed for the customer.
 *
 * Two layers of duplicate protection:
 *   - `client_request_id` (a UUID generated locally) is the canonical
 *     dedup key. Sending the same id twice always returns the same bill.
 *   - The DB has a partial UNIQUE on (tenant_id, client_request_id) as
 *     belt-and-suspenders against client bugs.
 */

import { readJSON, writeJSON } from "./storage"

export interface PendingBillItem {
    menu_item_id: string
    item_name: string
    hsn_code: string | null
    gst_slab: number
    quantity: number
    unit_price: number
    taxable_amount: number
    notes: string | null
}

/** Everything needed to recreate an entire bill on the server. We can't
 *  count on the order existing yet either — the staff member might have
 *  been offline since they started the shift. So we carry the order info
 *  + items alongside the bill params. */
export interface PendingBillPayload {
    /** Locally generated UUID — the idempotency key. Stable across retries. */
    client_request_id: string
    /** ISO timestamp — when the staff member hit "Generate bill". */
    created_at: string
    /** Pre-allocated invoice number that's already on the printed slip. */
    reserved_invoice: string

    // ── Order to recreate on sync ────────────────────────────────────────
    order_number: string
    order_type: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "QSR"
    /** Channel tag — SWIGGY / ZOMATO / PHONE / WHATSAPP / OTHER. Null = direct.
     *  Preserved through offline sync so the "revenue by channel" reports
     *  include offline-issued bills with the right attribution. Optional so
     *  older queued payloads (predating this field) still deserialise. */
    order_source?: string | null
    table_no: string | null
    customer_id: string | null
    /** Branch the order belongs to, captured at the moment the cashier
     *  hit "Generate bill". Sync worker passes it through to the orders
     *  insert so multi-branch reports show the bill at the right outlet.
     *  Optional — older queued payloads (pre-multi-branch) won't have
     *  it; sync.ts treats absent as null (= legacy / single-branch). */
    branch_id?: string | null
    /** Optional customer details captured at checkout (offline-mode). When
     *  customer_id is null and any of name / phone / email are set, the sync
     *  worker upserts a customers row (matched by phone, otherwise created)
     *  before calling generate_bill, so the bill snapshots the same data
     *  it would have if we'd been online. Field is optional so older queued
     *  payloads (predating this feature) keep deserialising cleanly. */
    customer_capture?: { name: string; phone: string; email: string } | null
    items: PendingBillItem[]

    // ── generate_bill params ─────────────────────────────────────────────
    service_charge: number
    order_discount: number
    round_off: number
    no_gst: boolean
    tax_model: "split" | "single" | "none"
    coupon_id: string | null
    coupon_discount: number

    /** Split-pay support: every fresh payload produced after the multi-
     *  payment rollout writes the array form. Older queued payloads (from
     *  before split-pay shipped, or from before this whole payment-first
     *  flow) used the singular `payment` shape — kept here for the sync
     *  worker to fall back to without losing in-flight bills. */
    payments?: Array<{
        method: "CASH" | "UPI" | "CARD"
        amount: number
        reference: string | null
    }>
    /** @deprecated Pre-split-pay singular payment. Sync worker treats this
     *  as a one-element `payments` array when `payments` is missing. */
    payment?: {
        method: "CASH" | "UPI" | "CARD"
        amount: number
        reference: string | null
    } | null

    /** Display-only snapshot — what the printed bill said the totals were.
     *  Helps the user reconcile if the sync ever shows a mismatch. */
    snapshot: {
        grand_total: number
        subtotal: number
        items_count: number
    }
}

export interface PendingBillRecord extends PendingBillPayload {
    /** How many times we've tried to push this one. */
    attempts: number
    /** Last error message from the sync worker, if any. */
    last_error: string | null
    /** Set when sync confirms success — these rows are kept briefly so the
     *  UI can show "just synced" and then garbage collected. */
    synced_at: string | null
    /** The server bill id, populated on successful sync. */
    bill_id: string | null
}

const KEY_PREFIX = "offline:pending-bills:"
function key(tenantId: string): string { return KEY_PREFIX + tenantId }

/** After this many failed attempts, the sync worker stops retrying a payload
 *  and parks it in a "dead-letter" state. The UI surfaces it as a "stuck"
 *  count so an admin can investigate (usually a server-side schema drift or
 *  a payload that violates a new RLS rule). */
export const MAX_SYNC_ATTEMPTS = 8

export function listPending(tenantId: string): PendingBillRecord[] {
    return readJSON<PendingBillRecord[]>(key(tenantId), [])
}

/** Live payloads still eligible for retry — excludes dead-letter rows. */
export function pendingCount(tenantId: string): number {
    return listPending(tenantId).filter((p) => !p.synced_at && p.attempts < MAX_SYNC_ATTEMPTS).length
}

/** Rows that have exceeded MAX_SYNC_ATTEMPTS without a success. Surfaced in
 *  the offline banner so the operator knows something needs hand-fixing. */
export function deadLetterCount(tenantId: string): number {
    return listPending(tenantId).filter((p) => !p.synced_at && p.attempts >= MAX_SYNC_ATTEMPTS).length
}

export function enqueue(tenantId: string, payload: PendingBillPayload): boolean {
    const buf = listPending(tenantId)
    // de-dup by client_request_id (defensive — UI shouldn't enqueue twice)
    if (buf.some((b) => b.client_request_id === payload.client_request_id)) return true
    buf.push({ ...payload, attempts: 0, last_error: null, synced_at: null, bill_id: null })
    return writeJSON(key(tenantId), buf)
}

export function markSynced(tenantId: string, clientRequestId: string, billId: string): void {
    const buf = listPending(tenantId).map((p) =>
        p.client_request_id === clientRequestId
            ? { ...p, synced_at: new Date().toISOString(), bill_id: billId, last_error: null }
            : p,
    )
    writeJSON(key(tenantId), buf)
}

export function markFailed(tenantId: string, clientRequestId: string, error: string): void {
    const buf = listPending(tenantId).map((p) =>
        p.client_request_id === clientRequestId
            ? { ...p, attempts: p.attempts + 1, last_error: error }
            : p,
    )
    writeJSON(key(tenantId), buf)
}

/** Drop a row entirely — used when a payload is unrecoverable (e.g. order
 *  was deleted server-side) and the user has chosen to abandon it. */
export function remove(tenantId: string, clientRequestId: string): void {
    const buf = listPending(tenantId).filter((p) => p.client_request_id !== clientRequestId)
    writeJSON(key(tenantId), buf)
}

/** Garbage-collect rows that have been synced for longer than `maxAgeMs`.
 *  Called opportunistically by the sync worker. */
export function gcSynced(tenantId: string, maxAgeMs: number = 60 * 60 * 1000): void {
    const now = Date.now()
    const buf = listPending(tenantId).filter((p) => {
        if (!p.synced_at) return true
        const t = Date.parse(p.synced_at)
        return !Number.isFinite(t) || now - t < maxAgeMs
    })
    writeJSON(key(tenantId), buf)
}
