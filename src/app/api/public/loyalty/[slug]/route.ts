import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"

/**
 * GET /api/public/loyalty/:slug?phone=...
 * Returns loyalty status for a phone-identified customer of the given tenant.
 *
 * No auth — phone+slug pair is the only identifier; we don't return PII beyond
 * what the customer typed in.
 */
export async function GET(
    req: Request,
    { params }: { params: Promise<{ slug: string }> },
) {
    const { slug } = await params
    const url = new URL(req.url)
    const phone = url.searchParams.get("phone")?.trim()
    if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 })

    const supabase = createServiceRoleClient()
    const { data: tenant } = await supabase
        .from("tenants")
        .select("id, name, slug, loyalty_enabled, loyalty_earn_per_100, loyalty_redeem_value")
        .eq("slug", slug)
        .maybeSingle()
    if (!tenant) return NextResponse.json({ error: "restaurant not found" }, { status: 404 })

    const t = tenant as { id: string; loyalty_enabled?: boolean }
    if (!t.loyalty_enabled) return NextResponse.json({ tenant, loyalty_enabled: false })

    const { data: customer } = await supabase
        .from("customers")
        .select("id, name, loyalty_points, total_visits, total_spent")
        .eq("tenant_id", t.id)
        .eq("phone", phone)
        .is("deleted_at", null)
        .maybeSingle()
    if (!customer) {
        return NextResponse.json({ tenant, customer: null, transactions: [] })
    }
    const c = customer as { id: string }

    const { data: tx } = await supabase
        .from("loyalty_transactions")
        .select("type, points, notes, created_at")
        .eq("tenant_id", t.id)
        .eq("customer_id", c.id)
        .order("created_at", { ascending: false })
        .limit(20)

    return NextResponse.json({ tenant, customer, transactions: tx ?? [] })
}
