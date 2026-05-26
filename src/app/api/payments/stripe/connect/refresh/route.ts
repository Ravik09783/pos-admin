import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { logError } from "@/lib/errors"

/**
 * GET /api/payments/stripe/connect/refresh
 *
 * Stripe's Account Link `refresh_url`. Hit when:
 *   - The onboarding link has expired (links are short-lived, ~minutes).
 *   - The OWNER clicked "back" out of the hosted onboarding screen
 *     and Stripe wants us to mint a fresh link.
 *
 * We re-create an Account Link for the SAME account (no new acct_*)
 * and 302 the browser to it. If anything goes wrong, fall back to the
 * payment settings page with a friendly error so the OWNER isn't stuck
 * on a Stripe blank screen.
 */
const STRIPE_API = "https://api.stripe.com/v1"

export async function GET(req: Request) {
    const secret = process.env.STRIPE_SECRET_KEY
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
    const failureRedirect = `${appUrl}/settings/payments?stripe_error=refresh`

    if (!secret) return NextResponse.redirect(failureRedirect)

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.redirect(`${appUrl}/login`)

    const { data: row } = await supabase
        .from("users").select("tenant_id, role").eq("id", user.id).maybeSingle()
    const tenantId = (row as { tenant_id?: string } | null)?.tenant_id
    if (!tenantId) return NextResponse.redirect(failureRedirect)

    const { data: gw } = await supabase
        .from("tenant_payment_gateways")
        .select("stripe_connected_account_id")
        .eq("tenant_id", tenantId)
        .maybeSingle()
    const acctId = (gw as { stripe_connected_account_id?: string } | null)?.stripe_connected_account_id
    if (!acctId) return NextResponse.redirect(failureRedirect)

    const body = new URLSearchParams()
    body.append("account", acctId)
    body.append("refresh_url", `${appUrl}/api/payments/stripe/connect/refresh`)
    body.append("return_url", `${appUrl}/settings/payments?stripe_onboarded=1`)
    body.append("type", "account_onboarding")

    const r = await fetch(`${STRIPE_API}/account_links`, {
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
        logError(new Error(`Stripe account_links.refresh failed: ${txt}`), {
            route: "/api/payments/stripe/connect/refresh",
            tenantId,
            acctId,
        })
        return NextResponse.redirect(failureRedirect)
    }
    const link = await r.json() as { url: string }
    return NextResponse.redirect(link.url)
}
