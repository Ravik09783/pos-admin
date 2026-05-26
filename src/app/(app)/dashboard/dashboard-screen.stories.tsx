import type { Meta, StoryObj } from "@storybook/react-vite"
import {
    AlertCircle, Banknote, BarChart3, Bike, BookOpen, CheckCircle2, ChefHat,
    Clock, FileSpreadsheet, Receipt, ShoppingCart, Sparkles, TrendingUp,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * Screen-level twin of the dashboard (`src/app/(app)/dashboard/dashboard-client.tsx`).
 * The real dashboard reshapes itself by role: an OWNER sees revenue KPIs +
 * setup status + CA export hero; a CASHIER sees their own shift bills; a
 * KITCHEN role sees order counts only. This story rebuilds the visual
 * structure from static fixtures so each role's home page can be reviewed
 * side-by-side.
 *
 *   - Greeting header (firstName + range selector)
 *   - KPI tiles (revenue / bills / avg bill / active orders)
 *   - Setup-progress card (pre-launch checklist; hidden once complete)
 *   - CA export hero (India only)
 *   - Aggregator teaser (India only — Swiggy / Zomato roadmap)
 *   - Role shortcuts
 */
type Role = "OWNER" | "MANAGER" | "CASHIER" | "KITCHEN"

interface DashScreenViewProps {
    role: Role
    firstName: string
    tenantName: string
    isIndia: boolean
    /** Drives whether the setup card renders. */
    setupComplete: boolean
    revenue: number
    billCount: number
    activeOrders: number
}

function DashScreenView({
    role, firstName, tenantName, isIndia, setupComplete,
    revenue, billCount, activeOrders,
}: DashScreenViewProps) {
    const showRevenue = role === "OWNER" || role === "MANAGER"
    const showCashierView = role === "CASHIER"
    const isAdmin = role === "OWNER" || role === "MANAGER"

    return (
        <div className="min-h-[800px] w-full bg-background text-foreground rounded-md border border-border/40 p-5 space-y-5">
            {/* Greeting */}
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">{tenantName}</div>
                    <h1 className="text-2xl md:text-3xl font-bold">
                        Hi {firstName} — {greeting()}
                    </h1>
                </div>
                {showRevenue && (
                    <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/40 p-1">
                        {(["Today", "Yesterday", "Last 7 days"]).map((label, i) => (
                            <button key={label} className={cn(
                                "px-3 py-1 rounded-full text-xs font-medium",
                                i === 0 ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                            )}>{label}</button>
                        ))}
                    </div>
                )}
            </div>

            {/* Setup card */}
            {!setupComplete && isAdmin && <SetupCard />}

            {/* KPIs */}
            {showRevenue && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Kpi icon={Banknote} label="Revenue today" value={isIndia ? `₹${revenue.toFixed(0)}` : `$${revenue.toFixed(0)}`} tone="success" trend="+12% vs yest" />
                    <Kpi icon={Receipt} label="Bills" value={String(billCount)} trend={`${billCount} closed`} />
                    <Kpi icon={TrendingUp} label="Avg bill" value={isIndia ? `₹${Math.round(revenue / Math.max(1, billCount))}` : `$${Math.round(revenue / Math.max(1, billCount))}`} />
                    <Kpi icon={ChefHat} label="Active orders" value={String(activeOrders)} tone={activeOrders > 5 ? "warning" : "default"} />
                </div>
            )}

            {/* Cashier view */}
            {showCashierView && (
                <div className="grid grid-cols-2 gap-3">
                    <Kpi icon={Receipt} label="My bills today" value={String(billCount)} />
                    <Kpi icon={Banknote} label="My cash collection" value={`₹${revenue.toFixed(0)}`} tone="success" />
                </div>
            )}

            {/* CA Export hero — India only */}
            {isIndia && isAdmin && <CaExportHero />}

            {/* Aggregator teaser — India only */}
            {isIndia && isAdmin && <AggregatorTeaser />}

            {/* Shortcuts */}
            <Shortcuts role={role} />
        </div>
    )
}

function greeting() {
    const h = new Date().getHours()
    if (h < 12) return "good morning"
    if (h < 17) return "good afternoon"
    return "good evening"
}

function Kpi({ icon: Icon, label, value, tone = "default", trend }: { icon: typeof Banknote; label: string; value: string; tone?: "default" | "success" | "warning"; trend?: string }) {
    return (
        <Card className="p-4">
            <CardContent className="p-0 space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon className={cn("h-3.5 w-3.5",
                        tone === "success" && "text-success",
                        tone === "warning" && "text-warning",
                    )} />
                    {label}
                </div>
                <div className="text-2xl font-bold tabular-nums">{value}</div>
                {trend && <div className="text-[11px] text-muted-foreground">{trend}</div>}
            </CardContent>
        </Card>
    )
}

function SetupCard() {
    const items = [
        { label: "Add your first 10 menu items", done: true },
        { label: "Mark 3 dining tables", done: true },
        { label: "Configure UPI / Razorpay to receive payments", done: false },
    ]
    return (
        <Card className="border-primary/40 bg-primary/[0.04]">
            <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span className="font-semibold">Finish setting up your restaurant</span>
                    <Badge variant="warning" className="ml-auto text-[10px]">2 / 3</Badge>
                </div>
                <ul className="space-y-1.5 text-sm">
                    {items.map((it) => (
                        <li key={it.label} className="flex items-center gap-2">
                            {it.done ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <AlertCircle className="h-3.5 w-3.5 text-warning" />}
                            <span className={it.done ? "text-muted-foreground line-through" : ""}>{it.label}</span>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    )
}

function CaExportHero() {
    return (
        <Card className="neon-border overflow-hidden">
            <CardContent className="p-5 flex items-start gap-4">
                <span className="grid place-items-center h-12 w-12 rounded-xl bg-gradient-to-br from-primary/30 to-[hsl(var(--neon-magenta)/0.2)] shrink-0">
                    <FileSpreadsheet className="h-6 w-6 text-primary" />
                </span>
                <div className="flex-1 min-w-0">
                    <div className="font-bold text-lg">CA Export ready</div>
                    <p className="text-sm text-muted-foreground">
                        GSTR-1 + GSTR-3B + P&amp;L + Balance Sheet, one zip. Hand it to your accountant.
                    </p>
                </div>
                <Button variant="neon" size="sm">Download</Button>
            </CardContent>
        </Card>
    )
}

function AggregatorTeaser() {
    return (
        <Card className="relative overflow-hidden">
            <CardContent className="p-4 flex items-start gap-3">
                <div className="grid place-items-center h-9 w-9 rounded-lg bg-orange-500/15 border border-orange-500/30">
                    <Bike className="h-4 w-4 text-orange-400" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-sm">Swiggy &amp; Zomato integration</span>
                        <Badge variant="warning" className="text-[10px]"><Clock className="h-2.5 w-2.5 mr-1" /> Coming soon</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">Tag manual aggregator orders today; auto-routing once partner APIs go live.</p>
                </div>
            </CardContent>
        </Card>
    )
}

function Shortcuts({ role }: { role: Role }) {
    const shortcuts: { icon: typeof ShoppingCart; label: string; visible: Role[] }[] = [
        { icon: ShoppingCart, label: "Open POS", visible: ["OWNER", "MANAGER", "CASHIER"] },
        { icon: ChefHat, label: "Kitchen display", visible: ["OWNER", "MANAGER", "KITCHEN"] },
        { icon: BookOpen, label: "Edit menu", visible: ["OWNER", "MANAGER"] },
        { icon: BarChart3, label: "View reports", visible: ["OWNER", "MANAGER"] },
    ]
    const visible = shortcuts.filter((s) => s.visible.includes(role))
    return (
        <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Quick actions</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {visible.map((s) => (
                    <Button key={s.label} variant="outline" className="justify-start h-auto py-3">
                        <s.icon className="h-4 w-4 mr-2" /> {s.label}
                    </Button>
                ))}
            </div>
        </div>
    )
}

const meta: Meta<typeof DashScreenView> = {
    title: "Screens/Dashboard",
    component: DashScreenView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "The role-shaped home page (`/dashboard`). What renders depends on `role`: OWNER + MANAGER see revenue KPIs + CA export hero (India only); CASHIER sees their own shift collection; KITCHEN sees order counts and routes to KDS. Setup checklist shows until all three items are complete, then disappears. India tenants also get the Swiggy/Zomato teaser; non-India don't (those aggregators don't operate elsewhere). Real page hits Supabase for every KPI + listens to realtime for active-order counts.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof DashScreenView>

/** India owner, fully set up — typical mid-shift snapshot. */
export const Owner_India: Story = {
    args: {
        role: "OWNER", firstName: "Raj", tenantName: "Bandra Bistro",
        isIndia: true, setupComplete: true,
        revenue: 24300, billCount: 28, activeOrders: 6,
    },
}

/** Non-India owner — no CA export, no Swiggy/Zomato teaser. USD figures. */
export const Owner_Intl: Story = {
    args: {
        role: "OWNER", firstName: "Alex", tenantName: "Brooklyn Bistro",
        isIndia: false, setupComplete: true,
        revenue: 1840, billCount: 42, activeOrders: 4,
    },
}

/** Fresh tenant — setup checklist is the first thing they see. */
export const Owner_Onboarding: Story = {
    args: {
        role: "OWNER", firstName: "Raj", tenantName: "Bandra Bistro",
        isIndia: true, setupComplete: false,
        revenue: 0, billCount: 0, activeOrders: 0,
    },
}

/** Cashier home — only their own collection + cash count, no tenant-wide revenue. */
export const Cashier: Story = {
    args: {
        role: "CASHIER", firstName: "Riya", tenantName: "Bandra Bistro",
        isIndia: true, setupComplete: true,
        revenue: 4280, billCount: 11, activeOrders: 0,
    },
}

/** Kitchen role — minimal, just operational counts. */
export const Kitchen: Story = {
    args: {
        role: "KITCHEN", firstName: "Mehul", tenantName: "Bandra Bistro",
        isIndia: true, setupComplete: true,
        revenue: 0, billCount: 0, activeOrders: 9,
    },
}
