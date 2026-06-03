import { NextResponse } from "next/server"

import { appOrigin } from "@/lib/app-origin"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { requireSuperAdmin } from "@/lib/super-admin/guard"
import { logError, logInfo } from "@/lib/errors"

/**
 * POST /api/super-admin/impersonate
 * Body: { tenant_id: string }  — impersonate a restaurant's owner, OR
 *       { user_id: string }    — impersonate one specific account
 *
 * Mints a magic-link URL for the target account and returns it. The
 * super-admin frontend opens this URL in a NEW TAB so the super-admin's
 * own session in the original tab is preserved.
 *
 * Why magic-link: Supabase doesn't expose a "sign in as user X" admin
 * call directly. `auth.admin.generateLink({ type: 'magiclink', email })`
 * produces a one-shot verification URL — clicking it gives the new tab a
 * real session for that user. RLS then naturally treats subsequent reads
 * as the impersonated user, no special server-side context to maintain.
 *
 * Target resolution:
 *   • user_id   → that exact account. Used by the "Accounts without
 *                 restaurant" tab, where the account has no tenant to
 *                 look an owner up from.
 *   • tenant_id → the restaurant's OWNER. If a tenant somehow has no
 *                 OWNER-role row, falls back to its earliest-created
 *                 member — so impersonation works for ANY restaurant
 *                 that has at least one user.
 *
 * The magic link's `redirect_to` lands on `/dashboard?impersonated=1`.
 * An impersonated account with no tenant is then routed on to
 * /onboarding by the `(app)` layout, exactly as a normal login would be.
 *
 * Audit: every impersonation is logged via `logInfo` with the super-
 * admin's email + the target account, so there's a trail in your log
 * sink.
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    const body = (await req.json().catch(() => null)) as {
        tenant_id?: string
        user_id?: string
    } | null
    const tenantId = body?.tenant_id
    const userId = body?.user_id

    const service = createServiceRoleClient()

    // ── Resolve the account to impersonate → { email, name } ───────────
    let targetEmail: string
    let targetName: string | null

    if (userId) {
        const { data, error } = await service
            .from("users")
            .select("email, full_name")
            .eq("id", userId)
            .maybeSingle()
        if (error) {
            logError(error, { route: "/api/super-admin/impersonate", userId })
            return NextResponse.json({ error: error.message }, { status: 500 })
        }
        const row = data as { email: string | null; full_name: string | null } | null
        if (!row?.email) {
            return NextResponse.json({ error: "Account not found." }, { status: 404 })
        }
        targetEmail = row.email
        targetName = row.full_name
    } else if (tenantId) {
        // Prefer the OWNER…
        const { data: ownerRow, error: ownerErr } = await service
            .from("users")
            .select("email, full_name")
            .eq("tenant_id", tenantId)
            .eq("role", "OWNER")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle()
        if (ownerErr) {
            logError(ownerErr, { route: "/api/super-admin/impersonate", tenantId })
            return NextResponse.json({ error: ownerErr.message }, { status: 500 })
        }
        let row = ownerRow as { email: string | null; full_name: string | null } | null

        // …else fall back to the tenant's earliest-created member, so a
        // restaurant with no OWNER row can still be impersonated.
        if (!row?.email) {
            const { data: anyRow } = await service
                .from("users")
                .select("email, full_name")
                .eq("tenant_id", tenantId)
                .order("created_at", { ascending: true })
                .limit(1)
                .maybeSingle()
            row = anyRow as { email: string | null; full_name: string | null } | null
        }
        if (!row?.email) {
            return NextResponse.json({
                error: "This restaurant has no users to impersonate.",
            }, { status: 404 })
        }
        targetEmail = row.email
        targetName = row.full_name
    } else {
        return NextResponse.json({ error: "tenant_id or user_id required" }, { status: 400 })
    }

    // ── Mint the magic link ────────────────────────────────────────────
    // `redirectTo` deliberately lands on `/auth/impersonate-land` rather
    // than `/dashboard` or `/menu`. The landing page sits OUTSIDE the
    // `(app)` route group so the super-admin short-circuit in
    // `(app)/layout.tsx` doesn't redirect the new tab away before
    // `AuthHashHandler` has a chance to read the URL hash and swap
    // the cookies. The path is also exempted in `proxy.ts` so no
    // session refresh races the swap. After the swap, the handler
    // forwards to `/menu` as the impersonated user.
    const appUrl = appOrigin(req)
    const { data, error } = await service.auth.admin.generateLink({
        type: "magiclink",
        email: targetEmail,
        options: {
            redirectTo: `${appUrl}/auth/impersonate-land`,
        },
    })
    if (error) {
        logError(error, { route: "/api/super-admin/impersonate", targetEmail })
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const action_link = (data as { properties?: { action_link?: string } })?.properties?.action_link
    if (!action_link) {
        return NextResponse.json({
            error: "Supabase did not return a magic link URL",
        }, { status: 500 })
    }

    // Verbose debug log — captures the appUrl we asked Supabase to
    // redirect to AND a sanitised view of the action_link Supabase
    // actually returned, so a stuck "Signing you in…" can be traced
    // to (a) whether the link points at our app or fell back to the
    // project's Site URL, and (b) what `redirect_to` Supabase
    // ultimately encoded into the link.
    try {
        const linkUrl = new URL(action_link)
        const encodedRedirect = linkUrl.searchParams.get("redirect_to")
        logInfo("[impersonate] mint OK", {
            superAdminEmail: guard.email,
            tenantId,
            userId,
            targetEmail,
            requestedRedirectTo: `${appUrl}/auth/impersonate-land`,
            actionLinkHost: linkUrl.host,
            actionLinkPath: linkUrl.pathname,
            actionLinkType: linkUrl.searchParams.get("type"),
            actionLinkRedirectTo: encodedRedirect,
            // True when Supabase honoured what we asked for; false
            // means the requested URL was rejected by the project's
            // redirect-URL allowlist and Supabase substituted the
            // project's Site URL — almost always the cause of an
            // impersonation that lands "somewhere weird".
            redirectMatchesRequest: encodedRedirect === `${appUrl}/auth/impersonate-land`,
        })
    } catch {
        logInfo("[impersonate] mint OK (action_link unparsable)", {
            superAdminEmail: guard.email, tenantId, userId, targetEmail,
        })
    }

    return NextResponse.json({
        ok: true,
        action_link,
        owner_email: targetEmail,
        owner_name: targetName,
    })
}
