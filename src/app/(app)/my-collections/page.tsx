"use client"

/**
 * End-of-shift collection report.
 *
 * The everyday use is: a cashier / captain finishes their shift, opens this
 * page, sees "you collected ₹X in cash + ₹Y online today", counts the cash
 * drawer, types the counted amount in, and confirms before clocking out.
 *
 * OWNER and MANAGER also get a "Team" tab that breaks the same numbers down
 * per staff member — covers the "did everyone balance?" check at close.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowDown, ArrowUp, Banknote, CheckCircle2, Clock, Coins, ExternalLink, Globe, RefreshCw, Sparkles, Wallet } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { useActiveBranch } from "@/lib/branch/active-branch"
import { getTaxConfig } from "@/lib/tax/locale-config"
import { METHOD_LABEL, cashVariance, GROUP_LABEL, groupOf, summarise, summariseByStaff, type PaymentRow } from "@/lib/reports/shift-summary"
import { cn, formatCurrency } from "@/lib/utils"
import type { UserRole } from "@/types/database"

/** Same `PaymentRow` but with the embedded bill (PostgREST returns
 *  the FK join as either an object or a single-element array — we
 *  accept both). Used to render the bill's invoice number as a link
 *  in the transaction history. */
type PaymentRowWithBill = PaymentRow & {
    bill?: { invoice_number: string | null } | { invoice_number: string | null }[] | null
}
function billNumberOf(p: PaymentRowWithBill): string | null {
    const b = p.bill
    if (!b) return null
    const single = Array.isArray(b) ? b[0] ?? null : b
    return single?.invoice_number ?? null
}

type ScopeTab = "mine" | "team"

function startOfDayISO(dateStr: string): string {
    return new Date(dateStr + "T00:00:00").toISOString()
}
function endOfDayISO(dateStr: string): string {
    return new Date(dateStr + "T23:59:59.999").toISOString()
}
function today(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export default function MyCollectionsPage() {
    const supabase = createClient()
    const [date, setDate] = useState<string>(today())
    const [me, setMe] = useState<{ id: string; name: string; role: UserRole; tenant_id: string; currency: string } | null>(null)
    const [rows, setRows] = useState<PaymentRowWithBill[]>([])
    const [staffNames, setStaffNames] = useState<Record<string, string>>({})
    const [loading, setLoading] = useState(true)
    const [scope, setScope] = useState<ScopeTab>("mine")
    const [counted, setCounted] = useState<string>("")
    const { activeBranchId } = useActiveBranch()

    const isAdmin = me?.role === "OWNER" || me?.role === "MANAGER"
    const money = useCallback((v: number) => formatCurrency(v, me?.currency ?? "INR"), [me?.currency])

    const refresh = useCallback(async () => {
        setLoading(true)
        try {
            const { data: u } = await supabase.auth.getUser()
            if (!u.user) return
            const { data: row } = await supabase.from("users")
                .select("id, full_name, role, tenant_id, tenant:tenants(currency)")
                .eq("id", u.user.id).maybeSingle()
            if (!row) return
            const r = row as { id: string; full_name: string | null; role: UserRole; tenant_id: string;
                              tenant: { currency: string | null } | { currency: string | null }[] | null }
            const tenant = Array.isArray(r.tenant) ? r.tenant[0] : r.tenant
            const cfg = getTaxConfig(null) // fallback default
            const currency = tenant?.currency ?? cfg.currency
            setMe({ id: r.id, name: r.full_name ?? "You", role: r.role, tenant_id: r.tenant_id, currency })

            // Fetch all payments in tenant for the day. RLS already scopes
            // by tenant — we filter here by date range AND by active
            // branch (migration 21 added payments.branch_id, back-filled
            // from each parent bill; migration 40 added a BEFORE INSERT
            // trigger that auto-stamps it going forward).
            //
            // Branch filter is INCLUSIVE of NULL: a payment with
            // branch_id = null is "ambient" — it pre-dates the back-fill
            // or some future code path forgot to stamp it. Excluding
            // those silently zeroes the report (the exact bug migration
            // 40 was written for). Including them means a single-branch
            // operator still sees their money even on an un-migrated DB.
            // For an "All branches" view (activeBranchId === null) we
            // skip the filter entirely.
            //
            // Typed as `any` to prevent "type instantiation is excessively
            // deep" — Supabase's chained generics exceed TS's recursion
            // limit once the OR/eq is applied on top.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let paysQ: any = supabase
                .from("payments")
                .select("id, method, amount, received_by, bill_id, branch_id, created_at, bill:bills(invoice_number)")
                .eq("tenant_id", r.tenant_id)
                .gte("created_at", startOfDayISO(date))
                .lte("created_at", endOfDayISO(date))
                .order("created_at", { ascending: false })
            if (activeBranchId !== null) {
                paysQ = paysQ.or(`branch_id.eq.${activeBranchId},branch_id.is.null`)
            }
            const { data: pays, error } = await paysQ
            if (error) {
                toast.error(error.message)
                setRows([])
            } else {
                setRows((pays ?? []) as PaymentRowWithBill[])
            }

            // For the team view, resolve staff names. Skip if non-admin
            // (they only see their own bucket anyway).
            if (r.role === "OWNER" || r.role === "MANAGER") {
                const { data: staff } = await supabase
                    .from("users")
                    .select("id, full_name, email")
                    .eq("tenant_id", r.tenant_id)
                const map: Record<string, string> = {}
                for (const s of (staff ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
                    map[s.id] = s.full_name || s.email || "Staff"
                }
                setStaffNames(map)
            }
        } finally {
            setLoading(false)
        }
    }, [supabase, date, activeBranchId])

    useEffect(() => { refresh() }, [refresh])

    // Slices used by the two tabs.
    const myRows = useMemo<PaymentRowWithBill[]>(
        () => (me ? rows.filter((p) => p.received_by === me.id) : []),
        [rows, me],
    )
    const mySummary = useMemo(() => summarise(myRows), [myRows])
    const teamSummary = useMemo(() => summarise(rows), [rows])
    const perStaff = useMemo(
        () => summariseByStaff(rows, staffNames),
        [rows, staffNames],
    )

    const cashExpected = mySummary.groups.find((g) => g.group === "cash")?.amount ?? 0
    const variance = counted.trim() === ""
        ? null
        : cashVariance(cashExpected, Number(counted) || 0)

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-6xl space-y-6">
            <PageHeader
                kicker="Close your shift"
                title="Collections"
                highlight="for today"
                description="Match your cash drawer against what the till says before you clock out."
                actions={
                    <>
                        <Input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="w-40"
                            max={today()}
                        />
                        <Button variant="outline" onClick={refresh} disabled={loading}>
                            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                            Refresh
                        </Button>
                    </>
                }
            />

            {isAdmin && (
                <Tabs value={scope} onValueChange={(v) => setScope(v as ScopeTab)}>
                    <TabsList>
                        <TabsTrigger value="mine">My shift</TabsTrigger>
                        <TabsTrigger value="team">Team summary</TabsTrigger>
                    </TabsList>
                </Tabs>
            )}

            {scope === "mine" || !isAdmin ? (
                <MineView
                    money={money}
                    summary={mySummary}
                    rows={myRows}
                    cashExpected={cashExpected}
                    counted={counted}
                    setCounted={setCounted}
                    variance={variance}
                    youName={me?.name ?? "You"}
                />
            ) : (
                <TeamView
                    money={money}
                    summary={teamSummary}
                    perStaff={perStaff}
                    rows={rows}
                    staffNames={staffNames}
                />
            )}
        </div>
    )
}

// ── My shift ────────────────────────────────────────────────────────────
function MineView({
    money, summary, rows, cashExpected, counted, setCounted, variance, youName,
}: {
    money: (v: number) => string
    summary: ReturnType<typeof summarise>
    rows: PaymentRowWithBill[]
    cashExpected: number
    counted: string
    setCounted: (v: string) => void
    variance: ReturnType<typeof cashVariance> | null
    youName: string
}) {
    const cash = summary.groups.find((g) => g.group === "cash")!
    const online = summary.groups.find((g) => g.group === "online")!
    const other = summary.groups.find((g) => g.group === "other")!

    return (
        <div className="space-y-6">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <KpiCard
                    icon={<Banknote className="h-5 w-5 text-success" />}
                    label="Cash in hand"
                    value={money(cash.amount)}
                    sub={`${cash.count} payment${cash.count === 1 ? "" : "s"}`}
                    accent="success"
                />
                <KpiCard
                    icon={<Globe className="h-5 w-5 text-primary" />}
                    label="Online settled"
                    value={money(online.amount)}
                    sub={`${online.count} payment${online.count === 1 ? "" : "s"}`}
                    accent="primary"
                />
                <KpiCard
                    icon={<Sparkles className="h-5 w-5 text-warning" />}
                    label="Other (loyalty / gift / comp)"
                    value={money(other.amount)}
                    sub={`${other.count} payment${other.count === 1 ? "" : "s"}`}
                    accent="warning"
                />
            </div>

            <Card className="neon-border">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Coins className="h-4 w-4" /> End-of-shift cash count
                    </CardTitle>
                    <CardDescription>
                        Count the notes & coins in your drawer, type the total below, and you&apos;ll see if it matches.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="grid sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                            <Label className="text-xs">Expected cash</Label>
                            <div className="font-mono text-2xl font-semibold">{money(cashExpected)}</div>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="counted" className="text-xs">Cash you counted</Label>
                            <Input
                                id="counted"
                                inputMode="decimal"
                                placeholder="0.00"
                                value={counted}
                                onChange={(e) => setCounted(e.target.value)}
                                className="text-lg font-mono"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Variance</Label>
                            <VarianceDisplay variance={variance} money={money} />
                        </div>
                    </div>
                    {variance && variance.status === "match" && (
                        <p className="text-sm text-success flex items-center gap-1.5 pt-1">
                            <CheckCircle2 className="h-4 w-4" /> {youName}, your drawer balances. Safe to clock out.
                        </p>
                    )}
                    {variance && variance.status !== "match" && (
                        <p className="text-sm text-warning pt-1">
                            {variance.status === "short"
                                ? `Short by ${money(Math.abs(variance.variance))} — recount, then flag this to your manager if it still doesn't balance.`
                                : `Over by ${money(variance.variance)} — extra cash in the drawer. Often a missed-receipt or a tip; recount and confirm.`}
                        </p>
                    )}
                </CardContent>
            </Card>

            <PaymentHistory
                rows={rows}
                money={money}
                title="Today's payments"
                description="Every payment you took today, newest first. Tap the invoice link to open the bill."
            />
        </div>
    )
}

// ── Team summary ────────────────────────────────────────────────────────
function TeamView({
    money, summary, perStaff, rows, staffNames,
}: {
    money: (v: number) => string
    summary: ReturnType<typeof summarise>
    perStaff: ReturnType<typeof summariseByStaff>
    rows: PaymentRowWithBill[]
    staffNames: Record<string, string>
}) {
    return (
        <div className="space-y-6">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <KpiCard
                    icon={<Banknote className="h-5 w-5 text-success" />}
                    label="Total cash (team)"
                    value={money(summary.groups.find((g) => g.group === "cash")!.amount)}
                    sub={`${summary.groups.find((g) => g.group === "cash")!.count} payments`}
                    accent="success"
                />
                <KpiCard
                    icon={<Globe className="h-5 w-5 text-primary" />}
                    label="Total online (team)"
                    value={money(summary.groups.find((g) => g.group === "online")!.amount)}
                    sub={`${summary.groups.find((g) => g.group === "online")!.count} payments`}
                    accent="primary"
                />
                <KpiCard
                    icon={<Wallet className="h-5 w-5" />}
                    label="Grand total"
                    value={money(summary.grandTotal)}
                    sub={`${summary.paymentCount} payments`}
                    accent="neutral"
                />
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">By staff member</CardTitle>
                    <CardDescription>Webhook / system-confirmed payments show under &quot;Auto&quot; — nobody handed cash to a person.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border/40 text-xs uppercase tracking-wider text-muted-foreground">
                                    <th className="text-left py-2 pr-3">Staff</th>
                                    <th className="text-right py-2 px-3">Cash</th>
                                    <th className="text-right py-2 px-3">Online</th>
                                    <th className="text-right py-2 px-3">Other</th>
                                    <th className="text-right py-2 pl-3">Real total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {perStaff.length === 0 && (
                                    <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">No collections recorded for this day yet.</td></tr>
                                )}
                                {perStaff.map((s) => (
                                    <tr key={s.staffId ?? "auto"} className="border-b border-border/30 hover:bg-card/40">
                                        <td className="py-2 pr-3 font-medium">{s.staffName}</td>
                                        <td className="text-right py-2 px-3 tabular-nums">{money(s.summary.groups.find((g) => g.group === "cash")!.amount)}</td>
                                        <td className="text-right py-2 px-3 tabular-nums">{money(s.summary.groups.find((g) => g.group === "online")!.amount)}</td>
                                        <td className="text-right py-2 px-3 tabular-nums text-muted-foreground">{money(s.summary.groups.find((g) => g.group === "other")!.amount)}</td>
                                        <td className="text-right py-2 pl-3 tabular-nums font-semibold">{money(s.summary.realTotal)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            <PaymentHistory
                rows={rows}
                money={money}
                title="Today's payments"
                description="Chronological log of every payment from every cashier today."
                staffNames={staffNames}
                showStaff
            />
        </div>
    )
}

// ── Shared bits ─────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub, accent }:
    { icon: React.ReactNode; label: string; value: string; sub: string;
      accent: "success" | "primary" | "warning" | "neutral" }
) {
    return (
        <Card>
            <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-2">
                    {icon}
                    <span>{label}</span>
                </div>
                <div className={cn("text-3xl font-bold tabular-nums",
                    accent === "success" && "text-success",
                    accent === "primary" && "text-primary",
                    accent === "warning" && "text-warning",
                )}>{value}</div>
                <div className="text-xs text-muted-foreground mt-1">{sub}</div>
            </CardContent>
        </Card>
    )
}

/** Map a payment group to a badge variant. Mirrors the KPI colours
 *  up top so the eye can scan the history and intuit the cash/online
 *  split without reading every row. */
function methodBadgeVariant(method: PaymentRow["method"]): "success" | "default" | "warning" | "outline" {
    const g = groupOf(method)
    if (g === "cash") return "success"
    if (g === "online") return "default"
    if (g === "other") return "warning"
    return "outline"
}

function formatTime(iso: string): string {
    try {
        const d = new Date(iso)
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    } catch {
        return ""
    }
}

/**
 * Chronological log of payments — replaces the old "By payment
 * method" rollup which duplicated the KPI cards above. Each row is
 * one payment with the time, method, amount, and a link to the bill
 * if there is one. On the team view we add a "by <staff>" column so
 * an admin can see exactly who collected what.
 */
function PaymentHistory({
    rows, money, title, description, staffNames, showStaff = false,
}: {
    rows: PaymentRowWithBill[]
    money: (v: number) => string
    title: string
    description?: string
    staffNames?: Record<string, string>
    showStaff?: boolean
}) {
    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between gap-3 flex-wrap text-base">
                    <span className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        {title}
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">
                        {rows.length} {rows.length === 1 ? "payment" : "payments"}
                    </span>
                </CardTitle>
                {description && <CardDescription>{description}</CardDescription>}
            </CardHeader>
            <CardContent>
                {rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No payments yet for this day.</p>
                ) : (
                    <div className="overflow-x-auto -mx-2">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                                    <th className="text-left py-2 px-2 font-medium">Time</th>
                                    <th className="text-left py-2 px-2 font-medium">Method</th>
                                    <th className="text-left py-2 px-2 font-medium">Bill</th>
                                    {showStaff && <th className="text-left py-2 px-2 font-medium">By</th>}
                                    <th className="text-right py-2 px-2 font-medium">Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((p) => {
                                    const amt = typeof p.amount === "string" ? Number(p.amount) : p.amount
                                    const inv = billNumberOf(p)
                                    const staff = p.received_by
                                        ? (staffNames?.[p.received_by] ?? "Staff")
                                        : "Auto"
                                    return (
                                        <tr key={p.id} className="border-t border-border/30 hover:bg-card/40">
                                            <td className="py-2 px-2 tabular-nums text-muted-foreground whitespace-nowrap">
                                                {formatTime(p.created_at)}
                                            </td>
                                            <td className="py-2 px-2">
                                                <Badge variant={methodBadgeVariant(p.method)} className="text-[10px] font-medium">
                                                    {METHOD_LABEL[p.method] ?? p.method}
                                                </Badge>
                                                <span className="ml-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                                                    {GROUP_LABEL[groupOf(p.method)]}
                                                </span>
                                            </td>
                                            <td className="py-2 px-2">
                                                {p.bill_id ? (
                                                    <Link
                                                        href={`/bills/${p.bill_id}`}
                                                        className="inline-flex items-center gap-1 text-primary hover:underline font-mono text-xs"
                                                    >
                                                        {inv ?? "Open"} <ExternalLink className="h-3 w-3" />
                                                    </Link>
                                                ) : (
                                                    <span className="text-muted-foreground text-xs">—</span>
                                                )}
                                            </td>
                                            {showStaff && (
                                                <td className={cn(
                                                    "py-2 px-2 text-xs",
                                                    p.received_by ? "text-foreground" : "text-muted-foreground italic",
                                                )}>
                                                    {staff}
                                                </td>
                                            )}
                                            <td className="py-2 px-2 text-right tabular-nums font-mono font-medium whitespace-nowrap">
                                                {Number.isFinite(amt) ? money(amt) : "—"}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

function VarianceDisplay({ variance, money }:
    { variance: ReturnType<typeof cashVariance> | null; money: (v: number) => string }
) {
    if (!variance) return <div className="font-mono text-2xl text-muted-foreground">—</div>
    if (variance.status === "match") {
        return <div className="font-mono text-2xl font-semibold text-success flex items-center gap-1.5">
            <CheckCircle2 className="h-5 w-5" /> Match
        </div>
    }
    const Arrow = variance.status === "short" ? ArrowDown : ArrowUp
    return (
        <div className={cn("font-mono text-2xl font-semibold flex items-center gap-1.5",
            variance.status === "short" ? "text-destructive" : "text-warning")}>
            <Arrow className="h-5 w-5" />
            {variance.status === "short" ? "−" : "+"}{money(Math.abs(variance.variance))}
        </div>
    )
}