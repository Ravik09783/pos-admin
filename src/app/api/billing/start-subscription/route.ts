import { NextResponse } from "next/server"

import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { stripeFetch, stripeForm, stripeErrorMessage } from "@/lib/billing/stripe"
import {
    findPlan, getStripePriceIdForPlan,
    type PlanRegion, type PlanTier,
} from "@/lib/billing/plans"
import { getTaxConfig } from "@/lib/tax/locale-config"

/**
 * POST /api/billing/start-subscription
 *
 * Body: { payment_method_id }  (pm_*, from Stripe Elements after card confirm)
 *
 * Step 2 of the "add card" flow. Four things happen here:
 *
 *   1. Attach the payment method to the customer (if not already).
 *   2. Set it as the customer's default invoice payment method.
 *   3. Resolve the right Stripe Price ID from the tenant's
 *      `plan_tier` + country (e.g. tier=growth + country=US →
 *      STRIPE_PLATFORM_PRICE_ID_INTL_GROWTH). See `plans.ts`.
 *   4. Create a Subscription on that Price ID.
 *
 * The Subscription's `customer.subscription.created` webhook then
 * mirrors the status into tenants.subscription_status. The first
 * invoice fires immediately; on success `invoice.payment_succeeded`
 * sets ACTIVE; on failure PAST_DUE.
 *
 * Idempotency: if the tenant already has a stripe_subscription_id, we
 * return the existing one rather than creating a duplicate.
 *
 * Authorization: any tenant member — same as setup-intent.
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    // Price ID is resolved later from the tenant's country + selected tier
    // (see step 3 below). We just need the secret key + at least the
    // legacy single price OR a per-tier price for whichever plan they end
    // up on — the actual lookup happens after we know the tier.
    if (!process.env.STRIPE_SECRET_KEY) {
        return NextResponse.json({
            error: "Platform billing isn't configured on the server. Set STRIPE_SECRET_KEY and try again.",
        }, { status: 500 })
    }

    const body = (await req.json().catch(() => null)) as { payment_method_id?: string } | null
    if (!body?.payment_method_id || !body.payment_method_id.startsWith("pm_")) {
        return NextResponse.json({ error: "payment_method_id required (pm_*)" }, { status: 400 })
    }
    const pmId = body.payment_method_id

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
        .select("id, stripe_customer_id, stripe_subscription_id, country, plan_tier, subscription_status, trial_ends_at")
        .eq("id", tenantId)
        .maybeSingle()
    const tenant = tenantRow as {
        id: string
        stripe_customer_id: string | null
        stripe_subscription_id: string | null
        country: string | null
        plan_tier: PlanTier | null
        subscription_status: string | null
        trial_ends_at: string | null
    } | null
    if (!tenant?.stripe_customer_id) {
        return NextResponse.json({
            error: "No Stripe customer for this tenant. Run /api/billing/setup-intent first.",
        }, { status: 400 })
    }

    // ── Resolve which Stripe Price ID to bill on ──────────────────────
    // Region is derived from the tenant's country (India → IN, else INTL).
    // Tier is whatever the OWNER picked via /settings/billing; defaults
    // to Starter if they skipped that step (the picker also writes
    // tenants.plan_tier on every selection). Each tier has its own env
    // var (STRIPE_PLATFORM_PRICE_ID_INTL_STARTER, etc.) — see plans.ts.
    // Legacy fallback: if no per-tier env is set, fall back to the
    // single STRIPE_PLATFORM_PRICE_ID so existing deploys don't break.
    const region: PlanRegion = getTaxConfig(tenant.country).code === "IN" ? "IN" : "INTL"
    const tier: PlanTier = tenant.plan_tier ?? "starter"
    const plan = findPlan(region, tier)
    const priceId = getStripePriceIdForPlan(plan) ?? process.env.STRIPE_PLATFORM_PRICE_ID ?? null
    if (!priceId) {
        return NextResponse.json({
            error: `No Stripe Price ID configured for the ${plan.name} plan (${region}). Set ${plan.stripePriceIdEnvVar} in the server env.`,
        }, { status: 500 })
    }

    // ── Idempotency: existing subscription? Return it. ────────────────
    if (tenant.stripe_subscription_id) {
        // Refresh card details from the PM we just attached, so the UI
        // shows the right brand/last4 even if Stripe is mid-sync.
        await refreshCardOnTenant(service, tenant.id, tenant.stripe_customer_id, pmId)
        return NextResponse.json({
            ok: true,
            subscription_id: tenant.stripe_subscription_id,
            cached: true,
        })
    }

    // ── 1. Attach the PM to the customer (idempotent on Stripe's side) ─
    const attach = await stripeFetch(`/payment_methods/${pmId}/attach`, stripeForm({
        customer: tenant.stripe_customer_id,
    }))
    if (!attach.ok) {
        // PMs can already be attached — that's fine, Stripe returns a
        // specific error code we can swallow. Otherwise surface.
        const errCode = (attach.data as { error?: { code?: string } })?.error?.code
        if (errCode !== "payment_method_already_attached") {
            logError(new Error(`payment_methods.attach failed: ${attach.rawText}`), {
                route: "/api/billing/start-subscription", tenantId,
            })
            return NextResponse.json({ error: stripeErrorMessage(attach.data) }, { status: 502 })
        }
    }

    // ── 2. Set as default invoice payment method ──────────────────────
    const setDefault = await stripeFetch(
        `/customers/${tenant.stripe_customer_id}`,
        stripeForm({ "invoice_settings[default_payment_method]": pmId }),
    )
    if (!setDefault.ok) {
        logError(new Error(`customers.update default_pm failed: ${setDefault.rawText}`), {
            route: "/api/billing/start-subscription", tenantId,
        })
        return NextResponse.json({ error: stripeErrorMessage(setDefault.data) }, { status: 502 })
    }

    // ── 3. Create the subscription ────────────────────────────────────
    // payment_behavior = default_incomplete so we can surface 3DS
    // challenges on the client.
    //
    // Honor the in-app free trial. When the tenant is still on TRIAL
    // and `trial_ends_at` is in the future, we pass `trial_end` to
    // Stripe so:
    //   - the subscription enters `trialing` state, NOT `active`
    //   - NO charge fires today; Stripe creates a $0 invoice
    //   - on `trial_ends_at`, Stripe auto-transitions to `active` and
    //     bills the card for the first paid period
    // This is what the OWNER expects when "starting a subscription
    // during the free trial" — card on file, charge deferred to trial
    // end. Without `trial_end` Stripe charges immediately, eating the
    // remaining trial days.
    //
    // Idempotency-Key on (tenant, price, customer): two browser tabs
    // racing this route — or a network retry — return the SAME
    // subscription instead of starting two. The key includes priceId
    // so a real "switch to a different tier" goes through as a fresh
    // call. Stripe's window is 24h, plenty for the user-visible races.
    const idemKey = `start-sub-${tenant.id}-${tenant.stripe_customer_id}-${priceId}`

    const trialEndUnix = tenant.subscription_status === "TRIAL" && tenant.trial_ends_at
        ? Math.floor(new Date(tenant.trial_ends_at).getTime() / 1000)
        : null
    const trialStillRunning = trialEndUnix != null && trialEndUnix > Math.floor(Date.now() / 1000)

    const subParams: Record<string, string> = {
        "customer": tenant.stripe_customer_id,
        "items[0][price]": priceId,
        "default_payment_method": pmId,
        "payment_behavior": "default_incomplete",
        "payment_settings[save_default_payment_method]": "on_subscription",
        "expand[0]": "latest_invoice.payment_intent",
        "metadata[tenant_id]": tenant.id,
    }
    if (trialStillRunning) {
        subParams["trial_end"] = String(trialEndUnix)
        // proration_behavior=none avoids a tiny prorated charge for
        // the moment between subscription creation and trial start.
        subParams["proration_behavior"] = "none"
    }

    const sub = await stripeFetch(
        "/subscriptions",
        stripeForm(subParams),
        "POST",
        { "Idempotency-Key": idemKey },
    )
    if (!sub.ok) {
        logError(new Error(`subscriptions.create failed: ${sub.rawText}`), {
            route: "/api/billing/start-subscription", tenantId,
        })
        return NextResponse.json({ error: stripeErrorMessage(sub.data) }, { status: 502 })
    }

    const subData = sub.data as {
        id: string
        status: string
        current_period_end?: number
        latest_invoice?: {
            payment_intent?: { client_secret?: string; status?: string }
        }
    }

    // Cache the subscription id immediately. The webhook will refine
    // status + period_end on `customer.subscription.created` shortly.
    await service
        .from("tenants")
        .update({
            stripe_subscription_id: subData.id,
            platform_payment_method_id: pmId,
            subscription_status: mapStripeStatus(subData.status),
            current_period_end: subData.current_period_end
                ? new Date(subData.current_period_end * 1000).toISOString()
                : null,
        } as never)
        .eq("id", tenant.id)

    await refreshCardOnTenant(service, tenant.id, tenant.stripe_customer_id, pmId)

    return NextResponse.json({
        ok: true,
        subscription_id: subData.id,
        status: subData.status,
        client_secret: subData.latest_invoice?.payment_intent?.client_secret ?? null,
        // If client_secret is present + status is `requires_action`,
        // the frontend needs to call stripe.confirmCardPayment to clear
        // a 3DS challenge before the first invoice settles.
    })
}

type ServiceClient = ReturnType<typeof createServiceRoleClient>

/** Pull brand + last4 from the freshly-attached PM and cache them on
 *  the tenant so the billing settings page can show "Visa •••• 4242"
 *  without a follow-up Stripe round-trip. Best-effort — if the
 *  payment_methods retrieve fails (rare), we just skip the cache. */
async function refreshCardOnTenant(
    service: ServiceClient,
    tenantId: string,
    customerId: string,
    pmId: string,
) {
    const r = await stripeFetch(`/payment_methods/${pmId}`, undefined, "GET")
    if (!r.ok) return
    const pm = r.data as { card?: { brand?: string; last4?: string } }
    await service
        .from("tenants")
        .update({
            platform_payment_method_id: pmId,
            platform_card_brand: pm.card?.brand ?? null,
            platform_card_last4: pm.card?.last4 ?? null,
        } as never)
        .eq("id", tenantId)
    void customerId  // referenced for symmetry; not used in this body
}

/** Stripe subscription statuses → our internal subscription_status. */
function mapStripeStatus(s: string): "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED" {
    switch (s) {
        case "trialing":        return "TRIAL"
        case "active":          return "ACTIVE"
        case "past_due":        return "PAST_DUE"
        case "unpaid":          return "SUSPENDED"
        case "incomplete_expired":
        case "canceled":        return "CANCELED"
        case "incomplete":
        // The first invoice is still confirming — show as PAST_DUE so
        // the UI prompts the OWNER to complete authentication.
                                return "PAST_DUE"
        default:                return "PAST_DUE"
    }
}