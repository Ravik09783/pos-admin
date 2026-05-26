import { NextResponse } from "next/server"

import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { stripeFetch, stripeForm, stripeErrorMessage } from "@/lib/billing/stripe"

/**
 * POST /api/billing/reactivate-subscription
 *
 * Undoes a `cancel_at_period_end=true` set by /cancel-subscription.
 * Only meaningful BEFORE the period actually ends — once Stripe has
 * fired `customer.subscription.deleted` the subscription is gone and
 * the OWNER has to start a new one via /start-subscription.
 *
 * Authorization: any tenant member.
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

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
        .from("tenants")
        .select("stripe_subscription_id")
        .eq("id", tenantId)
        .maybeSingle()
    const subId = (tenantRow as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id ?? null
    if (!subId) {
        return NextResponse.json({ error: "No subscription to reactivate" }, { status: 400 })
    }

    const r = await stripeFetch(
        `/subscriptions/${encodeURIComponent(subId)}`,
        stripeForm({ "cancel_at_period_end": "false" }),
    )
    if (!r.ok) {
        logError(new Error(`subscriptions.reactivate failed: ${r.rawText}`), {
            route: "/api/billing/reactivate-subscription", tenantId, subId,
        })
        return NextResponse.json({ error: stripeErrorMessage(r.data) }, { status: 502 })
    }

    return NextResponse.json({ ok: true })
}
