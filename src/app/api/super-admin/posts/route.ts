import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { requireSuperAdmin } from "@/lib/super-admin/guard"
import { sanitizeHtml } from "@/lib/post-html"
import { logError, logInfo } from "@/lib/errors"

/**
 * POST /api/super-admin/posts
 * Body: { title, body, audience: "ALL" | "SPECIFIC", tenant_ids?: string[] }
 *
 * A super-admin sends a markdown announcement post to ALL restaurants or
 * a SPECIFIC set. Wraps the `super_admin_create_post` RPC (migration 36),
 * which inserts the post + its target rows atomically.
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    const body = (await req.json().catch(() => null)) as {
        title?: string
        body?: string
        audience?: string
        tenant_ids?: string[]
        expires_at?: string | null
    } | null
    if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 })

    const title = (body.title ?? "").trim()
    // Strip scripts / event handlers / script-y URLs before storing, so
    // the body is already clean everywhere it's later rendered.
    const postBody = sanitizeHtml((body.body ?? "").trim()).trim()
    const audience = (body.audience ?? "ALL").toUpperCase() === "SPECIFIC" ? "SPECIFIC" : "ALL"
    const tenantIds = Array.isArray(body.tenant_ids)
        ? body.tenant_ids.filter((x): x is string => typeof x === "string")
        : []

    // Optional expiry. The composer sends a date-only string; we expire
    // at the END of that day so a post set to "June 1" shows all of June 1.
    let expiresAt: string | null = null
    const expiresRaw = typeof body.expires_at === "string" ? body.expires_at.trim() : ""
    if (expiresRaw) {
        const d = new Date(`${expiresRaw}T23:59:59`)
        if (Number.isNaN(d.getTime())) {
            return NextResponse.json({ error: "Invalid expiry date" }, { status: 400 })
        }
        expiresAt = d.toISOString()
    }

    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 })
    if (!postBody) return NextResponse.json({ error: "Post body is required" }, { status: 400 })
    if (audience === "SPECIFIC" && tenantIds.length === 0) {
        return NextResponse.json({ error: "Pick at least one restaurant" }, { status: 400 })
    }

    const admin = createServiceRoleClient()
    const { data, error } = await admin.rpc("super_admin_create_post" as never, {
        p_title: title,
        p_body: postBody,
        p_audience: audience,
        p_tenant_ids: audience === "SPECIFIC" ? tenantIds : null,
        p_created_by: guard.email,
        p_expires_at: expiresAt,
    } as never)

    if (error) {
        const notDeployed =
            (error as { code?: string }).code === "PGRST202" ||
            /could not find the function|super_admin_create_post/i.test(error.message)
        if (notDeployed) {
            return NextResponse.json({
                error: "Announcements aren't enabled yet — apply migration 36 "
                    + "(supabase/migrations/_backup_2026-05-20/36_admin_posts.sql, "
                    + "or re-apply combined_schema.sql).",
            }, { status: 503 })
        }
        logError(error, { route: "/api/super-admin/posts" })
        return NextResponse.json({ error: error.message }, { status: 400 })
    }

    const result = data as { recipient_count?: number } | null
    logInfo("super-admin post sent", {
        superAdminEmail: guard.email,
        audience,
        recipientCount: result?.recipient_count ?? 0,
    })
    return NextResponse.json({ ok: true, recipient_count: result?.recipient_count ?? 0 })
}
