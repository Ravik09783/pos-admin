import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"

/**
 * POST /api/payments/stripe/connect/dashboard-link
 *
 * Mints a Stripe Express Dashboard Login Link for the calling tenant's
 * connected account. The OWNER clicks "View Stripe dashboard" in the
 * payment settings page, we hit this endpoint, redirect them to the
 * single-use URL.
 *
 * Why this exists: the Express dashboard at connect.stripe.com/express
 * is NOT a normal login — there's no email/password. Access is mediated
 * entirely through these one-shot login links the platform generates.
 * The link expires in ~5 minutes and is single-use.
 *
 * Authorization: OWNER only. Sub-managers seeing payouts is a separate
 * concern (the embedded dashboard handles per-role views in-app).
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
    if (callerRole !== "OWNER") return NextResponse.json({ error: "OWNER only" }, { status: 403 })

    const { data: gw } = await supabase
        .from("tenant_payment_gateways")
        .select("stripe_connected_account_id, stripe_details_submitted")
        .eq("tenant_id", tenantId)
        .maybeSingle()
    const g = gw as { stripe_connected_account_id?: string; stripe_details_submitted?: boolean } | null
    if (!g?.stripe_connected_account_id) {
        return NextResponse.json({ error: "Finish Stripe onboarding first" }, { status: 400 })
    }
    if (g.stripe_details_submitted === false) {
        return NextResponse.json({ error: "Onboarding isn't complete yet — Stripe still needs your details" }, { status: 400 })
    }

    const r = await fetch(`${STRIPE_API}/accounts/${g.stripe_connected_account_id}/login_links`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${secret}`,
            "Stripe-Version": "2024-11-20.acacia",
        },
    })
    if (!r.ok) {
        const txt = await r.text()
        logError(new Error(`Stripe login_links.create failed: ${txt}`), {
            route: "/api/payments/stripe/connect/dashboard-link",
            tenantId,
        })
        return NextResponse.json({ error: parseStripeError(txt) }, { status: 502 })
    }
    const link = await r.json() as { url: string }
    return NextResponse.json({ url: link.url })
}

function parseStripeError(txt: string): string {
    try {
        const j = JSON.parse(txt) as { error?: { message?: string } }
        return j.error?.message ?? "Stripe rejected the request"
    } catch {
        return "Stripe rejected the request"
    }
}
