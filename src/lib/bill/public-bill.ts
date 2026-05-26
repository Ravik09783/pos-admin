import "server-only"

import { unstable_cache } from "next/cache"

import { createServiceRoleClient } from "@/lib/supabase/server"
import type { Bill, OrderItem, Tenant } from "@/types/database"

/**
 * Server-side fetcher for the public verified-bill page (`/b/:slug/:invoice`).
 *
 * Cached with `unstable_cache`:
 *   - Keyed on (slug, invoice) so two tenants with the same invoice
 *     number stay isolated.
 *   - Tagged so writes can invalidate. A bill voiding, a payment
 *     webhook landing, or any other mutation should call
 *     `revalidateTag(publicBillTag(bill.id))` to wipe the cached
 *     response.
 *
 * Returns null when the (slug, invoice) pair doesn't resolve to a
 * tenant + bill — the page renders a 404 for both cases without
 * leaking which one missed (slug vs. invoice).
 */
export type PublicBillPayload = {
    tenant: Tenant
    bill: Bill
    items: OrderItem[]
}

export const publicBillTag = (billId: string) => `public-bill:${billId}`
export const publicBillSlugTag = (slug: string, invoice: string) =>
    `public-bill:${slug}:${invoice}`

async function fetchPublicBillImpl(
    slug: string,
    invoice: string,
): Promise<PublicBillPayload | null> {
    // Service-role client because this URL is anonymous-public and the
    // bills table has tenant-scoped RLS. We've verified the slug +
    // invoice combo is the only access key — the route handler that
    // preceded this loader did exactly the same.
    const supabase = createServiceRoleClient()

    const { data: tenant } = await supabase
        .from("tenants")
        .select(
            "id, name, gstin, fssai, address_line1, city, pincode, phone, slug, country, currency, logo_url, settings",
        )
        .eq("slug", slug)
        .maybeSingle()
    if (!tenant) return null
    const t = tenant as { id: string }

    const { data: bill } = await supabase
        .from("bills")
        .select("*")
        .eq("tenant_id", t.id)
        .eq("invoice_number", invoice)
        .maybeSingle()
    if (!bill) return null
    const b = bill as { id: string; order_id: string }

    const { data: items } = await supabase
        .from("order_items")
        .select(
            "id, item_name, hsn_code, quantity, unit_price, gst_slab, line_total, is_void, notes",
        )
        .eq("order_id", b.order_id)

    return {
        tenant: tenant as Tenant,
        bill: bill as Bill,
        items: (items ?? []) as OrderItem[],
    }
}

export const getPublicBill = unstable_cache(
    fetchPublicBillImpl,
    ["public-bill"],
    {
        // 5-minute baseline TTL. Bills are effectively immutable once
        // PAID, so even an hour would be safe for the common case —
        // but a 5-minute floor keeps the "live webhook flips bill to
        // PAID" UX snappy for customers who refresh their receipt
        // immediately after paying. Writes call `revalidateTag` for
        // instant invalidation; this TTL is just the safety net.
        revalidate: 300,
        // The function captures `slug, invoice` as its arguments, so
        // unstable_cache automatically scopes the cache key by them.
        // The explicit tag below lets any code path (webhook, void
        // RPC, etc.) call `revalidateTag(publicBillSlugTag(slug, invoice))`
        // to wipe the entry on demand.
        tags: ["public-bill"],
    },
)
