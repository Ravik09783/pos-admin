import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { requireSuperAdmin } from "@/lib/super-admin/guard"
import { logError, logInfo, logWarn } from "@/lib/errors"
import { stripeFetch } from "@/lib/billing/stripe"

/**
 * DELETE /api/super-admin/tenant/[id]
 *
 * NUKE EVERYTHING for a tenant — DB rows, storage blobs, auth users,
 * and best-effort cancel of the Stripe subscription + revoke Connect
 * access. The DB cascade is one SQL call (every child table FKs
 * `on delete cascade` to tenants.id) but storage + auth + Stripe live
 * outside Postgres so we orchestrate them here.
 *
 * Order of operations:
 *   1. Verify caller is a super-admin (else 404).
 *   2. Call `super_admin_delete_tenant(uuid)` RPC. Returns the list of
 *      auth.users.id values + storage prefixes to sweep, and any
 *      Stripe identifiers (sub / customer / connect account).
 *   3. Cancel Stripe subscription (best-effort — log on failure).
 *   4. De-authorize Stripe Connect (best-effort).
 *   5. Sweep every storage prefix listed (best-effort).
 *   6. Delete every auth.user listed (best-effort).
 *
 * Step 2 is the only step that fails the request — once the cascade
 * commits we proceed even if cleanup loops error, because the tenant
 * is GONE from the user's perspective. Orphaned auth users and storage
 * blobs are a janitorial concern, not a data-integrity one. Every
 * partial failure logs via `logWarn` with the resource id, so an
 * operator can clean them up by hand.
 *
 * Audit: a `logInfo` row is written at the start with the super-admin's
 * email + tenant id + counts of what's about to be wiped.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    const { id: tenantId } = await params
    if (!tenantId || tenantId.length < 8) {
        return NextResponse.json({ error: "invalid tenant id" }, { status: 400 })
    }

    const service = createServiceRoleClient()

    // ── 1. Cascade-delete in the DB. RPC returns the cleanup work list. ─
    const { data: rpcRes, error: rpcErr } = await service.rpc(
        "super_admin_delete_tenant" as never,
        { p_tenant_id: tenantId } as never,
    )
    if (rpcErr) {
        logError(rpcErr, { route: "DELETE /api/super-admin/tenant/[id]", tenantId })
        return NextResponse.json({ error: rpcErr.message }, { status: 500 })
    }
    const summary = rpcRes as {
        deleted: boolean
        reason?: string
        tenant_id?: string
        tenant_name?: string
        tenant_slug?: string
        auth_user_ids?: string[]
        storage_prefixes?: string[]
        stripe_customer_id?: string | null
        stripe_subscription_id?: string | null
        stripe_connect_account_id?: string | null
    } | null
    if (!summary?.deleted) {
        return NextResponse.json({
            ok: false,
            reason: summary?.reason ?? "unknown",
        }, { status: 404 })
    }

    logInfo("super-admin tenant delete: DB cascade complete", {
        superAdminEmail: guard.email,
        tenantId,
        tenantName: summary.tenant_name,
        authUserCount: summary.auth_user_ids?.length ?? 0,
        storagePrefixCount: summary.storage_prefixes?.length ?? 0,
    })

    const cleanup = {
        stripe_subscription: "skipped" as "skipped" | "ok" | "failed",
        stripe_connect: "skipped" as "skipped" | "ok" | "failed",
        storage_objects_deleted: 0,
        storage_errors: [] as string[],
        auth_users_deleted: 0,
        auth_errors: [] as string[],
    }

    // ── 2. Cancel Stripe subscription (platform billing) ────────────────
    if (summary.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
        const r = await stripeFetch(`/subscriptions/${summary.stripe_subscription_id}`, undefined, "DELETE")
        if (r.ok) {
            cleanup.stripe_subscription = "ok"
        } else {
            cleanup.stripe_subscription = "failed"
            logWarn("super-admin tenant delete: Stripe subscription cancel failed", {
                tenantId, subId: summary.stripe_subscription_id, error: r.rawText.slice(0, 200),
            })
        }
    }

    // ── 3. De-authorize Stripe Connect Express account ──────────────────
    // We don't fully delete the connected account (Stripe doesn't allow
    // platforms to do that); we just revoke our platform's access. The
    // restaurant owner can later re-onboard with a different platform.
    if (summary.stripe_connect_account_id && process.env.STRIPE_SECRET_KEY) {
        const r = await stripeFetch(`/oauth/deauthorize`, new URLSearchParams({
            client_id: process.env.STRIPE_CONNECT_CLIENT_ID ?? "",
            stripe_user_id: summary.stripe_connect_account_id,
        }))
        if (r.ok) {
            cleanup.stripe_connect = "ok"
        } else {
            // OAuth deauthorize requires the platform's OAuth client_id.
            // Express accounts created via the API don't strictly need
            // this — they remain usable on Stripe's side but won't appear
            // in our system. Log and move on.
            cleanup.stripe_connect = "failed"
            logWarn("super-admin tenant delete: Stripe Connect deauth failed (Express accounts may not require this)", {
                tenantId, acctId: summary.stripe_connect_account_id, error: r.rawText.slice(0, 200),
            })
        }
    }

    // ── 4. Sweep storage buckets ────────────────────────────────────────
    // Convention: every uploaded file sits under `<bucket>/<tenant_id>/…`.
    // We list everything under the prefix then bulk-remove. If a tenant
    // had 0 uploads, the list call returns empty and remove is a no-op.
    for (const prefix of summary.storage_prefixes ?? []) {
        const [bucket, ...rest] = prefix.split("/")
        const folder = rest.join("/")
        if (!bucket) continue
        try {
            const { data: objects, error: listErr } = await service.storage
                .from(bucket)
                .list(folder, { limit: 1000 })
            if (listErr) {
                cleanup.storage_errors.push(`list ${prefix}: ${listErr.message}`)
                continue
            }
            const paths = (objects ?? []).map((o) => `${folder}/${o.name}`)
            if (paths.length === 0) continue
            const { error: rmErr } = await service.storage.from(bucket).remove(paths)
            if (rmErr) {
                cleanup.storage_errors.push(`remove ${prefix}: ${rmErr.message}`)
            } else {
                cleanup.storage_objects_deleted += paths.length
            }
        } catch (e) {
            cleanup.storage_errors.push(`${prefix}: ${(e as Error).message}`)
        }
    }
    if (cleanup.storage_errors.length > 0) {
        logWarn("super-admin tenant delete: some storage objects could not be removed", {
            tenantId, errors: cleanup.storage_errors,
        })
    }

    // ── 5. Delete every auth.user that belonged to this tenant ──────────
    // Sequential rather than Promise.all so we don't hammer the auth
    // admin endpoint with a burst that might rate-limit us mid-delete.
    for (const userId of summary.auth_user_ids ?? []) {
        try {
            const { error: delErr } = await service.auth.admin.deleteUser(userId)
            if (delErr) {
                cleanup.auth_errors.push(`${userId}: ${delErr.message}`)
            } else {
                cleanup.auth_users_deleted += 1
            }
        } catch (e) {
            cleanup.auth_errors.push(`${userId}: ${(e as Error).message}`)
        }
    }
    if (cleanup.auth_errors.length > 0) {
        logWarn("super-admin tenant delete: some auth users could not be removed", {
            tenantId, errors: cleanup.auth_errors,
        })
    }

    logInfo("super-admin tenant delete: full cleanup complete", {
        superAdminEmail: guard.email,
        tenantId,
        tenantName: summary.tenant_name,
        cleanup,
    })

    return NextResponse.json({
        ok: true,
        tenant_id: summary.tenant_id,
        tenant_name: summary.tenant_name,
        cleanup,
    })
}
