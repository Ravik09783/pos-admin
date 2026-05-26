import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { requireSuperAdmin } from "@/lib/super-admin/guard"
import { logError, logInfo } from "@/lib/errors"

/**
 * PATCH /api/super-admin/demo-requests/[id]
 * Body: { status?: "NEW" | "CONTACTED" | "CONVERTED" | "DROPPED", notes?: string | null }
 *
 * Super-admin updates the triage state of a public "Schedule a free demo"
 * lead. Service-role client because super-admins have no tenant — RLS
 * would scope them out otherwise.
 */

const ALLOWED_STATUSES = ["NEW", "CONTACTED", "CONVERTED", "DROPPED"] as const
type Status = (typeof ALLOWED_STATUSES)[number]

interface Body {
    status?: string
    notes?: string | null
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    const { id } = await ctx.params
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
        return NextResponse.json({ error: "invalid id" }, { status: 400 })
    }

    let body: Body
    try { body = (await req.json()) as Body } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }) }

    const patch: { status?: Status; notes?: string | null } = {}

    if (body.status !== undefined) {
        const s = String(body.status).toUpperCase()
        if (!ALLOWED_STATUSES.includes(s as Status)) {
            return NextResponse.json({ error: "invalid status" }, { status: 400 })
        }
        patch.status = s as Status
    }

    if (body.notes !== undefined) {
        const trimmed = typeof body.notes === "string" ? body.notes.slice(0, 4000) : null
        patch.notes = trimmed && trimmed.length > 0 ? trimmed : null
    }

    if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: "nothing to update" }, { status: 400 })
    }

    try {
        const service = createServiceRoleClient()
        const { error } = await service
            .from("demo_requests")
            .update(patch as never)
            .eq("id", id)
        if (error) {
            logError(error, { route: "/api/super-admin/demo-requests/[id]" })
            return NextResponse.json({ error: error.message }, { status: 400 })
        }
        logInfo("demo-request updated", { id, by: guard.email, status: patch.status })
        return NextResponse.json({ ok: true })
    } catch (e) {
        logError(e, { route: "/api/super-admin/demo-requests/[id]" })
        return NextResponse.json({ error: "Something went wrong." }, { status: 500 })
    }
}
