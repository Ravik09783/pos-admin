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
import { ArrowUpRight, LayoutGrid } from "lucide-react"

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
 * Section accent colors — drives the icon-pill tint on regular cards,
 * the section-heading underline, AND the whole-section "panel"
 * backdrop introduced in the redesign. Picked to feel like "rooms in
 * a restaurant" rather than a sterile control panel.
 *
 * Each entry carries:
 *   • `ring`  — gradient for icon pills + the small underline chip.
 *               TWO sets of stops: light defaults (visible on white)
 *               + dark: overrides (soft glassmorphism on near-black).
 *   • `text`  — accent foreground used on the icon.
 *   • `panel` — soft surface gradient for the whole section "panel"
 *               that wraps the section's cards. Strong enough to
 *               read as "this is the Kitchen room" on light AND on
 *               dark.
 *   • `panelBorder` — ring color that pairs with the panel surface.
 *   • `glow`  — old prop, kept for back-compat with the type but no
 *               longer used by the renderer.
 */
type SectionAccent = {
    ring: string
    text: string
    panel: string
    panelBorder: string
    glow: string
}

const SECTION_ACCENT: Record<string, SectionAccent> = {
    // Flat (gradient-free) section accents. Each section keeps a
    // distinct colour identity — the difference vs. the old palette
    // is that `ring` and `panel` are now single solid tints rather
    // than gradient stop-pairs. Same call sites, simpler CSS.
    Operations: {
        ring: "bg-primary/20",
        text: "text-primary",
        panel: "bg-primary/[0.04]",
        panelBorder: "border-primary/20 dark:border-primary/15",
        glow: "",
    },
    Kitchen: {
        ring: "bg-warning/20",
        text: "text-warning",
        panel: "bg-warning/[0.04]",
        panelBorder: "border-warning/25 dark:border-warning/15",
        glow: "",
    },
    Catalog: {
        ring: "bg-success/20",
        text: "text-success",
        panel: "bg-success/[0.04]",
        panelBorder: "border-success/25 dark:border-success/15",
        glow: "",
    },
    Customers: {
        ring: "bg-[hsl(var(--neon-magenta)/0.2)]",
        text: "text-[hsl(var(--neon-magenta))]",
        panel: "bg-[hsl(var(--neon-magenta)/0.04)]",
        panelBorder: "border-[hsl(var(--neon-magenta)/0.25)] dark:border-[hsl(var(--neon-magenta)/0.15)]",
        glow: "",
    },
    Reports: {
        ring: "bg-primary/20",
        text: "text-primary",
        panel: "bg-primary/[0.04]",
        panelBorder: "border-primary/20 dark:border-primary/15",
        glow: "",
    },
    Finance: {
        ring: "bg-amber-500/20",
        text: "text-amber-600 dark:text-amber-500",
        panel: "bg-amber-500/[0.04]",
        panelBorder: "border-amber-500/25 dark:border-amber-500/15",
        glow: "",
    },
    Setup: {
        ring: "bg-muted-foreground/15",
        text: "text-muted-foreground",
        panel: "bg-muted/30",
        panelBorder: "border-border dark:border-border/40",
        glow: "",
    },
}

/**
 * Optional one-liner per section, shown under the section title inside
 * the panel. Frames the section's purpose for a new user instead of
 * leaving them to infer from icons.
 */
const SECTION_SUBTITLE: Record<string, string> = {
    Operations: "Day-to-day counter work — POS, tables, QR queue.",
    Kitchen:    "What's cooking and who's plating it.",
    Catalog:    "Menu, recipes, stock, and suppliers.",
    Customers:  "Loyalty, gift cards, and coupons.",
    Reports:    "What's working — and what's not.",
    Finance:    "Money in, money out, tax-ready exports.",
    Setup:      "Staff, branches, payments, integrations.",
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

    // Split the pinned strip into a "featured" hero (the role's #1
    // action — the first entry of PINNED_BY_ROLE for this role) and
    // the rest as smaller secondary cards. The hero is double-wide
    // on desktop so the eye lands on the right action immediately.
    // Compact mode (used inside dialogs) skips the hero treatment.
    const [featuredItem, ...secondaryPins] = pinnedHrefs

    return (
        <div className={cn("space-y-6 md:space-y-8", compact && "space-y-4")}>
            {/* ── Quick access hero ─────────────────────────────────────
              * Featured card on the left, smaller pinned cards on the
              * right. Renders only on the full launcher (compact mode
              * keeps the simpler grid). */}
            {!compact && featuredItem && (
                <section>
                    <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground mb-3 flex items-center gap-2">
                        <span className="inline-block h-1.5 w-8 rounded-full bg-primary" />
                        Quick access
                    </h3>
                    <div className="grid gap-3 md:gap-4 md:grid-cols-12">
                        {/* Hero — half the row on md+. Mobile gets the
                          * hero full-width above the secondary row so
                          * it's still the obvious first action. */}
                        <div className="md:col-span-6 lg:col-span-6">
                            <FeaturedPinnedCard
                                item={featuredItem}
                                active={
                                    path === featuredItem.href ||
                                    (path !== null && path.startsWith(featuredItem.href + "/"))
                                }
                                pending={pending}
                                unread={unread}
                                onNavigate={onNavigate}
                            />
                        </div>
                        {/* Secondary pins — 2x2 grid beside the hero on
                          * md+, single row on mobile. The role might
                          * have anywhere from 0 to 4 secondaries — the
                          * grid just packs whatever's there. */}
                        {secondaryPins.length > 0 && (
                            <div className="md:col-span-6 lg:col-span-6 grid gap-3 grid-cols-2">
                                {secondaryPins.slice(0, 4).map((item) => (
                                    <PinnedCard
                                        key={item.href}
                                        item={item}
                                        active={
                                            path === item.href ||
                                            (path !== null && path.startsWith(item.href + "/"))
                                        }
                                        pending={pending}
                                        unread={unread}
                                        onNavigate={onNavigate}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </section>
            )}

            {/* ── Section panels ─────────────────────────────────────────
              * Each section is now its own colored panel with a soft
              * background tint matching its accent. Items live inside
              * the panel, so the whole page reads as a set of "rooms"
              * (Operations / Kitchen / Catalog / …) rather than a flat
              * list of icons under faint headings. */}
            {groups.map((g) => {
                const accent = SECTION_ACCENT[g.section] ?? SECTION_ACCENT.Setup!
                const subtitle = SECTION_SUBTITLE[g.section]
                return (
                    <section
                        key={g.section}
                        className={cn(
                            "relative rounded-2xl border p-4 md:p-5 overflow-hidden",
                            "shadow-sm dark:shadow-none",
                            accent.panel,
                            accent.panelBorder,
                        )}
                    >
                        {/* Decorative blur blob in the top-right corner
                          * of each panel — picks up the section's accent
                          * tint so the panels feel distinct at a glance. */}
                        <div
                            aria-hidden
                            className={cn(
                                "absolute -top-12 -right-12 h-40 w-40 rounded-full blur-3xl pointer-events-none opacity-50 dark:opacity-40 ",
                                accent.ring,
                            )}
                        />
                        <header className="relative mb-3 md:mb-4 flex items-baseline justify-between gap-3 flex-wrap">
                            <div className="min-w-0">
                                <h3 className="text-sm md:text-base font-bold tracking-tight flex items-center gap-2">
                                    <span className={cn("inline-block h-1.5 w-8 rounded-full", accent.ring)} />
                                    {g.section}
                                </h3>
                                {subtitle && (
                                    <p className="text-[11px] md:text-xs text-muted-foreground mt-0.5 leading-snug">
                                        {subtitle}
                                    </p>
                                )}
                            </div>
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                {g.items.length} {g.items.length === 1 ? "tool" : "tools"}
                            </span>
                        </header>
                        <div
                            className={cn(
                                "relative grid gap-2.5",
                                compact
                                    ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-5"
                                    : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
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

/**
 * Big "hero" card for the role's #1 action — POS for cashiers, KDS
 * for kitchen, Dashboard for admins. Twice the size of a secondary
 * pinned card; tall + roomy so the icon + title + subtitle have
 * breathing room and the eye lands here first on a fresh page.
 *
 * Layout: large gradient icon-block on the left, two-line title +
 * subtitle in the middle, animated "Open →" arrow on the right that
 * slides on hover. A decorative aurora blob sits behind the icon to
 * give the card a bit of life without screaming.
 */
function FeaturedPinnedCard({
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
                "group relative flex h-full min-h-[148px] md:min-h-[164px] flex-col justify-between rounded-2xl border p-5 md:p-6 overflow-hidden transition-all",
                // Light: subtle cyan→magenta gradient on a white card
                // so the hero feels "premium" without going neon.
                // Dark: keep the existing aurora over near-black.
                "bg-card border border-border/60 shadow-sm",
                "dark:from-primary/[0.10] dark:via-card/60 dark:to-[hsl(var(--neon-magenta)/0.10)] dark:shadow-none",
                "border-primary/30 hover:border-primary/70 hover:shadow-lg hover:-translate-y-0.5",
                "dark:border-primary/20 dark:hover:shadow-glow",
                active && "border-primary/70 ring-2 ring-primary/30",
            )}
        >
            {/* Two decorative aurora blobs — one tinted cyan in the
              * top-right, one magenta in the bottom-left. They sit
              * behind the content (z-0) and brighten on hover. */}
            <div
                aria-hidden
                className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-primary/30 dark:bg-primary/25 blur-3xl opacity-60 transition-opacity group-hover:opacity-90 pointer-events-none"
            />
            <div
                aria-hidden
                className="absolute -bottom-20 -left-20 h-48 w-48 rounded-full bg-[hsl(var(--neon-magenta)/0.25)] blur-3xl opacity-40 transition-opacity group-hover:opacity-70 pointer-events-none"
            />

            {/* Top row — big icon block + the open-arrow on the far right */}
            <div className="relative flex items-start justify-between gap-3">
                <div className={cn(
                    "grid place-items-center h-14 w-14 md:h-16 md:w-16 rounded-2xl shrink-0",
                    "bg-primary/15 text-primary",
                    "dark:from-primary/30 dark:to-[hsl(var(--neon-magenta)/0.25)]",
                    "shadow-md dark:shadow-glow",
                    "transition-transform group-hover:scale-105",
                )}>
                    <item.icon className="h-7 w-7 md:h-8 md:w-8" />
                </div>
                <span
                    aria-hidden
                    className={cn(
                        "grid place-items-center h-8 w-8 rounded-full",
                        "bg-card/80 dark:bg-background/60 border border-border/60",
                        "text-muted-foreground group-hover:text-primary group-hover:border-primary/60",
                        "transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5",
                    )}
                >
                    <ArrowUpRight className="h-4 w-4" />
                </span>
            </div>

            {/* Bottom row — title + subtitle + featured chip */}
            <div className="relative mt-4">
                <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-lg md:text-xl font-bold leading-tight tracking-tight">
                        {item.label}
                    </h4>
                    <Badge variant="neon" className="text-[10px] px-1.5 py-0">Featured</Badge>
                    {item.highlight && (
                        <Badge variant="neon" className="text-[9px] px-1 py-0">★</Badge>
                    )}
                </div>
                {subtitle && (
                    <p className="text-xs md:text-sm text-muted-foreground mt-1.5 leading-snug max-w-md">
                        {subtitle}
                    </p>
                )}
            </div>

            {/* Top-right badges — pending / unread. Shifted left to
              * clear the open-arrow chip. */}
            {item.badge === "pending" && pending > 0 && (
                <Badge variant="warning" className="absolute top-3 right-14 text-[10px] px-1.5 py-0 animate-pulse-glow">
                    {pending}
                </Badge>
            )}
            {item.badge === "unread-posts" && unread > 0 && (
                <Badge variant="default" className="absolute top-3 right-14 text-[10px] px-1.5 py-0">
                    {unread}
                </Badge>
            )}
        </Link>
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
                "group relative flex flex-col justify-between rounded-2xl border p-3.5 transition-all overflow-hidden",
                // LIGHT: solid card with a soft shadow + tinted
                // gradient (lighter than the hero's). DARK: keep the
                // existing low-opacity aurora.
                "bg-card border border-border/60 shadow-sm",
                "dark:from-primary/[0.06] dark:via-card/40 dark:to-[hsl(var(--neon-magenta))/0.06] dark:shadow-none",
                "border-border hover:border-primary/60 hover:shadow-md hover:-translate-y-0.5",
                "dark:border-border/60 dark:hover:shadow-glow",
                "min-h-[110px]",
                active && "border-primary/60 shadow-md dark:shadow-glow",
            )}
        >
            {/* Single decorative blob in the corner — smaller than the
              * hero's twin-blob treatment so the visual hierarchy is
              * "hero ▶ pinned ▶ menu cards". */}
            <div
                aria-hidden
                className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-primary/20 dark:bg-primary/15 blur-2xl opacity-60 transition-opacity group-hover:opacity-100 pointer-events-none"
            />
            <div className="relative flex items-start gap-2.5">
                <div className={cn(
                    "grid place-items-center h-10 w-10 rounded-xl shrink-0",
                    "bg-primary/15 text-primary",
                    "dark:from-primary/25 dark:to-[hsl(var(--neon-magenta))/0.2]",
                    "shadow-sm dark:shadow-glow",
                    "transition-transform group-hover:scale-110",
                )}>
                    <item.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-sm leading-tight">{item.label}</span>
                        {item.highlight && (
                            <Badge variant="neon" className="text-[9px] px-1 py-0">★</Badge>
                        )}
                    </div>
                </div>
            </div>
            {subtitle && (
                <p className="relative text-[11px] text-muted-foreground mt-2 line-clamp-2 leading-snug">
                    {subtitle}
                </p>
            )}

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
    accent: SectionAccent
}) {
    return (
        <Link
            href={item.href}
            onClick={onNavigate}
            className={cn(
                "group relative flex flex-col items-center justify-center gap-2 rounded-xl border text-center transition-all",
                // Card sits inside a colored panel now. On LIGHT we use
                // a near-opaque card surface so it lifts off the panel
                // tint without fighting it. On DARK we stay translucent
                // so the panel's aurora bleeds through, preserving the
                // glassmorphism aesthetic.
                "bg-card/90 backdrop-blur-sm shadow-sm",
                "dark:bg-card/40 dark:shadow-none",
                "hover:bg-accent hover:border-primary/50 hover:-translate-y-0.5 hover:shadow-md",
                "dark:hover:shadow-glow",
                compact ? "p-3 min-h-[92px]" : "p-4 min-h-[116px]",
                active
                    ? "border-primary/60 bg-primary/10 dark:bg-primary/10 ring-1 ring-primary/30"
                    : "border-border/80 dark:border-border/50",
            )}
        >
            {/* Icon container — tinted by section so the grid reads as
              * "rooms" rather than identical chrome. We add a soft
              * shadow on light and an inner ring on dark so the pill
              * itself reads as a small lifted button at any contrast. */}
            <span
                className={cn(
                    "grid place-items-center rounded-xl  transition-all duration-200",
                    "group-hover:scale-110 group-hover:-translate-y-0.5",
                    "shadow-sm dark:shadow-none",
                    "ring-1 ring-inset ring-white/40 dark:ring-white/[0.04]",
                    accent.ring,
                    compact ? "h-10 w-10" : "h-12 w-12",
                )}
            >
                <item.icon className={cn(compact ? "h-4 w-4" : "h-5 w-5", accent.text, active && "text-primary")} />
            </span>
            <span className={cn(
                "font-medium leading-tight transition-colors",
                "group-hover:text-foreground",
                compact ? "text-[11px]" : "text-xs md:text-sm",
            )}>
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
