import { NextResponse } from "next/server"

import { assertSameOrigin } from "@/lib/csrf"
import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { logError, logInfo } from "@/lib/errors"
import {
    createPaytmQr,
    paytmEnvCreds,
    resolveTenantPaytmCreds,
    type PaytmCreds,
    type TenantPaytmRow,
} from "@/lib/billing/paytm"

/**
 * POST /api/payments/paytm/display-checkout
 *
 * Cashier-fired Paytm UPI QR for the customer screen — the Paytm twin of
 * /api/payments/phonepe/display-checkout. Same payment-safety contract:
 * pre-create the order + items, insert the paytm_payment_events row BEFORE
 * minting the QR, then ask Paytm for a dynamic QR. The Paytm webhook (or the
 * reconcile cron) later calls confirm_display_checkout_payment(…, 'PAYTM')
 * which atomically creates bills + payments — no live cashier tab required.
 *
 * INPUT  { display_session_id: string }
 * OUTPUT { ok: true, qr_data, auto_confirm: true, checkout_session_id, order_id }
 *        { ok: false, reason: "not_configured" } | { ok: false, paytm_error }
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

interface CartLine {
    name?: string
    menu_item_id?: string | null
    quantity?: number
    unit_price?: number
    gst_slab?: number
    taxable_amount?: number
    notes?: string | null
    hsn_code?: string | null
}
interface SessionRow {
    id: string
    tenant_id: string
    branch_id: string | null
    grand_total: number
    currency: string | null
    status: string
    cart_payload: CartLine[] | null
    discount_total: number | null
    coupon_code: string | null
    customer_name: string | null
    customer_phone: string | null
    order_type: string | null
    table_no: string | null
}

export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { data: u } = await supabase
        .from("users").select("tenant_id, role").eq("id", user.id).maybeSingle() as {
            data: { tenant_id: string | null; role: string | null } | null
        }
    if (!u?.tenant_id) return NextResponse.json({ error: "no tenant" }, { status: 403 })
    if (!["OWNER", "MANAGER", "CASHIER", "CAPTAIN"].includes(u.role ?? "")) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const body = await req.json().catch(() => null) as { display_session_id?: string } | null
    const displaySessionId = body?.display_session_id
    if (!displaySessionId) return NextResponse.json({ error: "missing display_session_id" }, { status: 400 })

    const { data: session } = await supabase
        .from("pos_display_sessions")
        .select("id, tenant_id, branch_id, grand_total, currency, status, cart_payload, discount_total, coupon_code, customer_name, customer_phone, order_type, table_no")
        .eq("id", displaySessionId)
        .eq("created_by", user.id)
        .maybeSingle() as { data: SessionRow | null }
    if (!session) return NextResponse.json({ error: "display session not found" }, { status: 404 })
    if (!session.grand_total || session.grand_total <= 0) {
        return NextResponse.json({ error: "grand total must be > 0" }, { status: 400 })
    }
    if ((session.currency ?? "INR") !== "INR") {
        return NextResponse.json({ error: "Paytm only supports INR" }, { status: 400 })
    }
    const cart = Array.isArray(session.cart_payload) ? session.cart_payload : []
    if (cart.length === 0) return NextResponse.json({ error: "cart is empty" }, { status: 400 })

    const service = createServiceRoleClient()

    const { data: gw } = await service
        .from("tenant_payment_gateways")
        .select("paytm_mid, paytm_merchant_key, paytm_mid_staging, paytm_merchant_key_staging, paytm_enabled, paytm_env")
        .eq("tenant_id", session.tenant_id)
        .maybeSingle() as { data: TenantPaytmRow | null }
    const creds: PaytmCreds | null = resolveTenantPaytmCreds(gw) ?? paytmEnvCreds()
    if (!creds) return NextResponse.json({ ok: false, reason: "not_configured" })

    const { data: tenant } = await service
        .from("tenants").select("service_charge, round_off").eq("id", session.tenant_id).maybeSingle() as {
            data: { service_charge: number | null; round_off: number | null } | null
        }

    // Re-validate coupon server-side.
    let orderDiscount = Number(session.discount_total ?? 0)
    if (session.coupon_code) {
        const subtotal = cart.reduce((s, l) => s + Number(l.taxable_amount ?? 0), 0)
        const { data: cRes } = await service.rpc("validate_coupon_for_tenant" as never, {
            p_tenant_id: session.tenant_id, p_code: session.coupon_code, p_subtotal: subtotal,
        } as never) as { data: { coupon_id?: string; discount?: number } | null }
        if (cRes?.coupon_id) orderDiscount = Number(cRes.discount ?? orderDiscount)
    }

    let customerId: string | null = null
    if (session.customer_phone) {
        const { data: c } = await service
            .from("customers").select("id").eq("tenant_id", session.tenant_id).eq("phone", session.customer_phone).maybeSingle() as { data: { id: string } | null }
        customerId = c?.id ?? null
    }
    let tableId: string | null = null
    if (session.table_no && session.order_type === "DINE_IN") {
        const { data: t } = await service
            .from("dining_tables").select("id").eq("tenant_id", session.tenant_id).eq("table_number", session.table_no).maybeSingle() as { data: { id: string } | null }
        tableId = t?.id ?? null
    }

    // ── 1. Pre-create the order ──
    const orderNumber = `POS-${Date.now().toString().slice(-8)}`
    const orderType = (session.order_type ?? "QSR").toUpperCase()
    const safeOrderType = ["DINE_IN", "TAKEAWAY", "DELIVERY", "QSR"].includes(orderType) ? orderType : "QSR"
    const { data: orderRow, error: orderErr } = await service
        .from("orders")
        .insert({
            tenant_id: session.tenant_id, order_number: orderNumber, status: "ON_HOLD",
            order_type: safeOrderType, table_id: tableId, customer_id: customerId,
            branch_id: session.branch_id, created_by: user.id,
            service_charge: tenant?.service_charge ?? 0, order_discount: orderDiscount, round_off: tenant?.round_off ?? 0,
            notes: `POS Paytm auto-confirm${session.table_no ? ` · Table ${session.table_no}` : ""}`,
        } as never)
        .select("id").maybeSingle() as { data: { id: string } | null; error: unknown }
    if (orderErr || !orderRow) {
        logError(orderErr ?? "order insert returned no row", { route: "/api/payments/paytm/display-checkout", stage: "order_insert" })
        return NextResponse.json({ error: "couldn't create order" }, { status: 500 })
    }
    const orderId = orderRow.id

    // ── 2. order_items ──
    const lines = cart.map((c) => {
        const qty = Math.max(1, Math.round(Number(c.quantity) || 1))
        const unit = Number(c.unit_price) || 0
        const taxable = Number(c.taxable_amount ?? unit * qty)
        return {
            tenant_id: session.tenant_id, order_id: orderId, menu_item_id: c.menu_item_id ?? null,
            item_name: c.name ?? "Item", hsn_code: c.hsn_code ?? null, gst_slab: Number(c.gst_slab) || 0,
            quantity: qty, unit_price: unit, taxable_amount: taxable, line_total: taxable, notes: c.notes ?? null,
        }
    })
    const { error: itemsErr } = await service.from("order_items").insert(lines as never)
    if (itemsErr) {
        logError(itemsErr, { route: "/api/payments/paytm/display-checkout", stage: "order_items_insert", orderId })
        return NextResponse.json({ error: "couldn't create order items" }, { status: 500 })
    }

    // ── 3. Tracking row BEFORE minting ── (paytm_order_id is what Paytm echoes)
    const paytmOrderId = `pos-${session.id.slice(0, 8)}-${Date.now().toString(36)}`
    const { error: insertErr } = await service
        .from("paytm_payment_events")
        .insert({
            paytm_order_id: paytmOrderId, tenant_id: session.tenant_id, order_id: orderId,
            display_session_id: session.id, amount: session.grand_total, currency: "INR", flow: "POS", status: "PENDING",
        } as never)
    if (insertErr) {
        logError(insertErr, { route: "/api/payments/paytm/display-checkout", paytmOrderId, orderId })
        return NextResponse.json({ error: "couldn't initialise payment" }, { status: 500 })
    }

    // ── 4. Mint the Paytm dynamic QR ──
    const result = await createPaytmQr(creds, { orderId: paytmOrderId, amount: session.grand_total })
    if (!result.ok || !result.qrData) {
        await service
            .from("paytm_payment_events")
            .update({ status: "FAILED", raw: result.raw ?? { error: result.message }, processed_at: new Date().toISOString() } as never)
            .eq("paytm_order_id", paytmOrderId)
        return NextResponse.json({ ok: false, paytm_error: result.message ?? "Paytm couldn't mint the QR." })
    }

    logInfo("[paytm display-checkout] minted QR", { paytmOrderId, orderId, tenant_id: session.tenant_id, amount: session.grand_total })
    return NextResponse.json({
        ok: true,
        qr_data: result.qrData,
        auto_confirm: true,
        checkout_session_id: paytmOrderId,
        order_id: orderId,
    })
}
