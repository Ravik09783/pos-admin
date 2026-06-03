import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowRight, Bike, ExternalLink, HelpCircle, Pizza, Sparkles, Tag, Wallet } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/app-shell/page-header"
import { getCurrentUserAndTenant } from "@/lib/auth/current-user"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { formatCurrency } from "@/lib/utils"
import { AGGREGATORS, STATUS_LABELS, type AggregatorKey, type AggregatorMeta, type AggregatorStatus } from "@/lib/integrations/aggregators"

/**
 * /integrations — landing page that surfaces Swiggy + Zomato (and any
 * future aggregator) side by side so the OWNER can scan their food-
 * delivery footprint without picking one to drill into first.
 *
 * Each tile shows:
 *   - Brand strip (coloured tile + label)
 *   - Live connection status (NOT_CONNECTED / MANUAL_TRACKING / CONNECTED)
 *   - Month-to-date gross + order count, derived from bills tagged with
 *     this `orders.order_source`
 *   - Direct CTA to the per-aggregator workbench
 *
 * Below the tiles sits a single 3-step "how this works" panel — keeps
 * the page approachable for a first-time admin who hasn't tagged any
 * order yet.
 */
const FEATURED_AGGREGATORS: AggregatorKey[] = ["SWIGGY", "ZOMATO"]

const BRAND_ICON: Partial<Record<AggregatorKey, typeof Bike>> = {
    SWIGGY: Bike,
    ZOMATO: Pizza,
}

interface MtdSummary {
    aggregator: AggregatorKey
    gross: number
    order_count: number
    status: AggregatorStatus
}

export default async function IntegrationsIndexPage() {
    const { appUser } = await getCurrentUserAndTenant()
    if (!appUser?.tenant_id) notFound()

    const service = createServiceRoleClient()

    const { data: tenant } = await service
        .from("tenants")
        .select("currency, country")
        .eq("id", appUser.tenant_id)
        .maybeSingle() as { data: { currency?: string | null; country?: string | null } | null }
    const currency = tenant?.currency ?? "INR"

    // Month-to-date bills tagged with an aggregator source. ONE query
    // covers every aggregator — we group client-side so a new key in
    // AGGREGATORS doesn't need a schema change.
    const monthStart = new Date()
    monthStart.setHours(0, 0, 0, 0)
    monthStart.setDate(1)

    const [integrationsRes, billsRes] = await Promise.all([
        service
            .from("aggregator_integrations")
            .select("aggregator, status")
            .eq("tenant_id", appUser.tenant_id),
        service
            .from("bills")
            .select("grand_total, order:orders!inner(order_source)")
            .eq("tenant_id", appUser.tenant_id)
            .gte("created_at", monthStart.toISOString())
            .neq("bill_status", "VOID"),
    ])
    const integrations = (integrationsRes.data ?? []) as { aggregator: AggregatorKey; status: AggregatorStatus }[]
    const bills = (billsRes.data ?? []) as Array<{
        grand_total: number
        order: { order_source: string | null } | { order_source: string | null }[] | null
    }>

    const statusByKey: Partial<Record<AggregatorKey, AggregatorStatus>> = {}
    for (const i of integrations) {
        statusByKey[i.aggregator] = i.status
    }

    const grossByKey = new Map<string, { gross: number; count: number }>()
    for (const b of bills) {
        const ord = Array.isArray(b.order) ? b.order[0] : b.order
        const src = ord?.order_source
        if (!src) continue
        const cur = grossByKey.get(src) ?? { gross: 0, count: 0 }
        cur.gross += Number(b.grand_total)
        cur.count += 1
        grossByKey.set(src, cur)
    }

    const summaries: MtdSummary[] = FEATURED_AGGREGATORS.map((k) => ({
        aggregator: k,
        gross: grossByKey.get(k)?.gross ?? 0,
        order_count: grossByKey.get(k)?.count ?? 0,
        status: statusByKey[k] ?? "NOT_CONNECTED",
    }))

    const money = (n: number) => formatCurrency(n, currency)
    const totalGross = summaries.reduce((s, r) => s + r.gross, 0)
    const totalCount = summaries.reduce((s, r) => s + r.order_count, 0)

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-5xl space-y-6">
            <PageHeader
                kicker="Connected apps"
                title="Food-delivery integrations"
                highlight="orders + payouts"
                description="Track Swiggy and Zomato orders alongside your direct sales. Tag each order at the POS so commission projections, payout reconciliation and per-channel reports just work."
            />

            {/* ── Combined snapshot strip ──────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SummaryTile label="Gross this month" value={money(totalGross)} sub="Swiggy + Zomato" icon={Wallet} />
                <SummaryTile label="Orders this month" value={String(totalCount)} sub="Tagged bills" icon={Tag} />
                <SummaryTile label="Connected channels" value={String(summaries.filter((s) => s.status === "CONNECTED" || s.status === "MANUAL_TRACKING").length)} sub={`of ${summaries.length}`} icon={Sparkles} />
                <SummaryTile label="Bridges available" value="3" sub="UrbanPiper, Petpooja, MagicPin" icon={ExternalLink} />
            </div>

            {/* ── Side-by-side aggregator cards ─────────────────────── */}
            <div className="grid md:grid-cols-2 gap-4">
                {summaries.map((s) => (
                    <AggregatorCard
                        key={s.aggregator}
                        meta={AGGREGATORS[s.aggregator]}
                        summary={s}
                        money={money}
                    />
                ))}
            </div>

            {/* ── "How does this work" — always visible, simple ──── */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <HelpCircle className="h-4 w-4 text-primary" />
                        How does this work?
                    </CardTitle>
                    <CardDescription>
                        Three short steps. You can start today without any approval from Swiggy or Zomato.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid md:grid-cols-3 gap-4">
                    <StepBox
                        n={1}
                        title="Tag each order at the POS"
                        body="When you ring up an order that came from Swiggy or Zomato, pick the Source dropdown in the POS dialog. That's all — no setup needed."
                    />
                    <StepBox
                        n={2}
                        title="See it on the dashboards"
                        body="The Swiggy and Zomato workbenches show this month's gross, order count, expected commission, and your full bill history per channel."
                    />
                    <StepBox
                        n={3}
                        title="Reconcile each payout"
                        body="When Swiggy or Zomato pays you fortnightly, click 'Add settlement' and paste the numbers. We flag any commission overcharge automatically."
                    />
                </CardContent>
            </Card>
        </div>
    )
}

function SummaryTile({
    label, value, sub, icon: Icon,
}: {
    label: string
    value: string
    sub: string
    icon: typeof Wallet
}) {
    return (
        <Card>
            <CardContent className="p-4 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
                    <span className="grid place-items-center h-7 w-7 rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
                </div>
                <div className="text-xl md:text-2xl font-bold tabular-nums leading-tight">{value}</div>
                <div className="text-[11px] text-muted-foreground">{sub}</div>
            </CardContent>
        </Card>
    )
}

function StepBox({ n, title, body }: { n: number; title: string; body: string }) {
    return (
        <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-1.5">
            <div className="flex items-center gap-2">
                <span className="grid place-items-center h-7 w-7 rounded-full bg-primary text-primary-foreground text-xs font-bold">{n}</span>
                <h3 className="font-semibold text-sm">{title}</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
        </div>
    )
}

function AggregatorCard({
    meta, summary, money,
}: {
    meta: AggregatorMeta
    summary: MtdSummary
    money: (n: number) => string
}) {
    const status = STATUS_LABELS[summary.status]
    const Icon = BRAND_ICON[meta.key] ?? Sparkles
    const tone = status.tone
    const slug = meta.key.toLowerCase()
    return (
        <Card
            className="overflow-hidden border-2"
            style={{ borderColor: `${meta.brandColor}33` }}
        >
            <div
                className="px-5 py-4 flex items-center gap-3"
                style={{
                    background: `linear-gradient(135deg, ${meta.brandColor}22 0%, transparent 70%)`,
                }}
            >
                <div
                    className="h-12 w-12 rounded-xl grid place-items-center shrink-0 shadow-sm"
                    style={{ background: meta.brandColor, color: meta.brandTextColor }}
                >
                    <Icon className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="font-bold text-base">{meta.label}</div>
                    <Badge
                        variant="outline"
                        className={
                            tone === "success" ? "text-success border-success/40 bg-success/5 text-[10px]"
                            : tone === "primary" ? "text-primary border-primary/40 bg-primary/5 text-[10px]"
                            : tone === "warning" ? "text-warning border-warning/40 bg-warning/5 text-[10px]"
                            : "text-muted-foreground text-[10px]"
                        }
                    >
                        {status.label}
                    </Badge>
                </div>
            </div>
            <CardContent className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Gross MTD</div>
                        <div className="text-2xl font-bold tabular-nums">{money(summary.gross)}</div>
                    </div>
                    <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Orders MTD</div>
                        <div className="text-2xl font-bold tabular-nums">{summary.order_count}</div>
                    </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{meta.blurb}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                    <Button asChild variant="neon" size="sm" className="flex-1">
                        <Link href={`/integrations/${slug}`}>
                            Open {meta.label} dashboard <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                        <a href={meta.partnerPortalUrl} target="_blank" rel="noreferrer">
                            Partner portal <ExternalLink className="h-3 w-3" />
                        </a>
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}
