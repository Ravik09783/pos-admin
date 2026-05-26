import { NextResponse } from "next/server"

import { appOrigin } from "@/lib/app-origin"
import { createClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"

/**
 * POST /api/payments/stripe/connect/onboard
 *
 * Creates a Stripe Connect Express account for the calling tenant if
 * they don't already have one, then returns an Account Link URL the
 * OWNER opens in a new tab to finish Stripe-side onboarding (bank
 * account, tax ID, identity verification).
 *
 * Body: {}  (everything comes from the auth + tenant context)
 *
 * Flow:
 *   1. Resolve caller's tenant + country.
 *   2. If tenant_payment_gateways.stripe_connected_account_id is null,
 *      POST /v1/accounts to mint an Express account.
 *      Persist the resulting acct_* immediately so a retry doesn't
 *      create a duplicate account (Stripe charges nothing to make one
 *      but multiple lying around is messy).
 *   3. POST /v1/account_links with type=account_onboarding.
 *   4. Return { url } — caller opens it in a new tab.
 *
 * Authorization: caller must be OWNER (account creation is a financial
 * action; managers shouldn't be able to fork off new Stripe accounts).
 */
const STRIPE_API = "https://api.stripe.com/v1"

export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const secret = process.env.STRIPE_SECRET_KEY
    const appUrl = appOrigin(req)
    if (!secret) return NextResponse.json({ error: "Stripe not configured on the server" }, { status: 500 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    // Authorization: OWNER only.
    const { data: caller } = await supabase
        .from("users")
        .select("role, tenant_id")
        .eq("id", user.id)
        .maybeSingle()
    const callerRole = (caller as { role?: string } | null)?.role
    const tenantId = (caller as { tenant_id?: string } | null)?.tenant_id
    if (!callerRole || !tenantId) {
        return NextResponse.json({ error: "not in a tenant" }, { status: 403 })
    }
    if (callerRole !== "OWNER") {
        return NextResponse.json({ error: "OWNER only" }, { status: 403 })
    }

    // Pull tenant + existing acct_* (if any).
    const { data: tenantRow } = await supabase
        .from("tenants").select("name, email, country, currency").eq("id", tenantId).maybeSingle()
    const tenant = tenantRow as { name?: string; email?: string; country?: string; currency?: string } | null
    if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 })

    const { data: gwRow } = await supabase
        .from("tenant_payment_gateways")
        .select("stripe_connected_account_id")
        .eq("tenant_id", tenantId)
        .maybeSingle()
    let acctId = (gwRow as { stripe_connected_account_id?: string } | null)?.stripe_connected_account_id ?? null

    // ── Step 1. Create the Express account if we don't already have one.
    if (!acctId) {
        // Stripe ISO-3166 country code. We try our best to map the
        // tenants.country (e.g. "United States") to a 2-letter code.
        const country = isoCountry(tenant.country)
        const body = new URLSearchParams()
        body.append("type", "express")
        body.append("country", country)
        if (tenant.email) body.append("email", tenant.email)
        body.append("business_profile[name]", tenant.name ?? "Restaurant")
        body.append("business_profile[product_description]", "Restaurant point-of-sale and online ordering")
        body.append("capabilities[card_payments][requested]", "true")
        body.append("capabilities[transfers][requested]", "true")
        // Idempotency: re-runs of this endpoint by the same tenant in a
        // short window won't accidentally create two accounts.
        const r = await fetch(`${STRIPE_API}/accounts`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${secret}`,
                "Content-Type": "application/x-www-form-urlencoded",
                "Stripe-Version": "2024-11-20.acacia",
                "Idempotency-Key": `connect-onboard-${tenantId}`,
            },
            body,
        })
        if (!r.ok) {
            const txt = await r.text()
            logError(new Error(`Stripe accounts.create failed: ${txt}`), {
                route: "/api/payments/stripe/connect/onboard",
                tenantId,
            })
            return NextResponse.json({ error: parseStripeError(txt) }, { status: 502 })
        }
        const account = await r.json() as { id: string; country?: string }
        acctId = account.id

        // Persist immediately so subsequent retries see the existing acct.
        const { error: upErr } = await supabase
            .from("tenant_payment_gateways")
            .upsert({
                tenant_id: tenantId,
                stripe_connected_account_id: acctId,
                stripe_account_enabled: true,
                stripe_account_country: account.country ?? country,
                stripe_charges_enabled: false,
                stripe_payouts_enabled: false,
                stripe_details_submitted: false,
            } as never, { onConflict: "tenant_id" })
        if (upErr) {
            logError(upErr, { route: "/api/payments/stripe/connect/onboard", step: "persist_acct" })
            // Don't fail the whole call — the account exists on Stripe's
            // side; we just couldn't write it locally. The webhook will
            // self-heal on the next account.updated event.
        }
    }

    // ── Step 2. Mint an Account Link for the hosted onboarding flow.
    const linkBody = new URLSearchParams()
    linkBody.append("account", acctId)
    linkBody.append("refresh_url", `${appUrl}/api/payments/stripe/connect/refresh`)
    linkBody.append("return_url", `${appUrl}/settings/payments?stripe_onboarded=1`)
    linkBody.append("type", "account_onboarding")

    const linkRes = await fetch(`${STRIPE_API}/account_links`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: linkBody,
    })
    if (!linkRes.ok) {
        const txt = await linkRes.text()
        logError(new Error(`Stripe account_links.create failed: ${txt}`), {
            route: "/api/payments/stripe/connect/onboard",
            tenantId,
            acctId,
        })
        return NextResponse.json({ error: parseStripeError(txt) }, { status: 502 })
    }
    const link = await linkRes.json() as { url: string; expires_at: number }
    return NextResponse.json({ url: link.url, account_id: acctId, expires_at: link.expires_at })
}

/** Crude mapping from country name (as stored in tenants.country) to a
 *  Stripe-acceptable ISO 3166-1 alpha-2 country code. Stripe Connect Express
 *  is available in ~46 countries — we cover the common ones. Unknown
 *  countries default to US which Stripe will reject during onboarding;
 *  the OWNER's KYC step then surfaces the error. */
function isoCountry(name: string | null | undefined): string {
    if (!name) return "US"
    const lower = name.toLowerCase().trim()
    const map: Record<string, string> = {
        "united states": "US",
        "usa": "US",
        "united kingdom": "GB",
        "uk": "GB",
        "great britain": "GB",
        "canada": "CA",
        "australia": "AU",
        "new zealand": "NZ",
        "ireland": "IE",
        "germany": "DE",
        "france": "FR",
        "italy": "IT",
        "spain": "ES",
        "netherlands": "NL",
        "belgium": "BE",
        "portugal": "PT",
        "austria": "AT",
        "denmark": "DK",
        "sweden": "SE",
        "norway": "NO",
        "finland": "FI",
        "switzerland": "CH",
        "singapore": "SG",
        "hong kong": "HK",
        "japan": "JP",
        "malaysia": "MY",
        "united arab emirates": "AE",
        "uae": "AE",
        "saudi arabia": "SA",
        "mexico": "MX",
        "brazil": "BR",
    }
    // Two-letter code passed in already? Return upper-cased.
    if (/^[a-z]{2}$/.test(lower)) return lower.toUpperCase()
    return map[lower] ?? "US"
}

/** Stripe error responses look like `{"error":{"message":"…"}}` — surface
 *  the human-readable message so the UI toast isn't gibberish. */
function parseStripeError(txt: string): string {
    try {
        const j = JSON.parse(txt) as { error?: { message?: string } }
        return j.error?.message ?? "Stripe rejected the request"
    } catch {
        return "Stripe rejected the request"
    }
}
