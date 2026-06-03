"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ArrowRight, BarChart3, FileSpreadsheet, TrendingUp } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { scopeQueryToBranch, useActiveBranch } from "@/lib/branch/active-branch"
import { cn, formatCurrency } from "@/lib/utils"
import type { Bill, OrderItem, Payment } from "@/types/database"

interface ReportData {
    bills: Bill[]
    items: OrderItem[]
    payments: Payment[]
}

export default function ReportsPage() {
    const supabase = createClient()
    const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
    const [from, setFrom] = useState(() => {
        const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10)
    })
    const [to, setTo] = useState(today)
    const [data, setData] = useState<ReportData | null>(null)
    const [loading, setLoading] = useState(true)
    const { activeBranchId } = useActiveBranch()

    useEffect(() => {
        ;(async () => {
            setLoading(true)
            const fromIso = new Date(from).toISOString()
            const toIso = new Date(to + "T23:59:59").toISOString()
            let billsQ = supabase
                .from("bills")
                .select("*")
                .gte("created_at", fromIso)
                .lte("created_at", toIso)
                .order("created_at")
            billsQ = scopeQueryToBranch(billsQ, activeBranchId)
            const { data: bills } = await billsQ
            const orderIds = (bills ?? []).map((b) => b.order_id)
            const billIds = (bills ?? []).map((b) => b.id)
            // order_items + payments scope transitively through the
            // already-branch-filtered bills/orders id lists, so no extra
            // branch filter needed on these two queries.
            const [{ data: items }, { data: payments }] = await Promise.all([
                orderIds.length ? supabase.from("order_items").select("*").in("order_id", orderIds) : Promise.resolve({ data: [] }),
                billIds.length ? supabase.from("payments").select("*").in("bill_id", billIds) : Promise.resolve({ data: [] }),
            ])
            setData({ bills: (bills ?? []) as Bill[], items: (items ?? []) as OrderItem[], payments: (payments ?? []) as Payment[] })
            setLoading(false)
        })()
    }, [from, to, supabase, activeBranchId])

    const stats = useMemo(() => {
        if (!data) return null
        const valid = data.bills.filter((b) => b.bill_status !== "VOID")
        const revenue = valid.reduce((s, b) => s + Number(b.grand_total), 0)
        const totalTax = valid.reduce((s, b) => s + Number(b.cgst_amount) + Number(b.sgst_amount) + Number(b.igst_amount), 0)
        const avgBill = valid.length ? revenue / valid.length : 0

        // by item
        const itemMap = new Map<string, { name: string; qty: number; revenue: number }>()
        for (const it of data.items) {
            if (it.is_void) continue
            const cur = itemMap.get(it.item_name) ?? { name: it.item_name, qty: 0, revenue: 0 }
            cur.qty += Number(it.quantity)
            cur.revenue += Number(it.line_total)
            itemMap.set(it.item_name, cur)
        }
        const topItems = Array.from(itemMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 20)

        // by payment method
        const payMap = new Map<string, number>()
        for (const p of data.payments) payMap.set(p.method, (payMap.get(p.method) ?? 0) + Number(p.amount))
        const byPayment = Array.from(payMap.entries()).map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount)

        // hourly heatmap
        const hours = new Array(24).fill(0)
        for (const b of valid) {
            const h = new Date(b.created_at).getHours()
            hours[h] += Number(b.grand_total)
        }
        const peakHour = hours.indexOf(Math.max(...hours))

        // daily series
        const dayMap = new Map<string, number>()
        for (const b of valid) {
            const k = new Date(b.created_at).toISOString().slice(0, 10)
            dayMap.set(k, (dayMap.get(k) ?? 0) + Number(b.grand_total))
        }
        const days = Array.from(dayMap.entries()).sort(([a], [b]) => a.localeCompare(b))

        return { revenue, totalTax, avgBill, validCount: valid.length, voidCount: data.bills.length - valid.length, topItems, byPayment, hours, peakHour, days }
    }, [data])

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-6">
            <PageHeader
                kicker="Analytics"
                title="Reports"
                highlight="any date range"
                description="Sales analytics, heatmaps, and item performance."
                actions={
                    <Button asChild variant="outline">
                        <Link href="/ca-export"><FileSpreadsheet className="h-4 w-4" /> CA Export</Link>
                    </Button>
                }
            />

            <Card>
                <CardContent className="pt-6 flex flex-wrap items-end gap-3">
                    <div className="space-y-1.5">
                        <Label>From</Label>
                        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                        <Label>To</Label>
                        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                    </div>
                    <Button variant="outline" onClick={() => { const d = new Date(); setFrom(d.toISOString().slice(0,10)); setTo(d.toISOString().slice(0,10)) }}>Today</Button>
                    <Button variant="outline" onClick={() => { const d = new Date(); d.setDate(d.getDate()-7); setFrom(d.toISOString().slice(0,10)); setTo(today) }}>Last 7d</Button>
                    <Button variant="outline" onClick={() => { const d = new Date(); d.setDate(1); setFrom(d.toISOString().slice(0,10)); setTo(today) }}>This month</Button>
                </CardContent>
            </Card>

            {loading || !stats ? (
                <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">{Array.from({length: 4}).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
            ) : (
                <>
                    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                        <Kpi label="Revenue" value={formatCurrency(stats.revenue)} />
                        <Kpi label="Bills" value={String(stats.validCount)} sub={stats.voidCount > 0 ? `${stats.voidCount} voided` : ""} />
                        <Kpi label="Avg bill value" value={formatCurrency(stats.avgBill)} />
                        <Kpi label="Tax collected" value={formatCurrency(stats.totalTax)} />
                    </div>

                    <Tabs defaultValue="items">
                        <TabsList>
                            <TabsTrigger value="items">Top items</TabsTrigger>
                            <TabsTrigger value="payments">Payment methods</TabsTrigger>
                            <TabsTrigger value="hourly">Hourly heatmap</TabsTrigger>
                            <TabsTrigger value="daily">Daily trend</TabsTrigger>
                        </TabsList>
                        <TabsContent value="items">
                            <Card>
                                <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Top items by revenue</CardTitle></CardHeader>
                                <CardContent className="px-0">
                                    {stats.topItems.length === 0 ? (
                                        <p className="text-center py-8 text-sm text-muted-foreground">No items.</p>
                                    ) : (
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Item</TableHead>
                                                    <TableHead className="text-right">Qty sold</TableHead>
                                                    <TableHead className="text-right">Revenue</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {stats.topItems.map((it) => (
                                                    <TableRow key={it.name}>
                                                        <TableCell>{it.name}</TableCell>
                                                        <TableCell className="text-right">{it.qty}</TableCell>
                                                        <TableCell className="text-right font-medium">{formatCurrency(it.revenue)}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="payments">
                            <Card>
                                <CardHeader><CardTitle className="text-base">Payment method split</CardTitle></CardHeader>
                                <CardContent>
                                    {stats.byPayment.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">No payments.</p>
                                    ) : (
                                        <div className="space-y-3">
                                            {stats.byPayment.map((p) => {
                                                const pct = (p.amount / stats.revenue) * 100
                                                return (
                                                    <div key={p.method} className="space-y-1">
                                                        <div className="flex justify-between text-sm">
                                                            <span className="font-medium">{p.method}</span>
                                                            <span>{formatCurrency(p.amount)} ({pct.toFixed(1)}%)</span>
                                                        </div>
                                                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                                                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="hourly">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /> Hourly heatmap</CardTitle>
                                    <CardDescription>Peak: {String(stats.peakHour).padStart(2, "0")}:00 hrs · Avg revenue per hour</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-12 gap-1">
                                        {stats.hours.map((amt: number, h) => {
                                            const max = Math.max(...stats.hours, 1)
                                            const intensity = amt / max
                                            return (
                                                <div key={h} className="text-center">
                                                    <div
                                                        className={cn(
                                                            "rounded h-12 transition-all",
                                                            intensity > 0.7 ? "bg-primary" : intensity > 0.4 ? "bg-primary/60" : intensity > 0.1 ? "bg-primary/30" : "bg-muted",
                                                        )}
                                                        title={`${formatCurrency(amt)}`}
                                                    />
                                                    <div className="text-[10px] text-muted-foreground mt-1">{String(h).padStart(2, "0")}</div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="daily">
                            <Card>
                                <CardHeader><CardTitle className="text-base">Daily revenue trend</CardTitle></CardHeader>
                                <CardContent>
                                    {stats.days.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">No data.</p>
                                    ) : (
                                        <div className="space-y-1">
                                            {stats.days.map(([day, amt]) => {
                                                const max = Math.max(...stats.days.map(([, a]) => a), 1)
                                                const pct = (amt / max) * 100
                                                return (
                                                    <div key={day} className="flex items-center gap-3">
                                                        <span className="text-xs text-muted-foreground w-28 shrink-0">{new Date(day).toLocaleDateString("en-IN", { weekday: "short", month: "short", day: "numeric" })}</span>
                                                        <div className="flex-1 h-7 bg-muted rounded overflow-hidden relative">
                                                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                                                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium">{formatCurrency(amt)}</span>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </>
            )}

            <Card className="neon-border bg-primary/10">
                <CardContent className="pt-6 flex items-center justify-between gap-4 flex-wrap">
                    <div>
                        <Badge variant="neon" className="mb-2">For your CA</Badge>
                        <h3 className="font-semibold text-lg">Need GST filing data?</h3>
                        <p className="text-sm text-muted-foreground">Hit the CA Export for GSTR-1, GSTR-3B, P&amp;L and Balance Sheet — all in one ZIP.</p>
                    </div>
                    <Button asChild variant="neon"><Link href="/ca-export">Open CA Export <ArrowRight className="h-4 w-4" /></Link></Button>
                </CardContent>
            </Card>
        </div>
    )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-wider font-medium text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{value}</div>
                {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
            </CardContent>
        </Card>
    )
}
