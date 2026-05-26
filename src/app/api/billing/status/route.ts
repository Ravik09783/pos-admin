import { NextResponse } from "next/server"

import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { reconcileTenantBillingDeduped } from "@/lib/billing/reconcile"

/**
 * GET /api/billing/status
 *
 * One-stop call for the dashboard banner + the billing settings page.
 *
 * Stripe is the source of truth for subscription state. Every call to
 * this endpoint first reconciles the tenant's cached fields against
 * live Stripe data (`reconcileTenantBillingDeduped` — 30s in-process
 * cache so a settings-page refresh doesn't fire repeat round-trips).
 * After reconciliation we read `subscription_health()` which sees the
 * up-to-date cache. The bill-generation hot path keeps reading the
 * cache directly via `is_tenant_billable` — fast, and now guaranteed
 * fresh because every UI render of the billing page re-syncs it.
 *
 * Response shape (see migration 16):
 *   {
 *     status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED",
 *     country: string,
 *     is_billable: boolean,
 *     is_india: boolean,                  // SaaS-exempt
 *     trial_ends_at: string | null,
 *     current_period_end: string | null,
 *     days_until_billing: number | null,
 *     has_payment_method: boolean,
 *     card_brand: string | null,
 *     card_last4: string | null,
 *     has_stripe_customer: boolean,
 *     platform_configured: boolean,       // env vars set on the server
 *     reconciled: boolean                 // did this call hit Stripe?
 *   }
 */
export async function GET() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { data: row } = await supabase
        .from("users").select("tenant_id").eq("id", user.id).maybeSingle()
    const tenantId = (row as { tenant_id?: string } | null)?.tenant_id
    if (!tenantId) return NextResponse.json({ error: "no_tenant" }, { status: 403 })

    // Re-pull live Stripe state into our cache before reading the RPC.
    // Safe to fail — reconcile swallows errors and the RPC falls back
    // to whatever is already cached. The deduped wrapper coalesces
    // concurrent callers + caches the result for 30s.
    const service = createServiceRoleClient()
    const reconcile = await reconcileTenantBillingDeduped(service, tenantId).catch(() => null)

    const { data, error } = await supabase.rpc("subscription_health" as never, { p_tenant_id: tenantId } as never)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Surface whether a real Stripe subscription exists (used by the
    // plan picker to decide whether a tier switch needs the
    // cancel-and-activate confirmation dialog). Cheap follow-up read
    // from the tenants row — subscription_health() doesn't expose
    // stripe_subscription_id today and amending that RPC would mean
    // another migration.
    const { data: subRow } = await service
        .from("tenants")
        .select("stripe_subscription_id")
        .eq("id", tenantId)
        .maybeSingle()
    const hasSubscription = Boolean(
        (subRow as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id,
    )

    // `platform_configured` flips the UI between "show subscription
    // surface" and "show admin warning that env vars are missing". We
    // count the platform as configured as long as STRIPE_SECRET_KEY is
    // set AND at least ONE Price ID exists — either the legacy single
    // `STRIPE_PLATFORM_PRICE_ID` or any of the modern tier-specific
    // ones (`STRIPE_PLATFORM_PRICE_ID_INTL_STARTER`, etc.). The
    // previous check insisted on the legacy var, which hid the entire
    // payment-methods + invoices surface on deploys that only had the
    // newer per-tier vars filled in.
    const hasAnyPriceId = Boolean(
        process.env.STRIPE_PLATFORM_PRICE_ID ||
        process.env.STRIPE_PLATFORM_PRICE_ID_INTL_STARTER ||
        process.env.STRIPE_PLATFORM_PRICE_ID_INTL_GROWTH ||
        process.env.STRIPE_PLATFORM_PRICE_ID_INTL_SCALE ||
        process.env.STRIPE_PLATFORM_PRICE_ID_IN_STARTER ||
        process.env.STRIPE_PLATFORM_PRICE_ID_IN_GROWTH ||
        process.env.STRIPE_PLATFORM_PRICE_ID_IN_SCALE,
    )
    const platformConfigured = Boolean(process.env.STRIPE_SECRET_KEY && hasAnyPriceId)

    return NextResponse.json({
        ...(data as Record<string, unknown>),
        platform_configured: platformConfigured,
        reconciled: Boolean(reconcile?.fromStripe),
        has_subscription: hasSubscription,
        // Soft-cancel state pulled from the Stripe-truth reconciler.
        // When `cancel_at_period_end` is true, the OWNER has clicked
        // Cancel — the subscription is still active until `cancels_on`,
        // then it goes away. UI uses this to show the "ending soon"
        // banner + a Reactivate button.
        cancel_at_period_end: Boolean(reconcile?.cancelAtPeriodEnd),
        cancels_on: reconcile?.cancelsOn ?? null,
    })
}
