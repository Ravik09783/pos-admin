import { NextResponse } from "next/server"

import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { paytmCreateQr, paytmEnvCreds, type PaytmCreds } from "@/lib/billing/paytm"

/**
 * POST /api/payments/paytm/display-checkout
 *
 * The ONE place a UPI scan-to-pay QR is resolved for the POS customer
 * display. It runs a fixed preference chain and RETURNS the resolved QR
 * payload — it does NOT write `checkout_url` itself. The POS writes the
 * QR onto `pos_display_sessions.checkout_url`, gated on the live payment
 * method, so a method switch mid-request can never strand a stale QR on
 * the customer screen. Both screens then render that one value.
 *
 * Resolution chain:
 *   1. Paytm connected (MID + Merchant Key)  → a Paytm dynamic UPI QR.
 *      The webhook auto-confirms it hands-free. `checkout_session_id` is
 *      set so both screens know it's the auto-confirm flow.
 *   2. Paytm failed, OR not connected, but a merchant UPI ID is saved
 *      → a plain `upi://pay?…` QR. No auto-confirm; the cashier verifies
 *      the UTR. `checkout_session_id` is null.
 *   3. Neither configured → `{ ok:false, reason:"not_configured" }` and
 *      checkout_url is cleared, so the dialog can tell the cashier the
 *      owner hasn't set up a payment method.
 *
 * Body: { display_session_id: string }
 * Returns 200 with either:
 *   { ok:true,  qr_data, auto_confirm, mode }   — a QR was issued
 *   { ok:false, reason:"not_configured" }       — nothing is set up
 * Non-2xx only for genuine errors (bad request / forbidden / server).
 *
 * Authorization: an authenticated user of the session's tenant.
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    let body: { display_session_id?: string } = {}
    try { body = await req.json() } catch { body = {} }
    const displaySessionId = body.display_session_id?.trim()
    if (!displaySessionId) {
        return NextResponse.json({ error: "display_session_id is required" }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const service = createServiceRoleClient()

    // ── 1. Load the display session + verify the caller's tenant ────────
    // Look the session up by `created_by` (the authenticated cashier) —
    // NOT by the `display_session_id` from the body. That row id churns
    // (the row is deleted + re-inserted), so an id passed by the POS can
    // already be stale by the time this route runs; `created_by` is
    // stable and unique, so it always resolves to the cashier's live row.
    const { data: session } = await service
        .from("pos_display_sessions")
        .select("id, tenant_id, branch_id, cart_payload, grand_total, currency, table_no, order_type, order_id, checkout_url, checkout_session_id")
        .eq("created_by", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    if (!session) {
        return NextResponse.json({ error: "display session not found" }, { status: 404 })
    }
    const s = session as {
        id: string
        tenant_id: string
        branch_id: string | null
        cart_payload: Array<{
            name: string; quantity: number; unit_price: number;
            notes?: string | null; gst_slab?: number | null; taxable_amount?: number | null
        }>
        grand_total: number
        currency: string
        table_no: string | null
        order_type: string | null
        order_id: string | null
        checkout_url: string | null
        checkout_session_id: string | null
    }

    const { data: caller } = await supabase
        .from("users").select("tenant_id").eq("id", user.id).maybeSingle()
    if ((caller as { tenant_id?: string } | null)?.tenant_id !== s.tenant_id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    if (!Array.isArray(s.cart_payload) || s.cart_payload.length === 0) {
        return NextResponse.json({ error: "Cart is empty — nothing to check out." }, { status: 400 })
    }
    if (!(Number(s.grand_total) > 0)) {
        return NextResponse.json({ error: "Grand total is zero — nothing to charge." }, { status: 400 })
    }

    // Idempotency: a QR is already live for this session (any non-sentinel
    // checkout_url). Browser refreshes / duplicate clicks must not mint a
    // second QR. `checkout_session_id` set ⇒ it was the Paytm auto path.
    if (s.checkout_url
        && !/^counter:/i.test(s.checkout_url)
        && !/^https?:/i.test(s.checkout_url)) {
        return NextResponse.json({
            ok: true, qr_data: s.checkout_url,
            auto_confirm: !!s.checkout_session_id,
            checkout_session_id: s.checkout_session_id,
            mode: s.checkout_session_id ? "paytm" : "upi", cached: true,
        })
    }

    // ── 2. Load the tenant's payment configuration ──────────────────────
    const [{ data: gwRow }, { data: tntRow }] = await Promise.all([
        service.from("tenant_payment_gateways")
            .select("paytm_mid, paytm_merchant_key, paytm_enabled, paytm_env")
            .eq("tenant_id", s.tenant_id).maybeSingle(),
        service.from("tenants")
            .select("upi_id, upi_payee_name, name")
            .eq("id", s.tenant_id).maybeSingle(),
    ])
    const g = gwRow as {
        paytm_mid: string | null
        paytm_merchant_key: string | null
        paytm_enabled: boolean | null
        paytm_env: string | null
    } | null
    const tnt = tntRow as {
        upi_id: string | null
        upi_payee_name: string | null
        name: string | null
    } | null

    // Paytm credentials — the tenant's own, else the platform .env fallback.
    let creds: PaytmCreds | null = null
    if (g?.paytm_enabled && g.paytm_mid && g.paytm_merchant_key) {
        creds = {
            env: g.paytm_env === "production" ? "production" : "staging",
            mid: g.paytm_mid,
            merchantKey: g.paytm_merchant_key,
        }
    } else {
        creds = paytmEnvCreds()
    }
    const upiId = tnt?.upi_id?.trim() || null
    const upiPayee = tnt?.upi_payee_name?.trim() || tnt?.name || "Merchant"

    // ── 3. Preferred path: a Paytm dynamic QR (auto-confirm) ────────────
    let paytmError: string | null = null
    if (creds) {
        // The webhook maps a payment back via a real orders row, so create
        // one (+ order_items carrying NET amount + gst_slab) if not yet done.
        let orderId = s.order_id
        if (!orderId) {
            const orderNumber = `POS-${Date.now().toString().slice(-8)}`
            const { data: orderRow, error: oe } = await service
                .from("orders")
                .insert({
                    tenant_id: s.tenant_id,
                    branch_id: s.branch_id,
                    order_number: orderNumber,
                    status: "OPEN",
                    order_type: s.order_type ?? "TAKEAWAY",
                    source: "POS",
                    notes: s.table_no ? `Table: ${s.table_no}` : null,
                    // The cashier who rang this sale up. created_by AND
                    // billed_by are both stamped so the sale is attributed
                    // to them in the dashboard / reports — even though the
                    // bill is finalised hands-free by the webhook, with no
                    // auth context of its own.
                    created_by: user.id,
                    billed_by: user.id,
                } as never)
                .select("id")
                .maybeSingle()
            if (oe || !orderRow) {
                logError(oe ?? new Error("order insert returned null"), {
                    route: "/api/payments/paytm/display-checkout", displaySessionId,
                })
                return NextResponse.json({ error: "Couldn't create the order" }, { status: 500 })
            }
            orderId = (orderRow as { id: string }).id

            const lines = s.cart_payload.map((line) => {
                const qty = Number(line.quantity) || 0
                const slab = Number(line.gst_slab) || 0
                const net = line.taxable_amount != null
                    ? Number(line.taxable_amount)
                    : (Number(line.unit_price) || 0) * qty
                const netUnit = qty > 0 ? Number((net / qty).toFixed(2)) : 0
                return {
                    tenant_id: s.tenant_id,
                    order_id: orderId,
                    item_name: line.name,
                    gst_slab: slab,
                    quantity: qty,
                    unit_price: netUnit,
                    taxable_amount: Number(net.toFixed(2)),
                    line_total: Number(net.toFixed(2)),
                    notes: line.notes ?? null,
                }
            })
            const { error: ie } = await service.from("order_items").insert(lines as never)
            if (ie) {
                logError(ie, { route: "/api/payments/paytm/display-checkout", step: "order_items", orderId })
                return NextResponse.json({ error: "Couldn't write the line items" }, { status: 500 })
            }
        }

        const qr = await paytmCreateQr(creds, {
            orderId: orderId!,
            amount: Number(s.grand_total),
            posId: s.branch_id ?? s.tenant_id,
        })
        if (qr.ok && qr.data?.qrData) {
            // Track the QR — the webhook maps the payment back via this row.
            const { error: evErr } = await service
                .from("paytm_payment_events")
                .insert({
                    paytm_order_id: orderId,
                    tenant_id: s.tenant_id,
                    order_id: orderId,
                    display_session_id: s.id,
                    amount: Number(s.grand_total),
                    currency: "INR",
                    flow: "POS",
                    status: "PENDING",
                } as never)
            if (evErr && !/duplicate key/i.test(evErr.message)) {
                logError(evErr, { route: "/api/payments/paytm/display-checkout", step: "paytm_payment_events", orderId })
                return NextResponse.json({ error: "Couldn't start the payment" }, { status: 500 })
            }
            // Link the order to the session so a re-call reuses it. The QR
            // itself is written to checkout_url by the POS — gated on the
            // live payment method — so a method switch mid-request can't
            // leave a stale QR on the customer screen. Non-fatal: if this
            // linkage write fails, a re-call just mints a fresh order.
            const { error: upErr } = await service
                .from("pos_display_sessions")
                .update({ order_id: orderId } as never)
                .eq("id", s.id)
            if (upErr) {
                logError(upErr, { route: "/api/payments/paytm/display-checkout", step: "link_order", orderId })
            }
            return NextResponse.json({
                ok: true, qr_data: qr.data.qrData, auto_confirm: true,
                checkout_session_id: orderId, mode: "paytm",
            })
        }
        // Paytm rejected it / was unreachable — remember why, fall through
        // to the plain-UPI QR so the sale can still be taken.
        paytmError = qr.message || "Paytm rejected the request"
        logError(new Error(`Paytm display QR create failed: ${qr.message}`), {
            route: "/api/payments/paytm/display-checkout", displaySessionId, orderId,
        })
    }

    // ── 4. Fallback: a plain UPI QR off the merchant UPI ID ─────────────
    // The POS writes this onto checkout_url (gated on the live method).
    if (upiId) {
        const intent = `upi://pay?pa=${encodeURIComponent(upiId)}`
            + `&pn=${encodeURIComponent(upiPayee)}`
            + `&am=${Number(s.grand_total).toFixed(2)}&cu=INR`
            + `&tn=${encodeURIComponent("Order payment")}`
        return NextResponse.json({
            ok: true, qr_data: intent, auto_confirm: false,
            checkout_session_id: null, mode: "upi", paytm_error: paytmError,
        })
    }

    // ── 5. Nothing configured ───────────────────────────────────────────
    return NextResponse.json({
        ok: false, reason: "not_configured", paytm_error: paytmError,
    })
}
