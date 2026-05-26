"use client"

/**
 * Owner cockpit — the analytics-first top section of the dashboard.
 *
 * Renders the four pieces that make the dashboard read as a "real
 * product" instead of a list of cards:
 *
 *   1. KPI strip   — Today's sales · This month's sales (w/ MoM delta)
 *                    · Outstanding bills · Top item today
 *   2. Line chart  — Sales for the last 30 days
 *   3. Donut chart — Payment-method split for this month
 *   4. Bar chart   — Top 5 selling items this month (by revenue)
 *
 * Branch-aware via `useActiveBranch`: respects the topbar switcher so an
 * OWNER can drill into one branch or aggregate across all.
 *
 * All five queries run in parallel; renders a skeleton until they land.
 */

import { useEffect, useMemo, useState } from "react"
import {
    Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
    ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import {
    ArrowDownRight, ArrowUpRight, Banknote, Loader2, Receipt, Sparkles, TrendingUp, Wallet,
} from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useActiveBranch } from "@/lib/branch/active-branch"
import { createClient } from "@/lib/supabase/client"
import { cn, formatCurrency } from "@/lib/utils"

/** Tableau-ish palette tuned for both dark + light themes. */
const SLICE_COLORS = [
    "hsl(var(--primary))",
    "hsl(var(--neon-magenta))",
    "hsl(var(--success))",
    "hsl(var(--warning))",
    "#a855f7",
    "#06b6d4",
    "#f97316",
    "#94a3b8",
]

interface BillRow { id: string; order_id: string; grand_total: number; created_at: string; bill_status: string }
interface ItemRow { item_name: string; quantity: number; line_total: number; is_void: boolean; order_id: string }
interface PaymentRow { method: string; amount: number; created_at: string }

interface CockpitData {
    todayRevenue: number
    todayBillCount: number
    monthRevenue: number
    monthBillCount: number
    prevMonthRevenue: number
    outstanding: { count: number; amount: number }
    topItemToday: { name: string; quantity: number } | null
    salesByDay: { date: string; revenue: number; label: string }[]
    paymentBreakdown: { method: string; amount: number }[]
    topItems: { name: string; revenue: number; quantity: number }[]
}

export function OwnerCockpit({ currency }: { currency: string }) {
    const { activeBranchId, branches, loading: branchLoading } = useActiveBranch()
    const supabase = useMemo(() => createClient(), [])
    const [data, setData] = useState<CockpitData | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (branchLoading) return
        let cancelled = false
        ;(async () => {
            setLoading(true)
            try {
                const result = await loadCockpit(supabase, activeBranchId)
                if (!cancelled) setData(result)
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [supabase, activeBranchId, branchLoading])

    const money = (v: number) => formatCurrency(v, currency)
    const branchLabel = activeBranchId === null
        ? (branches.length >= 2 ? " · All branches" : "")
        : ` · ${branches.find((b) => b.id === activeBranchId)?.name ?? "branch"}`

    if (loading || !data) {
        return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                    <Card key={i}><CardContent className="p-5 h-[88px] flex items-center justify-center text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                    </CardContent></Card>
                ))}
            </div>
        )
    }

    const monthDelta = data.prevMonthRevenue > 0
        ? ((data.monthRevenue - data.prevMonthRevenue) / data.prevMonthRevenue) * 100
        : null

    const paymentTotal = data.paymentBreakdown.reduce((s, p) => s + p.amount, 0)
    // Hide the Outstanding tile when nothing is unpaid — the POS flow
    // is pay-then-bill so zero is the steady state. The tile only
    // surfaces when something has actually gone wrong (cashier
    // abandoned checkout, partial payment, etc.).
    const showOutstanding = data.outstanding.count > 0

    return (
        <section className="space-y-4">
            <div className="flex items-baseline justify-between">
                <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground">
                        At a glance{branchLabel}
                    </div>
                </div>
            </div>

            {/* ── KPI strip ──────────────────────────────────────── */}
            {/* Outstanding tile is hidden when there's nothing
              * unpaid — the POS flow takes payment at checkout, so a
              * zero count is the steady state and the empty tile was
              * pure noise. It comes back automatically if a bill
              * ever lands in GENERATED-without-payment (e.g. cashier
              * aborted mid-checkout) so we still get visibility when
              * something's actually wrong. Grid drops 4→3 columns
              * accordingly so the remaining cards don't leave a gap. */}
            <div className={cn(
                "grid grid-cols-2 gap-3",
                showOutstanding ? "md:grid-cols-4" : "md:grid-cols-3",
            )}>
                <KpiCard
                    icon={<Receipt className="h-4 w-4" />}
                    label="Today"
                    value={money(data.todayRevenue)}
                    sub={`${data.todayBillCount} bill${data.todayBillCount === 1 ? "" : "s"}`}
                    tint="primary"
                />
                <KpiCard
                    icon={<TrendingUp className="h-4 w-4" />}
                    label="This month"
                    value={money(data.monthRevenue)}
                    sub={`${data.monthBillCount} bill${data.monthBillCount === 1 ? "" : "s"}`}
                    delta={monthDelta}
                    tint="magenta"
                />
                {showOutstanding && (
                    <KpiCard
                        icon={<Wallet className="h-4 w-4" />}
                        label="Outstanding"
                        value={money(data.outstanding.amount)}
                        sub={`${data.outstanding.count} unpaid`}
                        tint="warning"
                    />
                )}
                <KpiCard
                    icon={<Sparkles className="h-4 w-4" />}
                    label="Top item today"
                    value={data.topItemToday?.name ?? "—"}
                    sub={data.topItemToday ? `${data.topItemToday.quantity} sold` : "No sales yet"}
                    tint="success"
                    valueClassName="text-base md:text-lg leading-tight truncate"
                />
            </div>

            {/* ── Sales trend + payment donut ────────────────────── */}
            <div className="grid lg:grid-cols-3 gap-4">
                <Card className="lg:col-span-2">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-primary" /> Sales — last 30 days
                        </CardTitle>
                        <CardDescription>One bar per calendar day. Hover for the exact number.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {data.salesByDay.every((d) => d.revenue === 0) ? (
                            <EmptyChart label="No sales yet — bills you generate will plot here automatically." />
                        ) : (
                            <ResponsiveContainer width="100%" height={260}>
                                <LineChart data={data.salesByDay} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                    <XAxis
                                        dataKey="label"
                                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                        tickLine={false}
                                        axisLine={false}
                                        interval="preserveStartEnd"
                                    />
                                    <YAxis
                                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(v) => compactCurrency(Number(v), currency)}
                                    />
                                    <Tooltip content={<ChartTooltip money={money} />} />
                                    <Line
                                        type="monotone"
                                        dataKey="revenue"
                                        stroke="hsl(var(--primary))"
                                        strokeWidth={2.5}
                                        dot={false}
                                        activeDot={{ r: 4 }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Banknote className="h-4 w-4 text-success" /> Payments — this month
                        </CardTitle>
                        <CardDescription>How customers paid you.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {data.paymentBreakdown.length === 0 ? (
                            <EmptyChart label="No payments recorded yet this month." />
                        ) : (
                            <div className="relative">
                                <ResponsiveContainer width="100%" height={220}>
                                    <PieChart>
                                        <Pie
                                            data={data.paymentBreakdown}
                                            dataKey="amount"
                                            nameKey="method"
                                            innerRadius={48}
                                            outerRadius={84}
                                            paddingAngle={2}
                                            stroke="hsl(var(--background))"
                                            strokeWidth={2}
                                        >
                                            {data.paymentBreakdown.map((_, i) => (
                                                <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip content={<ChartTooltip money={money} suffix={(v) => paymentTotal > 0 ? ` · ${Math.round((v / paymentTotal) * 100)}%` : ""} />} />
                                    </PieChart>
                                </ResponsiveContainer>
                                {/* Centered total label */}
                                <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center pb-4">
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
                                    <div className="text-base font-bold tabular-nums">{money(paymentTotal)}</div>
                                </div>
                                <ul className="mt-1 space-y-0.5 text-xs">
                                    {data.paymentBreakdown.slice(0, 4).map((p, i) => (
                                        <li key={p.method} className="flex items-center gap-2">
                                            <span
                                                className="h-2.5 w-2.5 rounded-sm shrink-0"
                                                style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }}
                                            />
                                            <span className="flex-1 truncate text-muted-foreground">{prettyMethod(p.method)}</span>
                                            <span className="font-mono tabular-nums">{money(p.amount)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* ── Top items ──────────────────────────────────────── */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-warning" /> Top selling items — this month
                    </CardTitle>
                    <CardDescription>Ranked by revenue. Quantity sold shown on each bar.</CardDescription>
                </CardHeader>
                <CardContent>
                    {data.topItems.length === 0 ? (
                        <EmptyChart label="No items billed yet this month." />
                    ) : (
                        <ResponsiveContainer width="100%" height={Math.max(160, data.topItems.length * 44)}>
                            <BarChart data={data.topItems} layout="vertical" margin={{ left: 12, right: 36, top: 4, bottom: 4 }}>
                                <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
                                <XAxis
                                    type="number"
                                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                    tickFormatter={(v) => compactCurrency(Number(v), currency)}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <YAxis
                                    type="category"
                                    dataKey="name"
                                    width={140}
                                    tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <Tooltip content={<ChartTooltip money={money} keyLabel="Revenue" extraKey="quantity" extraLabel="Sold" />} />
                                <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={20} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </CardContent>
            </Card>
        </section>
    )
}

// ── KPI card ────────────────────────────────────────────────────
function KpiCard({
    icon, label, value, sub, delta, tint = "neutral", valueClassName,
}: {
    icon: React.ReactNode
    label: string
    value: string
    sub: string
    delta?: number | null
    tint?: "primary" | "magenta" | "success" | "warning" | "neutral"
    valueClassName?: string
}) {
    const accent = {
        primary: "text-primary bg-primary/10",
        magenta: "text-[hsl(var(--neon-magenta))] bg-[hsl(var(--neon-magenta)/0.1)]",
        success: "text-success bg-success/10",
        warning: "text-warning bg-warning/10",
        neutral: "text-foreground bg-muted",
    }[tint]
    return (
        <Card>
            <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
                    <span className={cn("grid place-items-center h-7 w-7 rounded-lg", accent)}>{icon}</span>
                </div>
                <div className={cn("text-2xl md:text-3xl font-bold tabular-nums leading-tight", valueClassName)}>{value}</div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{sub}</span>
                    {delta !== undefined && delta !== null && Number.isFinite(delta) && (
                        <span
                            className={cn(
                                "ml-auto flex items-center gap-0.5 font-semibold text-[11px] tabular-nums",
                                delta >= 0 ? "text-success" : "text-destructive",
                            )}
                            title="vs previous month"
                        >
                            {delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {Math.abs(delta).toFixed(1)}%
                        </span>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}

// ── Shared chart tooltip (matches app card style) ───────────────
function ChartTooltip({
    active, payload, label, money, suffix, keyLabel, extraKey, extraLabel,
}: {
    active?: boolean
    payload?: Array<{ value: number; name: string; payload?: Record<string, unknown> }>
    label?: string
    money: (n: number) => string
    suffix?: (v: number) => string
    keyLabel?: string
    extraKey?: string
    extraLabel?: string
}) {
    if (!active || !payload || payload.length === 0) return null
    const first = payload[0]
    const extra = extraKey && first?.payload ? (first.payload[extraKey] as number | undefined) : undefined
    return (
        <div className="rounded-md border border-border/60 bg-card/95 backdrop-blur shadow-md px-2.5 py-1.5 text-xs">
            {label && <div className="font-medium text-foreground mb-0.5">{label}</div>}
            {payload.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                    <span className="text-muted-foreground">{keyLabel ?? p.name}:</span>
                    <span className="font-semibold tabular-nums">
                        {money(p.value)}
                        {suffix ? suffix(p.value) : ""}
                    </span>
                </div>
            ))}
            {extra !== undefined && extraLabel && (
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{extraLabel}:</span>
                    <span className="font-semibold tabular-nums">{extra}</span>
                </div>
            )}
        </div>
    )
}

function EmptyChart({ label }: { label: string }) {
    return (
        <div className="h-[200px] rounded-md border border-dashed border-border/60 grid place-items-center text-center text-xs text-muted-foreground px-4">
            {label}
        </div>
    )
}

// ── Helpers ─────────────────────────────────────────────────────

function compactCurrency(v: number, currency: string): string {
    // Short form for chart axes — "₹12.3k" / "$1.2M" — avoids cramped labels.
    const symbol = currency === "INR" ? "₹" : currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : ""
    const abs = Math.abs(v)
    if (abs >= 1_00_00_000) return `${symbol}${(v / 1_00_00_000).toFixed(1)}Cr` // Indian crore
    if (abs >= 1_00_000) return `${symbol}${(v / 1_00_000).toFixed(1)}L`        // Indian lakh
    if (abs >= 1000) return `${symbol}${(v / 1000).toFixed(1)}k`
    return `${symbol}${Math.round(v)}`
}

const METHOD_LABELS: Record<string, string> = {
    CASH: "Cash", UPI: "UPI", CARD: "Card", PAYTM: "Paytm",
    STRIPE: "Stripe", RAZORPAY: "Razorpay", PHONEPE: "PhonePe",
    BANK_TRANSFER: "Bank", GIFT_CARD: "Gift card", LOYALTY: "Loyalty",
    COMPLIMENTARY: "Comp", CREDIT: "Credit", OTHER: "Other",
}
function prettyMethod(m: string): string {
    return METHOD_LABELS[m] ?? m.toLowerCase()
}

// ── Data load ───────────────────────────────────────────────────

async function loadCockpit(
    supabase: ReturnType<typeof createClient>,
    activeBranchId: string | null,
): Promise<CockpitData> {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const last30Start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)

    // Branch filter helper. Typed as `any` to prevent "type instantiation
    // is excessively deep" — Supabase's chained query generics exceed
    // TypeScript's recursion limit once a generic wrapper is added on top.
    // Same pattern as scopeQueryToBranch / the my-collections query.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function scope(q: any): any {
        return activeBranchId === null ? q : q.eq("branch_id", activeBranchId)
    }

    const [billsRes, prevMonthRes, outstandingRes, paymentsRes] = await Promise.all([
        scope(
            supabase.from("bills")
                .select("id, order_id, grand_total, created_at, bill_status")
                .gte("created_at", last30Start.toISOString())
                .lt("created_at", tomorrowStart.toISOString())
                .neq("bill_status", "VOID"),
        ),
        scope(
            supabase.from("bills")
                .select("grand_total")
                .gte("created_at", prevMonthStart.toISOString())
                .lt("created_at", monthStart.toISOString())
                .neq("bill_status", "VOID"),
        ),
        scope(
            // Outstanding = bills issued but not fully paid yet. We embed
            // the payment rows so we can subtract collected amounts per
            // bill — without this, a ₹1000 bill with ₹600 already paid
            // would still count as ₹1000 outstanding (the KPI's worst
            // bug: it overstates AR every time someone splits a payment).
            supabase.from("bills")
                .select("id, grand_total, payments(amount)")
                .eq("bill_status", "GENERATED"),
        ),
        scope(
            supabase.from("payments")
                .select("method, amount, created_at")
                .gte("created_at", monthStart.toISOString()),
        ),
    ])

    const bills = ((billsRes.data ?? []) as BillRow[]).map((b) => ({
        ...b, grand_total: Number(b.grand_total),
    }))

    // Order_items for those bills — for the top-items chart.
    const orderIds = bills.map((b) => b.order_id)
    let items: ItemRow[] = []
    if (orderIds.length > 0) {
        const r = await supabase.from("order_items")
            .select("item_name, quantity, line_total, is_void, order_id")
            .in("order_id", orderIds)
            .eq("is_void", false)
        items = ((r.data ?? []) as ItemRow[]).map((i) => ({
            ...i, quantity: Number(i.quantity), line_total: Number(i.line_total),
        }))
    }

    // ── Aggregate ───────────────────────────────────────────────
    const todayStartIso = todayStart.toISOString()
    const monthStartIso = monthStart.toISOString()

    const todayBills = bills.filter((b) => b.created_at >= todayStartIso)
    const monthBills = bills.filter((b) => b.created_at >= monthStartIso)
    const todayOrderIds = new Set(todayBills.map((b) => b.order_id))
    const monthOrderIds = new Set(monthBills.map((b) => b.order_id))

    const todayItemQty = new Map<string, number>()
    for (const it of items) {
        if (!todayOrderIds.has(it.order_id)) continue
        todayItemQty.set(it.item_name, (todayItemQty.get(it.item_name) ?? 0) + it.quantity)
    }
    const topToday = Array.from(todayItemQty.entries()).sort((a, b) => b[1] - a[1])[0]

    const monthItemAgg = new Map<string, { revenue: number; quantity: number }>()
    for (const it of items) {
        if (!monthOrderIds.has(it.order_id)) continue
        const cur = monthItemAgg.get(it.item_name) ?? { revenue: 0, quantity: 0 }
        cur.revenue += it.line_total
        cur.quantity += it.quantity
        monthItemAgg.set(it.item_name, cur)
    }
    const topItems = Array.from(monthItemAgg.entries())
        .map(([name, s]) => ({ name, revenue: round2(s.revenue), quantity: s.quantity }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5)

    // Sales by day for the last 30 days — seed every day at 0 so gaps stay visible.
    const dayMap = new Map<string, number>()
    const dayLabels = new Map<string, string>()
    for (let i = 29; i >= 0; i--) {
        const d = new Date(todayStart)
        d.setDate(d.getDate() - i)
        const key = dayKey(d)
        dayMap.set(key, 0)
        // Compact label: "5 Apr" or just day-of-month on dense charts.
        dayLabels.set(key, d.toLocaleDateString("en", { day: "numeric", month: "short" }))
    }
    for (const b of bills) {
        const key = dayKey(new Date(b.created_at))
        if (dayMap.has(key)) dayMap.set(key, (dayMap.get(key) ?? 0) + b.grand_total)
    }
    const salesByDay = Array.from(dayMap.entries()).map(([date, revenue]) => ({
        date, revenue: round2(revenue), label: dayLabels.get(date) ?? date,
    }))

    // Payment breakdown.
    const payments = (paymentsRes.data ?? []) as PaymentRow[]
    const methodMap = new Map<string, number>()
    for (const p of payments) {
        methodMap.set(p.method, (methodMap.get(p.method) ?? 0) + Number(p.amount))
    }
    const paymentBreakdown = Array.from(methodMap.entries())
        .map(([method, amount]) => ({ method, amount: round2(amount) }))
        .sort((a, b) => b.amount - a.amount)

    // Sums + outstanding.
    const todayRevenue = todayBills.reduce((s, b) => s + b.grand_total, 0)
    const monthRevenue = monthBills.reduce((s, b) => s + b.grand_total, 0)
    const prevMonthRevenue = ((prevMonthRes.data ?? []) as Array<{ grand_total: number }>)
        .reduce((s, b) => s + Number(b.grand_total), 0)
    // PostgREST embeds the related payments[] under each bill. We
    // subtract their sum per bill so a partially-paid bill only
    // contributes its remaining balance to the outstanding total.
    const outstandingRows = (outstandingRes.data ?? []) as Array<{
        id: string
        grand_total: number
        payments: Array<{ amount: number }> | null
    }>
    let outstandingAmount = 0
    for (const b of outstandingRows) {
        const paid = (b.payments ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0)
        const remaining = Math.max(0, Number(b.grand_total) - paid)
        outstandingAmount += remaining
    }
    const outstanding = {
        count: outstandingRows.length,
        amount: outstandingAmount,
    }

    return {
        todayRevenue: round2(todayRevenue),
        todayBillCount: todayBills.length,
        monthRevenue: round2(monthRevenue),
        monthBillCount: monthBills.length,
        prevMonthRevenue: round2(prevMonthRevenue),
        outstanding: { count: outstanding.count, amount: round2(outstanding.amount) },
        topItemToday: topToday ? { name: topToday[0], quantity: topToday[1] } : null,
        salesByDay,
        paymentBreakdown,
        topItems,
    }
}

function dayKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function round2(n: number): number { return Math.round(n * 100) / 100 }
