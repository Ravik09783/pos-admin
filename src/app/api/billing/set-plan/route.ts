import { NextResponse } from "next/server"

import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError, logWarn } from "@/lib/errors"
import {
    findPlan, getStripePriceIdForPlan, toDbLimit, planOverrideUnlimited,
    type PlanRegion, type PlanTier,
} from "@/lib/billing/plans"
import { stripeFetch, stripeForm } from "@/lib/billing/stripe"
import { getTaxConfig } from "@/lib/tax/locale-config"

/**
 * POST /api/billing/set-plan
 * Body: { tier: "starter" | "growth" | "scale" }
 *
 * Switches the tenant's plan tier. Resolves the matching plan from
 * `src/lib/billing/plans.ts` (single source of truth for limits) and
 * mirrors the resolved {maxBranches, maxStaffPerBranch} onto the
 * tenants row so the SQL gate (`is_user_within_plan_limits`) can
 * enforce without re-importing TypeScript.
 *
 * Region is auto-derived from `tenants.country` via `getTaxConfig` —
 * India tenants get INR limits; everyone else gets the INTL set. The
 * limits per tier happen to be identical across regions today, but the
 * resolver still goes through the right region path so feature lists
 * stay region-correct.
 *
 * Authorization: any tenant member — the OWNER-only gate was dropped
 * both here AND in the set_tenant_plan SQL RPC so staff can pay too.
 *
 * Stripe sync: if the tenant already has a `stripe_subscription_id`
 * (i.e. they've added a card and the subscription is live), this
 * route also tells Stripe to swap the subscription's line item to the
 * new tier's Price ID. The webhook will then echo a
 * `customer.subscription.updated` event back, but our DB is already
 * correct so that's a no-op. If the swap fails (Stripe rejects, or
 * the env var for the target tier isn't set), we still keep the new
 * tier in our DB and return 200 with a `stripe_sync_failed` flag —
 * the OWNER sees the tier change immediately, and our team gets a
 * logWarn so we can reconcile manually. Better than leaving the UI
 * stuck on the old tier.
 *
 * No Stripe call fires when:
 *   - tenant is on TRIAL (no subscription exists yet)
 *   - tenant is in India and pays via invoices (no Stripe sub)
 *   - the target tier's env var is empty (no Price ID configured)
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    let body: { tier?: string } = {}
    try { body = (await req.json()) as { tier?: string } } catch { /* empty body = error below */ }

    const tier = body.tier
    if (tier !== "starter" && tier !== "growth" && tier !== "scale") {
        return NextResponse.json({ error: "invalid tier" }, { status: 400 })
    }

    // Any tenant member can manage billing — so the restaurant is never
    // locked out just because the owner isn't around to pay.
    const { data: caller } = await supabase
        .from("users").select("tenant_id").eq("id", user.id).maybeSingle()
    const tenantId = (caller as { tenant_id?: string } | null)?.tenant_id
    if (!tenantId) return NextResponse.json({ error: "no_tenant" }, { status: 403 })

    // Resolve the tier's limits via the locale-config helper. The plan
    // file is the single source of truth — we don't hard-code numbers
    // anywhere else in this route.
    const { data: tenantRow } = await supabase
        .from("tenants")
        .select("country, stripe_subscription_id")
        .eq("id", tenantId)
        .maybeSingle()
    const country = (tenantRow as { country?: string | null } | null)?.country ?? null
    const subId = (tenantRow as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id ?? null
    const region: PlanRegion = getTaxConfig(country).code === "IN" ? "IN" : "INTL"
    const plan = findPlan(region, tier as PlanTier)

    const { data, error } = await supabase.rpc("set_tenant_plan" as never, {
        p_tier: plan.tier,
        p_max_branches: toDbLimit(plan.maxBranches),
        p_max_staff_per_branch: toDbLimit(plan.maxStaffPerBranch),
    } as never)
    if (error) {
        logError(error, { route: "/api/billing/set-plan", tenantId, tier: plan.tier })
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // ── Sync the tier to Stripe (best-effort) ────────────────────────────
    // If the tenant has a live subscription, swap its line item to the
    // new tier's Price ID. Stripe will prorate the difference on the
    // next invoice. If anything goes wrong we log + flag, but still
    // return 200 — the DB has the new tier so access control is correct
    // even if billing temporarily charges the wrong amount.
    let stripeSync: "skipped" | "ok" | "failed" = "skipped"
    let stripeError: string | null = null
    if (subId && process.env.STRIPE_SECRET_KEY) {
        const newPriceId = getStripePriceIdForPlan(plan)
        if (!newPriceId) {
            stripeSync = "failed"
            stripeError = `${plan.stripePriceIdEnvVar} is not set; subscription left on previous price`
            logWarn("set-plan: Stripe Price ID missing for tier", {
                tenantId, tier: plan.tier, envVar: plan.stripePriceIdEnvVar,
            })
        } else {
            // We need the existing line item id to "replace" it. Stripe
            // requires items[0][id] = the current item id; setting just
            // the price would ADD a second line item instead of swapping.
            const fetched = await stripeFetch(`/subscriptions/${subId}`, undefined, "GET")
            if (!fetched.ok) {
                stripeSync = "failed"
                stripeError = `couldn't fetch subscription: ${fetched.rawText}`
            } else {
                const sub = fetched.data as { items?: { data?: { id: string; price: { id: string } }[] } }
                const currentItem = sub.items?.data?.[0]
                if (!currentItem) {
                    stripeSync = "failed"
                    stripeError = "subscription has no line items"
                } else if (currentItem.price?.id === newPriceId) {
                    // Already on the right price (idempotent re-click).
                    stripeSync = "ok"
                } else {
                    const update = await stripeFetch(
                        `/subscriptions/${subId}`,
                        stripeForm({
                            "items[0][id]": currentItem.id,
                            "items[0][price]": newPriceId,
                            // Prorate so the OWNER is fairly charged for
                            // the days remaining in the current period.
                            "proration_behavior": "create_prorations",
                        }),
                    )
                    if (update.ok) {
                        stripeSync = "ok"
                    } else {
                        stripeSync = "failed"
                        stripeError = update.rawText.slice(0, 200)
                    }
                }
            }
            if (stripeSync === "failed") {
                logWarn("set-plan: Stripe subscription swap failed; tier saved locally only", {
                    tenantId, tier: plan.tier, subId, error: stripeError,
                })
                // Touch tenants once more so the response is "fresh" even
                // if Stripe lags. The webhook will eventually echo back.
                const service = createServiceRoleClient()
                await service.from("tenants").update({} as never).eq("id", tenantId)
            }
        }
    }

    return NextResponse.json({
        ok: true,
        plan: {
            tier: plan.tier,
            name: plan.name,
            region,
            max_branches: toDbLimit(plan.maxBranches),
            max_staff_per_branch: toDbLimit(plan.maxStaffPerBranch),
        },
        result: data,
        override_active: planOverrideUnlimited(),
        stripe_sync: stripeSync,
        stripe_sync_error: stripeError,
    })
}
