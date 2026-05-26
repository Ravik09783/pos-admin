import { NextResponse } from "next/server"

import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { createClient } from "@/lib/supabase/server"

/**
 * POST /api/payments/stripe/connect/disconnect
 *
 * Disconnects the tenant from their Stripe Connect account. The Stripe
 * account itself is NOT deleted on Stripe's side — that's a destructive
 * operation that Stripe (rightly) requires the merchant to do from
 * Stripe Dashboard, and only after pending balance has been paid out.
 * We just stop routing payments to it from RestoPOS.
 *
 *   - clears stripe_connected_account_id
 *   - clears stripe_account_country / charges / payouts / details flags
 *   - clears the last-payout snapshot
 *   - flips stripe_account_enabled = false
 *
 * The next time the OWNER hits "Connect with Stripe" the onboarding
 * flow will spin up a NEW Connect account. If they want to re-attach
 * an existing acct_*, they can paste the id into the form and save —
 * the webhook will rehydrate the flags.
 *
 * Authorization: OWNER only (RLS + an explicit role check for a
 * friendly error message).
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
        return NextResponse.json({ error: "Only the Owner can disconnect Stripe." }, { status: 403 })
    }

    try {
        const { error } = await supabase
            .from("tenant_payment_gateways")
            .update({
                stripe_connected_account_id: null,
                stripe_account_enabled: false,
                stripe_account_notes: null,
                stripe_charges_enabled: null,
                stripe_payouts_enabled: null,
                stripe_details_submitted: null,
                stripe_account_country: null,
                stripe_last_payout_at: null,
                stripe_last_payout_amount: null,
                stripe_last_payout_currency: null,
                stripe_last_payout_status: null,
            } as never)
            .eq("tenant_id", u.tenant_id)
        if (error) {
            if (error.code === "42501") {
                return NextResponse.json({ error: "Only the Owner can disconnect Stripe." }, { status: 403 })
            }
            logError(error, { route: "/api/payments/stripe/connect/disconnect" })
            return NextResponse.json({ error: error.message }, { status: 400 })
        }
        return NextResponse.json({
            ok: true,
            note: "Stripe disconnected on the RestoPOS side. To delete the account on Stripe's side, open the Stripe-hosted dashboard.",
        })
    } catch (e) {
        logError(e, { route: "/api/payments/stripe/connect/disconnect" })
        return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't disconnect Stripe." }, { status: 500 })
    }
}
