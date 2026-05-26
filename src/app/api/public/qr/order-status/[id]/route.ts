import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"

/**
 * GET /api/public/qr/order-status/:id
 *
 * Single source of truth for the guest's reload-restore: returns the full
 * order details (items, totals, customer, gateway, current stage). The
 * order UUID is effectively a bearer token here — knowing it grants access
 * to that one order, which is fine since the guest needs to read their own.
 *
 * Stages:
 *  - "pay_manual"             — manual UPI, awaiting payment + proof upload
 *  - "awaiting_confirmation"  — payment captured/uploaded, restaurant verifying
 *  - "confirmed"              — staff approved (or webhook auto-confirmed)
 *  - "rejected"               — staff rejected or order was voided
 */
export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params
    if (!id || id.length < 8) {
        return NextResponse.json({ error: "invalid id" }, { status: 400 })
    }
    const supabase = createServiceRoleClient()
    const { data: order } = await supabase
        .from("orders")
        .select(`
            id, tenant_id, order_number, status, source, payment_gateway,
            awaiting_confirmation, confirmed_at, rejected_reason,
            subtotal, taxable_amount, cgst_amount, sgst_amount, grand_total,
            table_id, customer_id, notes, created_at, paid_at
        `)
        .eq("id", id)
        .maybeSingle()
    if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 })

    const o = order as {
        id: string
        tenant_id: string
        order_number: string
        status: string
        source: string | null
        payment_gateway: string | null
        awaiting_confirmation: boolean
        confirmed_at: string | null
        rejected_reason: string | null
        subtotal: number
        taxable_amount: number
        cgst_amount: number
        sgst_amount: number
        grand_total: number
        table_id: string | null
        customer_id: string | null
        notes: string | null
        created_at: string
        paid_at: string | null
    }

    // Refuse to leak non-QR orders. This endpoint is public — the guest's
    // order UUID is the only secret. Block walk-in/POS orders even if
    // someone guesses a UUID.
    if (o.source && o.source !== "QR") {
        return NextResponse.json({ error: "not_found" }, { status: 404 })
    }

    // Line items
    const { data: itemsRaw } = await supabase
        .from("order_items")
        .select("id, item_name, quantity, unit_price, gst_slab, taxable_amount, line_total, is_void")
        .eq("order_id", id)
        .order("created_at", { ascending: true })
    const items = (itemsRaw ?? [])
        .filter((i: { is_void?: boolean }) => !i.is_void)
        .map((i: {
            id: string; item_name: string; quantity: number; unit_price: number;
            gst_slab: number; taxable_amount: number; line_total: number
        }) => ({
            id: i.id,
            item_name: i.item_name,
            quantity: i.quantity,
            unit_price: Number(i.unit_price),
            gst_slab: Number(i.gst_slab),
            taxable_amount: Number(i.taxable_amount),
            line_total: Number(i.line_total) || Number(i.taxable_amount),
        }))

    // Has the customer uploaded proof? (manual UPI only)
    const { data: proof } = await supabase
        .from("qr_payment_proofs")
        .select("status, screenshot_url, created_at")
        .eq("order_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    const p = proof as { status: string; screenshot_url: string; created_at: string } | null

    // Tenant (for display + UPI fallback if guest needs to re-show QR)
    const { data: tenant } = await supabase
        .from("tenants")
        .select("name, slug, upi_id, upi_payee_name, payment_gateway")
        .eq("id", o.tenant_id)
        .maybeSingle()

    // Bill (for the "Download bill" link on the success screen). May not
    // exist yet — bill is created server-side after payment webhook fires,
    // so the customer's first few polls won't see it. That's fine; once
    // it lands, the success-screen link enables.
    const { data: bill } = await supabase
        .from("bills")
        .select("id, invoice_number, bill_status")
        .eq("order_id", o.id)
        .maybeSingle()

    // Customer (for display only)
    let customer: { name: string | null; phone: string | null } | null = null
    if (o.customer_id) {
        const { data: c } = await supabase
            .from("customers")
            .select("name, phone")
            .eq("id", o.customer_id)
            .maybeSingle()
        if (c) customer = { name: (c as { name: string | null }).name, phone: (c as { phone: string | null }).phone }
    }

    // Compute stage. The "rejected" check beats "confirmed" because a
    // refunded order could in principle have both timestamps set.
    let stage: "pay_manual" | "awaiting_confirmation" | "confirmed" | "rejected"
    if (o.status === "VOID") {
        stage = "rejected"
    } else if (o.status === "PAID" || o.status === "BILLED" || o.status === "CLOSED") {
        stage = "confirmed"
    } else if (!o.awaiting_confirmation) {
        // Order is OPEN/IN_PROGRESS but no longer awaiting → was reset by staff
        stage = "awaiting_confirmation"
    } else if (o.payment_gateway === "paytm" || o.payment_gateway === "stripe") {
        // Online gateway: the customer pays via the Paytm QR / Stripe
        // Checkout and we wait for the webhook. No "pay_manual" stage —
        // there's no screenshot to upload.
        stage = "awaiting_confirmation"
    } else if (!p) {
        // Manual UPI but no proof uploaded yet
        stage = "pay_manual"
    } else {
        stage = "awaiting_confirmation"
    }

    return NextResponse.json({
        order: {
            id: o.id,
            order_number: o.order_number,
            status: o.status,
            payment_gateway: o.payment_gateway,
            subtotal: Number(o.subtotal) || 0,
            taxable_amount: Number(o.taxable_amount) || 0,
            cgst_amount: Number(o.cgst_amount) || 0,
            sgst_amount: Number(o.sgst_amount) || 0,
            grand_total: Number(o.grand_total) || 0,
            rejected_reason: o.rejected_reason,
            confirmed_at: o.confirmed_at,
            paid_at: o.paid_at,
            created_at: o.created_at,
            notes: o.notes,
        },
        items,
        proof: p ? { status: p.status, screenshot_url: p.screenshot_url, created_at: p.created_at } : null,
        tenant: tenant
            ? {
                name: (tenant as { name: string }).name,
                slug: (tenant as { slug: string }).slug,
                upi_id: (tenant as { upi_id: string | null }).upi_id,
                upi_payee_name: (tenant as { upi_payee_name: string | null }).upi_payee_name,
                payment_gateway: (tenant as { payment_gateway: string | null }).payment_gateway,
            }
            : null,
        customer,
        stage,
        // Bill info (when generated). The customer's success screen reads
        // this to render a "Download bill" link to /b/<slug>/<invoice>.
        bill: bill
            ? {
                id: (bill as { id: string }).id,
                invoice_number: (bill as { invoice_number: string }).invoice_number,
                bill_status: (bill as { bill_status: string }).bill_status,
            }
            : null,
    })
}

export const dynamic = "force-dynamic"
