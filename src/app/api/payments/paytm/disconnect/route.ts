import { NextResponse } from "next/server"

import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { createClient } from "@/lib/supabase/server"

/**
 * POST /api/payments/paytm/disconnect
 *
 * Removes the tenant's Paytm credentials. Doesn't touch Paytm-side —
 * the merchant's Paytm account itself is untouched; we just stop using
 * it for QR generation + webhook verification.
 *
 *   - clears BOTH paytm_mid / paytm_merchant_key (Production) AND
 *     paytm_mid_staging / paytm_merchant_key_staging (Test) — the
 *     remove button is "wipe all Paytm" regardless of which env was
 *     active. Reconnecting later is faster than partial state.
 *   - resets paytm_env to "production" (the default)
 *   - flips paytm_enabled = false
 *
 * Authorization: OWNER only (enforced by RLS on `tenant_payment_gateways`).
 * The route also checks the role explicitly so the user gets a friendly
 * 403 message instead of a generic Postgres permission error.
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { data: u } = await supabase
        .from("users")
        .select("role, tenant_id")
        .eq("id", user.id)
        .maybeSingle() as { data: { role: string | null; tenant_id: string | null } | null }
    if (!u?.tenant_id) return NextResponse.json({ error: "no tenant" }, { status: 400 })
    if (u.role !== "OWNER") {
        return NextResponse.json({ error: "Only the Owner can remove the payment method." }, { status: 403 })
    }

    try {
        const { error } = await supabase
            .from("tenant_payment_gateways")
            .update({
                paytm_mid: null,
                paytm_merchant_key: null,
                paytm_mid_staging: null,
                paytm_merchant_key_staging: null,
                paytm_env: "production", // reset to default; column is non-null in the table
                paytm_enabled: false,
            } as never)
            .eq("tenant_id", u.tenant_id)
        if (error) {
            if (error.code === "42501") {
                return NextResponse.json({ error: "Only the Owner can remove the payment method." }, { status: 403 })
            }
            logError(error, { route: "/api/payments/paytm/disconnect" })
            return NextResponse.json({ error: error.message }, { status: 400 })
        }
        return NextResponse.json({ ok: true })
    } catch (e) {
        logError(e, { route: "/api/payments/paytm/disconnect" })
        return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't remove Paytm." }, { status: 500 })
    }
}
