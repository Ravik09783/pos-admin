import type { Meta, StoryObj } from "@storybook/react-vite"
import {
    AlertCircle, BarChart3, BellRing, BookOpen, Boxes, Brain, Building2, CalendarDays,
    ChefHat, Coins, FileSpreadsheet, Gift, Landmark, LayoutDashboard, Megaphone, Palette,
    Receipt, Settings, ShoppingCart, Tag, Truck, Users, UserSquare2,
    UtensilsCrossed, Wallet, Zap,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { NavBranding } from "./nav"
import { cn } from "@/lib/utils"
import type { UserRole } from "@/types/database"

/**
 * Story-only twin of `Sidebar` — the live one calls `<NavBody>` which
 * uses `usePendingCount()` against Supabase. Here we paint the same
 * layout with a deterministic items + pending count.
 *
 * Real component: `src/components/app-shell/sidebar.tsx`.
 */
interface NavItemView {
    href: string
    icon: React.ComponentType<{ className?: string }>
    label: string
    section?: string
    highlight?: boolean
    badge?: "pending"
}

const FULL_NAV: NavItemView[] = [
    { section: "Operations", href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { href: "/pos", icon: ShoppingCart, label: "POS" },
    { href: "/tables", icon: Building2, label: "Tables" },
    { href: "/pending-orders", icon: AlertCircle, label: "QR Orders", badge: "pending" },
    { href: "/bills", icon: Receipt, label: "Bills" },
    { href: "/orders", icon: Receipt, label: "Orders" },
    { href: "/reservations", icon: CalendarDays, label: "Reservations" },
    { href: "/my-collections", icon: Coins, label: "My collections" },
    { section: "Kitchen", href: "/kds", icon: ChefHat, label: "Kitchen (KDS)" },
    { href: "/availability", icon: UtensilsCrossed, label: "Availability" },
    { section: "Catalog", href: "/menu-admin", icon: BookOpen, label: "Menu" },
    { href: "/inventory", icon: Boxes, label: "Inventory" },
    { section: "Customers", href: "/customers", icon: UserSquare2, label: "Customers" },
    { href: "/gift-cards", icon: Gift, label: "Gift cards" },
    { href: "/settings/coupons", icon: Tag, label: "Coupons" },
    { href: "/marketing", icon: Megaphone, label: "Marketing" },
    { section: "Reports", href: "/insights", icon: Brain, label: "Insights" },
    { href: "/forecast", icon: Brain, label: "Forecast" },
    { href: "/reports", icon: BarChart3, label: "Reports" },
    { section: "Finance", href: "/accounting", icon: Wallet, label: "Accounting" },
    { href: "/accounting/bank-rec", icon: Landmark, label: "Bank reconcile" },
    { href: "/vendors", icon: Truck, label: "Vendors" },
    { href: "/purchases", icon: Receipt, label: "Purchases" },
    { href: "/ca-export", icon: FileSpreadsheet, label: "CA Export", highlight: true },
    { section: "Setup", href: "/settings", icon: Settings, label: "Settings" },
    { href: "/settings/staff", icon: Users, label: "Staff" },
    { href: "/settings/payments", icon: Zap, label: "Payment gateway" },
    { href: "/settings/bill-design", icon: Palette, label: "Bill design" },
    { href: "/settings/notifications", icon: BellRing, label: "Notifications" },
    { href: "/settings/branches", icon: Building2, label: "Branches" },
]

function SidebarView({
    role, pending = 0, activeHref = "/dashboard",
}: { role: UserRole; pending?: number; activeHref?: string }) {
    return (
        <aside className="flex w-60 h-[700px] shrink-0 flex-col border-r border-border/50 bg-card/40 backdrop-blur-xl">
            <NavBranding />
            <nav className="flex-1 px-3 py-4 space-y-0.5 scrollbar-thin overflow-auto">
                {FULL_NAV.map((item) => {
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
                                    <Badge variant="warning" className="text-[10px] px-1.5 py-0">{pending}</Badge>
                                )}
                                {item.highlight && (
                                    <Badge variant="neon" className="text-[10px] px-1.5 py-0">★</Badge>
                                )}
                            </a>
                        </div>
                    )
                })}
            </nav>
            {role === "OWNER" && (
                <div className="px-3 pb-4 text-xs text-muted-foreground">
                    <div className="rounded-md bg-muted/40 p-3">
                        <div className="font-semibold text-foreground">CA Export</div>
                        Hit it at month-end and email the ZIP to your accountant.
                    </div>
                </div>
            )}
        </aside>
    )
}

const meta: Meta<typeof SidebarView> = {
    title: "AppShell/Sidebar",
    component: SidebarView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "The desktop left sidebar — branding header, full nav body, plus an OWNER-only footer card nudging the CA Export. Mobile sees this same content via a `<Sheet>` drawer triggered from the topbar hamburger.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof SidebarView>

export const OwnerView: Story = {
    args: { role: "OWNER", pending: 2, activeHref: "/dashboard" },
}

export const CashierView: Story = {
    args: { role: "CASHIER", pending: 1, activeHref: "/pos" },
    parameters: { docs: { description: { story: "Cashiers don't see the CA Export footer card (it's OWNER-only)." } } },
}

export const KitchenView: Story = {
    args: { role: "KITCHEN", pending: 0, activeHref: "/kds" },
}
