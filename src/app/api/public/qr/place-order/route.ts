import { NextResponse } from "next/server"

import { appOrigin } from "@/lib/app-origin"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { logError, logWarn } from "@/lib/errors"
import { resolveGateway, type PaymentGateway } from "@/lib/payments/gateway"
import { paytmCreateQr, paytmEnvCreds, resolveTenantPaytmCreds, type PaytmCreds, type TenantPaytmRow } from "@/lib/billing/paytm"
import { getClientIp, rateLimit } from "@/lib/rate-limit"

interface PlaceOrderBody {
    tenant_slug: string
    table_number: string
    customer_name?: string
    customer_phone?: string
    notes?: string
    /** Optional: total amount the customer's screen displayed. We refuse if the
     *  server-recomputed total is more than 0.5% off — protects against price
     *  changes (or a coupon that became invalid) between preview and submit. */
    expected_total?: number
    /** Optional promo code — re-validated server-side; discount carried on the
     *  order so confirm_qr_order applies it when generating the bill. */
    coupon_code?: string
    items: Array<{ menu_item_id: string; quantity: number; notes?: string }>
}

/**
 * POST /api/public/qr/place-order
 *
 * Validates sold-out items and creates an order in awaiting_confirmation state.
 *
 * Returns either a Paytm dynamic-UPI-QR payload (recommended path — the
 * payment goes directly to the restaurant's Paytm account and the webhook
 * auto-confirms), a Stripe Checkout payload, or a manual UPI payload
 * (fallback when the owner hasn't connected an online gateway).
 */
export async function POST(req: Request) {
    // ---- Rate limit by IP + table to prevent flooding ----
    const ip = getClientIp(req)
    const ipLimit = await rateLimit(`qr-order:ip:${ip}`, 20, 60_000) // 20 / minute per IP
    if (!ipLimit.allowed) {
        logWarn("Rate limit exceeded for QR order", { route: "/api/public/qr/place-order", ip })
        return NextResponse.json({ error: "Too many requests. Please slow down." }, {
            status: 429,
            headers: { "Retry-After": String(Math.ceil((ipLimit.resetAt - Date.now()) / 1000)) },
        })
    }

    const body = (await req.json()) as PlaceOrderBody
    if (!body.tenant_slug || !body.items?.length) {
        return NextResponse.json({ error: "missing fields" }, { status: 400 })
    }
    if (body.items.length > 50) {
        return NextResponse.json({ error: "Cart has too many items (max 50)" }, { status: 400 })
    }
    if (body.items.some((i) => i.quantity < 1 || i.quantity > 99)) {
        return NextResponse.json({ error: "Quantity out of range (1-99)" }, { status: 400 })
    }

    const supabase = createServiceRoleClient()

    // Per-table rate limit (prevents the same table from spamming orders)
    const tableLimit = await rateLimit(
        `qr-order:table:${body.tenant_slug}:${body.table_number}`,
        10,
        60_000,
    )
    if (!tableLimit.allowed) {
        return NextResponse.json({ error: "Too many orders from this table — please wait a moment" }, {
            status: 429,
            headers: { "Retry-After": String(Math.ceil((tableLimit.resetAt - Date.now()) / 1000)) },
        })
    }
    const { data: tenant } = await supabase
        .from("tenants")
        .select("id, name, qr_ordering_enabled, payment_gateway, upi_id, upi_payee_name, country, currency, service_charge_percent")
        .eq("slug", body.tenant_slug)
        .maybeSingle()
    if (!tenant) return NextResponse.json({ error: "restaurant not found" }, { status: 404 })
    const t = tenant as {
        id: string
        name: string
        qr_ordering_enabled?: boolean
        payment_gateway?: string
        upi_id?: string
        upi_payee_name?: string
        country?: string
        currency?: string
        service_charge_percent?: number
    }
    if (t.qr_ordering_enabled === false) {
        return NextResponse.json({ error: "QR ordering disabled" }, { status: 403 })
    }

    // ---- Validate items ----
    const itemIds = body.items.map((i) => i.menu_item_id)
    const { data: menuItems } = await supabase
        .from("menu_items")
        .select("id, name, base_price, sale_price, gst_slab, hsn_code, is_active, is_sold_out, is_tax_inclusive")
        .in("id", itemIds)
        .eq("tenant_id", t.id)
        .is("deleted_at", null)
    type Mi = { id: string; name: string; base_price: number; sale_price: number | null; gst_slab: number; hsn_code: string | null; is_active: boolean; is_sold_out: boolean; is_tax_inclusive: boolean }
    const itemMap = new Map((menuItems ?? []).map((x: { id: string }) => [x.id, x as Mi]))

    const soldOut: string[] = []
    const missing: string[] = []
    for (const cartItem of body.items) {
        const m = itemMap.get(cartItem.menu_item_id)
        if (!m) { missing.push(cartItem.menu_item_id); continue }
        if (!m.is_active) { missing.push(m.name); continue }
        if (m.is_sold_out) { soldOut.push(m.name) }
    }
    if (soldOut.length > 0) {
        return NextResponse.json({
            error: "sold_out",
            message: `Sold out: ${soldOut.join(", ")}`,
            sold_out_items: soldOut,
        }, { status: 409 })
    }
    if (missing.length > 0) {
        return NextResponse.json({
            error: "missing_items",
            message: "Some items are no longer available",
            missing,
        }, { status: 409 })
    }

    // ---- Determine payment path ----
    // Country drives the gateway: India → Paytm (UPI), elsewhere → Stripe
    // (Connect). An Indian admin can opt into "manual" UPI; the resolver
    // enforces that policy in one place (src/lib/payments/gateway.ts).
    //
    // For an online gateway the restaurant must have completed onboarding:
    //   - Paytm:  tenant_payment_gateways.paytm_enabled + MID + key
    //             (or the platform .env fallback for dev / single-restaurant)
    //   - Stripe: tenant_payment_gateways.stripe_connected_account_id (acct_*)
    // When Paytm isn't connected we downgrade to manual UPI if the
    // restaurant has a UPI id; otherwise this route refuses with 400.
    const gateway = resolveGateway(t.country, t.payment_gateway)

    type StripeConnect = {
        stripe_connected_account_id: string | null
        stripe_account_enabled: boolean | null
    }
    let stripeAcct: StripeConnect | null = null
    let paytmCreds: PaytmCreds | null = null
    // The gateway we actually run this order through. Starts as the
    // resolved gateway, then downgrades paytm → manual when Paytm isn't
    // connected so a transient gap doesn't block ordering entirely.
    let effectiveGateway: PaymentGateway = gateway

    if (gateway === "paytm") {
        const { data: gw } = await supabase
            .from("tenant_payment_gateways")
            .select("paytm_mid, paytm_merchant_key, paytm_mid_staging, paytm_merchant_key_staging, paytm_enabled, paytm_env")
            .eq("tenant_id", t.id)
            .maybeSingle()
        // Helper picks production vs staging credentials based on
        // `paytm_env`. Falls back to the platform .env pair when the
        // tenant doesn't have a connected Paytm.
        paytmCreds =
            resolveTenantPaytmCreds(gw as TenantPaytmRow | null) ?? paytmEnvCreds()
        if (!paytmCreds) {
            if (!t.upi_id) {
                return NextResponse.json({
                    error: "Restaurant has not finished setting up online payments. Please ask staff to take payment in person.",
                }, { status: 400 })
            }
            effectiveGateway = "manual"
        }
    } else if (gateway === "stripe") {
        if (!process.env.STRIPE_SECRET_KEY) {
            return NextResponse.json({
                error: "Stripe not enabled on the platform. Contact RestoPOS support.",
            }, { status: 503 })
        }
        const { data: gw } = await supabase
            .from("tenant_payment_gateways")
            .select("stripe_connected_account_id, stripe_account_enabled")
            .eq("tenant_id", t.id)
            .maybeSingle()
        stripeAcct = (gw as unknown as StripeConnect | null) ?? null
        if (!stripeAcct?.stripe_connected_account_id) {
            return NextResponse.json({
                error: "Restaurant has not finished setting up online payments. Please ask staff to take payment in person.",
            }, { status: 400 })
        }
        if (stripeAcct.stripe_account_enabled === false) {
            return NextResponse.json({
                error: "Online payments are temporarily disabled for this restaurant.",
            }, { status: 400 })
        }
    } else if (!t.upi_id) {
        return NextResponse.json({ error: "Restaurant has not set up payment yet" }, { status: 400 })
    }

    // ---- Find / link the dining table + customer ----
    const { data: tableRow } = await supabase
        .from("dining_tables")
        .select("id, branch_id")
        .eq("tenant_id", t.id)
        .eq("number", body.table_number)
        .maybeSingle()
    const tableId = (tableRow as { id?: string } | null)?.id ?? null
    // Multi-branch: the table's branch is THE branch this order belongs
    // to (a customer's seat physically dictates the outlet). If the
    // table row predates multi-branch and has branch_id null, the order
    // also stays null — that's fine for single-branch tenants.
    const tableBranchId = (tableRow as { branch_id?: string | null } | null)?.branch_id ?? null

    let customerId: string | null = null
    if (body.customer_phone?.trim()) {
        const { data: cust } = await supabase
            .from("customers")
            .upsert({
                tenant_id: t.id,
                name: body.customer_name?.trim() || null,
                phone: body.customer_phone.trim(),
            }, { onConflict: "tenant_id,phone" })
            .select("id")
            .maybeSingle()
        customerId = (cust as { id?: string } | null)?.id ?? null
    }

    // ---- Create order ----
    const orderNumber = `QR-${Date.now().toString().slice(-8)}`
    const { data: order, error: oe } = await supabase
        .from("orders")
        .insert({
            tenant_id: t.id,
            order_number: orderNumber,
            status: "ON_HOLD",
            order_type: "DINE_IN",
            source: "QR",
            table_id: tableId,
            customer_id: customerId,
            awaiting_confirmation: true,
            payment_gateway: effectiveGateway,
            notes: body.notes?.trim() || `Table ${body.table_number}`,
            // Branch is derived from the table the customer scanned — the
            // physical seat dictates the outlet. Null for single-branch
            // tenants (or legacy tables that predate multi-branch).
            branch_id: tableBranchId,
        })
        .select("id")
        .maybeSingle()
    if (oe || !order) return NextResponse.json({ error: oe?.message ?? "failed to create order" }, { status: 500 })
    const orderId = (order as { id: string }).id

    if (tableId) {
        await supabase.from("dining_tables").update({ status: "OCCUPIED" }).eq("id", tableId)
    }

    // ---- Insert order_items + compute totals ----
    // Honour the admin-configured sale_price when it's set and lower than
    // base_price. Server-side authoritative — client-sent prices are never
    // trusted; we always price from menu_items.
    const lines = body.items.map((cartItem) => {
        const m = itemMap.get(cartItem.menu_item_id)!
        const unit = (m.sale_price != null && Number(m.sale_price) > 0 && Number(m.sale_price) < Number(m.base_price))
            ? Number(m.sale_price)
            : Number(m.base_price)
        // generate_bill treats order_items.taxable_amount as the NET
        // (pre-tax) amount and re-adds tax. For tax-inclusive items we
        // have to back the tax out here, otherwise the server inflates
        // the bill and the customer's paid amount falls short of v_grand,
        // landing the bill in BILLED instead of PAID.
        const slab = Number(m.gst_slab) || 0
        const netUnit = (m.is_tax_inclusive && slab > 0) ? unit / (1 + slab / 100) : unit
        const taxable = Number((netUnit * cartItem.quantity).toFixed(2))
        const note = typeof cartItem.notes === "string" ? cartItem.notes.trim().slice(0, 200) : ""
        return {
            tenant_id: t.id,
            order_id: orderId,
            menu_item_id: m.id,
            item_name: m.name,
            hsn_code: m.hsn_code,
            gst_slab: slab,
            quantity: cartItem.quantity,
            unit_price: unit,
            taxable_amount: taxable,
            line_total: taxable,
            notes: note || null,
        }
    })
    const { error: ie } = await supabase.from("order_items").insert(lines)
    if (ie) return NextResponse.json({ error: ie.message }, { status: 500 })

    const subtotal = lines.reduce((s, l) => s + Number(l.taxable_amount), 0)
    const tax = lines.reduce((s, l) => {
        const m = itemMap.get(l.menu_item_id!)!
        return s + Number(l.taxable_amount) * Number(m.gst_slab) / 100
    }, 0)

    // ---- Coupon (optional) — re-validate server-side; never trust the client's
    //      preview discount. Clamped so it can't exceed the taxable base.
    let couponId: string | null = null
    let couponDiscount = 0
    if (body.coupon_code?.trim()) {
        const { data: cRes } = await supabase.rpc("validate_coupon_for_tenant" as never, {
            p_tenant_id: t.id,
            p_code: body.coupon_code.trim(),
            p_subtotal: subtotal,
        } as never)
        const c = cRes as { valid?: boolean; coupon_id?: string; discount?: number } | null
        if (c?.valid && c.coupon_id) {
            couponId = c.coupon_id
            couponDiscount = Math.min(Number(c.discount ?? 0), subtotal)
        }
        // If the code is invalid here, we just ignore it — the customer's
        // expected_total (which they computed WITHOUT a discount in that case,
        // or WITH one) will fail the stale-price check below and they'll be
        // told to refresh. That's the safest outcome.
    }

    // Order-level discount reduces the payable but GST stays on the supply
    // value (matches the POS computeOrder + confirm_qr_order convention).
    const grandTotal = Math.round(((subtotal - couponDiscount) + tax) * 100) / 100

    // ---- Stale price guard ----
    // If the customer's screen showed a different total (because the owner
    // edited a price between menu fetch and submit), we void the order and
    // ask them to refresh. Tolerance: 0.5% or ₹2, whichever is greater.
    if (body.expected_total !== undefined) {
        const expected = Number(body.expected_total)
        if (Number.isFinite(expected)) {
            const tolerance = Math.max(2, grandTotal * 0.005)
            if (Math.abs(expected - grandTotal) > tolerance) {
                // Soft-void the order (don't delete — keep the audit trail).
                // Leave the table OCCUPIED; the periodic cleanup will free it.
                await supabase.from("orders").update({
                    status: "VOID",
                    awaiting_confirmation: false,
                    rejected_reason: `Price changed: customer saw ₹${expected.toFixed(2)}, server computed ₹${grandTotal.toFixed(2)}`,
                }).eq("id", orderId)
                logWarn("Stale price detected", {
                    route: "/api/public/qr/place-order",
                    tenantId: t.id,
                    expected,
                    actual: grandTotal,
                    delta: grandTotal - expected,
                })
                return NextResponse.json({
                    error: "price_changed",
                    message: `Prices changed since you opened the menu. New total: ₹${grandTotal.toFixed(2)} (you saw ₹${expected.toFixed(2)}). Please refresh and try again.`,
                    server_total: grandTotal,
                    customer_total: expected,
                }, { status: 409 })
            }
        }
    }

    // Persist the computed totals + coupon on the order row so a reloaded
    // customer page (which has nothing but the order_id from localStorage)
    // can show the actual amount, and so confirm_qr_order can apply the
    // coupon when it generates the bill. The RPC recomputes totals at billing
    // time — these are just so the customer's "awaiting" screen isn't blank.
    await supabase.from("orders").update({
        subtotal,
        order_discount: couponDiscount,
        taxable_amount: subtotal - couponDiscount,
        grand_total: grandTotal,
        coupon_id: couponId,
        coupon_discount: couponDiscount,
    }).eq("id", orderId)

    // ===== Paytm path — dynamic UPI QR + webhook auto-confirm =====
    // Issue a Paytm dynamic QR for the exact amount. The customer scans it
    // from ANY UPI app; on success Paytm POSTs to /api/webhooks/paytm,
    // which confirms the order + generates the bill. The QR is tracked in
    // paytm_payment_events so the webhook can map the payment back here.
    if (effectiveGateway === "paytm" && paytmCreds) {
        const qr = await paytmCreateQr(paytmCreds, {
            orderId,                 // the order UUID — unique, echoed by the webhook
            amount: grandTotal,
            posId: t.id,
        })
        if (!qr.ok || !qr.data?.qrData) {
            logError(new Error(`Paytm QR create failed: ${qr.message}`), {
                route: "/api/public/qr/place-order", tenantId: t.id, orderId,
            })
            // Fall back to plain UPI when we can — better than blocking the
            // customer entirely on a transient Paytm hiccup.
            if (t.upi_id) {
                await supabase.from("orders").update({ payment_gateway: "manual" }).eq("id", orderId)
                return NextResponse.json({
                    ok: true,
                    gateway: "manual",
                    order_id: orderId,
                    order_number: orderNumber,
                    amount: grandTotal,
                    coupon_discount: couponDiscount,
                    manual: {
                        upi_id: t.upi_id,
                        upi_payee_name: t.upi_payee_name ?? t.name,
                    },
                })
            }
            return NextResponse.json({
                error: "Couldn't start the payment just now. Please ask a staff member for help.",
            }, { status: 502 })
        }

        // Track the QR — paytm_order_id == the order UUID we sent to Paytm.
        // The webhook finds this row by ORDERID and is idempotent on it.
        await supabase.from("paytm_payment_events").insert({
            paytm_order_id: orderId,
            tenant_id: t.id,
            order_id: orderId,
            amount: grandTotal,
            currency: "INR",
            flow: "QR_ORDER",
            status: "PENDING",
        } as never)

        return NextResponse.json({
            ok: true,
            gateway: "paytm",
            order_id: orderId,
            order_number: orderNumber,
            amount: grandTotal,
            coupon_discount: couponDiscount,
            paytm: {
                // UPI intent string — the customer page renders it as a QR
                // (and as a "pay now" deep link when it's a upi:// intent).
                qr_data: qr.data.qrData,
                // Optional Paytm-rendered QR image (base64 PNG).
                qr_image: qr.data.image ?? null,
            },
        })
    }

    // ===== Stripe path (platform credentials + Connect destination charge) =====
    if (effectiveGateway === "stripe" && stripeAcct?.stripe_connected_account_id) {
        const feeRaw = Number(process.env.STRIPE_PLATFORM_FEE_PERCENT ?? "1")
        const feePercent = Number.isFinite(feeRaw)
            ? Math.min(100, Math.max(0, feeRaw))
            : 1
        const amountMinor = Math.round(grandTotal * 100)
        const applicationFeeMinor = Math.round(amountMinor * feePercent / 100)
        // Currency from the tenant's locale config. Stripe Checkout requires
        // a valid 3-letter currency that matches the connected account's
        // supported settlements; we lean on locale-config to do that mapping.
        const currency = (t.currency ?? "USD").toLowerCase()

        const appUrl = appOrigin(req)
        const params = new URLSearchParams()
        params.append("mode", "payment")
        params.append("line_items[0][price_data][currency]", currency)
        params.append("line_items[0][price_data][product_data][name]", `${t.name} · Order ${orderNumber}`)
        params.append("line_items[0][price_data][unit_amount]", String(amountMinor))
        params.append("line_items[0][quantity]", "1")
        params.append("metadata[order_id]", orderId)
        params.append("metadata[tenant_id]", t.id)
        params.append("metadata[order_number]", orderNumber)
        params.append("metadata[source]", "QR")
        params.append("metadata[platform_fee]", String(applicationFeeMinor))
        params.append("metadata[connected_account]", stripeAcct.stripe_connected_account_id)
        // Customer is redirected back here after payment; the QR page
        // polls /api/public/qr/order-status with the order_id and shows
        // the success screen + bill download once the webhook fires.
        params.append("success_url", `${appUrl}/qr/${body.tenant_slug}/${body.table_number}?paid=${orderId}`)
        params.append("cancel_url",  `${appUrl}/qr/${body.tenant_slug}/${body.table_number}?cancelled=${orderId}`)
        // Connect destination charge: money lands in platform, application
        // fee retained, rest auto-transferred to the connected account.
        params.append("payment_intent_data[application_fee_amount]", String(applicationFeeMinor))
        params.append("payment_intent_data[transfer_data][destination]", stripeAcct.stripe_connected_account_id)
        params.append("payment_intent_data[metadata][bill_id]", "")  // bill not generated yet
        params.append("payment_intent_data[metadata][order_id]", orderId)
        params.append("payment_intent_data[metadata][tenant_id]", t.id)
        params.append("payment_intent_data[metadata][platform_fee]", String(applicationFeeMinor))
        params.append("payment_intent_data[metadata][connected_account]", stripeAcct.stripe_connected_account_id)

        const sr = await fetch("https://api.stripe.com/v1/checkout/sessions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params,
        })
        if (!sr.ok) {
            const txt = await sr.text()
            logError(new Error(`Stripe checkout-session failed: ${txt}`), {
                route: "/api/public/qr/place-order",
                tenantId: t.id,
                orderId,
            })
            return NextResponse.json({ error: "Payment provider error" }, { status: 502 })
        }
        const session = await sr.json() as { id: string; url: string }
        await supabase.from("orders").update({ stripe_session_id: session.id }).eq("id", orderId)

        return NextResponse.json({
            ok: true,
            gateway: "stripe",
            order_id: orderId,
            order_number: orderNumber,
            amount: grandTotal,
            coupon_discount: couponDiscount,
            // Customer page redirects to this hosted Checkout URL.
            stripe: {
                checkout_url: session.url,
                session_id: session.id,
            },
        })
    }

    // ===== Manual UPI fallback =====
    return NextResponse.json({
        ok: true,
        gateway: "manual",
        order_id: orderId,
        order_number: orderNumber,
        amount: grandTotal,
        coupon_discount: couponDiscount,
        manual: {
            upi_id: t.upi_id,
            upi_payee_name: t.upi_payee_name ?? t.name,
        },
    })
}
