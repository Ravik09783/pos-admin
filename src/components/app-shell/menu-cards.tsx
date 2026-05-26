"use client"

/**
 * Card-based navigation — the replacement for the old left sidebar.
 *
 * Layout (top → bottom):
 *   1. **Quick access**   : a wide hero strip of 4 large cards picked per
 *                            role — the screens that role actually opens
 *                            every shift. Renders FIRST so the cashier
 *                            on shift never has to scroll past Settings
 *                            to find POS.
 *   2. **Sectioned grid** : everything else, grouped by section the same
 *                            way the old sidebar was, but with tinted
 *                            icons + a stronger hover state so the page
 *                            doesn't feel like a list of plain outlines.
 *
 * Items, role-filtering, badges and pending counts are all reused from
 * `./nav.tsx` so the launcher can never drift out of sync with the rest
 * of the chrome.
 */

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutGrid } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useMyPermissions } from "@/lib/rbac/use-permissions"
import { cn } from "@/lib/utils"
import type { UserRole } from "@/types/database"
import { filterNavForUser, usePendingCount, useUnreadPostCount, type NavItem } from "./nav"

interface MenuCardsProps {
    /** Fires after the user clicks a card. */
    onNavigate?: () => void
    /** Tighter grid for embedded surfaces. */
    compact?: boolean
}

interface NavGroup {
    section: string
    items: NavItem[]
}

function groupBySection(items: NavItem[]): NavGroup[] {
    const groups: NavGroup[] = []
    for (const it of items) {
        if (it.section) {
            groups.push({ section: it.section, items: [it] })
        } else {
            const last = groups[groups.length - 1]
            if (last) last.items.push(it)
            // No leading section header (shouldn't happen given the NAV layout) —
            // fall through; the item is silently dropped rather than render
            // a misplaced card. NAV always opens with a `section:` item.
        }
    }
    return groups
}

/**
 * Hrefs to surface in the "Quick access" hero strip, ordered for each
 * role by how often a real shift opens them. Hrefs that aren't visible
 * for the current user (role or permission filter) drop out silently —
 * the strip just shows fewer cards rather than rendering greyed-out
 * dead links.
 *
 * Keep this list TIGHT — 4-5 entries per role max. The whole point is
 * "I tap one of these and I'm working in 90% of cases."
 */
const PINNED_BY_ROLE: Record<UserRole, string[]> = {
    OWNER:    ["/dashboard", "/pos",  "/orders",       "/reports",       "/kds"],
    MANAGER:  ["/dashboard", "/pos",  "/orders",       "/kds",           "/reports"],
    CASHIER:  ["/pos",       "/tables", "/orders",     "/pending-orders","/my-collections"],
    CAPTAIN:  ["/tables",    "/pos",  "/reservations", "/orders",        "/pending-orders"],
    KITCHEN:  ["/kds",       "/availability"],
    DELIVERY: ["/orders",    "/dashboard"],
    AUDITOR:  ["/reports",   "/audit-log", "/accounting", "/ca-export"],
}

/**
 * Per-pinned-href subtitle — the one-line "what this is for". Kept here
 * (not on NavItem) because it only renders on the launcher hero strip.
 * If a card surfaces in Quick access without an entry here we just show
 * the label alone — graceful fallback.
 */
const PINNED_SUBTITLE: Record<string, string> = {
    "/dashboard":       "Today's shift at a glance",
    "/pos":             "Ring up orders + take payments",
    "/orders":          "Today's bills & order list",
    "/tables":          "Floor plan + running tabs",
    "/kds":             "Live kitchen tickets",
    "/availability":    "Mark items sold-out",
    "/reservations":    "Bookings + walk-in waitlist",
    "/pending-orders":  "QR orders waiting for you",
    "/my-collections":  "End-of-shift cash check",
    "/reports":         "Sales, items, payments",
    "/audit-log":       "Who changed what",
    "/accounting":      "P&L, BS, ledgers",
    "/ca-export":       "Monthly tax bundle",
}

/**
 * Section accent colors — drives the icon-pill tint on regular cards
 * and the section-heading underline. Picked to feel like "rooms in a
 * restaurant" rather than a sterile control panel.
 */
const SECTION_ACCENT: Record<string, { ring: string; text: string; glow: string }> = {
    Operations: { ring: "from-primary/20 to-primary/5",                       text: "text-primary",       glow: "shadow-[0_0_18px_hsl(var(--neon-cyan)/0.25)]" },
    Kitchen:    { ring: "from-warning/25 to-warning/5",                       text: "text-warning",       glow: "shadow-[0_0_18px_hsl(var(--warning)/0.25)]" },
    Catalog:    { ring: "from-success/25 to-success/5",                       text: "text-success",       glow: "shadow-[0_0_18px_hsl(var(--success)/0.25)]" },
    Customers:  { ring: "from-[hsl(var(--neon-magenta)/0.25)] to-[hsl(var(--neon-magenta)/0.05)]", text: "text-[hsl(var(--neon-magenta))]", glow: "shadow-[0_0_18px_hsl(var(--neon-magenta)/0.25)]" },
    Reports:    { ring: "from-primary/25 to-[hsl(var(--neon-magenta)/0.05)]", text: "text-primary",       glow: "shadow-[0_0_18px_hsl(var(--neon-cyan)/0.25)]" },
    Finance:    { ring: "from-amber-500/25 to-amber-500/5",                   text: "text-amber-500",     glow: "shadow-[0_0_18px_rgba(245,158,11,0.25)]" },
    Setup:      { ring: "from-muted-foreground/15 to-muted-foreground/5",     text: "text-muted-foreground", glow: "" },
}

export function MenuCards({ onNavigate, compact }: MenuCardsProps) {
    const path = usePathname()
    const pending = usePendingCount()
    const unread = useUnreadPostCount()
    const { role, can, loading } = useMyPermissions()

    if (loading || !role) {
        return <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
    }

    const allVisible = filterNavForUser(role, can)
    const itemByHref = new Map(allVisible.map((i) => [i.href, i]))
    const groups = groupBySection(allVisible)

    // Pinned set, with the role's preferred order, dropping anything the
    // current user can't see. Empty for a brand-new role we forgot to
    // map — in that case the hero strip just doesn't render.
    const pinnedHrefs = (PINNED_BY_ROLE[role] ?? [])
        .map((h) => itemByHref.get(h))
        .filter((x): x is NavItem => Boolean(x))

    // Belt-and-braces empty state: a fresh-role + no-permissions user
    // could end up with no nav items at all (DELIVERY mid-setup, or an
    // over-restricted custom template). Render a friendly nudge rather
    // than a blank canvas, which looks broken.
    if (groups.length === 0 && pinnedHrefs.length === 0) {
        return (
            <div className="rounded-2xl glass border border-border/50 p-10 text-center space-y-2">
                <div className="text-sm font-medium">Nothing to show here yet.</div>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    Your account doesn&apos;t have any pages enabled. Ask the restaurant owner
                    to assign you a role template — once they do, your menu fills in automatically.
                </p>
            </div>
        )
    }

    return (
        <div className={cn("space-y-6", compact && "space-y-4")}>
            {/* ── Quick access hero strip ───────────────────────────────
              * Rendered only on the full launcher (not in `compact` mode,
              * where space is tighter and "favorites" would crowd the
              * dialog). Each card is a wider, taller tile with a soft
              * gradient + descriptive subtitle so the eye knows where
              * to land on first paint. */}
            {!compact && pinnedHrefs.length > 0 && (
                <section>
                    <h3 className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground mb-2.5">
                        Quick access
                    </h3>
                    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                        {pinnedHrefs.map((item) => {
                            const active =
                                path === item.href ||
                                (path !== null && path.startsWith(item.href + "/"))
                            return (
                                <PinnedCard
                                    key={item.href}
                                    item={item}
                                    active={active}
                                    pending={pending}
                                    unread={unread}
                                    onNavigate={onNavigate}
                                />
                            )
                        })}
                    </div>
                </section>
            )}

            {/* ── The rest, by section ───────────────────────────────── */}
            {groups.map((g) => {
                const accent = SECTION_ACCENT[g.section] ?? SECTION_ACCENT.Setup!
                return (
                    <section key={g.section}>
                        <h3 className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground mb-2.5 flex items-center gap-2">
                            <span className={cn("inline-block h-1 w-6 rounded-full bg-gradient-to-r", accent.ring)} />
                            {g.section}
                        </h3>
                        <div
                            className={cn(
                                "grid gap-2.5",
                                compact
                                    ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-5"
                                    : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6",
                            )}
                        >
                            {g.items.map((item) => {
                                const active =
                                    path === item.href ||
                                    (item.href !== "/settings" && path !== null && path.startsWith(item.href + "/")) ||
                                    (item.href === "/settings" && path === "/settings")
                                return (
                                    <MenuCard
                                        key={item.href}
                                        item={item}
                                        active={active}
                                        pending={pending}
                                        unread={unread}
                                        onNavigate={onNavigate}
                                        compact={compact}
                                        accent={accent}
                                    />
                                )
                            })}
                        </div>
                    </section>
                )
            })}
        </div>
    )
}

function PinnedCard({
    item, active, pending, unread, onNavigate,
}: {
    item: NavItem
    active: boolean
    pending: number
    unread: number
    onNavigate?: () => void
}) {
    const subtitle = PINNED_SUBTITLE[item.href]
    return (
        <Link
            href={item.href}
            onClick={onNavigate}
            className={cn(
                "group relative flex flex-col rounded-2xl border p-4 transition-all overflow-hidden",
                "bg-gradient-to-br from-primary/[0.06] via-card/40 to-[hsl(var(--neon-magenta))/0.06]",
                "border-border/60 hover:border-primary/50 hover:shadow-glow",
                "min-h-[120px]",
                active && "border-primary/60 shadow-glow",
            )}
        >
            {/* Decorative blur blob behind the icon — subtle aurora */}
            <div
                aria-hidden
                className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-primary/15 blur-2xl opacity-70 transition-opacity group-hover:opacity-100 pointer-events-none"
            />
            <div className="relative flex items-start gap-3">
                <div className="grid place-items-center h-11 w-11 rounded-xl bg-gradient-to-br from-primary/25 to-[hsl(var(--neon-magenta))/0.2] text-primary shadow-glow shrink-0">
                    <item.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-sm leading-tight">{item.label}</span>
                        {item.highlight && (
                            <Badge variant="neon" className="text-[9px] px-1 py-0">★</Badge>
                        )}
                    </div>
                    {subtitle && (
                        <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 leading-snug">
                            {subtitle}
                        </p>
                    )}
                </div>
            </div>

            {/* Top-right badges — pending / unread / highlight */}
            {item.badge === "pending" && pending > 0 && (
                <Badge variant="warning" className="absolute top-2 right-2 text-[10px] px-1.5 py-0 animate-pulse-glow">
                    {pending}
                </Badge>
            )}
            {item.badge === "unread-posts" && unread > 0 && (
                <Badge variant="default" className="absolute top-2 right-2 text-[10px] px-1.5 py-0">
                    {unread}
                </Badge>
            )}
        </Link>
    )
}

function MenuCard({
    item, active, pending, unread, onNavigate, compact, accent,
}: {
    item: NavItem
    active: boolean
    pending: number
    unread: number
    onNavigate?: () => void
    compact?: boolean
    accent: { ring: string; text: string; glow: string }
}) {
    return (
        <Link
            href={item.href}
            onClick={onNavigate}
            className={cn(
                "group relative flex flex-col items-center justify-center gap-2 rounded-xl border text-center transition-all",
                "bg-card/40 backdrop-blur-sm hover:bg-accent hover:border-primary/40 hover:-translate-y-0.5",
                "hover:shadow-glow",
                compact ? "p-3 min-h-[88px]" : "p-4 min-h-[112px]",
                active
                    ? "border-primary/60 bg-primary/10"
                    : "border-border/50",
            )}
        >
            {/* Icon container — tinted by section so the grid reads as
              * "rooms" rather than identical chrome. */}
            <span
                className={cn(
                    "grid place-items-center rounded-xl bg-gradient-to-br transition-transform group-hover:scale-110",
                    accent.ring,
                    compact ? "h-9 w-9" : "h-11 w-11",
                )}
            >
                <item.icon className={cn(compact ? "h-4 w-4" : "h-5 w-5", accent.text, active && "text-primary")} />
            </span>
            <span className={cn("font-medium leading-tight", compact ? "text-[11px]" : "text-xs md:text-sm")}>
                {item.label}
            </span>

            {/* Top-right corner badges, mirroring the sidebar's behaviour. */}
            {item.badge === "pending" && pending > 0 && (
                <Badge variant="warning" className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0 animate-pulse-glow">
                    {pending}
                </Badge>
            )}
            {item.badge === "unread-posts" && unread > 0 && (
                <Badge variant="default" className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0">
                    {unread}
                </Badge>
            )}
            {item.highlight && !item.badge && (
                <Badge variant="neon" className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0">★</Badge>
            )}
        </Link>
    )
}

/**
 * Topbar trigger — a link to the /menu launcher page. The cashier can be
 * inside POS / KDS and still reach any other page in two taps.
 *
 * Carries a pulse-dot when something needs attention so a deep-in-POS
 * cashier notices a pending QR order / unread announcement without
 * opening the menu first — same nudge the old sidebar gave.
 */
export function MenuLauncher() {
    const path = usePathname()
    const pending = usePendingCount()
    const unread = useUnreadPostCount()
    const hasNew = pending > 0 || unread > 0
    const active = path === "/menu"
    return (
        <Button
            asChild
            variant="ghost"
            size="sm"
            className={cn(
                "gap-2 h-9 shrink-0 relative",
                active && "bg-primary/10 text-primary",
            )}
        >
            <Link href="/menu" aria-label="Open menu" data-tour="topbar-menu">
                <LayoutGrid className="h-4 w-4" />
                <span className="hidden sm:inline text-sm">Menu</span>
                {hasNew && !active && (
                    <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-warning animate-pulse" />
                )}
            </Link>
        </Button>
    )
}
