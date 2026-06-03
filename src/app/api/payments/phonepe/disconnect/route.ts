import { NextResponse } from "next/server"

import { assertSameOrigin } from "@/lib/csrf"
import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { logError } from "@/lib/errors"

/**
 * POST /api/payments/phonepe/disconnect
 *
 * Clears the tenant's PhonePe credentials from
 * `tenant_payment_gateways`. Used by Settings → Payments when the
 * OWNER wants to switch back to manual UPI or rotate credentials.
 *
 * Wipes BOTH the staging and production pairs in one call — there's
 * no UX value in keeping one set while clearing the other; an
 * "edit" intent should just re-paste.
 *
 * Auth: signed-in OWNER / MANAGER only. The PhonePe-fired transactions
 * already in flight (PENDING in `phonepe_payment_events`) are NOT
 * touched — they still need to resolve via the webhook or the
 * reconcile cron. Disconnecting the credentials just stops NEW
 * transactions from being mintable.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { data: row } = await supabase
        .from("users")
        .select("tenant_id, role")
        .eq("id", user.id)
        .maybeSingle() as { data: { tenant_id: string | null; role: string | null } | null }
    if (!row?.tenant_id) return NextResponse.json({ error: "no tenant" }, { status: 403 })
    if (row.role !== "OWNER" && row.role !== "MANAGER") {
        return NextResponse.json({ error: "Only Owners + Managers can disconnect PhonePe." }, { status: 403 })
    }

    // Service role for the write: the per-tenant RLS that hides salt
    // keys from non-owners would also prevent the write, so we bypass
    // it here. We've already auth-checked the role above.
    const service = createServiceRoleClient()
    const { error } = await service
        .from("tenant_payment_gateways")
        .update({
            phonepe_mid: null,
            phonepe_merchant_key: null,
            phonepe_salt_index: "1",
            phonepe_mid_staging: null,
            phonepe_merchant_key_staging: null,
            phonepe_salt_index_staging: "1",
            phonepe_enabled: false,
            phonepe_env: "staging",
        } as never)
        .eq("tenant_id", row.tenant_id)
    if (error) {
        logError(error, { route: "/api/payments/phonepe/disconnect", tenantId: row.tenant_id })
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
}
