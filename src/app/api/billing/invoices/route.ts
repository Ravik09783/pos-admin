import { NextResponse } from "next/server"

import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { logError } from "@/lib/errors"
import { stripeFetch, stripeErrorMessage } from "@/lib/billing/stripe"

/**
 * GET /api/billing/invoices
 *
 * Returns the last 12 invoices for the tenant's Stripe Customer. The
 * shape is tuned for an in-app table: just the columns the UI needs +
 * the `invoice_pdf` URL so the "Download" button can link directly to
 * Stripe's CDN (no proxying through us).
 *
 * Authorization: any tenant member. Tenants with no Stripe Customer yet
 * get an empty array — the UI shows "no invoices yet" instead of 4xx.
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
    if (!customerId) return NextResponse.json({ invoices: [] })

    const r = await stripeFetch(
        `/invoices?customer=${encodeURIComponent(customerId)}&limit=12`,
        undefined,
        "GET",
    )
    if (!r.ok) {
        logError(new Error(`Stripe invoices.list failed: ${r.rawText}`), {
            route: "/api/billing/invoices", tenantId,
        })
        return NextResponse.json({ error: stripeErrorMessage(r.data) }, { status: 502 })
    }

    const rows = ((r.data as { data?: StripeInvoice[] }).data ?? []).map((inv) => ({
        id: inv.id,
        number: inv.number ?? null,
        status: inv.status ?? "open",
        amount_paid: (inv.amount_paid ?? 0) / 100,
        amount_due: (inv.amount_due ?? 0) / 100,
        currency: (inv.currency ?? "usd").toUpperCase(),
        created: inv.created ? new Date(inv.created * 1000).toISOString() : null,
        period_start: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
        period_end: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
        hosted_invoice_url: inv.hosted_invoice_url ?? null,
        invoice_pdf: inv.invoice_pdf ?? null,
    }))

    return NextResponse.json({ invoices: rows })
}

interface StripeInvoice {
    id: string
    number?: string | null
    status?: string
    amount_paid?: number
    amount_due?: number
    currency?: string
    created?: number
    period_start?: number
    period_end?: number
    hosted_invoice_url?: string | null
    invoice_pdf?: string | null
}
