import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"

/**
 * POST /api/payments/stripe/connect/account-session
 *
 * Mints a short-lived AccountSession (`client_secret`) that the
 * `<ConnectComponentsProvider>` on the frontend uses to render
 * Stripe-hosted Embedded Components (Payments, Payouts, Balances,
 * Notification banner) scoped to this tenant's connected account.
 *
 * The client_secret is single-use per page mount; the React provider
 * re-mints it on session expiry. Lifetime is short (~30 min).
 *
 * Authorization: anyone authenticated within the tenant can view the
 * payments dashboard, but OWNER + MANAGER get the management
 * component (which lets them update bank details). Cashiers see
 * read-only payment / payout views.
 */
const STRIPE_API = "https://api.stripe.com/v1"

export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const secret = process.env.STRIPE_SECRET_KEY
    if (!secret) return NextResponse.json({ error: "Stripe not configured" }, { status: 500 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { data: caller } = await supabase
        .from("users").select("role, tenant_id").eq("id", user.id).maybeSingle()
    const callerRole = (caller as { role?: string } | null)?.role
    const tenantId = (caller as { tenant_id?: string } | null)?.tenant_id
    if (!tenantId) return NextResponse.json({ error: "not in a tenant" }, { status: 403 })

    // Only OWNER + MANAGER + AUDITOR get payment-data visibility. Cashiers
    // see their own collections via /my-collections instead.
    if (callerRole !== "OWNER" && callerRole !== "MANAGER" && callerRole !== "AUDITOR") {
        return NextResponse.json({ error: "Insufficient role" }, { status: 403 })
    }

    const { data: gw } = await supabase
        .from("tenant_payment_gateways")
        .select("stripe_connected_account_id")
        .eq("tenant_id", tenantId)
        .maybeSingle()
    const acctId = (gw as { stripe_connected_account_id?: string } | null)?.stripe_connected_account_id
    if (!acctId) {
        return NextResponse.json({ error: "Connect a Stripe account first" }, { status: 400 })
    }

    const body = new URLSearchParams()
    body.append("account", acctId)
    // Enable the components we render on /settings/payments/dashboard.
    // Read more: https://docs.stripe.com/connect/supported-embedded-components
    body.append("components[payments][enabled]", "true")
    body.append("components[payments][features][refund_management]", "true")
    body.append("components[payments][features][dispute_management]", "true")
    body.append("components[payments][features][capture_payments]", "false")
    body.append("components[payouts][enabled]", "true")
    body.append("components[payouts][features][instant_payouts]", "true")
    body.append("components[payouts][features][standard_payouts]", "true")
    body.append("components[payouts][features][edit_payout_schedule]", "true")
    body.append("components[balances][enabled]", "true")
    body.append("components[notification_banner][enabled]", "true")
    // Account management is OWNER-only — managers can VIEW the dashboard
    // but can't change bank details. We toggle the component on/off
    // here based on role; the React side picks it up from the response.
    if (callerRole === "OWNER") {
        body.append("components[account_management][enabled]", "true")
        body.append("components[account_management][features][external_account_collection]", "true")
    }

    const r = await fetch(`${STRIPE_API}/account_sessions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Stripe-Version": "2024-11-20.acacia",
        },
        body,
    })
    if (!r.ok) {
        const txt = await r.text()
        logError(new Error(`Stripe account_sessions.create failed: ${txt}`), {
            route: "/api/payments/stripe/connect/account-session",
            tenantId,
            acctId,
        })
        return NextResponse.json({ error: parseStripeError(txt) }, { status: 502 })
    }
    const session = await r.json() as { client_secret: string }
    return NextResponse.json({
        client_secret: session.client_secret,
        can_manage_account: callerRole === "OWNER",
    })
}

function parseStripeError(txt: string): string {
    try {
        const j = JSON.parse(txt) as { error?: { message?: string } }
        return j.error?.message ?? "Stripe rejected the request"
    } catch {
        return "Stripe rejected the request"
    }
}
