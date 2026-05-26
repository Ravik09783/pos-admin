import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { requireSuperAdmin } from "@/lib/super-admin/guard"
import { getTaxConfig } from "@/lib/tax/locale-config"
import { logError, logInfo } from "@/lib/errors"

/**
 * POST /api/super-admin/create-account
 * Body: { full_name, email, password, restaurant_name, country }
 *
 * A super-admin provisions a complete restaurant on behalf of a customer
 * who can't (or shouldn't) run the public /signup + /onboarding flow
 * themselves. It does in one step what /signup followed by /onboarding
 * does — owner login account + the tenant — with ONE difference: no
 * email-verification step.
 *
 * On the public /signup page Supabase emails a confirmation link and the
 * account stays dormant until the user clicks it. Here the super-admin
 * has no access to the owner's inbox, so we create the auth.users row
 * with `email_confirm: true` (service-role only) — `email_confirmed_at`
 * is stamped immediately and the owner can sign in with the password we
 * set. Same trick the /api/admin/staff/create route uses.
 *
 * Two steps:
 *   1. service-role → auth.admin.createUser  (mints the confirmed auth
 *      user; the `trg_auth_user_created` trigger inserts the public.users
 *      row with tenant_id = NULL, role = OWNER).
 *   2. service-role → rpc("super_admin_create_restaurant", { p_owner_id,
 *      ... }). That RPC is the super-admin counterpart of the public
 *      `complete_onboarding` RPC: it takes the owner id explicitly
 *      (complete_onboarding keys off auth.uid(), which is NULL for a
 *      service-role call), and atomically creates the tenant, the main
 *      branch, the branch tax profile and seed expense categories.
 *
 * If step 2 fails, we roll back step 1 with auth.admin.deleteUser so we
 * don't leak an orphan owner account with no restaurant.
 *
 * NOTE: step 2 needs migration 34 applied — see
 * `supabase/migrations/_backup_2026-05-20/34_super_admin_create_restaurant.sql`
 * (or just re-apply `combined_schema.sql`). Until then the RPC call
 * fails with a clear "migration not applied" message.
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    const body = (await req.json().catch(() => null)) as {
        full_name?: string
        email?: string
        password?: string
        restaurant_name?: string
        country?: string
    } | null
    if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 })

    const fullName = (body.full_name ?? "").trim()
    const email = (body.email ?? "").trim().toLowerCase()
    const password = body.password ?? ""
    const restaurantName = (body.restaurant_name ?? "").trim()
    const country = (body.country ?? "").trim()

    // Same validation the public /signup + /onboarding pages enforce.
    if (!fullName) {
        return NextResponse.json({ error: "Owner's name is required" }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: "Enter a valid email" }, { status: 400 })
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        return NextResponse.json({
            error: "Password must be 8+ characters with at least one letter and one number",
        }, { status: 400 })
    }
    if (restaurantName.length < 2) {
        return NextResponse.json({ error: "Restaurant name is required" }, { status: 400 })
    }

    // Country drives currency + fiscal-year start. getTaxConfig falls back
    // to India for anything unrecognised, so this never throws.
    const cfg = getTaxConfig(country || "IN")

    const admin = createServiceRoleClient()

    // ── Step 1. auth.admin.createUser ──────────────────────────────────
    const { data: createRes, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        // Skip the email-verification flow — the super-admin vouches for
        // this account and has no access to the owner's inbox.
        email_confirm: true,
        user_metadata: { full_name: fullName },
    })

    if (createErr || !createRes?.user) {
        const msg = createErr?.message ?? "Failed to create account"
        if (/already (registered|exists)/i.test(msg)) {
            return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 })
        }
        logError(createErr ?? new Error(msg), { route: "/api/super-admin/create-account" })
        return NextResponse.json({ error: msg }, { status: 500 })
    }

    const newUserId = createRes.user.id

    // ── Step 2. super_admin_create_restaurant RPC ──────────────────────
    const { error: rpcErr } = await admin.rpc("super_admin_create_restaurant" as never, {
        p_owner_id: newUserId,
        p_name: restaurantName,
        p_country: cfg.name,
        p_currency: cfg.currency,
        p_fy_start_month: cfg.fiscalYearStartMonth,
    } as never)

    if (rpcErr) {
        // The restaurant didn't get created — roll back the auth user (its
        // public.users row cascades) so a half-made account isn't left
        // behind. super_admin_create_restaurant is atomic: on error the
        // tenant/branch inserts were never committed.
        try { await admin.auth.admin.deleteUser(newUserId) } catch { /* best effort */ }

        logError(rpcErr, { route: "/api/super-admin/create-account", step: "rpc" })

        // PGRST202 = function not found in the schema cache → migration 34
        // hasn't been applied to this database yet.
        const notDeployed =
            (rpcErr as { code?: string }).code === "PGRST202" ||
            /could not find the function|super_admin_create_restaurant.*does not exist/i.test(rpcErr.message)
        if (notDeployed) {
            return NextResponse.json({
                error: "Restaurant setup is not available yet — apply migration 34 "
                    + "(supabase/migrations/_backup_2026-05-20/34_super_admin_create_restaurant.sql, "
                    + "or re-apply combined_schema.sql) to the database.",
            }, { status: 503 })
        }
        return NextResponse.json({ error: rpcErr.message }, { status: 400 })
    }

    logInfo("super-admin created restaurant", {
        superAdminEmail: guard.email,
        newOwnerEmail: email,
        newUserId,
        restaurantName,
        country: cfg.name,
    })

    return NextResponse.json({ ok: true, user_id: newUserId, email, restaurant_name: restaurantName })
}
