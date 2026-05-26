import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"

/**
 * GET /api/public/bills/:slug/:invoice
 * Returns a bill that can be displayed publicly. Identified by tenant slug +
 * invoice number — both are non-secret but together act as a verification key.
 *
 * No auth required (this is a customer-facing receipt URL).
 */
export async function GET(
    _req: Request,
    { params }: { params: Promise<{ slug: string; invoice: string }> },
) {
    const { slug, invoice } = await params
    const supabase = createServiceRoleClient()
    const { data: tenant } = await supabase
        .from("tenants")
        .select("id, name, gstin, fssai, address_line1, city, pincode, phone, slug, country, currency, logo_url, settings")
        .eq("slug", slug)
        .maybeSingle()
    if (!tenant) return NextResponse.json({ error: "not found" }, { status: 404 })
    const t = tenant as { id: string; name: string }

    const { data: bill } = await supabase
        .from("bills")
        .select("*")
        .eq("tenant_id", t.id)
        .eq("invoice_number", invoice)
        .maybeSingle()
    if (!bill) return NextResponse.json({ error: "not found" }, { status: 404 })
    const b = bill as { order_id: string }

    const { data: items } = await supabase
        .from("order_items")
        .select("id, item_name, hsn_code, quantity, unit_price, gst_slab, line_total, is_void, notes")
        .eq("order_id", b.order_id)

    return NextResponse.json({ tenant, bill, items: items ?? [] })
}
