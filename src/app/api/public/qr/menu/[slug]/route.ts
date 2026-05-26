import { NextResponse } from "next/server"
import { unstable_cache } from "next/cache"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { resolveGateway } from "@/lib/payments/gateway"

/**
 * GET /api/public/qr/menu/:slug
 * Returns the public menu for a tenant (used by the QR ordering page).
 * No auth — slug is the public identifier.
 *
 * ── Caching strategy ─────────────────────────────────────────────────────
 * The QR menu page polls this endpoint on every customer visit. Two
 * layers of cache:
 *
 *   1. `unstable_cache` (server-side) — the heavy DB work (tenant
 *      lookup, gateway readiness, menu items, categories, recs) sits
 *      behind a 60-second TTL keyed on (slug, tableNumber). Menu
 *      writes invalidate it via `revalidateTag('qr-menu')`.
 *
 *   2. `Cache-Control` HTTP header — CDN / browser can serve the JSON
 *      for up to 30 seconds without round-tripping to us at all. The
 *      slightly tighter window means menu edits propagate quickly.
 *
 * Tenant onboarding state (paytm_ready, stripe_ready) is computed
 * inside the cached function. That's fine — these flags flip rarely
 * (once per tenant during initial gateway onboarding) and a 60-second
 * stale window during that ramp is acceptable.
 */
async function loadPublicMenu(slug: string, tableNumber: string | null) {
    const supabase = createServiceRoleClient()
    const { data: tenant } = await supabase
        .from("tenants")
        .select(
            "id, name, slug, logo_url, upi_id, upi_payee_name, payment_gateway, qr_ordering_enabled, qr_require_payment, address_line1, city, phone, country, currency",
        )
        .eq("slug", slug)
        .maybeSingle()
    if (!tenant) return { error: "restaurant not found" as const, status: 404 as const }
    const t = tenant as {
        id: string
        qr_ordering_enabled?: boolean
        payment_gateway?: string
        country?: string
        upi_id?: string | null
    }
    if (t.qr_ordering_enabled === false) {
        return { error: "QR ordering disabled by restaurant" as const, status: 403 as const }
    }

    const gateway = resolveGateway(t.country, t.payment_gateway)

    let paytmReady = false
    let stripeReady = false
    if (gateway === "paytm") {
        const { data: gw } = await supabase
            .from("tenant_payment_gateways")
            .select("paytm_mid, paytm_merchant_key, paytm_enabled")
            .eq("tenant_id", t.id)
            .maybeSingle()
        const r = gw as { paytm_mid?: string | null; paytm_merchant_key?: string | null; paytm_enabled?: boolean } | null
        const tenantPaytm = Boolean(r?.paytm_enabled && r.paytm_mid && r.paytm_merchant_key)
        // "Ready" when Paytm is connected per-tenant, OR via the platform
        // .env fallback, OR — since the QR-ordering flow gracefully
        // downgrades to plain UPI — when the restaurant has a UPI id.
        paytmReady = tenantPaytm
            || Boolean(process.env.PAYTM_MID && process.env.PAYTM_MERCHANT_KEY)
            || Boolean(t.upi_id)
    } else if (gateway === "stripe" && process.env.STRIPE_SECRET_KEY) {
        const { data: gw } = await supabase
            .from("tenant_payment_gateways")
            .select("stripe_connected_account_id, stripe_account_enabled")
            .eq("tenant_id", t.id)
            .maybeSingle()
        const s = gw as { stripe_connected_account_id?: string; stripe_account_enabled?: boolean } | null
        stripeReady = Boolean(s?.stripe_connected_account_id && s.stripe_account_enabled !== false)
    }

    let scopedBranchId: string | null = null
    if (tableNumber) {
        const { data: tableRow } = await supabase
            .from("dining_tables")
            .select("branch_id")
            .eq("tenant_id", t.id)
            .eq("number", tableNumber)
            .maybeSingle()
        scopedBranchId = (tableRow as { branch_id?: string | null } | null)?.branch_id ?? null
    }

    let menuItemsQ = supabase
        .from("menu_items")
        .select(
            "id, category_id, name, description, base_price, sale_price, food_type, gst_slab, is_tax_inclusive, image_url, is_sold_out, sort_order, hsn_code, branch_id",
        )
        .eq("tenant_id", t.id)
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("sort_order")
    if (scopedBranchId) {
        menuItemsQ = menuItemsQ.or(`branch_id.eq.${scopedBranchId},branch_id.is.null`)
    }

    const [{ data: cats }, { data: items }, { data: recRows }] = await Promise.all([
        supabase
            .from("menu_categories")
            .select("id, name, sort_order, icon")
            .eq("tenant_id", t.id)
            .is("deleted_at", null)
            .eq("is_active", true)
            .order("sort_order"),
        menuItemsQ,
        supabase
            .from("menu_item_recommendations")
            .select("item_id, recommended_item_id, sort_order")
            .eq("tenant_id", t.id)
            .order("sort_order"),
    ])

    const recommendations: Record<string, string[]> = {}
    for (const r of (recRows ?? []) as { item_id: string; recommended_item_id: string }[]) {
        ;(recommendations[r.item_id] ??= []).push(r.recommended_item_id)
    }

    return {
        ok: true as const,
        payload: {
            tenant: {
                ...tenant,
                payment_gateway: gateway,
                paytm_ready: paytmReady,
                stripe_ready: stripeReady,
            },
            categories: cats ?? [],
            items: items ?? [],
            recommendations,
        },
    }
}

const loadPublicMenuCached = unstable_cache(loadPublicMenu, ["qr-menu"], {
    revalidate: 60,
    tags: ["qr-menu"],
})

export async function GET(
    req: Request,
    { params }: { params: Promise<{ slug: string }> },
) {
    const { slug } = await params
    const { searchParams } = new URL(req.url)
    const tableNumber = searchParams.get("table") ?? searchParams.get("t")

    const result = await loadPublicMenuCached(slug, tableNumber)
    if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result.payload, {
        headers: {
            // Cache at the CDN + browser for 30s with a 60s stale-while-
            // revalidate window. Customers reloading the menu page during
            // a meal won't trigger a DB hit; menu edits propagate in <=60s
            // (or instantly if the admin write path calls revalidateTag).
            "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
        },
    })
}
