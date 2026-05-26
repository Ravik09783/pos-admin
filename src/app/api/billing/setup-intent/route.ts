import { NextResponse } from "next/server"

import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { stripeFetch, stripeForm, stripeErrorMessage } from "@/lib/billing/stripe"

/**
 * POST /api/billing/setup-intent
 *
 * Step 1 of the "add a payment method" flow. Returns a SetupIntent
 * client_secret that the frontend's Stripe Elements <CardElement>
 * uses to attach a card to the tenant's Stripe Customer.
 *
 * Side-effects:
 *   - Creates a Stripe Customer for this tenant if one doesn't exist.
 *     Idempotency-key on tenant_id makes retries safe.
 *   - Stores the resulting cus_* in tenants.stripe_customer_id.
 *
 * Authorization: any tenant member — so a locked restaurant can be
 * unlocked by whoever is on shift, not just the owner.
 *
 * Note: this only ATTACHES a payment method. Subscription creation
 * happens separately in /api/billing/start-subscription once the card
 * is confirmed by Stripe Elements client-side.
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
        .select("id, name, email, country, currency, stripe_customer_id")
        .eq("id", tenantId)
        .maybeSingle()
    const tenant = tenantRow as {
        id: string
        name: string | null
        email: string | null
        country: string | null
        currency: string | null
        stripe_customer_id: string | null
    } | null
    if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 })

    // ── 1. Ensure we have a Stripe Customer for this tenant ───────────
    //
    // Three layers of duplicate-customer protection, in order of cost:
    //
    //   (a) Local cache hit — if tenants.stripe_customer_id is already
    //       set, that's the canonical id. No Stripe call at all.
    //   (b) Stripe search — if local is empty, look on Stripe for any
    //       customer tagged `metadata.tenant_id = <this tenant>`. Covers
    //       the "DB was restored / column got wiped, but the Stripe
    //       customer still exists" case. Cheap (one GET).
    //   (c) Idempotent create — only if (a) and (b) both miss. We send
    //       an `Idempotency-Key` keyed on tenant_id, so even if two
    //       browser tabs race this route within 24 hours, Stripe
    //       returns the same `cus_…` object both times.
    //
    // Finally we persist via an atomic UPDATE that only writes when the
    // column is still null — so a concurrent writer that won the race
    // doesn't get clobbered, and we re-read the canonical value to
    // double-check we're using whichever id actually landed in the DB.
    let customerId = tenant.stripe_customer_id

    if (!customerId) {
        // (b) Defensive Stripe search by metadata.tenant_id.
        // Stripe's search API uses Elasticsearch-style query syntax and
        // can lag indexing by up to a minute; we still try it because
        // catching a pre-existing customer is far more valuable than
        // the rare false negative (which falls through to idempotent
        // create below).
        const search = await stripeFetch(
            `/customers/search?query=${encodeURIComponent(`metadata['tenant_id']:'${tenant.id}'`)}&limit=1`,
            undefined,
            "GET",
        )
        if (search.ok) {
            const hits = (search.data as { data?: Array<{ id: string }> }).data ?? []
            if (hits[0]?.id) customerId = hits[0].id
        }
    }

    if (!customerId) {
        // (c) Idempotent create. Same key for 24h → Stripe returns the
        // same object on every retry instead of creating duplicates.
        const r = await stripeFetch(
            "/customers",
            stripeForm({
                "email": tenant.email ?? "",
                "name": tenant.name ?? "Restaurant",
                "metadata[tenant_id]": tenant.id,
                "metadata[country]": tenant.country ?? "",
            }),
            "POST",
            { "Idempotency-Key": `tenant-customer-${tenant.id}` },
        )
        if (!r.ok) {
            logError(new Error(`Stripe customers.create failed: ${r.rawText}`), {
                route: "/api/billing/setup-intent", tenantId,
            })
            return NextResponse.json({ error: stripeErrorMessage(r.data) }, { status: 502 })
        }
        customerId = (r.data as { id: string }).id
    }

    // Atomic persist. The `is.("stripe_customer_id", null)` filter lets
    // a concurrent caller that already wrote a different id win — our
    // UPDATE then affects zero rows and we re-read the winning value
    // below.
    const { error: updErr } = await service
        .from("tenants")
        .update({ stripe_customer_id: customerId } as never)
        .eq("id", tenant.id)
        .is("stripe_customer_id", null)
    if (updErr) {
        logError(updErr, { route: "/api/billing/setup-intent", step: "atomic_persist_customer", tenantId })
    }

    // Re-read to get the canonical id. If a concurrent writer beat us,
    // we use their value (and orphan the one we just minted — Stripe
    // bills nothing for idle customers so it's safe to leave).
    const { data: refreshed } = await service
        .from("tenants")
        .select("stripe_customer_id")
        .eq("id", tenant.id)
        .maybeSingle()
    customerId = (refreshed as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? customerId
    if (!customerId) {
        return NextResponse.json({ error: "Failed to resolve Stripe customer" }, { status: 500 })
    }

    // ── 2. Mint a SetupIntent (no charge — just attaches a PM) ────────
    const r2 = await stripeFetch("/setup_intents", stripeForm({
        "customer": customerId,
        "payment_method_types[0]": "card",
        "usage": "off_session",      // we'll charge later via the subscription
        "metadata[tenant_id]": tenant.id,
    }))
    if (!r2.ok) {
        logError(new Error(`Stripe setup_intents.create failed: ${r2.rawText}`), {
            route: "/api/billing/setup-intent", tenantId, customerId,
        })
        return NextResponse.json({ error: stripeErrorMessage(r2.data) }, { status: 502 })
    }
    const intent = r2.data as { client_secret: string; id: string }

    return NextResponse.json({
        client_secret: intent.client_secret,
        customer_id: customerId,
    })
}
