import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { AGGREGATORS, type AggregatorKey } from "@/lib/integrations/aggregators"

/**
 * POST   /api/admin/integrations/[aggregator]/settlement
 *   body: {
 *     period_start: 'YYYY-MM-DD',
 *     period_end:   'YYYY-MM-DD',
 *     gross_sales: number,
 *     commission_charged: number,
 *     net_payout: number,
 *     paid_on?: 'YYYY-MM-DD' | null,
 *     reference?: string | null,
 *     notes?: string | null,
 *   }
 *
 * Records a single settlement / payout cycle as reported by the
 * aggregator's statement. OWNER-only via RLS. We don't compute the
 * numbers — the admin copy-pastes them from the aggregator's PDF /
 * portal export so they line up exactly with the bank deposit.
 *
 * DELETE /api/admin/integrations/[aggregator]/settlement?id=<uuid>
 *   Removes a settlement row (typo correction). OWNER-only.
 */
function ymdOk(v: unknown): v is string {
    return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

export async function POST(req: Request, ctx: { params: Promise<{ aggregator: string }> }) {
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
        period_start?: string
        period_end?: string
        gross_sales?: number | string
        commission_charged?: number | string
        net_payout?: number | string
        paid_on?: string | null
        reference?: string | null
        notes?: string | null
    } | null
    if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 })

    if (!ymdOk(body.period_start) || !ymdOk(body.period_end)) {
        return NextResponse.json({ error: "period_start / period_end must be YYYY-MM-DD" }, { status: 400 })
    }
    if (body.period_end < body.period_start) {
        return NextResponse.json({ error: "period_end is earlier than period_start" }, { status: 400 })
    }
    const gross = Number(body.gross_sales)
    const commission = Number(body.commission_charged)
    const net = Number(body.net_payout)
    for (const [name, n] of [["gross_sales", gross], ["commission_charged", commission], ["net_payout", net]] as const) {
        if (!Number.isFinite(n) || n < 0) {
            return NextResponse.json({ error: `${name} must be a non-negative number` }, { status: 400 })
        }
    }
    const paidOn = body.paid_on
    if (paidOn != null && paidOn !== "" && !ymdOk(paidOn)) {
        return NextResponse.json({ error: "paid_on must be YYYY-MM-DD or null" }, { status: 400 })
    }

    const { data: caller } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle() as { data: { tenant_id: string | null } | null }
    if (!caller?.tenant_id) return NextResponse.json({ error: "no tenant" }, { status: 400 })

    const { error, data } = await supabase
        .from("aggregator_settlements")
        .insert({
            tenant_id: caller.tenant_id,
            aggregator,
            period_start: body.period_start,
            period_end: body.period_end,
            gross_sales: Math.round(gross * 100) / 100,
            commission_charged: Math.round(commission * 100) / 100,
            net_payout: Math.round(net * 100) / 100,
            paid_on: paidOn || null,
            reference: (body.reference ?? "").trim().slice(0, 120) || null,
            notes: (body.notes ?? "").trim().slice(0, 2000) || null,
            created_by: user.id,
        } as never)
        .select("id")
        .single()

    if (error) {
        if (error.code === "42501") {
            return NextResponse.json({ error: "Only the Admin can record settlements." }, { status: 403 })
        }
        logError(error, { route: "/api/admin/integrations/[aggregator]/settlement POST", aggregator })
        return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ ok: true, id: (data as { id: string }).id })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ aggregator: string }> }) {
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

    const url = new URL(req.url)
    const id = url.searchParams.get("id") ?? ""
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return NextResponse.json({ error: "invalid settlement id" }, { status: 400 })
    }

    // Defense-in-depth: chain an explicit tenant_id filter on the
    // delete instead of trusting RLS alone. If RLS were ever loosened
    // or the policy mis-configured, this prevents cross-tenant
    // deletion of a settlement row by guessing its UUID.
    const { data: caller } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle() as { data: { tenant_id: string | null } | null }
    if (!caller?.tenant_id) return NextResponse.json({ error: "no tenant" }, { status: 400 })

    const { error } = await supabase
        .from("aggregator_settlements")
        .delete()
        .eq("id", id)
        .eq("aggregator", aggregator)
        .eq("tenant_id", caller.tenant_id)

    if (error) {
        if (error.code === "42501") {
            return NextResponse.json({ error: "Only the Admin can remove settlements." }, { status: 403 })
        }
        logError(error, { route: "/api/admin/integrations/[aggregator]/settlement DELETE" })
        return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
}
