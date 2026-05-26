import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { stripeFetch } from "@/lib/billing/stripe"
import { logError, logWarn } from "@/lib/errors"

/**
 * Pull live state for one tenant from Stripe and sync our cached
 * fields on the `tenants` row.
 *
 * Why this exists alongside the webhook handler:
 *   - Webhooks are the primary writer (low latency, push-based).
 *   - But webhooks can be missed: signing-secret rotation, deploy gap,
 *     event-list filter, network blip mid-replay. When that happens our
 *     cached `subscription_status` / `current_period_end` / card-on-file
 *     fields drift from Stripe.
 *   - This reconciler closes the gap by re-reading Stripe whenever a
 *     human-facing surface needs accurate state (the /api/billing/status
 *     endpoint calls it on every settings-page load, debounced by a
 *     short in-process cache).
 *
 * Stripe IS the source of truth. The DB columns are a denormalised
 * cache to keep the bill-generation hot path fast (`is_tenant_billable`
 * shouldn't have to hit Stripe). After reconcile() runs, the cache
 * matches Stripe exactly.
 *
 * Safe to run on every request — it's all read-only Stripe calls plus
 * one targeted Supabase UPDATE that only writes when fields actually
 * differ.
 */
type ServiceClient = SupabaseClient

interface CachedSnapshot {
    subscription_status: SubscriptionStatus | null
    current_period_end: string | null
    trial_ends_at: string | null
    platform_payment_method_id: string | null
    platform_card_brand: string | null
    platform_card_last4: string | null
}

type SubscriptionStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED"

/** Stripe subscription statuses → our internal cache values. Mirrors
 *  the same map used by the webhook + start-subscription handlers so
 *  reconciliation can't produce a value the rest of the code wouldn't. */
function mapStripeStatus(s: string | null | undefined): SubscriptionStatus | null {
    switch (s) {
        case "trialing":        return "TRIAL"
        case "active":          return "ACTIVE"
        case "past_due":        return "PAST_DUE"
        case "unpaid":          return "SUSPENDED"
        case "incomplete":      return "PAST_DUE"
        case "incomplete_expired":
        case "canceled":        return "CANCELED"
        default:                return null
    }
}

interface ReconcileResult {
    /** True when at least one cached field was rewritten from Stripe. */
    drifted: boolean
    /** Final, post-reconcile snapshot of the cached fields. */
    snapshot: CachedSnapshot
    /** True when Stripe data was actually pulled. False means there was
     *  nothing to reconcile (no customer / no subscription) and we just
     *  returned the existing cache. */
    fromStripe: boolean
    /** Stripe-side cancellation state (read-through, not cached locally
     *  today). `cancel_at_period_end` is true when the OWNER has hit
     *  the in-app Cancel button; the subscription is still active but
     *  will not renew. `cancels_on` is when it actually goes away. */
    cancelAtPeriodEnd: boolean
    cancelsOn: string | null
}

/**
 * Reconcile cached tenant fields against live Stripe state. Call this
 * before reading subscription_health() if you need Stripe-truth.
 *
 * Steps:
 *   1. Load the current cached snapshot from `tenants`.
 *   2. If `stripe_customer_id` is null, nothing to reconcile — return
 *      the cache unchanged (this happens for fresh tenants who haven't
 *      added a card yet, and for India tenants who don't use Stripe).
 *   3. Fetch `customers/:id` + `subscriptions/:id` (if subscription_id
 *      exists) + the default payment method's brand/last4.
 *   4. If any of (subscription_status, current_period_end, card brand,
 *      card last4) differ from the cache, write the Stripe values back
 *      to the tenant row in a single UPDATE.
 *
 * Errors are swallowed defensively — reconcile is a best-effort
 * freshness check, not a critical path. If Stripe is unreachable we
 * just return the existing cache.
 */
export async function reconcileTenantBilling(
    service: ServiceClient,
    tenantId: string,
): Promise<ReconcileResult> {
    const { data: tenantRow } = await service
        .from("tenants")
        .select(
            "stripe_customer_id, stripe_subscription_id, subscription_status, current_period_end, trial_ends_at, platform_payment_method_id, platform_card_brand, platform_card_last4",
        )
        .eq("id", tenantId)
        .maybeSingle()

    const cached: CachedSnapshot = {
        subscription_status: (tenantRow as { subscription_status?: SubscriptionStatus } | null)?.subscription_status ?? null,
        current_period_end: (tenantRow as { current_period_end?: string | null } | null)?.current_period_end ?? null,
        trial_ends_at: (tenantRow as { trial_ends_at?: string | null } | null)?.trial_ends_at ?? null,
        platform_payment_method_id: (tenantRow as { platform_payment_method_id?: string | null } | null)?.platform_payment_method_id ?? null,
        platform_card_brand: (tenantRow as { platform_card_brand?: string | null } | null)?.platform_card_brand ?? null,
        platform_card_last4: (tenantRow as { platform_card_last4?: string | null } | null)?.platform_card_last4 ?? null,
    }

    const customerId = (tenantRow as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? null
    const subscriptionId = (tenantRow as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id ?? null
    if (!customerId) {
        return { drifted: false, snapshot: cached, fromStripe: false, cancelAtPeriodEnd: false, cancelsOn: null }
    }
    if (!process.env.STRIPE_SECRET_KEY) {
        return { drifted: false, snapshot: cached, fromStripe: false, cancelAtPeriodEnd: false, cancelsOn: null }
    }

    // Pull both calls in parallel — they don't depend on each other.
    const [custRes, subRes] = await Promise.all([
        stripeFetch(`/customers/${encodeURIComponent(customerId)}`, undefined, "GET"),
        subscriptionId
            ? stripeFetch(`/subscriptions/${encodeURIComponent(subscriptionId)}`, undefined, "GET")
            : Promise.resolve(null),
    ])

    if (!custRes.ok) {
        logWarn("Stripe customers.retrieve failed during reconcile", {
            tenantId, status: custRes.status,
        })
        return { drifted: false, snapshot: cached, fromStripe: false, cancelAtPeriodEnd: false, cancelsOn: null }
    }
    const customer = custRes.data as {
        invoice_settings?: { default_payment_method?: string | null }
    }
    const defaultPmId = customer.invoice_settings?.default_payment_method ?? null

    // Pull the default PM details (brand + last4) so the UI's "Visa
    // •••• 4242" stays in sync if the OWNER swaps cards in the Stripe
    // Customer Portal directly — those changes only reach us through
    // this reconcile path.
    let cardBrand: string | null = null
    let cardLast4: string | null = null
    if (defaultPmId) {
        const pmRes = await stripeFetch(`/payment_methods/${encodeURIComponent(defaultPmId)}`, undefined, "GET")
        if (pmRes.ok) {
            const pm = pmRes.data as { card?: { brand?: string; last4?: string } }
            cardBrand = pm.card?.brand ?? null
            cardLast4 = pm.card?.last4 ?? null
        }
    }

    let nextStatus: SubscriptionStatus | null = cached.subscription_status
    let nextPeriodEnd: string | null = cached.current_period_end
    let nextTrialEnd: string | null = cached.trial_ends_at
    let cancelAtPeriodEnd = false
    let cancelsOn: string | null = null

    if (subRes && subRes.ok) {
        const sub = subRes.data as {
            status?: string
            current_period_end?: number
            trial_end?: number | null
            canceled_at?: number | null
            cancel_at_period_end?: boolean
            cancel_at?: number | null
        }
        const mapped = mapStripeStatus(sub.status)
        if (mapped) nextStatus = mapped
        if (typeof sub.current_period_end === "number") {
            nextPeriodEnd = new Date(sub.current_period_end * 1000).toISOString()
        }
        // Stripe's `trial_end` is null once the trial has converted —
        // we don't clear our local copy in that case because trial_ends_at
        // also acts as the seed for the dashboard "trial used to be"
        // copy. Only update when Stripe has a concrete trial_end value.
        if (typeof sub.trial_end === "number") {
            nextTrialEnd = new Date(sub.trial_end * 1000).toISOString()
        }
        // Soft-cancel state — surfaced through the result, not cached
        // on the tenants row. The cancel-subscription UI flow reads
        // this to render "your subscription ends on X" banners.
        cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end)
        if (typeof sub.cancel_at === "number") {
            cancelsOn = new Date(sub.cancel_at * 1000).toISOString()
        } else if (cancelAtPeriodEnd && typeof sub.current_period_end === "number") {
            // Stripe sometimes returns cancel_at_period_end=true without
            // a concrete `cancel_at` — the cancellation will happen at
            // current_period_end. Mirror it here so the UI always has
            // a date to show.
            cancelsOn = new Date(sub.current_period_end * 1000).toISOString()
        }
    } else if (subRes && !subRes.ok) {
        // Subscription id no longer resolves on Stripe — most often
        // because the OWNER fully canceled it via the Customer Portal.
        // Treat that as CANCELED in our cache.
        const errCode = (subRes.data as { error?: { code?: string } })?.error?.code
        if (errCode === "resource_missing") {
            nextStatus = "CANCELED"
        } else {
            logWarn("Stripe subscriptions.retrieve failed during reconcile", {
                tenantId, status: subRes.status,
            })
        }
    }

    const drifted =
        nextStatus !== cached.subscription_status ||
        nextPeriodEnd !== cached.current_period_end ||
        nextTrialEnd !== cached.trial_ends_at ||
        defaultPmId !== cached.platform_payment_method_id ||
        cardBrand !== cached.platform_card_brand ||
        cardLast4 !== cached.platform_card_last4

    const snapshot: CachedSnapshot = {
        subscription_status: nextStatus,
        current_period_end: nextPeriodEnd,
        trial_ends_at: nextTrialEnd,
        platform_payment_method_id: defaultPmId,
        platform_card_brand: cardBrand,
        platform_card_last4: cardLast4,
    }

    if (drifted) {
        const { error: updErr } = await service
            .from("tenants")
            .update({
                subscription_status: snapshot.subscription_status,
                current_period_end: snapshot.current_period_end,
                trial_ends_at: snapshot.trial_ends_at,
                platform_payment_method_id: snapshot.platform_payment_method_id,
                platform_card_brand: snapshot.platform_card_brand,
                platform_card_last4: snapshot.platform_card_last4,
            } as never)
            .eq("id", tenantId)
        if (updErr) {
            logError(updErr, { route: "reconcileTenantBilling", step: "write", tenantId })
            // Return drifted=true anyway so the caller knows there's a
            // mismatch even if our write failed.
        }
    }

    return { drifted, snapshot, fromStripe: true, cancelAtPeriodEnd, cancelsOn }
}

// ── In-process dedup so concurrent reconciles for the same tenant
// share one Stripe round-trip instead of N. The window is short — 30s
// — because Stripe state DOES change (webhook lag, mid-flight 3DS).
// Anything longer would mask legitimate updates.
const RECONCILE_DEDUP_MS = 30_000
const inFlight = new Map<string, Promise<ReconcileResult>>()
const recent = new Map<string, { at: number; result: ReconcileResult }>()

export async function reconcileTenantBillingDeduped(
    service: ServiceClient,
    tenantId: string,
): Promise<ReconcileResult> {
    const cached = recent.get(tenantId)
    if (cached && Date.now() - cached.at < RECONCILE_DEDUP_MS) {
        return cached.result
    }
    const existing = inFlight.get(tenantId)
    if (existing) return existing

    const p = reconcileTenantBilling(service, tenantId)
        .then((r) => {
            recent.set(tenantId, { at: Date.now(), result: r })
            return r
        })
        .finally(() => {
            inFlight.delete(tenantId)
        })
    inFlight.set(tenantId, p)
    return p
}
