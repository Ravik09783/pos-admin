import { NextResponse } from "next/server"
import { unstable_cache } from "next/cache"

import { createServiceRoleClient } from "@/lib/supabase/server"

/**
 * GET /api/public/display/menu/:slug
 *
 * Lightweight menu + recommendations feed for the POS customer-facing
 * display's "Perfect with your order" upsell panel. Returns just enough
 * to suggest add-ons: each active item's id / name / price / photo, plus
 * the restaurant's curated `menu_item_recommendations` graph.
 *
 * Public + slug-keyed (the display tablet has no login). Unlike the
 * QR-ordering menu API this is deliberately NOT gated on
 * `qr_ordering_enabled` — the counter display's upsell should work
 * whether or not a restaurant uses QR table-ordering.
 *
 * Cached: the menu + recommendations change rarely, and the display
 * refreshes this every few minutes anyway.
 */
async function loadDisplayMenu(slug: string) {
    const supabase = createServiceRoleClient()
    const { data: tenant } = await supabase
        .from("tenants")
        .select("id")
        .eq("slug", slug)
        .maybeSingle()
    if (!tenant) return null
    const tenantId = (tenant as { id: string }).id

    const [{ data: items }, { data: recRows }] = await Promise.all([
        supabase
            .from("menu_items")
            .select("id, name, description, food_type, base_price, sale_price, image_url, is_sold_out")
            .eq("tenant_id", tenantId)
            .is("deleted_at", null)
            .eq("is_active", true),
        supabase
            .from("menu_item_recommendations")
            .select("item_id, recommended_item_id, sort_order")
            .eq("tenant_id", tenantId)
            .order("sort_order"),
    ])

    // item_id → ordered list of recommended item ids.
    const recommendations: Record<string, string[]> = {}
    for (const r of (recRows ?? []) as { item_id: string; recommended_item_id: string }[]) {
        ;(recommendations[r.item_id] ??= []).push(r.recommended_item_id)
    }

    return { items: items ?? [], recommendations }
}

const loadDisplayMenuCached = unstable_cache(loadDisplayMenu, ["display-menu"], {
    revalidate: 120,
    // Shares the `qr-menu` tag so a menu edit invalidates both feeds.
    tags: ["qr-menu", "display-menu"],
})

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ slug: string }> },
) {
    const { slug } = await params
    const result = await loadDisplayMenuCached(slug)
    if (!result) {
        return NextResponse.json({ error: "restaurant not found" }, { status: 404 })
    }
    return NextResponse.json(result, {
        headers: {
            "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=120",
        },
    })
}
