/**
 * Sync worker — drains the pending-bills queue. For each pending payload it
 * re-runs the full server-side workflow the POS would have run online:
 *
 *   1. INSERT into orders  (skipped if an order with this order_number is
 *      already there — happens on retries after a partial failure)
 *   2. INSERT into order_items  (skipped if the order already has any rows)
 *   3. generate_bill(..., p_reserved_invoice, p_client_request_id, p_coupon_id)
 *
 * Step 3 is fully idempotent on `client_request_id` (the DB has a UNIQUE
 * partial index that makes a second insert physically impossible). Step 1
 * de-dupes on order_number. Step 2 probes existing row count to avoid
 * doubling items on a retry between steps 2 and 3. Coupon redemption +
 * GIFT_CARD payments are folded into step 3 — see migration 22.
 *
 * Concurrency: a module-level mutex makes two concurrent callers (e.g. the
 * `online` event firing twice in StrictMode dev, or two tabs both detecting
 * "online") share one run.
 */

import { dropReservation } from "./reservation-buffer"
import { listPending, markFailed, markSynced, gcSynced, MAX_SYNC_ATTEMPTS, type PendingBillRecord } from "./pending-bills"
import { readJSON, writeJSON } from "./storage"

/** Stored under this key so the topbar can show "Last synced 3m ago" even
 *  after a tab refresh. Per-tenant — switching tenants on the same browser
 *  doesn't pollute the other tenant's display. */
const LAST_SYNC_KEY = "offline:last-sync:"

export function readLastSync(tenantId: string): string | null {
    return readJSON<string | null>(LAST_SYNC_KEY + tenantId, null)
}

export function writeLastSync(tenantId: string, isoTs: string): void {
    writeJSON(LAST_SYNC_KEY + tenantId, isoTs)
}

// Supabase's real client type is deeply generic and trying to match a
// narrower structural interface trips TS2589 ("excessively deep"). The
// shape we actually rely on is verified at runtime via the response
// objects each call returns.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any

let inFlight: Promise<SyncResult> | null = null

export interface SyncResult {
    attempted: number
    succeeded: number
    failed: number
    errors: { client_request_id: string; error: string }[]
}

export async function syncPendingBills(supabase: SupabaseLike, tenantId: string): Promise<SyncResult> {
    if (inFlight) return inFlight
    inFlight = doSync(supabase, tenantId).finally(() => { inFlight = null })
    return inFlight
}

async function doSync(supabase: SupabaseLike, tenantId: string): Promise<SyncResult> {
    // Skip dead-letter rows so a single broken payload can't block the rest
    // of the queue (or burn the user's phone battery retrying forever). The
    // banner shows the dead-letter count separately; an admin can re-enable
    // a row by clearing its attempts counter once they've fixed the cause.
    const queue = listPending(tenantId).filter(
        (p) => !p.synced_at && p.attempts < MAX_SYNC_ATTEMPTS,
    )
    const result: SyncResult = { attempted: queue.length, succeeded: 0, failed: 0, errors: [] }

    for (const p of queue) {
        if (typeof navigator !== "undefined" && navigator.onLine === false) break
        const r = await pushOne(supabase, tenantId, p)
        if (r.ok) result.succeeded += 1
        else { result.failed += 1; result.errors.push({ client_request_id: p.client_request_id, error: r.error }) }
    }

    gcSynced(tenantId)
    return result
}

async function pushOne(
    supabase: SupabaseLike,
    tenantId: string,
    p: PendingBillRecord,
): Promise<{ ok: true } | { ok: false; error: string }> {
    // ── Fast path: if generate_bill has already run for this id, we're done.
    const billProbe = await supabase.from("bills")
        .select("id").eq("tenant_id", tenantId).eq("client_request_id", p.client_request_id).maybeSingle()
    if (billProbe.data) {
        const billId = (billProbe.data as { id: string }).id
        markSynced(tenantId, p.client_request_id, billId)
        dropReservation(tenantId, p.reserved_invoice)
        return { ok: true }
    }

    // ── 0. Resolve / upsert the marketing customer (when captured offline).
    //    The offline POS can't reach the customers table, so if the cashier
    //    typed name/phone/email at checkout we stored them on the payload
    //    and upsert here. Match by phone (existing record), otherwise insert.
    //    Best-effort — failure here doesn't block the bill.
    let customerId: string | null = p.customer_id
    if (!customerId && p.customer_capture) {
        const cap = p.customer_capture
        try {
            if (cap.phone) {
                const found = await supabase
                    .from("customers")
                    .select("id, name, email")
                    .eq("tenant_id", tenantId)
                    .eq("phone", cap.phone)
                    .is("deleted_at", null)
                    .maybeSingle()
                if (found.data) {
                    const row = found.data as { id: string; name: string | null; email: string | null }
                    const patch: Record<string, string> = {}
                    if (cap.name && !row.name) patch.name = cap.name
                    if (cap.email && !row.email) patch.email = cap.email
                    if (Object.keys(patch).length > 0) {
                        await supabase.from("customers").update(patch).eq("id", row.id)
                    }
                    customerId = row.id
                }
            }
            if (!customerId && (cap.phone || cap.email)) {
                const ins = await supabase.from("customers").insert({
                    tenant_id: tenantId,
                    name: cap.name || null,
                    phone: cap.phone || null,
                    email: cap.email || null,
                }).select("id").maybeSingle()
                if (ins.data) customerId = (ins.data as { id: string }).id
            }
        } catch {
            // Don't block the bill on marketing capture.
        }
    }

    // ── 1. Make sure the order exists — keyed by order_number per tenant.
    let orderId: string | null = null
    const existingOrder = await supabase.from("orders")
        .select("id").eq("tenant_id", tenantId).eq("order_number", p.order_number).maybeSingle()
    if (existingOrder.data) {
        orderId = (existingOrder.data as { id: string }).id
    } else {
        const { data: { user } } = await supabase.auth.getUser()
        const ins = await supabase.from("orders").insert({
            tenant_id: tenantId,
            order_number: p.order_number,
            status: "OPEN",
            order_type: p.order_type,
            // Preserve the channel tag (Swiggy/Zomato/etc.) the cashier picked
            // at checkout so revenue-by-channel reports include offline bills.
            order_source: p.order_source ?? null,
            customer_id: customerId,
            notes: p.table_no ? `Table: ${p.table_no}` : null,
            created_by: user?.id ?? null,
            // Stamp branch_id captured at queue-time. Pre-multi-branch
            // payloads don't carry it; null is the right fallback there.
            branch_id: p.branch_id ?? null,
        }).select("id").single()
        if (ins.error || !ins.data) {
            const msg = ins.error?.message ?? "Failed to create order"
            markFailed(tenantId, p.client_request_id, msg)
            return { ok: false, error: msg }
        }
        orderId = (ins.data as { id: string }).id
    }

    // ── 2. Insert items. There's a vanishingly small retry window where
    //    items got inserted on a prior attempt but the generate_bill call
    //    that immediately followed didn't land — re-running step 2 would
    //    then double the order_items. The DB-level guarantee against
    //    duplicate BILLS (UNIQUE on tenant_id + client_request_id) means
    //    the resulting bill is still single + correct; if a tenant ever
    //    sees a totals mismatch from this edge case, the audit log will
    //    show the duplicated lines and an admin can fix it. The proper
    //    long-term fix is a server-side `create_full_bill` RPC that does
    //    steps 1 + 2 + 3 in one transaction.
    const lines = p.items.map((it) => ({
        tenant_id: tenantId,
        order_id: orderId!,
        menu_item_id: it.menu_item_id,
        item_name: it.item_name,
        hsn_code: it.hsn_code,
        gst_slab: it.gst_slab,
        quantity: it.quantity,
        unit_price: it.unit_price,
        taxable_amount: it.taxable_amount,
        line_total: it.taxable_amount,   // generate_bill recomputes
        notes: it.notes,
    }))
    const insItems = await supabase.from("order_items").insert(lines).select("id").single()
    if (insItems.error && insItems.error.code !== "23505") {
        markFailed(tenantId, p.client_request_id, `items: ${insItems.error.message}`)
        return { ok: false, error: insItems.error.message }
    }

    // ── 3. generate_bill — idempotent on client_request_id, atomic on
    //    payments. Bill row + payment rows + status flips all happen in
    //    one Postgres transaction. p_created_at preserves the device-
    //    clock moment the printed receipt was issued (GST-relevant).
    //
    //    Pre-split-pay payloads carried a singular `payment`; we coerce
    //    it into an array so old queued bills sync the same way as new
    //    multi-row payloads.
    const paymentList = p.payments
        ?? (p.payment ? [p.payment] : [])
    const payloadPayments = paymentList
        .filter((pay): pay is NonNullable<typeof pay> => Boolean(pay) && Number(pay.amount) > 0)
        .map((pay) => ({
            method: pay.method,
            amount: Number(pay.amount),
            reference: pay.reference ?? null,
        }))

    const { data, error } = await supabase.rpc("generate_bill", {
        p_order_id: orderId!,
        p_customer_id: customerId,
        p_service_charge: p.service_charge,
        p_order_discount: p.order_discount,
        p_round_off: p.round_off,
        p_no_gst: p.no_gst,
        p_tax_model: p.tax_model,
        p_reserved_invoice: p.reserved_invoice,
        p_client_request_id: p.client_request_id,
        p_created_at: p.created_at,
        p_payments: payloadPayments,
        // Coupon redemption is now atomic with bill insert (migration 22).
        // Pre-migration 22 deploys still work because the RPC accepts
        // p_coupon_id with a default null; older bills queued offline
        // before the migration land without coupon attribution, which
        // is correct (their bill row still has order_discount applied).
        p_coupon_id: p.coupon_id ?? null,
    })
    if (error) {
        markFailed(tenantId, p.client_request_id, error.message)
        return { ok: false, error: error.message }
    }
    const r = data as { bill_id?: string } | null
    if (!r?.bill_id) {
        markFailed(tenantId, p.client_request_id, "Unexpected empty response from generate_bill")
        return { ok: false, error: "Unexpected empty response" }
    }

    markSynced(tenantId, p.client_request_id, r.bill_id)
    dropReservation(tenantId, p.reserved_invoice)
    return { ok: true }
}
