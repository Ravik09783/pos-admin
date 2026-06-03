"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import {
    AlertCircle, AlertTriangle, ArrowRight, Banknote, BarChart3, Bike, BookOpen, Boxes, Building2,
    CalendarDays, ChefHat, CheckCircle2, Clock, CreditCard, FileSpreadsheet, Receipt, Smartphone,
    ShoppingCart, Sparkles, TrendingUp, Truck, Users, Wallet, Zap,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/app-shell/page-header"
import { PageTour } from "@/components/tours/page-tour"
import { TourReplayButton } from "@/components/tours/tour-replay-button"
import { BillingWarningBanner } from "./billing-warning-banner"
import { OwnerCockpit } from "./owner-cockpit"
import { createClient } from "@/lib/supabase/client"
import { useActiveBranch } from "@/lib/branch/active-branch"
import { uniqueChannelName } from "@/lib/supabase/realtime"
import { can, ROLE_LABELS } from "@/lib/rbac/permissions"
import { getTaxConfig } from "@/lib/tax/locale-config"
import { computeAge } from "@/lib/profile/age"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import type { UserRole } from "@/types/database"

type Range = "today" | "yesterday" | "week"

interface SetupState {
    hasMenu: boolean
    hasTables: boolean
    hasPayment: boolean
    menuCount: number
    tableCount: number
}

interface DashData {
    revenue: number
    billCount: number
    avgBill: number
    myBillsToday: number
    activeOrders: number
    ordersInProgress: number
    pendingQr: number
    unpaidBills: number
    lowStock: { id: string; name: string }[]
    todayReservations: { id: string; customer_name: string; party_size: number; reserved_for: string }[]
}

const EMPTY: DashData = {
    revenue: 0, billCount: 0, avgBill: 0, myBillsToday: 0, activeOrders: 0,
    ordersInProgress: 0, pendingQr: 0, unpaidBills: 0, lowStock: [], todayReservations: [],
}

function rangeBounds(r: Range): { from: string; to: string; label: string } {
    const now = new Date()
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0)
    if (r === "today") return { from: startOfToday.toISOString(), to: now.toISOString(), label: "today" }
    if (r === "yesterday") {
        const startY = new Date(startOfToday); startY.setDate(startY.getDate() - 1)
        return { from: startY.toISOString(), to: startOfToday.toISOString(), label: "yesterday" }
    }
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7)
    return { from: weekAgo.toISOString(), to: now.toISOString(), label: "last 7 days" }
}

const fade = {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
}

// Module-level in-flight tracker for the dashboard's parallel-query
// refresh. React Strict Mode in dev mounts the component twice, so the
// useEffect that triggers refresh() fires twice on first render. Without
// this guard each mount would burn 8 wasted Supabase round-trips before
// the second resolves. Keyed by (range, branch, role, user) so a real
// param change still re-fires.
const dashboardInFlight = new Map<string, Promise<void>>()

export interface DashboardProfile {
    full_name: string | null
    email: string | null
    dob: string | null
    phone: string | null
    avatar_url: string | null
    joined_at: string | null
}

export function DashboardClient({
    userId, role, firstName, tenantName, tenantCurrency, tenantCountry, setup, profile,
}: {
    userId: string
    role: UserRole
    firstName: string
    tenantName: string
    tenantCurrency: string
    tenantCountry: string | null
    setup: SetupState
    profile?: DashboardProfile
}) {
    // Swiggy/Zomato only operate in India — hide the aggregator teaser
    // for restaurants outside that market.
    const isIndia = getTaxConfig(tenantCountry).code === "IN"
    const supabase = useMemo(() => createClient(), [])
    const [range, setRange] = useState<Range>("today")
    const [data, setData] = useState<DashData>(EMPTY)
    const [loaded, setLoaded] = useState(false)

    const showRevenue = can(role, "reports.view")
    const showCashierView = can(role, "bill.generate") && !showRevenue   // CASHIER
    const showSetupCard = can(role, "menu.write") && !(setup.hasMenu && setup.hasTables && setup.hasPayment)
    const setupComplete = setup.hasMenu && setup.hasTables && setup.hasPayment
    /** Drives every KPI query. When admin picks "All branches" this is
     *  null and the queries stay tenant-wide (correct for cross-branch
     *  view). Cashiers are locked to their assigned branch already.
     *
     *  `branchLoading` matters because the store starts at
     *  `activeBranchId: null, loading: true` and only resolves to the
     *  real branch a tick later. Without gating, the dashboard's
     *  refresh fires once with null (8 wasted queries) and again with
     *  the real branch (the queries we actually want). */
    const { activeBranchId, loading: branchLoading } = useActiveBranch()

    const refresh = useCallback(async () => {
        // Strict Mode in dev mounts every component twice, so the
        // useEffect that calls refresh() fires twice on first render —
        // 16+ wasted Supabase queries per dashboard load. We coalesce
        // by key: if a refresh for the same (range, branch, role, uid)
        // is already in flight, await it instead of starting a fresh
        // round of queries. In production this guard is a no-op because
        // Strict Mode's double-invoke doesn't happen there.
        const flightKey = `${range}|${activeBranchId ?? ""}|${role}|${userId}`
        const existing = dashboardInFlight.get(flightKey)
        if (existing) { await existing; return }

        const run = (async () => {
        const b = rangeBounds(range)
        const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
        const todayIso = startOfToday.toISOString()
        const endOfToday = new Date(startOfToday); endOfToday.setDate(endOfToday.getDate() + 1)

        const uid = userId

        // Run everything we're allowed to in parallel; tolerate RLS denials.
        const safe = async <T,>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> => {
            try { const r = await p; return r.error ? null : r.data } catch { return null }
        }

        // PostgREST's generic builder type infers deeply enough that
        // wrapping every count-head query in a generic helper makes
        // TypeScript give up with "Type instantiation is excessively
        // deep". So we apply the conditional eq inline per query — it's
        // a one-liner and TS handles it fine. Null active = "all
        // branches", no filter.
        const rangeBillsQ = supabase.from("bills").select("grand_total, bill_status").gte("created_at", b.from).lt("created_at", b.to)
        const activeOrdersQ = supabase.from("orders").select("id", { count: "exact", head: true }).in("status", ["OPEN", "IN_PROGRESS", "ON_HOLD", "BILLED"])
        const inProgressQ = supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "IN_PROGRESS")
        // `billed_by` lives on `orders`, not `bills` — query through the
        // embed and filter the joined column. The old `bills.billed_by`
        // form 400-ed because the column doesn't exist on this table.
        const myBillsQ = uid
            ? supabase
                  .from("bills")
                  .select("id, order:orders!inner(billed_by)", { count: "exact", head: true })
                  .eq("orders.billed_by", uid)
                  .gte("created_at", todayIso)
                  .neq("bill_status", "VOID")
            : null
        const pendingQ = supabase.from("orders").select("id", { count: "exact", head: true }).eq("awaiting_confirmation", true)
        const unpaidQ = supabase.from("bills").select("id", { count: "exact", head: true }).eq("bill_status", "GENERATED")
        const lowStockQ = (role === "OWNER" || role === "MANAGER")
            ? supabase.from("stock_items").select("id, name, current_stock, reorder_level").eq("is_active", true).is("deleted_at", null)
            : null
        const resQ = can(role, "order.create")
            ? supabase.from("reservations").select("id, customer_name, party_size, reserved_for, status")
                .gte("reserved_for", todayIso).lt("reserved_for", endOfToday.toISOString())
                .in("status", ["PENDING", "CONFIRMED", "SEATED"]).order("reserved_for")
            : null
        const [
            rangeBillsRaw, activeRaw, inProgressRaw, myBillsRaw,
            pendingRaw, unpaidRaw, lowStockRaw, resRaw,
        ] = await Promise.all([
            safe(activeBranchId === null ? rangeBillsQ : rangeBillsQ.eq("branch_id", activeBranchId)),
            safe((activeBranchId === null ? activeOrdersQ : activeOrdersQ.eq("branch_id", activeBranchId)) as never) as Promise<{ count?: number } | null>,
            safe((activeBranchId === null ? inProgressQ : inProgressQ.eq("branch_id", activeBranchId)) as never) as Promise<{ count?: number } | null>,
            myBillsQ ? safe((activeBranchId === null ? myBillsQ : myBillsQ.eq("branch_id", activeBranchId)) as never) as Promise<{ count?: number } | null> : Promise.resolve(null),
            safe((activeBranchId === null ? pendingQ : pendingQ.eq("branch_id", activeBranchId)) as never) as Promise<{ count?: number } | null>,
            safe((activeBranchId === null ? unpaidQ : unpaidQ.eq("branch_id", activeBranchId)) as never) as Promise<{ count?: number } | null>,
            lowStockQ ? safe(activeBranchId === null ? lowStockQ : lowStockQ.eq("branch_id", activeBranchId)) : Promise.resolve(null),
            resQ ? safe(activeBranchId === null ? resQ : resQ.eq("branch_id", activeBranchId)) : Promise.resolve(null),
        ])

        const bills = (rangeBillsRaw ?? []) as { grand_total: number; bill_status: string }[]
        const valid = bills.filter((x) => x.bill_status !== "VOID")
        const revenue = valid.reduce((s, x) => s + Number(x.grand_total ?? 0), 0)
        const billCount = valid.length
        const lowStock = ((lowStockRaw ?? []) as { id: string; name: string; current_stock: number; reorder_level: number }[])
            .filter((x) => Number(x.current_stock) <= Number(x.reorder_level))
            .map((x) => ({ id: x.id, name: x.name }))
        const todayReservations = ((resRaw ?? []) as { id: string; customer_name: string; party_size: number; reserved_for: string }[])
            .slice(0, 5)

        setData({
            revenue,
            billCount,
            avgBill: billCount > 0 ? revenue / billCount : 0,
            myBillsToday: (myBillsRaw as { count?: number } | null)?.count ?? 0,
            activeOrders: (activeRaw as { count?: number } | null)?.count ?? 0,
            ordersInProgress: (inProgressRaw as { count?: number } | null)?.count ?? 0,
            pendingQr: (pendingRaw as { count?: number } | null)?.count ?? 0,
            unpaidBills: (unpaidRaw as { count?: number } | null)?.count ?? 0,
            lowStock,
            todayReservations,
        })
        setLoaded(true)
        })()
        dashboardInFlight.set(flightKey, run)
        try {
            await run
        } finally {
            dashboardInFlight.delete(flightKey)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range, supabase, role, activeBranchId, userId])

    useEffect(() => {
        // Wait for the branch store to resolve before firing any
        // queries. Otherwise we burn 8 round-trips on the initial
        // null-branch state, then 8 more once the real branch lands.
        if (branchLoading) return
        refresh()
    }, [refresh, branchLoading])

    // Live refresh: re-pull whenever orders or bills change anywhere in
    // the tenant. Bursty events (a KOT lands and bumps both orders and
    // bills in the same tick) get debounced into a single refresh so a
    // batch update doesn't trigger 5 round-trips.
    useEffect(() => {
        if (branchLoading) return
        let debounceTimer: ReturnType<typeof setTimeout> | null = null
        const scheduleRefresh = () => {
            if (debounceTimer) clearTimeout(debounceTimer)
            debounceTimer = setTimeout(() => { refresh() }, 250)
        }
        const channel = supabase
            .channel(uniqueChannelName("dashboard"))
            .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, scheduleRefresh)
            .on("postgres_changes", { event: "*", schema: "public", table: "bills" }, scheduleRefresh)
            .subscribe()
        return () => {
            if (debounceTimer) clearTimeout(debounceTimer)
            supabase.removeChannel(channel)
        }
    }, [supabase, refresh, branchLoading])

    const greeting = (() => {
        const h = new Date().getHours()
        const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"
        return firstName ? `${part}, ${firstName}` : part
    })()

    const roleDescription: Record<UserRole, string> = {
        OWNER: `${greeting} — a live snapshot of ${tenantName}.`,
        MANAGER: `${greeting} — your shift at ${tenantName}, at a glance.`,
        CASHIER: `${greeting} — ready to take orders at ${tenantName}.`,
        CAPTAIN: `${greeting} — your floor at ${tenantName}.`,
        KITCHEN: `${greeting} — tickets coming through.`,
        AUDITOR: `${greeting} — read-only overview of ${tenantName}.`,
        DELIVERY: `${greeting} — deliveries in flight.`,
    }

    // Build the role-appropriate "needs attention" rows.
    const attention: { icon: typeof AlertCircle; text: string; href: string; tone: "warn" | "info" }[] = []
    if (data.pendingQr > 0 && (can(role, "bill.generate") || can(role, "order.create") || role === "KITCHEN")) {
        attention.push({ icon: AlertCircle, tone: "warn", href: "/pending-orders",
            text: `${data.pendingQr} QR order${data.pendingQr > 1 ? "s" : ""} awaiting confirmation` })
    }
    if (data.unpaidBills > 0 && can(role, "bill.generate")) {
        attention.push({ icon: Receipt, tone: "warn", href: "/orders",
            text: `${data.unpaidBills} bill${data.unpaidBills > 1 ? "s" : ""} not yet fully paid` })
    }
    if (data.lowStock.length > 0) {
        attention.push({ icon: AlertTriangle, tone: "warn", href: "/inventory",
            text: `${data.lowStock.length} item${data.lowStock.length > 1 ? "s" : ""} below reorder level: ${data.lowStock.slice(0, 3).map((x) => x.name).join(", ")}${data.lowStock.length > 3 ? "…" : ""}` })
    }
    if (data.todayReservations.length > 0) {
        const next = data.todayReservations[0]!
        attention.push({ icon: CalendarDays, tone: "info", href: "/reservations",
            text: `${data.todayReservations.length} reservation${data.todayReservations.length > 1 ? "s" : ""} today — next: ${next.customer_name} (${next.party_size}) at ${formatDate(next.reserved_for, { timeStyle: "short" })}` })
    }
    if (role === "KITCHEN" && data.ordersInProgress > 0) {
        attention.push({ icon: ChefHat, tone: "info", href: "/kds",
            text: `${data.ordersInProgress} ticket${data.ordersInProgress > 1 ? "s" : ""} in the kitchen` })
    }
    const showAttention = role !== "AUDITOR" && role !== "DELIVERY"

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-6 md:space-y-8">
            <PageTour tourKey="dashboard" />
            <PageHeader
                kicker="Overview"
                title="Dashboard"
                description={roleDescription[role]}
                actions={<><RoleActions role={role} /><TourReplayButton tourKey="dashboard" /></>}
            />

            {/* Subscription nag — only the OWNER manages billing. Renders
              * nothing when the subscription is healthy. */}
            {role === "OWNER" && <BillingWarningBanner />}

            {/* Owner cockpit — KPI strip + sales line + payment donut +
              * top-selling items. The polished "you bought a real product"
              * top section, OWNER-only since it surfaces revenue / outstanding /
              * payment-method splits across the whole tenant. */}
            {role === "OWNER" && (
                <div data-tour="dashboard-charts">
                    <OwnerCockpit currency={tenantCurrency} />
                </div>
            )}

            <motion.div
                initial="hidden"
                animate="visible"
                variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
                className="space-y-6 md:space-y-8"
            >
                {/* Your profile — name, age, DOB, photo. Shown to everyone
                 *  (not just non-admins) so each user has a quick "this is
                 *  who's logged in" anchor on their dashboard. */}
                {profile && (
                    <motion.div variants={fade}>
                        <MyProfileCard role={role} profile={profile} />
                    </motion.div>
                )}

                {/* "Your today" — bills count, value, cash, online — for
                 *  every user. Staff use this to gauge their own day at a
                 *  glance; admins see their own numbers (orders they
                 *  personally billed / cash they personally collected). */}
                <motion.div variants={fade}>
                    <MyTodayCard userId={userId} currency={tenantCurrency} />
                </motion.div>


                {/* First-time setup walkthrough (owner/manager only) */}
                {showSetupCard && (
                    <motion.div variants={fade}>
                        <SetupCard setup={setup} />
                    </motion.div>
                )}

                {/* The "needs attention" action queue */}
                {showAttention && (
                    <motion.div variants={fade}>
                        <AttentionPanel rows={attention} loaded={loaded} />
                    </motion.div>
                )}

                {/* Primary CTA hero, shaped by role */}
                <motion.div variants={fade}>
                    <RoleHero role={role} tenantName={tenantName} setupComplete={setupComplete} />
                </motion.div>

                {/* KPIs — full set for owner/manager/auditor, lighter for cashier */}
                {(showRevenue || showCashierView) && (
                    <motion.div variants={fade} data-tour="dashboard-kpis">
                        <KpiSection
                            range={range}
                            onRange={setRange}
                            data={data}
                            showRevenue={showRevenue}
                            currency={tenantCurrency}
                        />
                    </motion.div>
                )}

                {/* Operational counts for kitchen/captain/delivery (no revenue) */}
                {!showRevenue && !showCashierView && (
                    <motion.div variants={fade} data-tour="dashboard-kpis">
                        <OpsCounts role={role} data={data} />
                    </motion.div>
                )}

                {/* CA Export hero — owner only */}
                {can(role, "ca_export.run") && (
                    <motion.div variants={fade}>
                        <CaExportHero />
                    </motion.div>
                )}

                {/* Aggregator integration — admin teaser, India-only.
                 *  Swiggy & Zomato don't operate outside India. */}
                {isIndia && (showRevenue || can(role, "menu.write")) && (
                    <motion.div variants={fade}>
                        <AggregatorTeaserCard />
                    </motion.div>
                )}

                {/* Role-specific shortcuts */}
                <motion.div variants={fade}>
                    <Shortcuts role={role} />
                </motion.div>
            </motion.div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Header actions per role
// ---------------------------------------------------------------------------
function RoleActions({ role }: { role: UserRole }) {
    if (can(role, "order.create")) {
        return (
            <>
                {can(role, "reports.view") && (
                    <Button asChild variant="outline" className="hidden md:inline-flex">
                        <Link href="/reports">Reports</Link>
                    </Button>
                )}
                <Button asChild variant="neon">
                    <Link href="/pos"><ShoppingCart className="h-4 w-4" /> Open POS</Link>
                </Button>
            </>
        )
    }
    if (role === "KITCHEN") {
        return <Button asChild variant="neon"><Link href="/kds"><ChefHat className="h-4 w-4" /> Open KDS</Link></Button>
    }
    if (role === "AUDITOR") {
        return <Button asChild variant="neon"><Link href="/reports"><BarChart3 className="h-4 w-4" /> Reports</Link></Button>
    }
    if (role === "DELIVERY") {
        return <Button asChild variant="neon"><Link href="/orders"><Truck className="h-4 w-4" /> Deliveries</Link></Button>
    }
    return null
}

// ---------------------------------------------------------------------------
// Needs-attention panel
// ---------------------------------------------------------------------------
function AttentionPanel({ rows, loaded }: { rows: { icon: typeof AlertCircle; text: string; href: string; tone: "warn" | "info" }[]; loaded: boolean }) {
    return (
        <div className="rounded-2xl glass border border-border/50 p-5">
            <div className="flex items-center gap-2 mb-3">
                <span className="grid place-items-center h-7 w-7 rounded-lg bg-warning/15">
                    <AlertCircle className="h-3.5 w-3.5 text-warning" />
                </span>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Needs attention</h3>
                {loaded && <Badge variant={rows.length > 0 ? "warning" : "secondary"} className="ml-auto">{rows.length}</Badge>}
            </div>
            {!loaded ? (
                <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-9 rounded-md bg-muted/40 animate-pulse" />)}</div>
            ) : rows.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    Nothing needs you right now. Smooth shift.
                </div>
            ) : (
                <ul className="space-y-1.5">
                    {rows.map((r, i) => (
                        <li key={i}>
                            <Link
                                href={r.href}
                                className={cn(
                                    "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors group",
                                    r.tone === "warn"
                                        ? "border-warning/30 bg-warning/5 hover:border-warning/50"
                                        : "border-border/50 hover:border-primary/40 hover:bg-card/40",
                                )}
                            >
                                <r.icon className={cn("h-4 w-4 shrink-0", r.tone === "warn" ? "text-warning" : "text-primary")} />
                                <span className="flex-1 min-w-0">{r.text}</span>
                                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform shrink-0" />
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Role hero — the big "what you do here" card
// ---------------------------------------------------------------------------
function RoleHero({ role, tenantName, setupComplete }: { role: UserRole; tenantName: string; setupComplete: boolean }) {
    let cfg: { badge: string; title: string; highlight: string; desc: string; href: string; cta: string; icon: typeof ShoppingCart }
    if (can(role, "bill.generate")) {
        cfg = { badge: "Take an order", icon: ShoppingCart, title: "Ring up a customer", highlight: "in seconds", href: "/pos", cta: "Open POS",
            desc: "Tap items, apply a coupon, take payment — GST-compliant bill in one click." }
    } else if (can(role, "order.create")) {
        cfg = { badge: "Your floor", icon: Building2, title: "Manage tables", highlight: "& take orders", href: "/tables", cta: "View tables",
            desc: "See live table status, seat guests, and start orders from the floor." }
    } else if (role === "KITCHEN") {
        cfg = { badge: "Kitchen", icon: ChefHat, title: "Run the pass", highlight: "in real time", href: "/kds", cta: "Open KDS",
            desc: "Tickets arrive instantly, colour-coded by urgency. Bump items as they're plated." }
    } else if (role === "AUDITOR") {
        cfg = { badge: "Read-only", icon: BarChart3, title: "Review the numbers", highlight: "& exports", href: "/reports", cta: "Open reports",
            desc: "Sales analytics, the audit log, and CA-ready exports — all view-only." }
    } else {
        cfg = { badge: "Deliveries", icon: Truck, title: "Track deliveries", highlight: "in flight", href: "/orders", cta: "View orders",
            desc: "See delivery orders and update their status as they go out." }
    }
    return (
        <div className="relative rounded-2xl glass-strong border border-border/50 neon-border overflow-hidden">
            <div className="absolute -top-32 -right-32 h-72 w-72 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-32 -left-32 h-72 w-72 rounded-full bg-[hsl(var(--neon-magenta)/0.2)] blur-3xl pointer-events-none" />
            <div className="relative p-6 md:p-8 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                    <Badge variant="neon" className="mb-3"><Sparkles className="h-3 w-3 mr-1" /> {cfg.badge}</Badge>
                    <h2 className="text-xl md:text-2xl font-bold tracking-tight">
                        {cfg.title} <span className="text-gradient">{cfg.highlight}</span>
                    </h2>
                    <p className="mt-2 text-xs md:text-sm text-muted-foreground max-w-xl">{cfg.desc}</p>
                    {!setupComplete && can(role, "menu.write") && (
                        <p className="mt-2 text-xs text-warning">Finish setup above first so the POS has items + tables.</p>
                    )}
                    <Button asChild variant="neon" className="mt-5">
                        <Link href={cfg.href}>{cfg.cta} <ArrowRight className="h-4 w-4" /></Link>
                    </Button>
                </div>
                <div className="hidden sm:grid place-items-center h-16 w-16 rounded-2xl bg-primary/15 shrink-0">
                    <cfg.icon className="h-7 w-7 text-primary" />
                </div>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// KPI section with time-range toggle
// ---------------------------------------------------------------------------
function KpiSection({
    range, onRange, data, showRevenue, currency,
}: {
    range: Range; onRange: (r: Range) => void; data: DashData; showRevenue: boolean; currency: string
}) {
    const b = rangeBounds(range)
    const kpis = showRevenue
        ? [
            { label: `Revenue (${b.label})`, value: formatCurrency(data.revenue, currency), icon: Wallet, accent: "primary" as const },
            { label: `Bills (${b.label})`, value: String(data.billCount), icon: Receipt, accent: "magenta" as const },
            { label: "Avg bill value", value: formatCurrency(data.avgBill, currency), icon: TrendingUp, accent: "primary" as const },
            { label: "Active orders", value: String(data.activeOrders), icon: ShoppingCart, accent: "magenta" as const },
        ]
        : [
            { label: "My bills today", value: String(data.myBillsToday), icon: Receipt, accent: "primary" as const },
            { label: "Bills today (all)", value: String(data.billCount), icon: ShoppingCart, accent: "magenta" as const },
            { label: "Active orders", value: String(data.activeOrders), icon: ShoppingCart, accent: "primary" as const },
            { label: "QR awaiting confirm", value: String(data.pendingQr), icon: AlertCircle, accent: "magenta" as const },
        ]
    return (
        <div className="space-y-3">
            {showRevenue && (
                <div className="flex items-center gap-1.5 text-xs">
                    {(["today", "yesterday", "week"] as Range[]).map((r) => (
                        <button
                            key={r}
                            onClick={() => onRange(r)}
                            className={cn(
                                "px-3 py-1.5 rounded-md font-medium transition-colors",
                                range === r ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {r === "today" ? "Today" : r === "yesterday" ? "Yesterday" : "Last 7 days"}
                        </button>
                    ))}
                </div>
            )}
            <div className="grid gap-3 md:gap-4 grid-cols-2 lg:grid-cols-4">
                {kpis.map((k) => (
                    <div key={k.label} className="group relative rounded-2xl glass border border-border/50 p-4 md:p-5 transition-all hover:border-primary/40 hover:shadow-glow">
                        <div className="flex items-center justify-between mb-2">
                            <div className="text-xs md:text-sm text-muted-foreground font-medium truncate pr-2">{k.label}</div>
                            <div
                                className="grid place-items-center h-8 w-8 rounded-lg shrink-0"
                                style={{
                                    background: k.accent === "primary"
                                        ? "linear-gradient(135deg, hsl(var(--primary)/0.2), hsl(var(--neon-magenta)/0.15))"
                                        : "linear-gradient(135deg, hsl(var(--neon-magenta)/0.2), hsl(var(--primary)/0.15))",
                                }}
                            >
                                <k.icon className="h-4 w-4 text-primary" />
                            </div>
                        </div>
                        <div className="text-xl md:text-2xl font-bold tracking-tight tabular-nums">{k.value}</div>
                    </div>
                ))}
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Operational counts (kitchen / captain / delivery — no revenue)
// ---------------------------------------------------------------------------
function OpsCounts({ role, data }: { role: UserRole; data: DashData }) {
    const cards = role === "KITCHEN"
        ? [
            { label: "Tickets in kitchen", value: String(data.ordersInProgress), icon: ChefHat },
            { label: "Active orders", value: String(data.activeOrders), icon: ShoppingCart },
            { label: "QR awaiting confirm", value: String(data.pendingQr), icon: AlertCircle },
        ]
        : role === "DELIVERY"
        ? [
            { label: "Active orders", value: String(data.activeOrders), icon: ShoppingCart },
            { label: "In progress", value: String(data.ordersInProgress), icon: Truck },
        ]
        : [ // CAPTAIN
            { label: "Active orders", value: String(data.activeOrders), icon: ShoppingCart },
            { label: "Reservations today", value: String(data.todayReservations.length), icon: CalendarDays },
            { label: "QR awaiting confirm", value: String(data.pendingQr), icon: AlertCircle },
        ]
    return (
        <div className="grid gap-3 md:gap-4 grid-cols-2 lg:grid-cols-3">
            {cards.map((k) => (
                <div key={k.label} className="rounded-2xl glass border border-border/50 p-4 md:p-5">
                    <div className="flex items-center justify-between mb-2">
                        <div className="text-xs md:text-sm text-muted-foreground font-medium">{k.label}</div>
                        <div className="grid place-items-center h-8 w-8 rounded-lg bg-primary/15">
                            <k.icon className="h-4 w-4 text-primary" />
                        </div>
                    </div>
                    <div className="text-xl md:text-2xl font-bold tracking-tight tabular-nums">{k.value}</div>
                </div>
            ))}
        </div>
    )
}

// ---------------------------------------------------------------------------
// CA Export hero (owner only)
// ---------------------------------------------------------------------------
function CaExportHero() {
    return (
        <div className="relative rounded-2xl glass-strong border border-border/50 neon-border overflow-hidden">
            <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/15 blur-3xl pointer-events-none" />
            <div className="relative p-6 md:p-8 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                    <Badge variant="neon" className="mb-3">⭐ Differentiator</Badge>
                    <h2 className="text-lg md:text-2xl font-bold tracking-tight">
                        Send everything to your CA <span className="text-gradient">in one click</span>
                    </h2>
                    <p className="mt-2 text-xs md:text-sm text-muted-foreground max-w-xl">
                        Pick a month, hit export. ZIP with sales register, GSTR-1, GSTR-3B, P&amp;L and Balance Sheet inputs — Excel + Tally + GST portal JSON.
                    </p>
                    <Button asChild variant="neon" className="mt-5"><Link href="/ca-export">Open CA Export <ArrowRight className="h-4 w-4" /></Link></Button>
                </div>
                <div className="hidden sm:grid place-items-center h-16 w-16 rounded-2xl bg-primary/15 shrink-0">
                    <FileSpreadsheet className="h-7 w-7 text-primary" />
                </div>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Role-specific shortcuts
// ---------------------------------------------------------------------------
const SHORTCUTS: Record<UserRole, { href: string; icon: typeof BookOpen; label: string }[]> = {
    OWNER:    [{ href: "/pos", icon: ShoppingCart, label: "POS" }, { href: "/kds", icon: ChefHat, label: "Kitchen" }, { href: "/menu-admin", icon: BookOpen, label: "Menu" }, { href: "/settings/staff", icon: Users, label: "Staff" }],
    MANAGER:  [{ href: "/pos", icon: ShoppingCart, label: "POS" }, { href: "/kds", icon: ChefHat, label: "Kitchen" }, { href: "/menu-admin", icon: BookOpen, label: "Menu" }, { href: "/reports", icon: BarChart3, label: "Reports" }],
    CASHIER:  [{ href: "/pos", icon: ShoppingCart, label: "POS" }, { href: "/pending-orders", icon: AlertCircle, label: "QR Orders" }, { href: "/bills", icon: Receipt, label: "Bills" }, { href: "/customers", icon: Users, label: "Customers" }],
    CAPTAIN:  [{ href: "/pos", icon: ShoppingCart, label: "POS" }, { href: "/tables", icon: Building2, label: "Tables" }, { href: "/reservations", icon: CalendarDays, label: "Reservations" }, { href: "/orders", icon: Receipt, label: "Orders" }],
    KITCHEN:  [{ href: "/kds", icon: ChefHat, label: "Kitchen (KDS)" }, { href: "/orders", icon: Receipt, label: "Orders" }],
    AUDITOR:  [{ href: "/reports", icon: BarChart3, label: "Reports" }, { href: "/bills", icon: Receipt, label: "Bills" }, { href: "/accounting", icon: Boxes, label: "Accounting" }],
    DELIVERY: [{ href: "/orders", icon: Receipt, label: "Orders" }],
}

function Shortcuts({ role }: { role: UserRole }) {
    const links = SHORTCUTS[role] ?? []
    if (links.length === 0) return null
    return (
        <div className="rounded-2xl glass border border-border/50 p-5">
            <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Shortcuts</h3>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
                {links.map((l) => (
                    <Link key={l.href} href={l.href} className="flex items-center gap-2 rounded-lg p-2.5 hover:bg-accent transition-colors group">
                        <l.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                        <span className="flex-1">{l.label}</span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                    </Link>
                ))}
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// First-time setup card
// ---------------------------------------------------------------------------
function SetupCard({ setup }: { setup: SetupState }) {
    return (
        <div className="relative rounded-2xl glass-strong border border-border/50 neon-border overflow-hidden">
            <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/15 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-[hsl(var(--neon-magenta)/0.15)] blur-3xl pointer-events-none" />
            <div className="relative p-6 md:p-8">
                <Badge variant="neon" className="mb-3 w-fit"><Sparkles className="h-3 w-3 mr-1" /> Welcome!</Badge>
                <h2 className="text-xl md:text-2xl font-bold tracking-tight">Let&apos;s get your restaurant <span className="text-gradient">set up</span></h2>
                <p className="text-muted-foreground text-sm mt-1">Three quick steps and you&apos;ll be taking orders.</p>
                <div className="grid sm:grid-cols-3 gap-3 mt-5">
                    <SetupStep done={setup.hasMenu} num={1} href="/menu-admin" icon={BookOpen} label="Add your menu"
                        sub={setup.hasMenu ? `${setup.menuCount} items` : "Categories + items + GST slabs"} />
                    <SetupStep done={setup.hasTables} num={2} href="/tables" icon={Building2} label="Add your tables"
                        sub={setup.hasTables ? `${setup.tableCount} tables` : "Floor plan for dine-in"} />
                    <SetupStep done={setup.hasPayment} num={3} href="/settings/payments" icon={Zap} label="Configure payments"
                        sub={setup.hasPayment ? "Configured" : "PhonePe or UPI"} />
                </div>
            </div>
        </div>
    )
}

function SetupStep({ done, num, href, icon: Icon, label, sub }: {
    done: boolean; num: number; href: string; icon: typeof BookOpen; label: string; sub: string
}) {
    return (
        <Link href={href} className={cn(
            "group relative rounded-xl border p-4 transition-all",
            done ? "border-success/40 bg-success/5" : "border-border/60 hover:border-primary/50 hover:bg-card/40 hover:shadow-glow",
        )}>
            <div className="flex items-start gap-3">
                <div className="grid place-items-center h-10 w-10 rounded-lg shrink-0"
                    style={done
                        ? { background: "hsl(var(--success)/0.15)", color: "hsl(var(--success))" }
                        : { background: "linear-gradient(135deg, hsl(var(--primary)/0.2), hsl(var(--neon-magenta)/0.15))", color: "hsl(var(--primary))" }}>
                    {done ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Step {num}</div>
                    <div className="font-semibold leading-tight">{label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
                </div>
                {!done && <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition-transform" />}
            </div>
        </Link>
    )
}

// ── Your-today snapshot: bills + value + cash + online ──────────────────
//
// One source of truth: the new staff-scoping RLS (migration 026) already
// limits non-admins to their own data — but we explicitly filter by the
// logged-in user_id too, so an admin viewing this card sees only their
// PERSONAL numbers (orders they billed, cash they recorded) rather than
// the whole tenant. That's the right product call: this is "your shift",
// not "your restaurant".
function MyTodayCard({ userId, currency }: { userId: string; currency: string }) {
    const supabase = useMemo(() => createClient(), [])
    const [loading, setLoading] = useState(true)
    const [stats, setStats] = useState<{ bills: number; value: number; cash: number; card: number; upi: number }>(
        { bills: 0, value: 0, cash: 0, card: 0, upi: 0 },
    )

    const money = useCallback((v: number) => formatCurrency(v, currency), [currency])

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            if (!userId) { setLoading(false); return }

            const start = new Date(); start.setHours(0, 0, 0, 0)
            const startIso = start.toISOString()
            const end = new Date(start); end.setDate(end.getDate() + 1)
            const endIso = end.toISOString()

            // Bills + payments are independent — run them in parallel
            // instead of serially (saves one round-trip's worth of latency
            // on every dashboard mount).
            const [{ data: bills }, { data: pays }] = await Promise.all([
                supabase
                    .from("bills")
                    // `!inner` forces the join so the filter on the embedded
                    // `orders.billed_by` actually narrows the set.
                    .select("grand_total, order:orders!inner(billed_by)")
                    .eq("orders.billed_by", userId)
                    .gte("created_at", startIso)
                    .lt("created_at", endIso),
                supabase
                    .from("payments")
                    .select("method, amount")
                    .eq("received_by", userId)
                    .gte("created_at", startIso)
                    .lt("created_at", endIso),
            ])

            if (cancelled) return

            const billRows = (bills ?? []) as { grand_total: number | string }[]
            const billCount = billRows.length
            const billValue = billRows.reduce((s, b) => s + Number(b.grand_total ?? 0), 0)

            const payRows = (pays ?? []) as { method: string; amount: number | string }[]
            // Split what the cashier collected by how they account for it
            // at close: CASH (physical drawer), CARD (receipts to submit),
            // and UPI (manual UPI they verified). Auto-confirmed UPI from
            // the PhonePe webhook never lands here — those payment rows have
            // received_by = null, so the cashier is never asked to account
            // for money the bank settled hands-free.
            const UPI_LIKE = new Set(["UPI", "RAZORPAY", "PHONEPE", "PAYTM", "STRIPE", "BANK_TRANSFER"])
            let cash = 0, card = 0, upi = 0
            for (const p of payRows) {
                const a = Number(p.amount ?? 0)
                if (!Number.isFinite(a)) continue
                if (p.method === "CASH") cash += a
                else if (p.method === "CARD") card += a
                else if (UPI_LIKE.has(p.method)) upi += a
            }

            setStats({
                bills: billCount, value: round2(billValue),
                cash: round2(cash), card: round2(card), upi: round2(upi),
            })
            setLoading(false)
        })().catch(() => { if (!cancelled) setLoading(false) })

        return () => { cancelled = true }
    }, [supabase, userId])

    return (
        <Card className="neon-border">
            <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Your today</h3>
                    {loading && <span className="text-[10px] text-muted-foreground">loading…</span>}
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* The "Bills" tile now shows BOTH the total value the
                      * staffer billed today AND the bill count. `stats.value`
                      * was being computed but never rendered — that was the
                      * blank value people noticed. Big number = revenue; the
                      * sub-line carries the count. */}
                    <TodayTile
                        icon={<Receipt className="h-4 w-4" />}
                        label="You billed today"
                        value={money(stats.value)}
                        sub={`${stats.bills} bill${stats.bills === 1 ? "" : "s"}`}
                        accent="primary"
                    />
                    <TodayTile icon={<Banknote className="h-4 w-4" />} label="Cash to submit" value={money(stats.cash)} accent="success" />
                    <TodayTile icon={<CreditCard className="h-4 w-4" />} label="Card receipts" value={money(stats.card)} accent="primary" />
                    <TodayTile icon={<Smartphone className="h-4 w-4" />} label="UPI (manual)" value={money(stats.upi)} accent="primary" />
                </div>
                <p className="text-[11px] text-muted-foreground mt-3">
                    What you billed and collected since midnight — the big number is everything you rang up,
                    the three tiles after it are what you&apos;ll hand over at shift close (cash, card receipts,
                    manually-verified UPI). Auto-confirmed UPI lands in the bank directly so it isn&apos;t counted here.
                    Full breakdown on the <Link href="/my-collections" className="text-primary hover:underline">My collections</Link> page.
                </p>
            </CardContent>
        </Card>
    )
}

function TodayTile({ icon, label, value, sub, accent }:
    { icon: React.ReactNode; label: string; value: string; sub?: string; accent: "primary" | "success" | "neutral" }
) {
    return (
        <div className="rounded-lg border border-border/40 bg-card/40 p-3">
            <div className={cn("flex items-center gap-1.5 text-[11px] uppercase tracking-wider mb-1",
                accent === "success" && "text-success",
                accent === "primary" && "text-primary",
                accent === "neutral" && "text-muted-foreground",
            )}>
                {icon}
                <span>{label}</span>
            </div>
            <div className="text-2xl font-bold tabular-nums">{value}</div>
            {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
        </div>
    )
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

// ── Personal "this is you" card on every dashboard ──────────────────────
function MyProfileCard({ role, profile }: { role: UserRole; profile: DashboardProfile }) {
    const name = profile.full_name?.trim() || profile.email || "You"
    const initial = name.slice(0, 1).toUpperCase()
    const age = computeAge(profile.dob)
    const dobLabel = profile.dob ? formatDate(profile.dob, { dateStyle: "long" }) : null
    const joined = profile.joined_at ? formatDate(profile.joined_at, { dateStyle: "medium" }) : null
    return (
        <Card className="neon-border overflow-hidden">
            <CardContent className="p-5 flex flex-wrap items-center gap-5">
                {profile.avatar_url
                    /* eslint-disable-next-line @next/next/no-img-element */
                    ? <img src={profile.avatar_url} alt="" className="h-20 w-20 rounded-full object-cover border-2 border-primary/40 shadow-glow" />
                    : (
                        <div className="h-20 w-20 rounded-full grid place-items-center text-3xl font-bold bg-primary/15 text-primary border-2 border-primary/30">
                            {initial}
                        </div>
                    )}
                <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-bold leading-tight truncate">{name}</h2>
                        <Badge variant="outline">{ROLE_LABELS[role]}</Badge>
                    </div>
                    {profile.email && <div className="text-sm text-muted-foreground truncate">{profile.email}</div>}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
                        {age != null && <span><span className="font-medium text-foreground">{age}</span> yrs old</span>}
                        {dobLabel && <span>Born {dobLabel}</span>}
                        {profile.phone && <span>{profile.phone}</span>}
                        {joined && <span>Joined {joined}</span>}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

// ── Aggregator-integration teaser ───────────────────────────────────────
//
// Swiggy and Zomato don't have public APIs — both run closed partner
// programs with multi-month onboarding + commercial agreements. Until that
// partnership is in place, restaurants can tag manual entries on the POS
// (via the new orders.order_source column) so reports separate aggregator
// revenue from direct revenue.
//
// This card signals the upcoming feature without overpromising. When the
// partnership lands, this card flips to a "Connect" CTA.
function AggregatorTeaserCard() {
    return (
        <Card className="relative overflow-hidden neon-border">
            {/* Soft "coming soon" gradient wash */}
            <div
                aria-hidden
                className="absolute inset-0 opacity-30 pointer-events-none"
                style={{
                    background:
                        "radial-gradient(ellipse at top right, hsl(var(--neon-magenta)/0.25), transparent 60%), " +
                        "radial-gradient(ellipse at bottom left, hsl(var(--neon-cyan)/0.18), transparent 60%)",
                }}
            />
            <CardContent className="relative p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2">
                        <div className="grid place-items-center h-9 w-9 rounded-lg bg-warning/15 border border-orange-500/30">
                            <Bike className="h-5 w-5 text-orange-400" />
                        </div>
                        <div>
                            <h3 className="text-base font-bold">Swiggy &amp; Zomato integration</h3>
                            <p className="text-xs text-muted-foreground">On the roadmap — partnership-gated</p>
                        </div>
                    </div>
                    <Badge variant="warning" className="text-[10px] flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Coming soon
                    </Badge>
                </div>

                <p className="text-sm text-muted-foreground mb-3">
                    Direct partner-API integrations with India&apos;s two biggest aggregators. Both run
                    closed onboarding programs (3–9 months from application to live); we&apos;re working
                    on it. Once approved, this card becomes your &quot;Connect Swiggy / Zomato&quot; surface.
                </p>

                <div className="grid sm:grid-cols-2 gap-2 text-xs">
                    {[
                        "Auto-receive orders into your KDS",
                        "Sync menu + prices both ways",
                        "Auto-reconcile daily settlements",
                        "One report for Swiggy + Zomato + direct",
                    ].map((line) => (
                        <div key={line} className="flex items-center gap-2 rounded-md bg-card/40 px-2 py-1.5 border border-border/40">
                            <span className="h-1.5 w-1.5 rounded-full bg-orange-400 shrink-0" />
                            <span className="text-muted-foreground">{line}</span>
                        </div>
                    ))}
                </div>

                <div className="mt-3 pt-3 border-t border-border/40 text-[11px] text-muted-foreground flex items-center gap-2">
                    <Sparkles className="h-3 w-3" />
                    <span>
                        Already taking Swiggy / Zomato orders manually? Use the new <span className="text-foreground font-medium">Source</span> selector on the POS to tag them — your reports will then split revenue by channel.
                    </span>
                </div>
            </CardContent>
        </Card>
    )
}
