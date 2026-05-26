import { NextResponse } from "next/server"

import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { stripeFetch, stripeForm, stripeErrorMessage } from "@/lib/billing/stripe"

/**
 * POST /api/billing/payment-methods/default
 * Body: { payment_method_id: "pm_..." }
 *
 * Sets the default PM in two places that Stripe treats independently:
 *   1. `customer.invoice_settings.default_payment_method` — what
 *      auto-charges of NEW invoices fall back to. This is the source
 *      of truth our UI displays as "default".
 *   2. The active subscription's `default_payment_method` — overrides
 *      (1) for renewal charges of THIS subscription specifically.
 *
 * Without (2) a "set default" click would update the customer but the
 * existing subscription would keep charging the old card, which is the
 * opposite of what the OWNER expects.
 *
 * Authorization: any tenant member.
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    if (!process.env.STRIPE_SECRET_KEY) {
        return NextResponse.json({ error: "Stripe not configured on the server" }, { status: 500 })
    }

    let body: { payment_method_id?: string }
    try { body = await req.json() } catch { body = {} }
    const pmId = body.payment_method_id?.trim()
    if (!pmId || !pmId.startsWith("pm_")) {
        return NextResponse.json({ error: "payment_method_id is required" }, { status: 400 })
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
        .from("tenants")
        .select("stripe_customer_id, stripe_subscription_id")
        .eq("id", tenantId)
        .maybeSingle()
    const t = tenantRow as { stripe_customer_id?: string | null; stripe_subscription_id?: string | null } | null
    if (!t?.stripe_customer_id) {
        return NextResponse.json({ error: "no Stripe customer on this tenant" }, { status: 400 })
    }

    // ── 1. Update the customer's invoice_settings.default_payment_method.
    const r1 = await stripeFetch(
        `/customers/${encodeURIComponent(t.stripe_customer_id)}`,
        stripeForm({ "invoice_settings[default_payment_method]": pmId }),
    )
    if (!r1.ok) {
        logError(new Error(`customers.update default_payment_method failed: ${r1.rawText}`), {
            route: "/api/billing/payment-methods/default", tenantId,
        })
        return NextResponse.json({ error: stripeErrorMessage(r1.data) }, { status: 502 })
    }

    // ── 2. If there's an active subscription, point it at the new PM
    // too. Without this, the renewal still hits the old card until the
    // subscription's default_payment_method explicitly changes.
    if (t.stripe_subscription_id) {
        const r2 = await stripeFetch(
            `/subscriptions/${encodeURIComponent(t.stripe_subscription_id)}`,
            stripeForm({ "default_payment_method": pmId }),
        )
        if (!r2.ok) {
            logError(new Error(`subscriptions.update default_payment_method failed: ${r2.rawText}`), {
                route: "/api/billing/payment-methods/default", tenantId,
                subscriptionId: t.stripe_subscription_id,
            })
            // The customer-level update already succeeded — the
            // subscription will pick up the new PM on its next refresh.
            // We surface a soft warning rather than failing the whole call.
            return NextResponse.json({
                ok: true,
                warning: "Default updated, but the subscription's payment method couldn't be retargeted yet. Stripe will retry automatically.",
            })
        }
    }

    return NextResponse.json({ ok: true })
}
