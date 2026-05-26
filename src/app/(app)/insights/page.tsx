"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import { AlertTriangle, ArrowDown, ArrowUp, Brain, CheckCircle2, Eye, ShieldAlert, Sparkles, TrendingDown, TrendingUp } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import { useActiveBranch } from "@/lib/branch/active-branch"
import { cn, formatCurrency } from "@/lib/utils"

interface Bill {
    id: string
    bill_status: string
    grand_total: number
    item_discount: number
    order_discount: number
    created_at: string
}

interface OrderItem {
    item_name: string
    is_void: boolean
    quantity: number
    line_total: number
}

interface Insight {
    severity: "info" | "warning" | "alert"
    title: string
    detail: string
    icon: typeof AlertTriangle
    cta?: { label: string; href: string }
}

export default function InsightsPage() {
    const supabase = createClient()
    const [loading, setLoading] = useState(true)
    const [bills, setBills] = useState<Bill[]>([])
    const [items, setItems] = useState<OrderItem[]>([])
    const { activeBranchId } = useActiveBranch()

    useEffect(() => {
        ;(async () => {
            // 90-day window
            const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
            // Inline branch filter — wrapping in scopeQueryToBranch triggers
            // a TS "instantiation excessively deep" error against the
            // PostgREST builder's recursive type. Same semantics as the
            // helper: null → no filter, otherwise eq on branch_id.
            const billsQ = supabase
                .from("bills")
                .select("id, bill_status, grand_total, item_discount, order_discount, created_at, order_id")
                .gte("created_at", since)
                .order("created_at", { ascending: false })
            const { data: b } = await (activeBranchId === null ? billsQ : billsQ.eq("branch_id", activeBranchId))
            const orderIds = (b ?? []).map((x) => (x as { order_id: string }).order_id)
            // order_items inherit scope via the order_id list above.
            const { data: it } = orderIds.length
                ? await supabase.from("order_items").select("item_name, is_void, quantity, line_total").in("order_id", orderIds)
                : { data: [] }
            setBills((b ?? []) as Bill[])
            setItems((it ?? []) as OrderItem[])
            setLoading(false)
        })()
    }, [supabase, activeBranchId])

    const insights: Insight[] = useMemo(() => {
        const out: Insight[] = []
        const valid = bills.filter((b) => b.bill_status !== "VOID")
        const voids = bills.filter((b) => b.bill_status === "VOID")
        if (bills.length === 0) return out

        // 1. Today vs 30-day average revenue
        const today = new Date(); today.setHours(0, 0, 0, 0)
        const todayRev = valid.filter((b) => new Date(b.created_at) >= today).reduce((s, b) => s + Number(b.grand_total), 0)
        const last30Days = Array.from({ length: 30 }, (_, i) => {
            const d = new Date(today); d.setDate(d.getDate() - i - 1)
            const dEnd = new Date(d); dEnd.setDate(dEnd.getDate() + 1)
            return valid.filter((b) => {
                const t = new Date(b.created_at)
                return t >= d && t < dEnd
            }).reduce((s, b) => s + Number(b.grand_total), 0)
        })
        const avg30 = last30Days.reduce((s, x) => s + x, 0) / 30
        if (avg30 > 0 && todayRev < avg30 * 0.5) {
            out.push({
                severity: "warning",
                icon: TrendingDown,
                title: "Today's revenue is unusually low",
                detail: `${formatCurrency(todayRev)} so far vs 30-day avg ${formatCurrency(avg30)} — that's ${Math.round((1 - todayRev / avg30) * 100)}% below.`,
            })
        }
        if (todayRev > avg30 * 1.6) {
            out.push({
                severity: "info",
                icon: TrendingUp,
                title: "🔥 Strong day so far",
                detail: `${formatCurrency(todayRev)} vs 30-day avg ${formatCurrency(avg30)}.`,
            })
        }

        // 2. Discount anomaly
        const totalDiscount = valid.reduce((s, b) => s + Number(b.item_discount) + Number(b.order_discount), 0)
        const totalRevenue = valid.reduce((s, b) => s + Number(b.grand_total), 0)
        const discountPct = totalRevenue > 0 ? (totalDiscount / totalRevenue) * 100 : 0
        const todayDiscount = valid.filter((b) => new Date(b.created_at) >= today).reduce((s, b) => s + Number(b.item_discount) + Number(b.order_discount), 0)
        const todayDiscountPct = todayRev > 0 ? (todayDiscount / todayRev) * 100 : 0
        if (todayDiscountPct > discountPct * 2 && todayDiscountPct > 10) {
            out.push({
                severity: "alert",
                icon: ShieldAlert,
                title: "Discount usage spike today",
                detail: `${todayDiscountPct.toFixed(1)}% of revenue went to discounts today vs typical ${discountPct.toFixed(1)}%. Review staff discount permissions.`,
                cta: { label: "View bills", href: "/bills" },
            })
        }

        // 3. Voids spike
        const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        const recentVoids = voids.filter((b) => new Date(b.created_at) >= last7Days).length
        const totalRecent = bills.filter((b) => new Date(b.created_at) >= last7Days).length
        const voidRate = totalRecent > 0 ? (recentVoids / totalRecent) * 100 : 0
        if (voidRate > 5) {
            out.push({
                severity: "alert",
                icon: ShieldAlert,
                title: `Elevated void rate (${voidRate.toFixed(1)}% in last 7 days)`,
                detail: `${recentVoids} bills voided out of ${totalRecent} — investigate if this is fraud or a legitimate operational issue.`,
                cta: { label: "View bills", href: "/bills" },
            })
        }

        // 4. Top items
        const itemMap = new Map<string, { name: string; qty: number; revenue: number }>()
        for (const it of items) {
            if (it.is_void) continue
            const cur = itemMap.get(it.item_name) ?? { name: it.item_name, qty: 0, revenue: 0 }
            cur.qty += Number(it.quantity)
            cur.revenue += Number(it.line_total)
            itemMap.set(it.item_name, cur)
        }
        const topItem = Array.from(itemMap.values()).sort((a, b) => b.revenue - a.revenue)[0]
        if (topItem) {
            out.push({
                severity: "info",
                icon: TrendingUp,
                title: `Best seller: ${topItem.name}`,
                detail: `${topItem.qty} sold · ${formatCurrency(topItem.revenue)} in 90 days. Promote it on the QR menu.`,
            })
        }

        // 5. Day-of-week pattern
        const byDow = new Array(7).fill(0)
        for (const b of valid) {
            const dow = new Date(b.created_at).getDay()
            byDow[dow] += Number(b.grand_total)
        }
        const peakDow = byDow.indexOf(Math.max(...byDow))
        const dowNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        if (Math.max(...byDow) > 0) {
            out.push({
                severity: "info",
                icon: Brain,
                title: `Busiest day: ${dowNames[peakDow]}`,
                detail: `Make sure you're fully staffed on ${dowNames[peakDow]}s — that's when ${formatCurrency(byDow[peakDow] / 13)} avg revenue lands.`,
            })
        }

        // 6. Avg ticket trend
        const last30Bills = valid.filter((b) => new Date(b.created_at) >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
        const prev30Bills = valid.filter((b) => {
            const t = new Date(b.created_at)
            return t >= new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) && t < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        })
        const avgLast30 = last30Bills.length ? last30Bills.reduce((s, b) => s + Number(b.grand_total), 0) / last30Bills.length : 0
        const avgPrev30 = prev30Bills.length ? prev30Bills.reduce((s, b) => s + Number(b.grand_total), 0) / prev30Bills.length : 0
        if (avgPrev30 > 0) {
            const delta = ((avgLast30 - avgPrev30) / avgPrev30) * 100
            if (Math.abs(delta) > 8) {
                out.push({
                    severity: delta > 0 ? "info" : "warning",
                    icon: delta > 0 ? ArrowUp : ArrowDown,
                    title: `Avg ticket ${delta > 0 ? "up" : "down"} ${Math.abs(delta).toFixed(1)}% MoM`,
                    detail: `Now ${formatCurrency(avgLast30)} vs ${formatCurrency(avgPrev30)} the prior 30 days. ${delta > 0 ? "Upselling is working." : "Customers are spending less per visit — investigate menu pricing or portion sizes."}`,
                })
            }
        }

        return out
    }, [bills, items])

    const severityVariant = { info: "neon", warning: "warning", alert: "destructive" } as const

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-5xl space-y-6">
            {/* Hero */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="relative rounded-2xl glass-strong border border-border/50 neon-border overflow-hidden"
            >
                <div className="absolute -top-24 -right-24 h-56 w-56 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 -left-24 h-56 w-56 rounded-full bg-[hsl(var(--neon-magenta)/0.2)] blur-3xl pointer-events-none" />
                <div className="relative p-6 md:p-8 flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-4">
                        <div className="grid place-items-center h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/25 to-[hsl(var(--neon-magenta)/0.25)] shrink-0">
                            <Brain className="h-7 w-7 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                                Insights — <span className="text-gradient">90-day signals</span>
                            </h1>
                            <p className="mt-1 text-sm text-muted-foreground max-w-xl">
                                Anomaly detection driven by your own data. No paid APIs, no third-party LLMs.
                            </p>
                        </div>
                    </div>
                    <Badge variant="neon"><Sparkles className="h-3 w-3 mr-1" /> Auto-generated</Badge>
                </div>
            </motion.div>

            {loading ? (
                <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
            ) : insights.length === 0 ? (
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.5 }}
                    className="rounded-2xl glass-strong border border-border/50 neon-border p-12 text-center"
                >
                    <div className="mx-auto grid place-items-center h-16 w-16 rounded-full bg-gradient-to-br from-success/25 to-primary/25 mb-4">
                        <CheckCircle2 className="h-7 w-7 text-success" />
                    </div>
                    <h2 className="text-xl md:text-2xl font-bold tracking-tight">
                        Nothing <span className="text-gradient">unusual</span>
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">Your business is humming along.</p>
                </motion.div>
            ) : (
                <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={{ visible: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } } }}
                    className="space-y-3"
                >
                    {insights.map((ins, i) => (
                        <motion.div
                            key={i}
                            variants={{
                                hidden: { opacity: 0, x: -16 },
                                visible: { opacity: 1, x: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
                            }}
                            whileHover={{ x: 2 }}
                            className={cn(
                                "relative rounded-2xl glass border p-5 transition-all",
                                ins.severity === "alert" && "border-destructive/40 hover:border-destructive/60 hover:shadow-glow",
                                ins.severity === "warning" && "border-warning/40 hover:border-warning/60",
                                ins.severity === "info" && "border-border/50 hover:border-primary/40 hover:shadow-glow",
                            )}
                        >
                            <div className="flex items-start gap-4">
                                <div
                                    className="h-11 w-11 rounded-lg grid place-items-center shrink-0"
                                    style={
                                        ins.severity === "alert"
                                            ? { background: "linear-gradient(135deg, hsl(var(--destructive)/0.25), hsl(var(--destructive)/0.1))", color: "hsl(var(--destructive))" }
                                        : ins.severity === "warning"
                                            ? { background: "linear-gradient(135deg, hsl(var(--warning)/0.25), hsl(var(--warning)/0.1))", color: "hsl(var(--warning))" }
                                            : { background: "linear-gradient(135deg, hsl(var(--primary)/0.25), hsl(var(--neon-magenta)/0.15))", color: "hsl(var(--primary))" }
                                    }
                                >
                                    <ins.icon className="h-5 w-5" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="font-semibold leading-tight">{ins.title}</h3>
                                        <Badge variant={severityVariant[ins.severity]} className="text-[10px]">{ins.severity.toUpperCase()}</Badge>
                                    </div>
                                    <p className="text-sm text-muted-foreground mt-1.5">{ins.detail}</p>
                                    {ins.cta && (
                                        <Link href={ins.cta.href} className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-3 font-medium">
                                            <Eye className="h-3.5 w-3.5" /> {ins.cta.label}
                                        </Link>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </motion.div>
            )}
        </div>
    )
}
