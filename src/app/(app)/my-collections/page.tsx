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
import { ArrowDown, ArrowUp, Banknote, CheckCircle2, Coins, Globe, RefreshCw, Sparkles, Wallet } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { scopeQueryToBranch, useActiveBranch } from "@/lib/branch/active-branch"
import { getTaxConfig } from "@/lib/tax/locale-config"
import { cashVariance, GROUP_LABEL, groupOf, summarise, summariseByStaff, type PaymentRow } from "@/lib/reports/shift-summary"
import { cn, formatCurrency } from "@/lib/utils"
import type { UserRole } from "@/types/database"

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
    const [rows, setRows] = useState<PaymentRow[]>([])
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
            // from each parent bill).
            //
            // Typed as `any` to prevent "type instantiation is excessively
            // deep" — Supabase's chained generics exceed TS's recursion
            // limit once scopeQueryToBranch is applied on top.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let paysQ: any = supabase
                .from("payments")
                .select("id, method, amount, received_by, bill_id, created_at")
                .eq("tenant_id", r.tenant_id)
                .gte("created_at", startOfDayISO(date))
                .lte("created_at", endOfDayISO(date))
                .order("created_at", { ascending: false })
            paysQ = scopeQueryToBranch(paysQ, activeBranchId)
            const { data: pays, error } = await paysQ
            if (error) {
                toast.error(error.message)
                setRows([])
            } else {
                setRows((pays ?? []) as PaymentRow[])
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
    const myRows = useMemo(
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
                    cashExpected={cashExpected}
                    counted={counted}
                    setCounted={setCounted}
                    variance={variance}
                    youName={me?.name ?? "You"}
                />
            ) : (
                <TeamView money={money} summary={teamSummary} perStaff={perStaff} />
            )}
        </div>
    )
}

// ── My shift ────────────────────────────────────────────────────────────
function MineView({
    money, summary, cashExpected, counted, setCounted, variance, youName,
}: {
    money: (v: number) => string
    summary: ReturnType<typeof summarise>
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

            <BreakdownTable summary={summary} money={money} title="By payment method" />
        </div>
    )
}

// ── Team summary ────────────────────────────────────────────────────────
function TeamView({
    money, summary, perStaff,
}: {
    money: (v: number) => string
    summary: ReturnType<typeof summarise>
    perStaff: ReturnType<typeof summariseByStaff>
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

            <BreakdownTable summary={summary} money={money} title="Across the whole team — by payment method" />
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

function BreakdownTable({ summary, money, title }: {
    summary: ReturnType<typeof summarise>
    money: (v: number) => string
    title: string
}) {
    return (
        <Card>
            <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
            <CardContent>
                {summary.methods.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No payments yet for this day.</p>
                ) : (
                    <div className="space-y-1.5">
                        {summary.methods.map((m) => (
                            <div key={m.method} className="flex items-center justify-between gap-3 px-3 py-2 rounded-md hover:bg-card/40">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-medium">{m.label}</span>
                                    <Badge variant="outline" className="text-[10px]">{GROUP_LABEL[groupOf(m.method)]}</Badge>
                                    <span className="text-xs text-muted-foreground">× {m.count}</span>
                                </div>
                                <div className="font-mono tabular-nums">{money(m.amount)}</div>
                            </div>
                        ))}
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