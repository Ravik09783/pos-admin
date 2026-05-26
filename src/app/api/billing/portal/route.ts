import { NextResponse } from "next/server"

import { appOrigin } from "@/lib/app-origin"
import { createClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { stripeFetch, stripeForm, stripeErrorMessage } from "@/lib/billing/stripe"

/**
 * POST /api/billing/portal
 *
 * Returns a Stripe Customer Portal session URL. The OWNER opens this
 * in a new tab to:
 *   - update their card
 *   - download past invoices
 *   - retry a failed payment
 *   - cancel the subscription
 *
 * The portal is fully Stripe-hosted — what's available is configured in
 * Stripe Dashboard → Settings → Customer Portal. We just mint the link.
 *
 * Authorization: any tenant member.
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    if (!process.env.STRIPE_SECRET_KEY) {
        return NextResponse.json({ error: "Stripe not configured" }, { status: 500 })
    }
    const appUrl = appOrigin(req)

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { data: caller } = await supabase
        .from("users").select("role, tenant_id").eq("id", user.id).maybeSingle()
    // Any tenant member can manage billing — so the restaurant is never
    // locked out just because the owner isn't around to pay.
    const tenantId = (caller as { tenant_id?: string } | null)?.tenant_id
    if (!tenantId) return NextResponse.json({ error: "not in a tenant" }, { status: 403 })

    const { data: tenantRow } = await supabase
        .from("tenants").select("stripe_customer_id").eq("id", tenantId).maybeSingle()
    const customerId = (tenantRow as { stripe_customer_id?: string } | null)?.stripe_customer_id
    if (!customerId) {
        return NextResponse.json({
            error: "No payment method on file yet. Add one first.",
        }, { status: 400 })
    }

    const r = await stripeFetch("/billing_portal/sessions", stripeForm({
        customer: customerId,
        return_url: `${appUrl}/settings/billing`,
    }))
    if (!r.ok) {
        logError(new Error(`billing_portal.sessions.create failed: ${r.rawText}`), {
            route: "/api/billing/portal", tenantId,
        })
        // The most common cause is the portal not being configured in
        // Stripe Dashboard. Surface a clear message rather than the raw
        // Stripe error.
        const msg = stripeErrorMessage(r.data, "Couldn't open the Stripe billing portal.")
        return NextResponse.json({
            error: /portal/i.test(msg)
                ? "Stripe Customer Portal isn't configured. Open Stripe Dashboard → Settings → Billing → Customer portal and click 'Save'."
                : msg,
        }, { status: 502 })
    }
    const session = r.data as { url: string }
    return NextResponse.json({ url: session.url })
}
