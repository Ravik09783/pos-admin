import { NextResponse } from "next/server"

import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { logError } from "@/lib/errors"
import { stripeFetch, stripeErrorMessage } from "@/lib/billing/stripe"

/**
 * GET /api/billing/payment-methods
 *
 * Returns the OWNER's cards on file. The default PM is whichever
 * Stripe Customer.invoice_settings.default_payment_method points at —
 * that's what Stripe uses for subscription renewals.
 *
 * Shape:
 *   {
 *     default_payment_method_id: string | null,
 *     methods: [{ id, brand, last4, exp_month, exp_year, is_default }]
 *   }
 *
 * Authorization: any tenant member. Returns an empty array (not an
 * error) when the tenant has no Stripe Customer yet — the UI shows "no
 * cards on file" instead of a confusing 4xx.
 */
export async function GET() {
    if (!process.env.STRIPE_SECRET_KEY) {
        return NextResponse.json({ error: "Stripe not configured on the server" }, { status: 500 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { data: caller } = await supabase
        .from("users").select("role, tenant_id").eq("id", user.id).maybeSingle()
    // Any tenant member can manage billing — so the restaurant is never
    // locked out just because the owner isn't around to pay.
    const tenantId = (caller as { tenant_id?: string } | null)?.tenant_id
    if (!tenantId) return NextResponse.json({ error: "not in a tenant" }, { status: 403 })

    const service = createServiceRoleClient()
    const { data: tenantRow } = await service
        .from("tenants").select("stripe_customer_id").eq("id", tenantId).maybeSingle()
    const customerId = (tenantRow as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? null
    if (!customerId) {
        return NextResponse.json({ default_payment_method_id: null, methods: [] })
    }

    // Stripe API: list cards on the customer + read the default PM in
    // one round-trip pair. The customer.invoice_settings.default_payment_method
    // field is what controls auto-renewals — keep it as the source of truth.
    const [pmsRes, custRes] = await Promise.all([
        stripeFetch(`/customers/${encodeURIComponent(customerId)}/payment_methods?type=card&limit=20`, undefined, "GET"),
        stripeFetch(`/customers/${encodeURIComponent(customerId)}`, undefined, "GET"),
    ])
    if (!pmsRes.ok) {
        logError(new Error(`Stripe payment_methods.list failed: ${pmsRes.rawText}`), {
            route: "/api/billing/payment-methods", tenantId,
        })
        return NextResponse.json({ error: stripeErrorMessage(pmsRes.data) }, { status: 502 })
    }
    if (!custRes.ok) {
        logError(new Error(`Stripe customers.retrieve failed: ${custRes.rawText}`), {
            route: "/api/billing/payment-methods", tenantId, customerId,
        })
        return NextResponse.json({ error: stripeErrorMessage(custRes.data) }, { status: 502 })
    }

    const cust = custRes.data as { invoice_settings?: { default_payment_method?: string | null } }
    const defaultPmId = cust.invoice_settings?.default_payment_method ?? null

    const pms = (pmsRes.data as { data?: StripePm[] }).data ?? []
    const methods = pms.map((pm) => ({
        id: pm.id,
        brand: pm.card?.brand ?? "card",
        last4: pm.card?.last4 ?? "????",
        exp_month: pm.card?.exp_month ?? null,
        exp_year: pm.card?.exp_year ?? null,
        is_default: pm.id === defaultPmId,
    }))

    return NextResponse.json({
        default_payment_method_id: defaultPmId,
        methods,
    })
}

interface StripePm {
    id: string
    card?: {
        brand?: string
        last4?: string
        exp_month?: number
        exp_year?: number
    }
}
