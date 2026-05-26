"use client"

/**
 * Per-aggregator workbench — drives `/integrations/swiggy` AND
 * `/integrations/zomato` (and any future aggregator we add).
 *
 * Surfaces, top to bottom:
 *   1. **Status header**  : brand strip, current connection state, links
 *                            to the official partner program.
 *   2. **KPI strip**      : this-month gross / orders / avg / commission /
 *                            expected net payout (system-computed via
 *                            `aggregator_kpis` RPC).
 *   3. **Settings card**  : OWNER-only — status, partner restaurant ID,
 *                            commission %, contact email, notes.
 *                            Persists to `aggregator_integrations`.
 *   4. **Recent orders**  : last 25 bills tagged with this source.
 *                            Click-through to `/orders?source=SWIGGY`.
 *   5. **Settlement log** : monthly payouts as reported by the
 *                            aggregator. Add / delete from here. Variance
 *                            vs system-computed gross is shown inline.
 *   6. **Integration guide** (collapsible): step-by-step path to going
 *                            live — official partner program, third-party
 *                            bridges, and the manual workflow that works
 *                            until either of those land.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
    AlertTriangle, ArrowRight, ArrowUpRight, Calculator, CheckCircle2, ChevronDown,
    ExternalLink, FileText, Hourglass, Info, Link as LinkIcon, Loader2, Plus,
    Receipt, Send, ShieldCheck, Sparkles, Trash2, Wallet,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import {
    AGGREGATORS, STATUS_LABELS,
    type AggregatorKey, type AggregatorMeta, type AggregatorStatus,
} from "@/lib/integrations/aggregators"

interface IntegrationRow {
    tenant_id: string
    aggregator: AggregatorKey
    status: AggregatorStatus
    partner_restaurant_id: string | null
    contact_email: string | null
    commission_pct: number
    notes: string | null
    status_changed_at: string
    updated_at: string
}

interface KpiRow {
    gross: number
    order_count: number
    avg_order_value: number
    expected_commission: number
    expected_payout: number
}

interface OrderRow {
    id: string
    invoice_number: string
    grand_total: number
    bill_status: string
    created_at: string
    order: { customer_name: string | null; order_type: string | null } | { customer_name: string | null; order_type: string | null }[] | null
}

interface SettlementRow {
    id: string
    period_start: string
    period_end: string
    gross_sales: number
    commission_charged: number
    net_payout: number
    paid_on: string | null
    reference: string | null
    notes: string | null
    created_at: string
}

export function AggregatorWorkbench({
    aggregator, tenantCurrency,
}: {
    aggregator: AggregatorKey
    tenantCurrency: string
}) {
    const meta = AGGREGATORS[aggregator]
    const supabase = useMemo(() => createClient(), [])
    const money = useCallback((n: number) => formatCurrency(n, tenantCurrency), [tenantCurrency])

    const [integration, setIntegration] = useState<IntegrationRow | null>(null)
    const [kpi, setKpi] = useState<KpiRow | null>(null)
    const [orders, setOrders] = useState<OrderRow[]>([])
    const [settlements, setSettlements] = useState<SettlementRow[]>([])
    const [loading, setLoading] = useState(true)
    const [guideOpen, setGuideOpen] = useState(false)

    // Settings edit state (OWNER-only — RLS enforces, UI mirrors)
    const [settingsBusy, setSettingsBusy] = useState(false)
    const [status, setStatus] = useState<AggregatorStatus>("NOT_CONNECTED")
    const [partnerId, setPartnerId] = useState("")
    const [contactEmail, setContactEmail] = useState("")
    const [commissionPct, setCommissionPct] = useState<string>("0")
    const [notes, setNotes] = useState("")

    // Settlement-add dialog state
    const [settleOpen, setSettleOpen] = useState(false)

    const refresh = useCallback(async () => {
        setLoading(true)
        // Month-to-date window for KPI math.
        const monthStart = new Date()
        monthStart.setHours(0, 0, 0, 0)
        monthStart.setDate(1)
        const nextMonth = new Date(monthStart)
        nextMonth.setMonth(nextMonth.getMonth() + 1)

        const [integrationRes, kpiRes, ordersRes, settlementsRes] = await Promise.all([
            supabase
                .from("aggregator_integrations")
                .select("*")
                .eq("aggregator", aggregator)
                .maybeSingle(),
            supabase.rpc("aggregator_kpis" as never, {
                p_aggregator: aggregator,
                p_from: monthStart.toISOString(),
                p_to:   nextMonth.toISOString(),
            } as never),
            // Recent bills via the aggregator. We embed the order so we
            // can show customer + type without a second round-trip.
            supabase
                .from("bills")
                .select("id, invoice_number, grand_total, bill_status, created_at, order:orders!inner(customer_name, order_type, order_source)")
                .eq("orders.order_source", aggregator)
                .neq("bill_status", "VOID")
                .order("created_at", { ascending: false })
                .limit(25),
            supabase
                .from("aggregator_settlements")
                .select("id, period_start, period_end, gross_sales, commission_charged, net_payout, paid_on, reference, notes, created_at")
                .eq("aggregator", aggregator)
                .order("period_start", { ascending: false })
                .limit(24),
        ])

        const intRow = (integrationRes.data ?? null) as IntegrationRow | null
        setIntegration(intRow)
        setStatus(intRow?.status ?? "NOT_CONNECTED")
        setPartnerId(intRow?.partner_restaurant_id ?? "")
        setContactEmail(intRow?.contact_email ?? "")
        setCommissionPct(String(intRow?.commission_pct ?? 0))
        setNotes(intRow?.notes ?? "")

        const kpiData = (kpiRes.data ?? null) as KpiRow[] | null
        setKpi(kpiData && kpiData[0]
            ? {
                gross: Number(kpiData[0].gross),
                order_count: Number(kpiData[0].order_count),
                avg_order_value: Number(kpiData[0].avg_order_value),
                expected_commission: Number(kpiData[0].expected_commission),
                expected_payout: Number(kpiData[0].expected_payout),
            }
            : { gross: 0, order_count: 0, avg_order_value: 0, expected_commission: 0, expected_payout: 0 },
        )
        setOrders((ordersRes.data ?? []) as OrderRow[])
        setSettlements((settlementsRes.data ?? []) as SettlementRow[])
        setLoading(false)
    }, [supabase, aggregator])

    useEffect(() => { refresh() }, [refresh])

    async function saveSettings() {
        setSettingsBusy(true)
        try {
            const r = await fetch(`/api/admin/integrations/${aggregator.toLowerCase()}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    status,
                    partner_restaurant_id: partnerId.trim() || null,
                    contact_email: contactEmail.trim() || null,
                    commission_pct: Number(commissionPct) || 0,
                    notes: notes.trim() || null,
                }),
            })
            const data = await r.json().catch(() => ({}))
            if (!r.ok) throw new Error(data.error ?? "Couldn't save")
            toast.success(`${meta.label} integration saved`)
            await refresh()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save")
        } finally {
            setSettingsBusy(false)
        }
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-6xl space-y-6">
            <Header meta={meta} integration={integration} />

            <KpiStrip kpi={kpi} money={money} loading={loading} />

            <SettingsCard
                meta={meta}
                status={status} setStatus={setStatus}
                partnerId={partnerId} setPartnerId={setPartnerId}
                contactEmail={contactEmail} setContactEmail={setContactEmail}
                commissionPct={commissionPct} setCommissionPct={setCommissionPct}
                notes={notes} setNotes={setNotes}
                busy={settingsBusy} onSave={saveSettings}
            />

            <OrdersCard
                meta={meta}
                orders={orders}
                loading={loading}
                money={money}
            />

            <SettlementsCard
                meta={meta}
                settlements={settlements}
                kpi={kpi}
                money={money}
                onAdd={() => setSettleOpen(true)}
                onDeleted={refresh}
            />

            <GuideCard meta={meta} open={guideOpen} onToggle={() => setGuideOpen((v) => !v)} />

            <AddSettlementDialog
                open={settleOpen}
                onClose={() => setSettleOpen(false)}
                aggregator={aggregator}
                onSaved={refresh}
            />
        </div>
    )
}

// ──────────────────────────────────────────────────────────────────────────
// Header — brand strip + page title + status badge
// ──────────────────────────────────────────────────────────────────────────
function Header({ meta, integration }: { meta: AggregatorMeta; integration: IntegrationRow | null }) {
    const s = STATUS_LABELS[integration?.status ?? "NOT_CONNECTED"]
    const toneClass = {
        muted:   "bg-muted text-muted-foreground border-border",
        warning: "bg-warning/15 text-warning border-warning/40",
        primary: "bg-primary/15 text-primary border-primary/40",
        success: "bg-success/15 text-success border-success/40",
    }[s.tone]

    return (
        <div className="space-y-3">
            <PageHeader
                kicker="Integration"
                title={meta.label}
                highlight="orders + payouts"
                description={meta.blurb}
                actions={
                    <>
                        <Button asChild variant="outline">
                            <a href={meta.partnerProgramUrl} target="_blank" rel="noreferrer">
                                Partner portal <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                        </Button>
                        <Button asChild variant="neon">
                            <Link href={`/orders?source=${meta.key}`}>
                                Open orders <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                        </Button>
                    </>
                }
            />

            <div
                className="rounded-2xl border p-4 flex items-center gap-4 flex-wrap"
                style={{ background: `linear-gradient(135deg, ${meta.brandColor}22 0%, transparent 60%)`, borderColor: `${meta.brandColor}44` }}
            >
                <div
                    className="h-14 w-14 rounded-2xl grid place-items-center font-extrabold text-2xl shadow-glow shrink-0"
                    style={{ background: meta.brandColor, color: meta.brandTextColor }}
                >
                    {meta.label.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-0.5">Status</div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={cn("text-xs", toneClass)}>{s.label}</Badge>
                        <span className="text-xs text-muted-foreground truncate">{s.description}</span>
                    </div>
                </div>
                <div className="text-xs text-muted-foreground max-w-xs">
                    <Hourglass className="h-3 w-3 inline mr-1" /> {meta.onboardingExpectation}
                </div>
            </div>
        </div>
    )
}

// ──────────────────────────────────────────────────────────────────────────
// KPI strip — month-to-date
// ──────────────────────────────────────────────────────────────────────────
function KpiStrip({ kpi, money, loading }: { kpi: KpiRow | null; money: (n: number) => string; loading: boolean }) {
    if (loading || !kpi) {
        return (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {Array.from({ length: 5 }).map((_, i) => (
                    <Card key={i}><CardContent className="p-4 h-[96px] grid place-items-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></CardContent></Card>
                ))}
            </div>
        )
    }
    const tiles: { label: string; value: string; icon: typeof Receipt; sub?: string }[] = [
        { label: "Gross sales (MTD)", value: money(kpi.gross), icon: Wallet, sub: `${kpi.order_count} bill${kpi.order_count === 1 ? "" : "s"}` },
        { label: "Avg order value",   value: money(kpi.avg_order_value), icon: Calculator },
        { label: "Expected commission", value: money(kpi.expected_commission), icon: ArrowUpRight, sub: "Per current rate" },
        { label: "Expected payout",     value: money(kpi.expected_payout), icon: Send, sub: "Gross − commission" },
        { label: "Orders this month",   value: String(kpi.order_count), icon: Receipt },
    ]
    return (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {tiles.map((t) => (
                <Card key={t.label}>
                    <CardContent className="p-4 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{t.label}</div>
                            <span className="grid place-items-center h-7 w-7 rounded-lg bg-primary/10 text-primary"><t.icon className="h-4 w-4" /></span>
                        </div>
                        <div className="text-xl md:text-2xl font-bold tabular-nums leading-tight">{t.value}</div>
                        {t.sub && <div className="text-[11px] text-muted-foreground">{t.sub}</div>}
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}

// ──────────────────────────────────────────────────────────────────────────
// Settings card — OWNER-only
// ──────────────────────────────────────────────────────────────────────────
function SettingsCard({
    meta, status, setStatus, partnerId, setPartnerId, contactEmail, setContactEmail,
    commissionPct, setCommissionPct, notes, setNotes, busy, onSave,
}: {
    meta: AggregatorMeta
    status: AggregatorStatus
    setStatus: (s: AggregatorStatus) => void
    partnerId: string
    setPartnerId: (v: string) => void
    contactEmail: string
    setContactEmail: (v: string) => void
    commissionPct: string
    setCommissionPct: (v: string) => void
    notes: string
    setNotes: (v: string) => void
    busy: boolean
    onSave: () => void
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" /> {meta.label} settings
                </CardTitle>
                <CardDescription>
                    Drives the commission projection above and the variance check on settlement entries. Admin-only.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label>Integration status</Label>
                        <Select value={status} onValueChange={(v) => setStatus(v as AggregatorStatus)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {(Object.keys(STATUS_LABELS) as AggregatorStatus[]).map((k) => (
                                    <SelectItem key={k} value={k}>{STATUS_LABELS[k].label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-[11px] text-muted-foreground">
                            Flip to <em>Manual tracking</em> once you start tagging Source: {meta.label} on the POS.
                        </p>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Commission % charged by {meta.label}</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                type="number"
                                step="0.1"
                                min="0"
                                max="100"
                                value={commissionPct}
                                onChange={(e) => setCommissionPct(e.target.value)}
                                className="w-32 font-mono"
                            />
                            <span className="text-xs text-muted-foreground">
                                Typical {meta.label}: {meta.typicalCommissionPct.low}–{meta.typicalCommissionPct.high}%
                            </span>
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label>{meta.label} restaurant ID</Label>
                        <Input
                            value={partnerId}
                            onChange={(e) => setPartnerId(e.target.value)}
                            placeholder="From the partner portal"
                            className="font-mono text-xs"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Account-manager email</Label>
                        <Input
                            type="email"
                            value={contactEmail}
                            onChange={(e) => setContactEmail(e.target.value)}
                            placeholder="partnersupport@example.com"
                            className="text-xs"
                        />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                        <Label>Notes</Label>
                        <Textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Contract terms, peak-day overrides, anything worth remembering."
                            rows={2}
                            maxLength={2000}
                        />
                    </div>
                </div>
                <div className="flex justify-end">
                    <Button variant="neon" onClick={onSave} disabled={busy}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                        Save settings
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}

// ──────────────────────────────────────────────────────────────────────────
// Recent orders card
// ──────────────────────────────────────────────────────────────────────────
function OrdersCard({
    meta, orders, loading, money,
}: {
    meta: AggregatorMeta; orders: OrderRow[]; loading: boolean; money: (n: number) => string
}) {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <CardTitle className="text-base flex items-center gap-2">
                            <Receipt className="h-4 w-4 text-primary" /> Recent {meta.label} orders
                        </CardTitle>
                        <CardDescription>
                            Bills tagged with Source: {meta.label} — newest first, max 25.
                        </CardDescription>
                    </div>
                    <Button asChild size="sm" variant="outline">
                        <Link href={`/orders?source=${meta.key}`}>
                            View all <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="py-6 grid place-items-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
                ) : orders.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground space-y-2">
                        <Info className="h-5 w-5 mx-auto opacity-50" />
                        <p>
                            No {meta.label} orders this month yet. Tag orders as{" "}
                            <strong>Source: {meta.label}</strong> at the POS to see them here.
                        </p>
                    </div>
                ) : (
                    <ul className="divide-y divide-border/40">
                        {orders.map((b) => {
                            const order = Array.isArray(b.order) ? b.order[0] : b.order
                            return (
                                <li key={b.id} className="py-2.5 flex items-center gap-3 text-sm">
                                    <Link href={`/bills/${b.id}`} className="font-mono text-xs text-primary hover:underline">
                                        {b.invoice_number}
                                    </Link>
                                    <span className="text-muted-foreground truncate flex-1">
                                        {order?.customer_name ?? "—"}
                                        {order?.order_type && (
                                            <span className="text-[11px] text-muted-foreground/70 ml-2">
                                                · {order.order_type.toLowerCase()}
                                            </span>
                                        )}
                                    </span>
                                    <span className="font-mono tabular-nums">{money(Number(b.grand_total))}</span>
                                    <span className="text-[11px] text-muted-foreground tabular-nums">
                                        {formatDate(b.created_at, { dateStyle: "short", timeStyle: "short" })}
                                    </span>
                                    {b.bill_status !== "PAID" && (
                                        <Badge variant="warning" className="text-[10px]">{b.bill_status}</Badge>
                                    )}
                                </li>
                            )
                        })}
                    </ul>
                )}
            </CardContent>
        </Card>
    )
}

// ──────────────────────────────────────────────────────────────────────────
// Settlement history + variance check
// ──────────────────────────────────────────────────────────────────────────
function SettlementsCard({
    meta, settlements, kpi, money, onAdd, onDeleted,
}: {
    meta: AggregatorMeta
    settlements: SettlementRow[]
    kpi: KpiRow | null
    money: (n: number) => string
    onAdd: () => void
    onDeleted: () => void
}) {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <CardTitle className="text-base flex items-center gap-2">
                            <Wallet className="h-4 w-4 text-success" /> Settlements
                        </CardTitle>
                        <CardDescription>
                            Log each payout from {meta.label} so you can reconcile against the bank deposit + spot
                            commission overcharges.
                        </CardDescription>
                    </div>
                    <Button size="sm" variant="neon" onClick={onAdd}>
                        <Plus className="h-3.5 w-3.5" /> Add settlement
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                {settlements.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground space-y-2">
                        <FileText className="h-5 w-5 mx-auto opacity-50" />
                        <p>No settlements recorded yet. Drop your first payout statement in to start the audit trail.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {settlements.map((s) => (
                            <SettlementRowCard
                                key={s.id}
                                settlement={s}
                                aggregator={meta.key}
                                kpi={kpi}
                                money={money}
                                onDeleted={onDeleted}
                            />
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

function SettlementRowCard({
    settlement, aggregator, kpi, money, onDeleted,
}: {
    settlement: SettlementRow
    aggregator: AggregatorKey
    kpi: KpiRow | null
    money: (n: number) => string
    onDeleted: () => void
}) {
    // Cheap variance: only the MOST RECENT row is checked against the
    // currently-loaded month KPI, and only when the row's period
    // overlaps the current month. Useful guardrail for "did we get
    // overcharged?". A full per-period system-gross would require
    // re-querying — overkill for the dashboard.
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const overlapsThisMonth = new Date(settlement.period_end) >= monthStart
    const variance = (overlapsThisMonth && kpi) ? Number(settlement.gross_sales) - kpi.gross : null
    const variancePct = (variance != null && kpi && kpi.gross > 0) ? (variance / kpi.gross) * 100 : null

    const [deleting, setDeleting] = useState(false)
    async function remove() {
        if (!confirm("Delete this settlement entry? Use this only for typo fixes.")) return
        setDeleting(true)
        const r = await fetch(`/api/admin/integrations/${aggregator.toLowerCase()}/settlement?id=${settlement.id}`, {
            method: "DELETE",
        })
        if (!r.ok) {
            const data = await r.json().catch(() => ({}))
            toast.error(data.error ?? "Couldn't delete")
            setDeleting(false)
            return
        }
        toast.success("Settlement deleted")
        onDeleted()
    }

    return (
        <div className="rounded-md border border-border/50 p-3 text-sm">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                    <div className="font-medium">
                        {formatDate(settlement.period_start, { dateStyle: "medium" })}
                        {" – "}
                        {formatDate(settlement.period_end, { dateStyle: "medium" })}
                    </div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
                        {settlement.paid_on && (
                            <span><CheckCircle2 className="h-3 w-3 inline mr-1 text-success" /> Paid {formatDate(settlement.paid_on, { dateStyle: "short" })}</span>
                        )}
                        {settlement.reference && <span className="font-mono">{settlement.reference}</span>}
                    </div>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={remove} disabled={deleting} title="Delete">
                    {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3 text-destructive" />}
                </Button>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-2 text-xs">
                <Cell label="Gross" value={money(Number(settlement.gross_sales))} />
                <Cell label="Commission" value={money(Number(settlement.commission_charged))} tone="warning" />
                <Cell label="Net payout" value={money(Number(settlement.net_payout))} tone="success" />
            </div>
            {variance != null && variancePct != null && Math.abs(variancePct) > 1 && (
                <div className={cn(
                    "mt-2 text-[11px] rounded-md px-2 py-1.5 border flex items-start gap-1.5",
                    Math.abs(variancePct) > 5
                        ? "bg-destructive/10 border-destructive/30 text-destructive"
                        : "bg-warning/10 border-warning/30 text-warning",
                )}>
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>
                        Variance vs system-computed MTD gross:{" "}
                        <strong className="font-mono">{variance > 0 ? "+" : ""}{money(variance)}</strong>{" "}
                        ({variancePct > 0 ? "+" : ""}{variancePct.toFixed(1)}%). Check for un-tagged POS orders or{" "}
                        {aggregator.toLowerCase()}-side data lag.
                    </span>
                </div>
            )}
            {settlement.notes && (
                <p className="text-[11px] text-muted-foreground mt-1.5 whitespace-pre-line">{settlement.notes}</p>
            )}
        </div>
    )
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "warning" | "success" }) {
    const toneCls = tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : ""
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className={cn("font-mono font-semibold tabular-nums", toneCls)}>{value}</div>
        </div>
    )
}

// ──────────────────────────────────────────────────────────────────────────
// Add-settlement dialog
// ──────────────────────────────────────────────────────────────────────────
function AddSettlementDialog({
    open, onClose, aggregator, onSaved,
}: {
    open: boolean
    onClose: () => void
    aggregator: AggregatorKey
    onSaved: () => void
}) {
    const today = new Date().toISOString().slice(0, 10)
    const firstOfThisMonth = (() => {
        const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10)
    })()
    const [periodStart, setPeriodStart] = useState(firstOfThisMonth)
    const [periodEnd, setPeriodEnd] = useState(today)
    const [gross, setGross] = useState("")
    const [commission, setCommission] = useState("")
    const [net, setNet] = useState("")
    const [paidOn, setPaidOn] = useState("")
    const [reference, setReference] = useState("")
    const [notes, setNotes] = useState("")
    const [busy, setBusy] = useState(false)

    // Auto-compute net when gross + commission are filled (admin can
    // still override it because aggregators occasionally add adjustments
    // on top of the standard commission).
    useEffect(() => {
        const g = Number(gross); const c = Number(commission)
        if (Number.isFinite(g) && Number.isFinite(c) && (gross !== "" || commission !== "")) {
            const expected = Math.max(0, g - c)
            if (net === "" || net === String(Math.max(0, g - 0))) {
                setNet(expected.toFixed(2))
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gross, commission])

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        setBusy(true)
        try {
            const r = await fetch(`/api/admin/integrations/${aggregator.toLowerCase()}/settlement`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    period_start: periodStart,
                    period_end: periodEnd,
                    gross_sales: Number(gross),
                    commission_charged: Number(commission),
                    net_payout: Number(net),
                    paid_on: paidOn || null,
                    reference: reference || null,
                    notes: notes || null,
                }),
            })
            const data = await r.json().catch(() => ({}))
            if (!r.ok) throw new Error(data.error ?? "Couldn't save")
            toast.success("Settlement recorded")
            // Reset form
            setGross(""); setCommission(""); setNet(""); setPaidOn(""); setReference(""); setNotes("")
            onSaved()
            onClose()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save")
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
            <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Record settlement</DialogTitle></DialogHeader>
                <form onSubmit={submit} className="space-y-3">
                    <div className="grid sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label>Period start *</Label>
                            <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Period end *</Label>
                            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Gross sales *</Label>
                            <Input type="number" step="0.01" min="0" value={gross} onChange={(e) => setGross(e.target.value)} required className="font-mono" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Commission charged *</Label>
                            <Input type="number" step="0.01" min="0" value={commission} onChange={(e) => setCommission(e.target.value)} required className="font-mono" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Net payout *</Label>
                            <Input type="number" step="0.01" min="0" value={net} onChange={(e) => setNet(e.target.value)} required className="font-mono" />
                            <p className="text-[11px] text-muted-foreground">Auto-fills from gross − commission. Override if there are adjustments.</p>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Paid on</Label>
                            <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label>Bank reference / UTR</Label>
                            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="From the bank statement" className="font-mono text-xs" />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label>Notes</Label>
                            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} placeholder="Disputed items, festival adjustments, etc." />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="submit" variant="neon" disabled={busy}>
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            Record settlement
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

// ──────────────────────────────────────────────────────────────────────────
// Integration guide — collapsible, mirrors the WhatsApp guide pattern
// ──────────────────────────────────────────────────────────────────────────
function GuideCard({ meta, open, onToggle }: { meta: AggregatorMeta; open: boolean; onToggle: () => void }) {
    return (
        <Card>
            <CardHeader>
                <button onClick={onToggle} className="w-full text-left flex items-start justify-between gap-3">
                    <div>
                        <CardTitle className="text-base flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-warning" /> How to integrate with {meta.label}
                        </CardTitle>
                        <CardDescription>
                            Three paths: official partner program, third-party bridge, or manual tagging today. All
                            three feed into the same workbench above.
                        </CardDescription>
                    </div>
                    <ChevronDown className={cn("h-5 w-5 transition-transform shrink-0", open && "rotate-180")} />
                </button>
            </CardHeader>
            {open && (
                <CardContent className="space-y-5">
                    <Path
                        n={1}
                        title="Apply to the official partner program"
                        timeline="7–30 days for listing · longer for direct POS integration"
                        body={
                            <>
                                Go to{" "}
                                <a href={meta.partnerProgramUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                                    {meta.partnerProgramUrl.replace(/^https?:\/\//, "")}
                                    <ExternalLink className="h-2.5 w-2.5" />
                                </a>
                                . Fill in the business application (FSSAI license, GST, bank account, owner KYC).
                                Once approved you can list your menu via the {meta.label} partner portal — orders
                                come in over their app, you can already track them <em>manually</em> here by
                                tagging each order&apos;s Source on the POS.
                            </>
                        }
                        cta={{ href: meta.partnerProgramUrl, label: `Apply on ${meta.label}` }}
                    />

                    <Path
                        n={2}
                        title="Wire up automatically via a third-party bridge"
                        timeline="Live the same day after the bridge approves you"
                        body={
                            <>
                                {meta.label} doesn&apos;t publish a self-serve API key — but partners like
                                UrbanPiper, Petpooja Bridge and MagicPin Reach DO, because they have their own
                                approved integrations with the aggregators. You pay a small monthly fee per outlet
                                and get auto-sync (orders push into your KDS, menu changes push back to{" "}
                                {meta.label}, payouts auto-reconcile).
                            </>
                        }
                        sub={
                            <ul className="grid sm:grid-cols-2 gap-2 mt-2">
                                {meta.bridges.map((b) => (
                                    <li key={b.url} className="rounded-md border border-border/50 p-2.5 text-xs">
                                        <a href={b.url} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline inline-flex items-center gap-0.5">
                                            {b.name} <LinkIcon className="h-2.5 w-2.5" />
                                        </a>
                                        <p className="text-muted-foreground mt-0.5">{b.note}</p>
                                    </li>
                                ))}
                            </ul>
                        }
                    />

                    <Path
                        n={3}
                        title="Tag manually at the POS (works today)"
                        timeline="No application needed — every restaurant can do this from day one."
                        body={
                            <>
                                On the POS, before generating the bill, set <strong>Source: {meta.label}</strong> on
                                the order. The workbench above (KPIs, recent orders, expected commission) populates
                                from those tags. Then when {meta.label} sends the fortnightly payout statement,
                                click <em>Add settlement</em> and copy in the numbers — the variance flag tells you
                                immediately whether the commission they charged matches your contract.
                            </>
                        }
                    />

                    <div className="rounded-md bg-primary/[0.05] border border-primary/30 p-3 text-xs space-y-1">
                        <div className="font-semibold text-primary">When the {meta.label} integration goes live</div>
                        <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                            <li>Orders flow into the KDS automatically with the same urgency colour-coding as dine-in.</li>
                            <li>Menu items + prices + sold-out flags sync both ways — toggle availability here, it propagates.</li>
                            <li>Settlements are pulled nightly and auto-reconciled against the system gross.</li>
                            <li>Cancellation reasons + delivery agent metadata land on the bill for audit.</li>
                            <li>Per-aggregator P&amp;L sits in your monthly reports without manual tagging.</li>
                        </ul>
                    </div>
                </CardContent>
            )}
        </Card>
    )
}

function Path({
    n, title, timeline, body, sub, cta,
}: {
    n: number
    title: string
    timeline: string
    body: React.ReactNode
    sub?: React.ReactNode
    cta?: { href: string; label: string }
}) {
    return (
        <div className="flex gap-3">
            <span className="grid place-items-center h-7 w-7 rounded-full bg-primary/15 text-primary text-xs font-bold shrink-0 mt-0.5">{n}</span>
            <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm">{title}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{timeline}</div>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{body}</p>
                {sub}
                {cta && (
                    <Button asChild size="sm" variant="outline" className="mt-2">
                        <a href={cta.href} target="_blank" rel="noreferrer">{cta.label} <ExternalLink className="h-3 w-3" /></a>
                    </Button>
                )}
            </div>
        </div>
    )
}
