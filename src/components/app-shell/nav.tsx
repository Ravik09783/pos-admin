"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState, useSyncExternalStore } from "react"
import {
    AlertCircle,
    BarChart3,
    BellRing,
    Bike,
    BookOpen,
    Boxes,
    Brain,
    Building2,
    CalendarDays,
    ChefHat,
    Coins,
    CreditCard,
    FileSpreadsheet,
    Gift,
    History,
    Landmark,
    LayoutDashboard,
    Megaphone,
    Monitor,
    Newspaper,
    Palette,
    Percent,
    Pizza,
    Receipt,
    Settings,
    ShoppingCart,
    ShieldCheck,
    Sparkles,
    Tag,
    Truck,
    Users,
    UserSquare2,
    UtensilsCrossed,
    Wallet,
    Zap,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/client"
import { uniqueChannelName } from "@/lib/supabase/realtime"
import { useActiveBranch } from "@/lib/branch/active-branch"
import type { Permission } from "@/lib/rbac/permissions"
import type { UserRole } from "@/types/database"

export interface NavItem {
    href: string
    icon: React.ComponentType<{ className?: string }>
    label: string
    section?: string
    highlight?: boolean
    badge?: "pending" | "unread-posts"
    /** Roles that should see this item. Undefined = visible to all signed-in users. */
    roles?: UserRole[]
    /** Optional permission the user must have to see this item. Honors
     *  per-user overrides via filterNavForUser — so when an OWNER revokes
     *  `reports.view` from a manager, the Reports card disappears even
     *  though their role still allows it. */
    permission?: Permission
}

// Role visibility lists kept in sync with PERMISSIONS in src/lib/rbac/permissions.ts.
// Hiding a nav link is a UX nicety — the RLS policies are still the real gate.
const ALL_OPERATIONS: UserRole[] = ["OWNER", "MANAGER", "CASHIER", "CAPTAIN"]
const STAFF_PLUS_KITCHEN: UserRole[] = ["OWNER", "MANAGER", "CASHIER", "CAPTAIN", "KITCHEN"]
const OWNER_MGR: UserRole[] = ["OWNER", "MANAGER"]
const OWNER_MGR_AUDITOR: UserRole[] = ["OWNER", "MANAGER", "AUDITOR"]
const OWNER_ONLY: UserRole[] = ["OWNER"]

const CUSTOMER_OPS: UserRole[] = ["OWNER", "MANAGER", "CASHIER"]

// Ordered to match how a real shift actually flows. Top of each section
// = highest frequency. Kitchen-only and analytics tools moved out of the
// front-of-house "Operations" group so cashiers see a clean hot-path list.
// Role filtering (filterNavForRole) drops anything a given role can't see;
// empty sections collapse automatically.
const NAV: NavItem[] = [
    // ── Operations — what the cashier / captain actually touches all day ──
    // Order: Dashboard (home anchor) → POS (the workhorse) → Tables (dine-in
    // floor) → QR Orders (alert badge) → Bills → Orders → Reservations →
    // My collections (end-of-shift). KDS and Availability moved to their
    // own "Kitchen" section so they don't clutter the cashier's view.
    { section: "Operations", href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { href: "/announcements", icon: Newspaper, label: "Announcements", badge: "unread-posts", roles: OWNER_MGR },
    { href: "/pos", icon: ShoppingCart, label: "POS", roles: ALL_OPERATIONS },
    { href: "/tables", icon: Building2, label: "Tables", roles: ALL_OPERATIONS },
    { href: "/pending-orders", icon: AlertCircle, label: "QR Orders", badge: "pending", roles: ALL_OPERATIONS },
    // /orders is now the unified Sales page (orders + bills). The old
    // /bills listing redirects here; /bills/[id] still owns the print view.
    { href: "/orders", icon: Receipt, label: "Sales" }, // everyone (read-only for some)
    { href: "/reservations", icon: CalendarDays, label: "Reservations", roles: ALL_OPERATIONS },
    { href: "/my-collections", icon: Coins, label: "My collections", roles: ALL_OPERATIONS },

    // ── Kitchen — KDS + sold-out management. Own section so the kitchen
    // role sees exactly two items and front-of-house isn't drowning in them.
    { section: "Kitchen", href: "/kds", icon: ChefHat, label: "Kitchen (KDS)", roles: STAFF_PLUS_KITCHEN },
    { href: "/availability", icon: UtensilsCrossed, label: "Availability", roles: STAFF_PLUS_KITCHEN, permission: "menu.toggle_availability" },

    // ── Catalog — product data only ───────────────────────────────────────
    { section: "Catalog", href: "/menu-admin", icon: BookOpen, label: "Menu", roles: OWNER_MGR },
    // AI menu extractor — upload a printed menu, OCR-it-in-browser, save.
    // Owner/Manager only because it writes to menu_items in bulk.
    { href: "/ai", icon: Sparkles, label: "AI menu import", roles: OWNER_MGR },
    { href: "/inventory", icon: Boxes, label: "Inventory", roles: OWNER_MGR_AUDITOR },

    // ── Customers — CRM + every "give the guest a perk" tool in one place.
    // Coupons, gift cards, and broadcast marketing all live next to the
    // Customers list since they're touched while looking at customers.
    { section: "Customers", href: "/customers", icon: UserSquare2, label: "Customers", roles: CUSTOMER_OPS },
    { href: "/gift-cards", icon: Gift, label: "Gift cards", roles: CUSTOMER_OPS },
    { href: "/settings/coupons", icon: Tag, label: "Coupons", roles: OWNER_MGR },
    { href: "/marketing", icon: Megaphone, label: "Marketing", roles: OWNER_MGR },

    // ── Reports & insights — analytics, separate from the day-to-day cash.
    { section: "Reports", href: "/insights", icon: Brain, label: "Insights", roles: OWNER_MGR, permission: "reports.view" },
    { href: "/forecast", icon: Brain, label: "Forecast", roles: OWNER_MGR, permission: "reports.view" },
    { href: "/reports", icon: BarChart3, label: "Reports", roles: OWNER_MGR_AUDITOR, permission: "reports.view" },
    { href: "/audit-log", icon: History, label: "Audit log", roles: OWNER_MGR_AUDITOR, permission: "audit_log.view" },

    // ── Finance — money in/out + compliance exports. CA Export sits here
    // because it's an end-of-period gov filing, conceptually adjacent to
    // accounting and bank rec.
    { section: "Finance", href: "/accounting", icon: Wallet, label: "Accounting", roles: OWNER_MGR_AUDITOR, permission: "reports.view" },
    { href: "/accounting/bank-rec", icon: Landmark, label: "Bank reconcile", roles: OWNER_MGR },
    { href: "/settings/payments/dashboard", icon: CreditCard, label: "Payments dashboard", roles: OWNER_MGR_AUDITOR, permission: "reports.view" },
    { href: "/vendors", icon: Truck, label: "Vendors", roles: OWNER_MGR_AUDITOR },
    { href: "/purchases", icon: Receipt, label: "Purchases", roles: OWNER_MGR },
    { href: "/ca-export", icon: FileSpreadsheet, label: "CA Export", highlight: true, roles: OWNER_ONLY, permission: "ca_export.run" },

    // ── Setup — touched once at onboarding, occasionally afterwards.
    { section: "Setup", href: "/settings", icon: Settings, label: "Settings", roles: OWNER_ONLY },
    { href: "/settings/billing", icon: Wallet, label: "Billing", roles: OWNER_ONLY },
    // /settings/staff — no role restriction; visible to anyone whose
    // template grants `manage_users` (Owner has it by default; can be
    // delegated to a custom Manager template).
    { href: "/settings/staff", icon: Users, label: "Staff", permission: "manage_users" },
    // Template CRUD stays owner-only — delegates can ASSIGN existing
    // templates from /settings/staff but can't author new ones.
    { href: "/settings/role-templates", icon: ShieldCheck, label: "Role templates", roles: OWNER_ONLY },
    // Access overview — same audience as the Staff page (anyone who
    // can assign templates benefits from the at-a-glance roster).
    { href: "/settings/access", icon: Users, label: "Access overview", permission: "manage_users" },
    { href: "/settings/payments", icon: Zap, label: "Payment gateway", roles: OWNER_ONLY },
    { href: "/settings/tax", icon: Percent, label: "Tax", roles: OWNER_ONLY },
    { href: "/settings/bill-design", icon: Palette, label: "Bill design", roles: OWNER_MGR },
    { href: "/settings/notifications", icon: BellRing, label: "Notifications", roles: OWNER_MGR },
    // Customer display — merged surface. The page itself shows:
    //   1. Every staff member's personal URL (top)
    //   2. Branch-wide URLs (only renders for OWNER/MANAGER)
    // We expand the nav role so cashiers + captains can reach it for
    // their personal URL; the branch-wide section gates itself
    // server-rendered on role.
    { href: "/settings/display", icon: Monitor, label: "Customer display", roles: ALL_OPERATIONS },
    { href: "/settings/branches", icon: Building2, label: "Branches", roles: OWNER_ONLY },

    // ── Integrations — aggregator workbenches. Each page mirrors the
    // same surfaces (settings + KPIs + orders + settlements + guide) so
    // adding a third (DoorDash, Uber Eats…) is just a new sub-route.
    // Bike = Swiggy (delivery-first brand), Pizza = Zomato (discovery
    // brand) — different icons so the eye distinguishes them at a glance.
    { section: "Integrations", href: "/integrations/swiggy", icon: Bike, label: "Swiggy", roles: OWNER_MGR },
    { href: "/integrations/zomato", icon: Pizza, label: "Zomato", roles: OWNER_MGR },
]

function isVisibleTo(item: NavItem, role: UserRole): boolean {
    return !item.roles || item.roles.includes(role)
}

/** Override-aware variant of filterNavForRole used by the card launcher.
 *  An item is visible iff:
 *    1. the user's role is on its roles list (or it has no list), AND
 *    2. its `permission` (if any) is in the user's assigned role-template
 *       whitelist — see useMyPermissions / canWithTemplate (migration 47).
 *  Section headers collapse with their items, same as filterNavForRole. */
export function filterNavForUser(
    role: UserRole,
    can: (p: Permission) => boolean,
): NavItem[] {
    const passes = (item: NavItem) =>
        isVisibleTo(item, role) && (item.permission ? can(item.permission) : true)

    const out: NavItem[] = []
    let i = 0
    while (i < NAV.length) {
        const item = NAV[i]
        if (item.section) {
            const group: NavItem[] = [item]
            let j = i + 1
            while (j < NAV.length && !NAV[j].section) {
                group.push(NAV[j])
                j++
            }
            const visible = group.filter(passes)
            const headerVisible = passes(item)
            const childVisible = group.slice(1).some(passes)
            if (headerVisible || childVisible) {
                if (!headerVisible && visible.length > 0) {
                    visible[0] = { ...visible[0], section: item.section }
                }
                out.push(...visible)
            }
            i = j
        } else {
            if (passes(item)) out.push(item)
            i++
        }
    }
    return out
}

/** Drops section headers that have no visible items underneath. */
export function filterNavForRole(role: UserRole): NavItem[] {
    const out: NavItem[] = []
    let i = 0
    while (i < NAV.length) {
        const item = NAV[i]
        if (item.section) {
            // Peek ahead until the next section header — if any item in this
            // group is visible, include the header + visible items.
            const group: NavItem[] = [item]
            let j = i + 1
            while (j < NAV.length && !NAV[j].section) {
                group.push(NAV[j])
                j++
            }
            const visible = group.filter((g) => isVisibleTo(g, role))
            // Need at least one non-section item visible (or the header item itself).
            const headerVisible = isVisibleTo(item, role)
            const childVisible = group.slice(1).some((g) => isVisibleTo(g, role))
            if (headerVisible || childVisible) {
                // Keep header even if only children are visible — show the section.
                if (!headerVisible && visible.length > 0) {
                    // Stamp the first visible child as the section header.
                    visible[0] = { ...visible[0], section: item.section }
                }
                out.push(...visible)
            }
            i = j
        } else {
            if (isVisibleTo(item, role)) out.push(item)
            i++
        }
    }
    return out
}

// ── Shared pending-count store ────────────────────────────────────────────
//
// `usePendingCount` is called from multiple places on the same render —
// the desktop Sidebar's NavBody, the mobile Topbar badge, and again when
// the mobile Sheet renders NavBody. A naive per-instance hook would fire
// one COUNT query + open one realtime channel per call site. The store
// below fetches once per active branch and broadcasts to every subscriber.
let pendingCount = 0
let pendingBranchKey: string | null | undefined = undefined
const pendingListeners = new Set<() => void>()
let pendingChannel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null
let pendingSupabase: ReturnType<typeof createClient> | null = null

function emitPending() {
    pendingListeners.forEach((fn) => fn())
}

async function refreshPending(branchId: string | null) {
    const supabase = pendingSupabase ?? createClient()
    pendingSupabase = supabase
    let q = supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("awaiting_confirmation", true)
    if (branchId !== null) q = q.eq("branch_id", branchId)
    const { count: n } = await q
    pendingCount = n ?? 0
    emitPending()
}

function ensurePendingSubscription(branchId: string | null) {
    if (pendingBranchKey === branchId) return
    pendingBranchKey = branchId
    const supabase = pendingSupabase ?? createClient()
    pendingSupabase = supabase
    // Resubscribe — the branch filter is captured in the closure so we
    // need a fresh channel when the active branch changes.
    if (pendingChannel) {
        supabase.removeChannel(pendingChannel)
        pendingChannel = null
    }
    void refreshPending(branchId)
    pendingChannel = supabase
        .channel(uniqueChannelName("sidebar-pending"))
        .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => refreshPending(branchId))
        .subscribe()
}

function subscribePending(fn: () => void): () => void {
    pendingListeners.add(fn)
    return () => {
        pendingListeners.delete(fn)
        if (pendingListeners.size === 0 && pendingChannel && pendingSupabase) {
            pendingSupabase.removeChannel(pendingChannel)
            pendingChannel = null
            pendingBranchKey = undefined
        }
    }
}

function getPendingSnapshot(): number { return pendingCount }
function getPendingServerSnapshot(): number { return 0 }

export function usePendingCount(): number {
    /** Active branch — when set, the sidebar badge counts only this
     *  branch's QR orders awaiting confirmation. Null = aggregate all. */
    const { activeBranchId, loading: branchLoading } = useActiveBranch()
    const count = useSyncExternalStore(subscribePending, getPendingSnapshot, getPendingServerSnapshot)
    useEffect(() => {
        // Wait for the branch store to resolve. Otherwise we issue a
        // null-branch COUNT first, then a per-branch COUNT once it
        // loads — doubling the query and the realtime channel churn.
        if (branchLoading) return
        ensurePendingSubscription(activeBranchId)
    }, [activeBranchId, branchLoading])
    return count
}

// ── Unread announcement-post count (nav badge) ─────────────────────────────
//
// Mirrors the pending-count store above but without realtime — platform
// posts arrive rarely, so a fetch on first mount + a manual refresh after
// the /announcements page marks posts read is enough.
let unreadPosts = 0
let unreadLoaded = false
const unreadListeners = new Set<() => void>()
let unreadSupabase: ReturnType<typeof createClient> | null = null

function emitUnread() {
    unreadListeners.forEach((fn) => fn())
}

/** Re-fetch the unread announcement count and broadcast it to the badge.
 *  Exported so the /announcements page can refresh it after marking
 *  posts read. Safe no-op if migration 36 isn't applied (RPC missing). */
export async function refreshUnreadPosts() {
    const supabase = unreadSupabase ?? createClient()
    unreadSupabase = supabase
    const { data } = await supabase.rpc("my_unread_post_count" as never)
    unreadPosts = typeof data === "number" ? data : 0
    unreadLoaded = true
    emitUnread()
}

function subscribeUnread(fn: () => void): () => void {
    unreadListeners.add(fn)
    if (!unreadLoaded) {
        // Flip the flag synchronously so sibling NavBody instances on the
        // same render (desktop sidebar + mobile sheet) don't all fetch.
        unreadLoaded = true
        void refreshUnreadPosts()
    }
    return () => {
        unreadListeners.delete(fn)
    }
}
function getUnreadSnapshot(): number { return unreadPosts }
function getUnreadServerSnapshot(): number { return 0 }

export function useUnreadPostCount(): number {
    return useSyncExternalStore(subscribeUnread, getUnreadSnapshot, getUnreadServerSnapshot)
}

export function NavBody({ onNavigate, role }: { onNavigate?: () => void; role: UserRole }) {
    const path = usePathname()
    const pending = usePendingCount()
    const unread = useUnreadPostCount()
    const items = filterNavForRole(role)

    return (
        <nav className="flex-1 px-3 py-4 space-y-0.5 scrollbar-thin overflow-auto">
            {items.map((item) => {
                const active =
                    path === item.href ||
                    (item.href !== "/settings" && path.startsWith(item.href + "/")) ||
                    (item.href === "/settings" && path === "/settings")
                return (
                    <div key={item.href}>
                        {item.section && (
                            <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
                                {item.section}
                            </div>
                        )}
                        <Link
                            href={item.href}
                            onClick={onNavigate}
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
                                <Badge variant="warning" className="text-[10px] px-1.5 py-0 animate-pulse-glow">
                                    {pending}
                                </Badge>
                            )}
                            {item.badge === "unread-posts" && unread > 0 && (
                                <Badge variant="default" className="text-[10px] px-1.5 py-0">
                                    {unread}
                                </Badge>
                            )}
                            {item.highlight && (
                                <Badge variant="neon" className="text-[10px] px-1.5 py-0">★</Badge>
                            )}
                        </Link>
                    </div>
                )
            })}
        </nav>
    )
}

export function NavBranding() {
    return (
        <Link href="/dashboard" className="flex items-center gap-2 px-5 py-5 border-b border-border/50">
            <span className="grid place-items-center h-8 w-8 rounded-md bg-gradient-to-br from-primary to-[hsl(var(--neon-magenta))] text-primary-foreground">
                <Sparkles className="h-4 w-4" />
            </span>
            <span className="font-semibold tracking-tight">RestoPOS</span>
        </Link>
    )
}
