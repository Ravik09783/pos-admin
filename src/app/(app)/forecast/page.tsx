"use client"

import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import { Brain, Calendar, ChefHat, Sparkles, TrendingUp } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { createClient } from "@/lib/supabase/client"
import { useActiveBranch } from "@/lib/branch/active-branch"
import { cn, formatCurrency } from "@/lib/utils"

interface Bill { id: string; grand_total: number; created_at: string; bill_status: string; order_id: string }
interface Item { item_name: string; quantity: number; line_total: number; is_void: boolean; order_id: string }

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

export default function ForecastPage() {
    const supabase = createClient()
    const [loading, setLoading] = useState(true)
    const [bills, setBills] = useState<Bill[]>([])
    const [items, setItems] = useState<Item[]>([])
    const { activeBranchId } = useActiveBranch()

    useEffect(() => {
        ;(async () => {
            const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
            // Inline branch filter — wrapping in scopeQueryToBranch triggers
            // a TS "instantiation excessively deep" error against the
            // PostgREST builder's recursive type. Same semantics as the
            // helper: null → no filter, otherwise eq on branch_id.
            const billsQ = supabase
                .from("bills")
                .select("id, grand_total, created_at, bill_status, order_id")
                .gte("created_at", since)
                .neq("bill_status", "VOID")
            const { data: b } = await (activeBranchId === null ? billsQ : billsQ.eq("branch_id", activeBranchId))
            const orderIds = (b ?? []).map((x) => (x as Bill).order_id)
            const { data: it } = orderIds.length
                ? await supabase.from("order_items").select("item_name, quantity, line_total, is_void, order_id").in("order_id", orderIds)
                : { data: [] }
            setBills((b ?? []) as Bill[])
            setItems((it ?? []) as Item[])
            setLoading(false)
        })()
    }, [supabase, activeBranchId])

    const forecast = useMemo(() => {
        if (bills.length === 0) return null

        // ----- Day-of-week × Hour heatmap of revenue & orders -----
        const dowHourRev: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
        const dowHourOrders: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
        const dowOccurrences: number[] = new Array(7).fill(0)

        // Track distinct dates per DOW so we can avg properly
        const datesByDow = Array.from({ length: 7 }, () => new Set<string>())
        for (const b of bills) {
            const t = new Date(b.created_at)
            const dow = t.getDay()
            const hour = t.getHours()
            dowHourRev[dow]![hour]! += Number(b.grand_total)
            dowHourOrders[dow]![hour]! += 1
            datesByDow[dow]!.add(t.toISOString().slice(0, 10))
        }
        for (let d = 0; d < 7; d++) dowOccurrences[d] = datesByDow[d]!.size || 1

        // Tomorrow's forecast
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
        const tdow = tomorrow.getDay()
        const tomorrowHourly = dowHourRev[tdow]!.map((v, h) => ({
            hour: h,
            revenue: v / dowOccurrences[tdow]!,
            orders: dowHourOrders[tdow]![h]! / dowOccurrences[tdow]!,
        }))
        const tomorrowTotal = tomorrowHourly.reduce((s, h) => s + h.revenue, 0)
        const tomorrowOrders = tomorrowHourly.reduce((s, h) => s + h.orders, 0)

        // Last 4 weeks of same DOW for trend
        const sameWeekday = bills.filter((b) => new Date(b.created_at).getDay() === tdow)
            .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
        const last4Weekly = [0, 1, 2, 3].map((wk) => {
            const start = new Date(); start.setDate(start.getDate() + 1 - 7 * (wk + 1))
            start.setHours(0, 0, 0, 0)
            const end = new Date(start); end.setDate(end.getDate() + 1)
            return sameWeekday.filter((b) => {
                const t = new Date(b.created_at)
                return t >= start && t < end
            }).reduce((s, b) => s + Number(b.grand_total), 0)
        })

        // ----- Item demand by DOW -----
        const itemByOrder = new Map<string, Item[]>()
        for (const it of items) {
            if (it.is_void) continue
            const list = itemByOrder.get(it.order_id) ?? []
            list.push(it)
            itemByOrder.set(it.order_id, list)
        }
        const itemDow = new Map<string, number[]>()
        for (const b of bills) {
            const t = new Date(b.created_at)
            const dow = t.getDay()
            const its = itemByOrder.get(b.order_id) ?? []
            for (const it of its) {
                const arr = itemDow.get(it.item_name) ?? new Array(7).fill(0)
                arr[dow] += Number(it.quantity)
                itemDow.set(it.item_name, arr)
            }
        }
        const tomorrowItemDemand = Array.from(itemDow.entries())
            .map(([name, byDow]) => ({
                name,
                avg: byDow[tdow]! / dowOccurrences[tdow]!,
                total: byDow.reduce((a, b) => a + b, 0),
            }))
            .filter((x) => x.avg >= 0.5)
            .sort((a, b) => b.avg - a.avg)
            .slice(0, 20)

        // ----- 7-day forecast -----
        const next7 = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(); d.setDate(d.getDate() + i + 1)
            const dow = d.getDay()
            const dayRev = dowHourRev[dow]!.reduce((a, b) => a + b, 0) / dowOccurrences[dow]!
            const dayOrders = dowHourOrders[dow]!.reduce((a, b) => a + b, 0) / dowOccurrences[dow]!
            return { date: d, dow, revenue: dayRev, orders: dayOrders }
        })

        return { tomorrowHourly, tomorrowTotal, tomorrowOrders, last4Weekly, tomorrowItemDemand, next7, dowOccurrences }
    }, [bills, items])

    if (loading) {
        return <div className="container mx-auto py-8 space-y-3 px-4"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>
    }
    if (!forecast) {
        return (
            <div className="container mx-auto py-8 max-w-3xl px-4">
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl glass-strong border border-border/50 neon-border p-12 text-center"
                >
                    <div className="mx-auto grid place-items-center h-16 w-16 rounded-full bg-gradient-to-br from-primary/25 to-[hsl(var(--neon-magenta)/0.25)] mb-4">
                        <Brain className="h-7 w-7 text-primary" />
                    </div>
                    <h2 className="text-xl md:text-2xl font-bold tracking-tight">
                        Not enough <span className="text-gradient">sales data yet</span>
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">Need at least a couple of weeks of sales to forecast. Keep selling and check back soon.</p>
                </motion.div>
            </div>
        )
    }

    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
    const peakHour = forecast.tomorrowHourly.reduce((max, cur) => cur.revenue > max.revenue ? cur : max, { hour: 0, revenue: 0, orders: 0 })

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-6">
            {/* Hero — tomorrow's forecast */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="relative rounded-2xl glass-strong border border-border/50 neon-border overflow-hidden"
            >
                <div className="absolute -top-32 -right-32 h-72 w-72 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
                <div className="absolute -bottom-32 -left-32 h-72 w-72 rounded-full bg-[hsl(var(--neon-magenta)/0.2)] blur-3xl pointer-events-none" />
                <div className="relative p-6 md:p-8">
                    <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
                        <div className="flex items-center gap-3">
                            <div className="grid place-items-center h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/25 to-[hsl(var(--neon-magenta)/0.25)] shrink-0">
                                <Brain className="h-6 w-6 text-primary" />
                            </div>
                            <div>
                                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                                    Demand <span className="text-gradient">Forecast</span>
                                </h1>
                                <p className="text-xs md:text-sm text-muted-foreground">
                                    {DOW_LONG[tomorrow.getDay()]}, {tomorrow.toLocaleDateString("en-IN", { day: "numeric", month: "long" })} — based on 90 days of patterns
                                </p>
                            </div>
                        </div>
                        <Badge variant="neon"><Sparkles className="h-3 w-3 mr-1" /> Same-day average</Badge>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-4">
                        <ForecastKpi label="Forecast revenue" value={formatCurrency(forecast.tomorrowTotal)} highlight />
                        <ForecastKpi label="Expected bills" value={String(Math.round(forecast.tomorrowOrders))} />
                        <ForecastKpi label="Peak hour" value={`${String(peakHour.hour).padStart(2, "0")}:00`} />
                    </div>
                </div>
            </motion.div>

            <Tabs defaultValue="hourly">
                <TabsList>
                    <TabsTrigger value="hourly">Hourly</TabsTrigger>
                    <TabsTrigger value="items">Item demand</TabsTrigger>
                    <TabsTrigger value="weekly">7-day</TabsTrigger>
                    <TabsTrigger value="trend">Trend (4 weeks)</TabsTrigger>
                </TabsList>

                <TabsContent value="hourly">
                    <Card>
                        <CardHeader><CardTitle className="text-base">Tomorrow's hourly forecast</CardTitle></CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-12 gap-1">
                                {forecast.tomorrowHourly.map((h) => {
                                    const max = Math.max(...forecast.tomorrowHourly.map((x) => x.revenue), 1)
                                    const intensity = h.revenue / max
                                    return (
                                        <div key={h.hour} className="text-center">
                                            <div
                                                className={cn(
                                                    "rounded h-16 transition-all flex items-end justify-center",
                                                    intensity > 0.7 ? "bg-primary" : intensity > 0.4 ? "bg-primary/60" : intensity > 0.1 ? "bg-primary/30" : "bg-muted",
                                                )}
                                                title={`${formatCurrency(h.revenue)} · ${h.orders.toFixed(1)} orders`}
                                            />
                                            <div className="text-[10px] text-muted-foreground mt-1">{String(h.hour).padStart(2, "0")}</div>
                                        </div>
                                    )
                                })}
                            </div>
                            <p className="text-xs text-muted-foreground mt-4">Hover for revenue & order count per hour.</p>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="items">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2"><ChefHat className="h-4 w-4 text-primary" /> Item demand prediction</CardTitle>
                            <CardDescription>Stock these for tomorrow based on what you typically sell on {DOW_LONG[tomorrow.getDay()]}s.</CardDescription>
                        </CardHeader>
                        <CardContent className="px-0">
                            {forecast.tomorrowItemDemand.length === 0 ? (
                                <p className="text-center py-8 text-sm text-muted-foreground">Not enough data yet.</p>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Item</TableHead>
                                            <TableHead className="text-right">Expected qty tomorrow</TableHead>
                                            <TableHead className="text-right">90-day total</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {forecast.tomorrowItemDemand.map((it) => (
                                            <TableRow key={it.name}>
                                                <TableCell className="font-medium">{it.name}</TableCell>
                                                <TableCell className="text-right">
                                                    <Badge variant="neon">~{Math.round(it.avg)}</Badge>
                                                </TableCell>
                                                <TableCell className="text-right text-sm text-muted-foreground">{Math.round(it.total)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="weekly">
                    <Card>
                        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Calendar className="h-4 w-4 text-primary" /> Next 7 days</CardTitle></CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                {forecast.next7.map((d, i) => {
                                    const max = Math.max(...forecast.next7.map((x) => x.revenue), 1)
                                    const pct = (d.revenue / max) * 100
                                    return (
                                        <div key={i} className="flex items-center gap-3">
                                            <span className="text-sm w-32 shrink-0">{DOW_LONG[d.dow]} {d.date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                                            <div className="flex-1 h-7 bg-muted rounded overflow-hidden relative">
                                                <div className="h-full bg-gradient-to-r from-primary/50 to-primary" style={{ width: `${pct}%` }} />
                                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium">{formatCurrency(d.revenue)} · {Math.round(d.orders)} bills</span>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="trend">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Same-day-of-week trend</CardTitle>
                            <CardDescription>Last 4 {DOW_LONG[tomorrow.getDay()]}s — see if business is improving.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                {forecast.last4Weekly.map((rev, i) => {
                                    const max = Math.max(...forecast.last4Weekly, 1)
                                    const pct = (rev / max) * 100
                                    const date = new Date(); date.setDate(date.getDate() + 1 - 7 * (i + 1))
                                    return (
                                        <div key={i} className="flex items-center gap-3">
                                            <span className="text-sm w-32 shrink-0 text-muted-foreground">{date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                                            <div className="flex-1 h-7 bg-muted rounded overflow-hidden relative">
                                                <div className="h-full bg-gradient-to-r from-success/50 to-success" style={{ width: `${pct}%` }} />
                                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium">{formatCurrency(rev)}</span>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}

function ForecastKpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div className="rounded-xl bg-card/60 border border-border/50 p-4 backdrop-blur">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
            <div className={cn(
                "mt-1 text-2xl md:text-3xl font-bold tabular-nums",
                highlight && "text-gradient",
            )}>{value}</div>
        </div>
    )
}
