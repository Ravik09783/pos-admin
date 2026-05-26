import { NextResponse } from "next/server"

import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { stripeFetch, stripeForm, stripeErrorMessage } from "@/lib/billing/stripe"

/**
 * POST /api/billing/cancel-subscription
 *
 * Cancels the tenant's Stripe subscription at the end of the current
 * billing period (NOT immediately) so the OWNER keeps access for what
 * they've already paid for. Stripe will fire
 * `customer.subscription.deleted` when the period actually ends; the
 * webhook flips our cached `subscription_status` to `CANCELED` at
 * that moment.
 *
 * Why not cancel immediately:
 *   - Customer-friendly default — they paid for the period, they get
 *     the period. Immediate cancellation forfeits the remainder.
 *   - Reversible — they can hit Reactivate any time before the period
 *     ends and we just clear cancel_at_period_end.
 *
 * Authorization: any tenant member — billing is shared so a locked
 * restaurant is never stuck waiting for the owner to act.
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
        return NextResponse.json({ error: "No active subscription to cancel" }, { status: 400 })
    }

    // `cancel_at_period_end=true` is the soft-cancel. Stripe still
    // honors the current paid period, then deletes the sub when the
    // period rolls over. `customer.subscription.updated` fires here;
    // `customer.subscription.deleted` fires at period end.
    const r = await stripeFetch(
        `/subscriptions/${encodeURIComponent(subId)}`,
        stripeForm({ "cancel_at_period_end": "true" }),
    )
    if (!r.ok) {
        logError(new Error(`subscriptions.cancel(at_period_end) failed: ${r.rawText}`), {
            route: "/api/billing/cancel-subscription", tenantId, subId,
        })
        return NextResponse.json({ error: stripeErrorMessage(r.data) }, { status: 502 })
    }

    const sub = r.data as { current_period_end?: number; cancel_at_period_end?: boolean; cancel_at?: number }
    return NextResponse.json({
        ok: true,
        cancel_at_period_end: sub.cancel_at_period_end ?? true,
        cancels_on: sub.cancel_at
            ? new Date(sub.cancel_at * 1000).toISOString()
            : sub.current_period_end
                ? new Date(sub.current_period_end * 1000).toISOString()
                : null,
    })
}
