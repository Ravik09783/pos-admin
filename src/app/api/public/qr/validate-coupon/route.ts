import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { getClientIp, rateLimit } from "@/lib/rate-limit"

/**
 * POST /api/public/qr/validate-coupon
 * Body: { tenant_slug, code, subtotal }
 *
 * Lets a QR-ordering customer check a promo code before paying. Returns the
 * discount the coupon would apply. The discount is re-validated server-side
 * again at place-order time — this endpoint is purely for the live preview.
 */
export async function POST(req: Request) {
    const ip = getClientIp(req)
    const limit = await rateLimit(`qr-coupon:ip:${ip}`, 30, 60_000)
    if (!limit.allowed) {
        return NextResponse.json({ valid: false, error: "Too many tries — slow down." }, { status: 429 })
    }

    let body: { tenant_slug?: string; code?: string; subtotal?: number }
    try { body = await req.json() } catch { return NextResponse.json({ valid: false, error: "bad request" }, { status: 400 }) }
    const code = body.code?.trim()
    const subtotal = Number(body.subtotal)
    if (!body.tenant_slug || !code) return NextResponse.json({ valid: false, error: "missing fields" }, { status: 400 })
    if (!Number.isFinite(subtotal) || subtotal <= 0) return NextResponse.json({ valid: false, error: "Add items first" }, { status: 400 })

    const supabase = createServiceRoleClient()
    const { data: tenant } = await supabase
        .from("tenants").select("id").eq("slug", body.tenant_slug).maybeSingle()
    if (!tenant) return NextResponse.json({ valid: false, error: "restaurant not found" }, { status: 404 })

    const { data, error } = await supabase.rpc("validate_coupon_for_tenant" as never, {
        p_tenant_id: (tenant as { id: string }).id,
        p_code: code,
        p_subtotal: subtotal,
    } as never)
    if (error) return NextResponse.json({ valid: false, error: "Couldn't check that code" }, { status: 500 })

    const r = data as { valid: boolean; error?: string; coupon_id?: string; code?: string; description?: string | null; discount?: number }
    if (!r.valid) return NextResponse.json({ valid: false, error: r.error ?? "Invalid coupon" })
    return NextResponse.json({
        valid: true,
        coupon_id: r.coupon_id,
        code: r.code,
        description: r.description ?? null,
        discount: Number(r.discount ?? 0),
    })
}

export const dynamic = "force-dynamic"
