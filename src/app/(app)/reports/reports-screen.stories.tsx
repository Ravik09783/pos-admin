import type { Meta, StoryObj } from "@storybook/react-vite"
import { ArrowDown, ArrowUp, Banknote, BarChart3, TrendingUp } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

/**
 * Screen-level twin of the reports page (`src/app/(app)/reports/page.tsx`).
 * The real page aggregates bills + payments + items across a date range
 * and renders charts (hourly heatmap, top items, payment split,
 * day-of-week trends). This story replaces every aggregation with
 * static fixtures so designers can iterate the chart layouts without
 * spinning up Supabase.
 */
interface ReportsViewProps {
    tab: "overview" | "items" | "hours"
    period: "Today" | "This week" | "Last 7 days" | "This month"
}

function ReportsView({ tab, period }: ReportsViewProps) {
    return (
        <div className="min-h-[800px] w-full bg-background text-foreground rounded-md border border-border/40 p-5 space-y-5">
            {/* Header */}
            <div className="flex items-center gap-3 flex-wrap">
                <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Insights</div>
                    <h1 className="text-xl font-bold">Reports</h1>
                </div>
                <div className="ml-auto inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/40 p-1">
                    {(["Today", "This week", "Last 7 days", "This month"] as const).map((p) => (
                        <button key={p} className={cn(
                            "px-3 py-1 rounded-full text-xs font-medium",
                            p === period ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                        )}>{p}</button>
                    ))}
                </div>
            </div>

            <Tabs value={tab}>
                <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="items">Top items</TabsTrigger>
                    <TabsTrigger value="hours">Hourly heatmap</TabsTrigger>
                </TabsList>
            </Tabs>

            {tab === "overview" && <OverviewTab />}
            {tab === "items" && <TopItemsTab />}
            {tab === "hours" && <HeatmapTab />}
        </div>
    )
}

function OverviewTab() {
    return (
        <>
            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi label="Revenue" value="₹2,84,500" delta="+18%" up />
                <Kpi label="Bills" value="412" delta="+12%" up />
                <Kpi label="Avg bill" value="₹690" delta="-3%" />
                <Kpi label="Refunds" value="₹4,200" delta="+1.5%" />
            </div>

            <div className="grid lg:grid-cols-[1fr_1fr] gap-3">
                {/* Payment split donut placeholder */}
                <Card>
                    <CardContent className="p-5 space-y-3">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <Banknote className="h-4 w-4 text-primary" /> Payment split
                        </div>
                        <div className="grid grid-cols-[180px_1fr] gap-4 items-center">
                            <DonutPlaceholder />
                            <div className="space-y-2 text-xs">
                                <Legend dot="bg-primary" label="UPI" value="₹1,72,300" pct="60%" />
                                <Legend dot="bg-success" label="Card" value="₹68,400" pct="24%" />
                                <Legend dot="bg-warning" label="Cash" value="₹38,200" pct="13%" />
                                <Legend dot="bg-muted-foreground" label="Razorpay link" value="₹5,600" pct="3%" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Day-of-week bars */}
                <Card>
                    <CardContent className="p-5 space-y-3">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <BarChart3 className="h-4 w-4 text-primary" /> Revenue by day
                        </div>
                        <div className="grid grid-cols-7 gap-2 items-end h-40">
                            {[42, 38, 50, 62, 78, 92, 70].map((h, i) => (
                                <div key={i} className="flex flex-col items-center gap-1">
                                    <div className="bg-primary/70 rounded-t w-full" style={{ height: `${h}%` }} />
                                    <span className="text-[10px] text-muted-foreground">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]}</span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </>
    )
}

function TopItemsTab() {
    const items = [
        { name: "Hyderabadi Biryani", qty: 184, revenue: 66240 },
        { name: "Paneer Tikka", qty: 142, revenue: 31808 },
        { name: "Margherita Pizza", qty: 96, revenue: 30720 },
        { name: "Dal Makhani", qty: 88, revenue: 21120 },
        { name: "Garlic Naan", qty: 312, revenue: 18720 },
        { name: "Chicken 65", qty: 54, revenue: 17280 },
        { name: "Butter Naan", qty: 264, revenue: 13200 },
    ]
    const maxQty = Math.max(...items.map((i) => i.qty))
    return (
        <Card>
            <CardContent className="p-5">
                <div className="flex items-center gap-2 text-sm font-semibold mb-3">
                    <TrendingUp className="h-4 w-4 text-primary" /> Top items by quantity
                </div>
                <div className="space-y-2">
                    {items.map((it) => (
                        <div key={it.name} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-medium">{it.name}</span>
                                <span className="text-muted-foreground tabular-nums">
                                    {it.qty} sold · <span className="text-foreground font-semibold">₹{it.revenue.toLocaleString("en-IN")}</span>
                                </span>
                            </div>
                            <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-primary to-[hsl(var(--neon-magenta))]" style={{ width: `${(it.qty / maxQty) * 100}%` }} />
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}

function HeatmapTab() {
    const hours = Array.from({ length: 14 }, (_, i) => 10 + i)   // 10:00 → 23:00
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    return (
        <Card>
            <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                    <BarChart3 className="h-4 w-4 text-primary" /> Hourly revenue heatmap
                </div>
                <div className="overflow-x-auto">
                    <div className="grid grid-cols-[40px_repeat(14,1fr)] gap-1 text-[10px]">
                        <div />
                        {hours.map((h) => <div key={h} className="text-center text-muted-foreground">{h}</div>)}
                        {days.map((d) => (
                            <RowKey key={d} day={d} />
                        ))}
                    </div>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>Low</span>
                    <div className="flex gap-0.5">
                        {[0.1, 0.25, 0.45, 0.7, 0.95].map((v) => (
                            <span key={v} className="h-3 w-4" style={{ background: `hsl(var(--primary) / ${v})` }} />
                        ))}
                    </div>
                    <span>High</span>
                </div>
            </CardContent>
        </Card>
    )
}

function RowKey({ day }: { day: string }) {
    return (
        <>
            <div className="text-muted-foreground">{day}</div>
            {Array.from({ length: 14 }).map((_, h) => {
                const v = Math.min(1, Math.max(0.05, Math.sin((h + day.length) / 2) * 0.5 + 0.5))
                return <div key={h} className="h-7 rounded-sm" style={{ background: `hsl(var(--primary) / ${v.toFixed(2)})` }} />
            })}
        </>
    )
}

function Kpi({ label, value, delta, up }: { label: string; value: string; delta?: string; up?: boolean }) {
    return (
        <Card className="p-4">
            <CardContent className="p-0 space-y-1">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-2xl font-bold tabular-nums">{value}</div>
                {delta && (
                    <div className={cn(
                        "text-[11px] flex items-center gap-0.5 tabular-nums",
                        up ? "text-success" : "text-destructive",
                    )}>
                        {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                        {delta}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

function DonutPlaceholder() {
    return (
        <div className="relative h-40 w-40 mx-auto">
            <div className="absolute inset-0 rounded-full"
                style={{ background: "conic-gradient(hsl(var(--primary)) 0 60%, hsl(var(--success)) 60% 84%, hsl(var(--warning)) 84% 97%, hsl(var(--muted-foreground)) 97% 100%)" }} />
            <div className="absolute inset-6 rounded-full bg-background grid place-items-center">
                <div className="text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">Total</div>
                    <div className="text-base font-bold tabular-nums">₹2.84L</div>
                </div>
            </div>
        </div>
    )
}

function Legend({ dot, label, value, pct }: { dot: string; label: string; value: string; pct: string }) {
    return (
        <div className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full", dot)} />
            <span className="text-muted-foreground">{label}</span>
            <Badge variant="outline" className="text-[10px] ml-auto">{pct}</Badge>
            <span className="font-semibold tabular-nums">{value}</span>
        </div>
    )
}

const meta: Meta<typeof ReportsView> = {
    title: "Screens/Reports",
    component: ReportsView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Reports page (`/reports`) — three tabs (Overview, Top items, Hourly heatmap) over a configurable date range. Overview combines a KPI strip with a payment-split donut and a day-of-week revenue bar chart. Top items ranks dishes by sold quantity, with the revenue per item alongside. The heatmap shows revenue intensity hour × day-of-week so the owner can see when their kitchen is busiest. Real page reads from Supabase via aggregation helpers in `src/lib/reports/`.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof ReportsView>

export const Overview: Story = {
    args: { tab: "overview", period: "Last 7 days" },
}

export const TopItems: Story = {
    args: { tab: "items", period: "This month" },
}

export const Heatmap: Story = {
    args: { tab: "hours", period: "Last 7 days" },
}
