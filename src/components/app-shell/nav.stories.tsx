import type { Meta, StoryObj } from "@storybook/react-vite"
import {
    AlertCircle, BarChart3, BellRing, BookOpen, Boxes, Brain, Building2, CalendarDays,
    ChefHat, Coins, FileSpreadsheet, Gift, Landmark, LayoutDashboard, Megaphone, Palette,
    Receipt, Settings, ShoppingCart, Sparkles, Tag, Truck, Users, UserSquare2,
    UtensilsCrossed, Wallet, Zap,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { NavBranding } from "./nav"
import { cn } from "@/lib/utils"

/**
 * Storybook visual twin of `NavBody`. The live component reads the user's
 * role from Supabase via `usePendingCount`; this version takes the
 * filtered NAV list + pending count as props so the story renders
 * deterministically.
 *
 * Real component: `src/components/app-shell/nav.tsx`.
 */
interface NavItemView {
    href: string
    icon: React.ComponentType<{ className?: string }>
    label: string
    section?: string
    highlight?: boolean
    badge?: "pending"
}

function NavBodyView({
    items, pending, activeHref,
}: { items: NavItemView[]; pending: number; activeHref: string }) {
    return (
        <nav className="flex-1 px-3 py-4 space-y-0.5 scrollbar-thin overflow-auto">
            {items.map((item) => {
                const active = item.href === activeHref || activeHref.startsWith(item.href + "/")
                return (
                    <div key={item.href}>
                        {item.section && (
                            <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
                                {item.section}
                            </div>
                        )}
                        <a
                            href="#"
                            onClick={(e) => e.preventDefault()}
                            className={cn(
                                "flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors",
                                active
                                    ? "bg-primary/10 text-primary"
                                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                            )}
                        >
                            <item.icon className="h-4 w-4" />
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.badge === "pending" && pending > 0 && (
                                <Badge variant="warning" className="text-[10px] px-1.5 py-0">
                                    {pending}
                                </Badge>
                            )}
                            {item.highlight && (
                                <Badge variant="neon" className="text-[10px] px-1.5 py-0">★</Badge>
                            )}
                        </a>
                    </div>
                )
            })}
        </nav>
    )
}

// ── Fixture: trimmed NAV slice (matches the canonical list in nav.tsx) ──
const OPERATIONS: NavItemView[] = [
    { section: "Operations", href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { href: "/pos", icon: ShoppingCart, label: "POS" },
    { href: "/tables", icon: Building2, label: "Tables" },
    { href: "/pending-orders", icon: AlertCircle, label: "QR pending", badge: "pending" },
    { href: "/bills", icon: Receipt, label: "Bills" },
    { href: "/orders", icon: Receipt, label: "Orders" },
    { href: "/reservations", icon: CalendarDays, label: "Reservations" },
    { href: "/my-collections", icon: Coins, label: "My collections" },
]
const KITCHEN: NavItemView[] = [
    { section: "Kitchen", href: "/kds", icon: ChefHat, label: "Kitchen (KDS)" },
    { href: "/availability", icon: UtensilsCrossed, label: "Availability" },
]
const CATALOG: NavItemView[] = [
    { section: "Catalog", href: "/menu-admin", icon: BookOpen, label: "Menu" },
    { href: "/inventory", icon: Boxes, label: "Inventory" },
]
const CUSTOMERS: NavItemView[] = [
    { section: "Customers", href: "/customers", icon: UserSquare2, label: "Customers" },
    { href: "/gift-cards", icon: Gift, label: "Gift cards" },
    { href: "/settings/coupons", icon: Tag, label: "Coupons" },
    { href: "/marketing", icon: Megaphone, label: "Marketing" },
]
const REPORTS: NavItemView[] = [
    { section: "Reports", href: "/insights", icon: Brain, label: "Insights" },
    { href: "/forecast", icon: Brain, label: "Forecast" },
    { href: "/reports", icon: BarChart3, label: "Reports" },
]
const FINANCE: NavItemView[] = [
    { section: "Finance", href: "/accounting", icon: Wallet, label: "Accounting" },
    { href: "/accounting/bank-rec", icon: Landmark, label: "Bank reconcile" },
    { href: "/vendors", icon: Truck, label: "Vendors" },
    { href: "/purchases", icon: Receipt, label: "Purchases" },
    { href: "/ca-export", icon: FileSpreadsheet, label: "CA Export", highlight: true },
]
const SETUP: NavItemView[] = [
    { section: "Setup", href: "/settings", icon: Settings, label: "Settings" },
    { href: "/settings/staff", icon: Users, label: "Staff" },
    { href: "/settings/payments", icon: Zap, label: "Payment gateway" },
    { href: "/settings/bill-design", icon: Palette, label: "Bill design" },
    { href: "/settings/notifications", icon: BellRing, label: "Notifications" },
    { href: "/settings/branches", icon: Building2, label: "Branches" },
]
const FULL_OWNER = [...OPERATIONS, ...KITCHEN, ...CATALOG, ...CUSTOMERS, ...REPORTS, ...FINANCE, ...SETUP]
// Cashier sees a trimmed subset.
const CASHIER_VIEW = [...OPERATIONS, ...KITCHEN, ...CUSTOMERS.slice(0, 2)]
// Kitchen role: only kitchen tools.
const KITCHEN_VIEW = [{ ...KITCHEN[0]!, section: "Kitchen" }, ...KITCHEN.slice(1)]

const meta: Meta<typeof NavBodyView> = {
    title: "AppShell/Nav",
    component: NavBodyView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "The sidebar navigation list. Filters by role (OWNER/MANAGER see everything; CASHIER/CAPTAIN see operations + customers; KITCHEN sees only KDS + Availability). Active link gets a primary-tinted background. `QR pending` carries a live count badge sourced from `usePendingCount()`, branch-scoped via `useActiveBranch()`.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof NavBodyView>

function Frame({ children }: { children: React.ReactNode }) {
    return (
        <aside className="flex w-60 h-[600px] flex-col border-r border-border/50 bg-card/40 backdrop-blur-xl">
            <NavBranding />
            {children}
        </aside>
    )
}

/** Owner — the full menu. */
export const OwnerView: Story = {
    render: () => (
        <Frame>
            <NavBodyView items={FULL_OWNER} pending={3} activeHref="/dashboard" />
        </Frame>
    ),
}

/** Cashier — operations + kitchen + customers only. */
export const CashierView: Story = {
    render: () => (
        <Frame>
            <NavBodyView items={CASHIER_VIEW} pending={1} activeHref="/pos" />
        </Frame>
    ),
}

/** Kitchen — KDS + Availability only. Tightest nav. */
export const KitchenView: Story = {
    render: () => (
        <Frame>
            <NavBodyView items={KITCHEN_VIEW} pending={0} activeHref="/kds" />
        </Frame>
    ),
}

/** Lots of pending QR orders — badge stands out. */
export const HeavyPendingLoad: Story = {
    render: () => (
        <Frame>
            <NavBodyView items={FULL_OWNER} pending={12} activeHref="/pending-orders" />
        </Frame>
    ),
}

/** Just the branding header — used at the top of every sidebar variant. */
export const Branding: Story = {
    render: () => (
        <div className="w-60 border border-border/50 rounded-md">
            <NavBranding />
        </div>
    ),
}

