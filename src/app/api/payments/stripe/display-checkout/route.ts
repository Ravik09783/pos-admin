import { NextResponse } from "next/server"

import { appOrigin } from "@/lib/app-origin"
import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError, logWarn } from "@/lib/errors"

/**
 * POST /api/payments/stripe/display-checkout
 *
 * Cashier-initiated equivalent of the QR-ordering Stripe Checkout flow.
 * Called by the POS the moment the cashier hits Review & checkout on
 * an international tenant with Stripe Connect onboarded.
 *
 * Body: { display_session_id: string }
 *
 * What this does, in order:
 *   1. Reads the current cart snapshot off the display session.
 *   2. Creates an `orders` row + `order_items` rows (status=OPEN) so
 *      the eventual webhook can call `generate_bill` against a real
 *      order_id rather than reconstructing the cart from JSON.
 *   3. Creates a Stripe Checkout Session as a Connect destination
 *      charge — money lands in the platform, application_fee_amount
 *      stays with us, the rest auto-transfers to the restaurant's
 *      Express account.
 *   4. Stashes order_id + checkout_url + checkout_session_id back onto
 *      the display session so the tablet can render the QR.
 *
 * Stripe Checkout auto-shows Apple Pay / Google Pay / Link / Card /
 * Klarna / SEPA / Bancontact / etc. based on the customer's device +
 * the merchant's enabled Dashboard methods. No payment_method_types
 * is passed so Stripe's Dynamic Payment Methods drive the list.
 *
 * Authorization: the caller must be an authenticated tenant user
 * (the cashier on the POS).
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    if (!process.env.STRIPE_SECRET_KEY) {
        return NextResponse.json({ error: "Stripe not configured on the server" }, { status: 500 })
    }
    const appUrl = appOrigin(req)

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

    // ── 1. Load the display session + verify caller's tenant ────────
    const { data: session } = await service
        .from("pos_display_sessions")
        .select("id, tenant_id, branch_id, cart_payload, subtotal, tax_total, grand_total, currency, table_no, order_type, customer_name, customer_phone, order_id, checkout_session_id, checkout_url")
        .eq("id", displaySessionId)
        .maybeSingle()
    if (!session) {
        return NextResponse.json({ error: "display session not found" }, { status: 404 })
    }
    const s = session as {
        id: string
        tenant_id: string
        branch_id: string | null
        cart_payload: Array<{ name: string; quantity: number; unit_price: number; notes?: string | null }>
        subtotal: number
        tax_total: number
        grand_total: number
        currency: string
        table_no: string | null
        order_type: string | null
        customer_name: string | null
        customer_phone: string | null
        order_id: string | null
        checkout_session_id: string | null
        checkout_url: string | null
    }

    // Caller must belong to this tenant.
    const { data: caller } = await supabase
        .from("users").select("tenant_id").eq("id", user.id).maybeSingle()
    if ((caller as { tenant_id?: string } | null)?.tenant_id !== s.tenant_id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    if (!Array.isArray(s.cart_payload) || s.cart_payload.length === 0) {
        return NextResponse.json({ error: "Cart is empty — nothing to check out." }, { status: 400 })
    }
    if (s.grand_total <= 0) {
        return NextResponse.json({ error: "Grand total is zero — nothing to charge." }, { status: 400 })
    }

    // Idempotency: if a checkout URL already exists on this session,
    // return it. Browser refreshes / duplicate clicks shouldn't create
    // a second Stripe Checkout for the same cart.
    if (s.checkout_url && s.checkout_session_id) {
        return NextResponse.json({
            ok: true,
            checkout_url: s.checkout_url,
            checkout_session_id: s.checkout_session_id,
            cached: true,
        })
    }

    // ── 2. Stripe Connect lookup ────────────────────────────────────
    const { data: gw } = await service
        .from("tenant_payment_gateways")
        .select("stripe_connected_account_id, stripe_account_enabled")
        .eq("tenant_id", s.tenant_id)
        .maybeSingle()
    const connected = gw as { stripe_connected_account_id?: string; stripe_account_enabled?: boolean } | null
    if (!connected?.stripe_connected_account_id) {
        return NextResponse.json({
            error: "Stripe Connect isn't set up for this restaurant yet. Finish onboarding in Settings → Payment gateway.",
        }, { status: 400 })
    }
    if (connected.stripe_account_enabled === false) {
        return NextResponse.json({
            error: "Online card payments are temporarily disabled for this restaurant.",
        }, { status: 400 })
    }

    // ── 3. Create the order + order_items if not already done ────────
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
                created_by: user.id,
            } as never)
            .select("id")
            .maybeSingle()
        if (oe || !orderRow) {
            logError(oe ?? new Error("order insert returned null"), {
                route: "/api/payments/stripe/display-checkout", displaySessionId,
            })
            return NextResponse.json({ error: "Couldn't create order" }, { status: 500 })
        }
        orderId = (orderRow as { id: string }).id

        // Insert order_items.
        const lines = s.cart_payload.map((line) => {
            const unit = Number(line.unit_price) || 0
            const qty = Number(line.quantity) || 0
            const taxable = Number((unit * qty).toFixed(2))
            return {
                tenant_id: s.tenant_id,
                order_id: orderId,
                item_name: line.name,
                gst_slab: 0,
                quantity: qty,
                unit_price: unit,
                taxable_amount: taxable,
                line_total: taxable,
                notes: line.notes ?? null,
            }
        })
        const { error: ie } = await service.from("order_items").insert(lines as never)
        if (ie) {
            logError(ie, { route: "/api/payments/stripe/display-checkout", step: "order_items", orderId })
            return NextResponse.json({ error: "Couldn't write line items" }, { status: 500 })
        }
    }

    // ── 4. Create the Stripe Checkout Session ───────────────────────
    const amount = Math.round(Number(s.grand_total) * 100)
    const currency = s.currency.toLowerCase()
    const feeRaw = Number(process.env.STRIPE_PLATFORM_FEE_PERCENT ?? "1")
    const feePercent = Number.isFinite(feeRaw) ? Math.min(100, Math.max(0, feeRaw)) : 1
    const applicationFeeAmount = Math.round(amount * feePercent / 100)

    const params = new URLSearchParams()
    params.append("mode", "payment")
    params.append("line_items[0][price_data][currency]", currency)
    params.append("line_items[0][price_data][product_data][name]", "Restaurant order")
    params.append("line_items[0][price_data][unit_amount]", String(amount))
    params.append("line_items[0][quantity]", "1")
    // Metadata keys our webhook handler resolves on
    // `checkout.session.completed` to attribute the payment back to
    // the right display session + order.
    params.append("metadata[display_session_id]", s.id)
    params.append("metadata[order_id]", orderId!)
    params.append("metadata[tenant_id]", s.tenant_id)
    params.append("metadata[platform_fee]", String(applicationFeeAmount))
    params.append("metadata[connected_account]", connected.stripe_connected_account_id)
    params.append("metadata[flow]", "cashier_display")
    // After payment Stripe redirects the CUSTOMER'S phone browser back
    // here. We point at a generic "thank you" route so they don't land
    // on an authenticated /bills/<id> page they can't access.
    params.append("success_url", `${appUrl}/display/paid?session_id={CHECKOUT_SESSION_ID}`)
    params.append("cancel_url", `${appUrl}/display/cancelled`)
    params.append("locale", "auto")
    params.append("billing_address_collection", "auto")
    // Customer's phone-side polish: phone number for SMS receipt.
    if (s.customer_phone) {
        // We already have it from the POS lookup; skip the prompt.
    } else {
        params.append("phone_number_collection[enabled]", "true")
    }

    // Connect destination charge — money lands in the platform, fee
    // stays with us, rest transfers to the merchant.
    params.append("payment_intent_data[application_fee_amount]", String(applicationFeeAmount))
    params.append("payment_intent_data[transfer_data][destination]", connected.stripe_connected_account_id)

    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Stripe-Version": "2024-11-20.acacia",
            // Idempotency on (display_session, order). A retry from the
            // cashier's POS shouldn't spin up duplicate Checkout
            // Sessions — Stripe returns the existing one within 24h.
            "Idempotency-Key": `display-checkout-${s.id}-${orderId}`,
        },
        body: params,
    })
    if (!r.ok) {
        const txt = await r.text()
        logError(new Error(`Stripe checkout.sessions.create failed: ${txt}`), {
            route: "/api/payments/stripe/display-checkout", displaySessionId, orderId,
        })
        return NextResponse.json({ error: "Stripe rejected the checkout request" }, { status: 502 })
    }
    const checkout = await r.json() as { id: string; url: string }

    // ── 5. Persist back onto the display session ────────────────────
    const { error: upErr } = await service
        .from("pos_display_sessions")
        .update({
            order_id: orderId,
            checkout_url: checkout.url,
            checkout_session_id: checkout.id,
        } as never)
        .eq("id", s.id)
    if (upErr) {
        logWarn("Failed to persist checkout fields on display session", {
            displaySessionId, checkoutSessionId: checkout.id, error: upErr.message,
        })
        // Non-fatal — the customer can still scan the QR we'll return,
        // and the webhook resolves via metadata not via this row.
    }

    return NextResponse.json({
        ok: true,
        checkout_url: checkout.url,
        checkout_session_id: checkout.id,
        order_id: orderId,
    })
}
