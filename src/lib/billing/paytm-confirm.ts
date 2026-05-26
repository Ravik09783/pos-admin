import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Finalising a successful Paytm payment — shared by two callers:
 *
 *   • `/api/webhooks/paytm`            — the normal path (Paytm calls us).
 *   • `/api/payments/paytm/reconcile`  — the safety net (we poll Paytm for
 *                                        a payment whose webhook never
 *                                        arrived).
 *
 * Keeping the "turn a paid event into a bill" logic in ONE place means a
 * recovered payment is billed exactly the way a webhook-driven one is.
 */

/** The slice of a `paytm_payment_events` row this module needs. */
export interface PaytmEventRow {
    paytm_order_id: string
    tenant_id: string
    order_id: string | null
    display_session_id: string | null
    flow: string
    amount: number
    currency: string | null
}

/**
 * Generate the bill for a SUCCESSFUL Paytm payment, then mark the
 * `paytm_payment_events` row SUCCESS.
 *
 * Routes to the right confirm RPC by flow:
 *   - `display_session_id` set → POS counter checkout
 *       → `confirm_display_checkout_payment`
 *   - `flow = 'QR_ORDER'`      → customer self-order at a table
 *       → `confirm_qr_order_system`
 * Both RPCs receive `p_method = 'PAYTM'` so the payment is recorded under
 * the correct gateway.
 *
 * Idempotent at every layer: the confirm RPCs return the EXISTING bill
 * for an already-billed order, and the event-status guard means a second
 * call is a no-op. Safe to invoke from the webhook and the reconcile job
 * for the same payment.
 */
export async function finalizePaytmPayment(
    service: SupabaseClient,
    ev: PaytmEventRow,
    txnId: string,
    grossAmount: number,
    raw?: Record<string, unknown> | null,
): Promise<{ billId: string | null; error: string | null }> {
    // Paytm's transaction id is the payment reference stamped onto the
    // bill's payment row; fall back to the order id if it's missing.
    const reference = txnId || ev.paytm_order_id
    let billId: string | null = null

    if (ev.display_session_id) {
        const { data, error } = await service.rpc("confirm_display_checkout_payment" as never, {
            p_order_id: ev.order_id,
            p_display_session_id: ev.display_session_id,
            p_stripe_intent_id: reference,
            p_gross_amount: grossAmount,
            p_platform_fee: 0,
            p_currency: (ev.currency ?? "INR").toUpperCase(),
            p_method: "PAYTM",
        } as never)
        if (error) return { billId: null, error: error.message }
        billId = (data as { bill_id?: string } | null)?.bill_id ?? null
    } else if (ev.flow === "QR_ORDER" && ev.order_id) {
        const { data, error } = await service.rpc("confirm_qr_order_system" as never, {
            p_order_id: ev.order_id,
            p_razorpay_payment_id: reference,
            p_amount: grossAmount,
            p_method: "PAYTM",
        } as never)
        if (error) return { billId: null, error: error.message }
        billId = (data as { bill_id?: string } | null)?.bill_id ?? null
    }

    await service
        .from("paytm_payment_events")
        .update({
            status: "SUCCESS",
            paytm_txn_id: txnId || null,
            bill_id: billId,
            raw: (raw ?? null) as never,
            processed_at: new Date().toISOString(),
        } as never)
        .eq("paytm_order_id", ev.paytm_order_id)

    return { billId, error: null }
}
