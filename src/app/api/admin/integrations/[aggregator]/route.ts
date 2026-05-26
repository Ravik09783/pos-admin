import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { AGGREGATORS, type AggregatorKey, type AggregatorStatus } from "@/lib/integrations/aggregators"

/**
 * PATCH /api/admin/integrations/[aggregator]
 *   body: {
 *     status?: AggregatorStatus,
 *     partner_restaurant_id?: string | null,
 *     contact_email?: string | null,
 *     commission_pct?: number,
 *     notes?: string | null,
 *   }
 *
 * Upserts the per-(tenant, aggregator) row in `aggregator_integrations`.
 * RLS allows OWNER writes only; the API mirrors that and additionally
 * validates the aggregator key against our registry so an admin can't
 * silently create a row for an aggregator we don't actually support.
 */
const ALLOWED_STATUSES: AggregatorStatus[] = [
    "NOT_CONNECTED", "APPLICATION_PENDING", "MANUAL_TRACKING", "CONNECTED",
]

export async function PATCH(req: Request, ctx: { params: Promise<{ aggregator: string }> }) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { aggregator: aggRaw } = await ctx.params
    const aggregator = aggRaw.toUpperCase() as AggregatorKey
    if (!(aggregator in AGGREGATORS)) {
        return NextResponse.json({ error: "unknown aggregator" }, { status: 400 })
    }

    const body = await req.json().catch(() => null) as {
        status?: string
        partner_restaurant_id?: string | null
        contact_email?: string | null
        commission_pct?: number | string
        notes?: string | null
    } | null
    if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 })

    const { data: caller } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle() as { data: { tenant_id: string | null } | null }
    if (!caller?.tenant_id) return NextResponse.json({ error: "no tenant" }, { status: 400 })

    // Build the upsert payload with only the fields the client sent.
    const patch: Record<string, unknown> = {}

    if (body.status !== undefined) {
        const s = String(body.status).toUpperCase() as AggregatorStatus
        if (!ALLOWED_STATUSES.includes(s)) {
            return NextResponse.json({ error: "invalid status" }, { status: 400 })
        }
        patch.status = s
        patch.status_changed_at = new Date().toISOString()
    }
    if (body.partner_restaurant_id !== undefined) {
        const v = (body.partner_restaurant_id ?? "").trim().slice(0, 120)
        patch.partner_restaurant_id = v || null
    }
    if (body.contact_email !== undefined) {
        const v = (body.contact_email ?? "").trim().slice(0, 200)
        patch.contact_email = v || null
    }
    if (body.commission_pct !== undefined) {
        const n = Number(body.commission_pct)
        if (!Number.isFinite(n) || n < 0 || n > 100) {
            return NextResponse.json({ error: "commission_pct must be between 0 and 100" }, { status: 400 })
        }
        patch.commission_pct = Math.round(n * 100) / 100
    }
    if (body.notes !== undefined) {
        const v = (body.notes ?? "").trim().slice(0, 2000)
        patch.notes = v || null
    }

    // Upsert — RLS gates this to OWNER.
    const { error } = await supabase
        .from("aggregator_integrations")
        .upsert({
            tenant_id: caller.tenant_id,
            aggregator,
            ...patch,
            updated_by: user.id,
            created_by: user.id, // ignored on subsequent updates because of UPSERT-on-PK
        } as never, {
            onConflict: "tenant_id,aggregator",
        })

    if (error) {
        if (error.code === "42501") {
            return NextResponse.json({ error: "Only the Admin can change aggregator integration settings." }, { status: 403 })
        }
        logError(error, { route: "/api/admin/integrations/[aggregator] PATCH", aggregator })
        return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
}
