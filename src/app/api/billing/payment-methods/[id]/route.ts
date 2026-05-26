import { NextResponse } from "next/server"

import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { stripeFetch, stripeErrorMessage } from "@/lib/billing/stripe"

/**
 * DELETE /api/billing/payment-methods/:id
 *
 * Detaches a payment method from the tenant's Stripe Customer. Two
 * safety guards stop the OWNER from breaking their own renewals:
 *
 *   1. Refuse to detach the DEFAULT PM while another card is on file —
 *      they'd have to switch the default first. Removing the default
 *      while leaving others orphans the subscription's billing fallback.
 *   2. Refuse to detach the LAST PM if a subscription is active — the
 *      next renewal would fail. Cancel the sub or add a replacement
 *      card first.
 *
 * Authorization: any tenant member.
 */
export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    if (!process.env.STRIPE_SECRET_KEY) {
        return NextResponse.json({ error: "Stripe not configured on the server" }, { status: 500 })
    }

    const { id: pmId } = await params
    if (!pmId || !pmId.startsWith("pm_")) {
        return NextResponse.json({ error: "invalid payment method id" }, { status: 400 })
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
        .select("stripe_customer_id, stripe_subscription_id, subscription_status, trial_ends_at")
        .eq("id", tenantId)
        .maybeSingle()
    const t = tenantRow as {
        stripe_customer_id?: string | null
        stripe_subscription_id?: string | null
        subscription_status?: string | null
        trial_ends_at?: string | null
    } | null
    if (!t?.stripe_customer_id) {
        return NextResponse.json({ error: "no Stripe customer on this tenant" }, { status: 400 })
    }

    // Look up: how many cards are on the customer? Which is default?
    const [pmsRes, custRes] = await Promise.all([
        stripeFetch(`/customers/${encodeURIComponent(t.stripe_customer_id)}/payment_methods?type=card&limit=20`, undefined, "GET"),
        stripeFetch(`/customers/${encodeURIComponent(t.stripe_customer_id)}`, undefined, "GET"),
    ])
    if (!pmsRes.ok || !custRes.ok) {
        return NextResponse.json({ error: "Couldn't read current payment methods from Stripe" }, { status: 502 })
    }
    const pms = ((pmsRes.data as { data?: { id: string }[] }).data ?? [])
    const defaultId = (custRes.data as { invoice_settings?: { default_payment_method?: string | null } })
        .invoice_settings?.default_payment_method ?? null

    const isOnlyCard = pms.length <= 1
    const isDefault = defaultId === pmId
    // A TRIAL with a Stripe subscription_id attached is a SCHEDULED
    // charge — the card is set to auto-bill on `trial_ends_at`. Treat
    // it like an active subscription for last-card-removal purposes:
    // dropping the only PM would silently break the upcoming charge.
    // The OWNER must either add a replacement card or explicitly
    // cancel the scheduled subscription first.
    const subActive =
        t.subscription_status === "ACTIVE" ||
        t.subscription_status === "PAST_DUE" ||
        (t.subscription_status === "TRIAL" && Boolean(t.stripe_subscription_id))

    if (isOnlyCard && subActive) {
        const isTrialScheduled =
            t.subscription_status === "TRIAL" && Boolean(t.stripe_subscription_id)
        return NextResponse.json({
            error: isTrialScheduled
                ? "This card is scheduled to be charged when your free trial ends. Removing it would silently break that charge. Add a replacement card first, or cancel the scheduled subscription from this page."
                : "This is your only card on file and you have an active subscription. Add another card before removing this one — Stripe needs at least one valid card to renew the subscription.",
        }, { status: 409 })
    }
    if (isDefault && pms.length > 1) {
        return NextResponse.json({
            error: "This card is your default. Pick another card as the default before removing this one.",
        }, { status: 409 })
    }

    const det = await stripeFetch(`/payment_methods/${encodeURIComponent(pmId)}/detach`, new URLSearchParams())
    if (!det.ok) {
        logError(new Error(`payment_methods.detach failed: ${det.rawText}`), {
            route: "/api/billing/payment-methods/[id]", tenantId, pmId,
        })
        return NextResponse.json({ error: stripeErrorMessage(det.data) }, { status: 502 })
    }

    return NextResponse.json({ ok: true })
}
