"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
    AlertCircle,
    BookOpen,
    Boxes,
    Building2,
    CalendarDays,
    ChefHat,
    ChevronDown,
    Clock,
    Coins,
    LayoutDashboard,
    LogOut,
    Newspaper,
    Receipt,
    Search,
    Settings,
    ShieldAlert,
    ShoppingCart,
    User as UserIcon,
    UserSquare2,
    UtensilsCrossed,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/client"
import { useActiveBranch } from "@/lib/branch/active-branch"
import { ROLE_LABELS } from "@/lib/rbac/permissions"
import { cn } from "@/lib/utils"
import { BranchSwitcher } from "./branch-switcher"
import { MenuLauncher } from "./menu-cards"
import { usePendingCount, useUnreadPostCount } from "./nav"
import { NotificationPermissionButton } from "./notification-permission-button"
import { OfflineBanner } from "./offline-banner"
import type { UserRole } from "@/types/database"

/** Roles that can see the QR-pending-orders queue. Mirrors
 *  `ALL_OPERATIONS` in nav.tsx — anyone at the front of the house
 *  needs to know a QR order is waiting. */
const CAN_SEE_QR_PENDING: ReadonlySet<UserRole> = new Set<UserRole>(["OWNER", "MANAGER", "CASHIER", "CAPTAIN"])

/** Roles that can see the in-app announcements feed. Mirrors
 *  `OWNER_MGR` in nav.tsx — announcements are admin-broadcast. */
const CAN_SEE_ANNOUNCEMENTS: ReadonlySet<UserRole> = new Set<UserRole>(["OWNER", "MANAGER"])

/**
 * Role-aware shortcut list shown inside the user dropdown — same
 * intent as the "Quick access" strip on /menu, but reachable from any
 * page in two clicks (avatar → tap the page). We keep this in sync
 * by hand because the launcher's `PINNED_BY_ROLE` lives in a
 * client-only file that isn't worth importing here just to share
 * three lines. If you add a role-pinned page on /menu, mirror it
 * here so the two surfaces don't drift.
 *
 * Kept TIGHT — 4 entries max per role. The dropdown is a quick-jump
 * affordance, not a second sidebar.
 */
type Shortcut = {
    href: string
    label: string
    icon: React.ComponentType<{ className?: string }>
}

const QUICK_LINKS_BY_ROLE: Record<UserRole, Shortcut[]> = {
    OWNER: [
        { href: "/dashboard",  label: "Dashboard",   icon: LayoutDashboard },
        { href: "/pos",        label: "POS",         icon: ShoppingCart },
        { href: "/orders",     label: "Sales",       icon: Receipt },
        { href: "/kds",        label: "Kitchen",     icon: ChefHat },
    ],
    MANAGER: [
        { href: "/dashboard",  label: "Dashboard",   icon: LayoutDashboard },
        { href: "/pos",        label: "POS",         icon: ShoppingCart },
        { href: "/orders",     label: "Sales",       icon: Receipt },
        { href: "/kds",        label: "Kitchen",     icon: ChefHat },
    ],
    CASHIER: [
        { href: "/pos",            label: "POS",            icon: ShoppingCart },
        { href: "/tables",         label: "Tables",         icon: Building2 },
        { href: "/orders",         label: "Sales",          icon: Receipt },
        { href: "/my-collections", label: "My collections", icon: Coins },
    ],
    CAPTAIN: [
        { href: "/tables",        label: "Tables",        icon: Building2 },
        { href: "/pos",           label: "POS",           icon: ShoppingCart },
        { href: "/reservations",  label: "Reservations",  icon: CalendarDays },
        { href: "/orders",        label: "Sales",         icon: Receipt },
    ],
    KITCHEN: [
        { href: "/kds",           label: "Kitchen (KDS)", icon: ChefHat },
        { href: "/availability",  label: "Availability",  icon: UtensilsCrossed },
    ],
    DELIVERY: [
        { href: "/orders",        label: "Sales",         icon: Receipt },
        { href: "/dashboard",     label: "Dashboard",     icon: LayoutDashboard },
    ],
    AUDITOR: [
        { href: "/dashboard",     label: "Dashboard",     icon: LayoutDashboard },
        { href: "/orders",        label: "Sales",         icon: Receipt },
        { href: "/inventory",     label: "Inventory",     icon: Boxes },
        { href: "/menu-admin",    label: "Menu",          icon: BookOpen },
    ],
}

/**
 * Second-tier shortcuts — the "More tools" section. Surfaces pages
 * that aren't part of the daily-shift quick-access list but get
 * touched often enough to deserve a one-click jump from the avatar
 * dropdown. Kept role-aware so a cashier doesn't see Menu-admin /
 * Inventory etc.
 */
const MORE_LINKS_BY_ROLE: Record<UserRole, Shortcut[]> = {
    OWNER: [
        { href: "/menu-admin",   label: "Menu",        icon: BookOpen },
        { href: "/inventory",    label: "Inventory",   icon: Boxes },
        { href: "/customers",    label: "Customers",   icon: UserSquare2 },
        { href: "/reports",      label: "Reports",     icon: Receipt },
    ],
    MANAGER: [
        { href: "/menu-admin",   label: "Menu",        icon: BookOpen },
        { href: "/inventory",    label: "Inventory",   icon: Boxes },
        { href: "/customers",    label: "Customers",   icon: UserSquare2 },
        { href: "/reports",      label: "Reports",     icon: Receipt },
    ],
    CASHIER: [
        { href: "/customers",    label: "Customers",   icon: UserSquare2 },
        { href: "/reservations", label: "Reservations", icon: CalendarDays },
    ],
    CAPTAIN: [
        { href: "/customers",    label: "Customers",   icon: UserSquare2 },
        { href: "/availability", label: "Availability", icon: UtensilsCrossed },
    ],
    KITCHEN: [],
    DELIVERY: [],
    AUDITOR: [
        { href: "/reports",      label: "Reports",     icon: Receipt },
        { href: "/customers",    label: "Customers",   icon: UserSquare2 },
    ],
}

/** Ticks every 30 seconds — plenty for HH:MM display, and well
 *  under the threshold where the re-render is worth caching about.
 *  Initial value is null on the server so the client and server
 *  markup match (Date.now() differs between them and would otherwise
 *  hydrate-mismatch). We render the clock only once the client-side
 *  effect has fired. */
function useClock(): Date | null {
    const [now, setNow] = useState<Date | null>(null)
    useEffect(() => {
        setNow(new Date())
        const id = setInterval(() => setNow(new Date()), 30_000)
        return () => clearInterval(id)
    }, [])
    return now
}

export function Topbar({
    tenantId,
    tenantName,
    tenantLogoUrl,
    userName,
    userEmail,
    userAvatarUrl,
    role,
    isSuperAdmin = false,
}: {
    tenantId: string
    tenantName: string
    tenantLogoUrl: string | null
    userName: string
    userEmail: string
    /** Optional avatar — falls back to the User icon when null. */
    userAvatarUrl?: string | null
    role: UserRole
    /** When true, the user dropdown shows a "Super-admin console" entry
     *  routing to /super-admin. False/undefined hides it entirely so a
     *  regular OWNER never sees the option. */
    isSuperAdmin?: boolean
}) {
    const router = useRouter()
    const supabase = createClient()
    // Drive the left-side branch label from the same hook as the right-side
    // switcher dropdown — so the moment a user picks a different branch the
    // header text updates too. (Single-branch tenants and locked-down staff
    // get nothing rendered, just like the dropdown.)
    const { activeBranch, accessibleBranches, canSwitch, activeBranchId } = useActiveBranch()
    // Show the branch chip whenever the user can move between branches —
    // admin or multi-branch user. Single-branch users get a clean topbar.
    const showBranchLabel = accessibleBranches.length >= 2 && canSwitch
    const branchLabel = activeBranch?.name ?? (activeBranchId === null ? "All branches" : null)

    // Notification counters. Both hooks already power badges elsewhere
    // (the launcher's red-dot pulse, the nav's "QR Orders" / "unread
    // posts" badges) — wiring them into the avatar dropdown gives the
    // user a fallback in case they miss the audio chime: a number on
    // the avatar + a labelled entry inside the dropdown.
    const pendingCount = usePendingCount()
    const unreadPosts = useUnreadPostCount()
    const showPending = CAN_SEE_QR_PENDING.has(role) && pendingCount > 0
    const showUnreadPosts = CAN_SEE_ANNOUNCEMENTS.has(role) && unreadPosts > 0
    const totalUnread =
        (CAN_SEE_QR_PENDING.has(role) ? pendingCount : 0) +
        (CAN_SEE_ANNOUNCEMENTS.has(role) ? unreadPosts : 0)
    const hasNotifications = totalUnread > 0
    const quickLinks = QUICK_LINKS_BY_ROLE[role] ?? []
    const moreLinks = MORE_LINKS_BY_ROLE[role] ?? []

    async function signOut() {
        await supabase.auth.signOut()
        toast.success("Signed out")
        router.push("/login")
        router.refresh()
    }

    // Two-letter initial used by the logo fallback. We take the
    // first letter of the first two words so "Gopal Sweets" → "GS"
    // (a tiny touch but it makes the avatar feel intentional rather
    // than a generic placeholder).
    const tenantInitials = tenantName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? "")
        .join("") || "?"
    // OWNER / MANAGER badges get a primary tint so admins stand
    // apart at a glance; everyone else stays in the neutral outline.
    const isAdminRole = role === "OWNER" || role === "MANAGER"
    // Live clock — anchors the otherwise-empty middle of the bar.
    // For restaurant staff it's a genuinely useful focal point
    // (shift hand-offs, KDS prep windows, last-orders cut-offs).
    const now = useClock()
    const timeStr = now
        ? now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
        : ""
    const dateStr = now
        ? now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
        : ""

    return (
        <header className="relative h-16 border-b border-border/60 bg-card/60 backdrop-blur-xl flex items-center justify-between px-3 md:px-6 gap-3">
            {/* Subtle gradient stripe along the bottom edge — gives the
              * header a softer "lift" than a hard border alone and adds
              * a brand-coloured anchor that ties into the page's
              * primary→magenta gradient elsewhere. */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border"
            />

            {/* ── LEFT: Brand identity ───────────────────────────── */}
            <div className="flex items-center gap-3 min-w-0">
                {/* The card launcher — a topbar link to /menu, the full
                  * card grid that replaced the old sidebar. Reachable from
                  * any page including kiosk mode. */}
                <MenuLauncher />

                {/* Vertical divider — visually separates the navigation
                  * launcher from the tenant-identity cluster so they
                  * read as two distinct affordances. */}
                <div className="h-7 w-px bg-border/60 shrink-0 hidden sm:block" aria-hidden />

                {/* Logo tile — always white-backgrounded so dark-on-
                  * transparent PNG logos remain visible in dark mode.
                  * Fixed height, auto width: the container hugs the
                  * logo's natural aspect ratio so wide wordmark-style
                  * logos render at their proper proportions instead
                  * of being squashed into a square. `max-w` caps a
                  * runaway-wide logo at a sane size so the header
                  * never gets visually swallowed.
                  *
                  * When no logo is uploaded yet, we fall back to a
                  * square gradient initial tile that matches the user-
                  * avatar styling for visual consistency. */}
                {tenantLogoUrl ? (
                    <div className="h-9 w-auto max-w-[140px] inline-flex items-center rounded-lg bg-white px-1.5 py-1 ring-1 ring-border/60 shadow-sm shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={tenantLogoUrl}
                            alt=""
                            className="h-full w-auto max-w-full object-contain"
                        />
                    </div>
                ) : (
                    <span
                        aria-hidden
                        className="h-9 w-9 rounded-lg grid place-items-center shrink-0 text-xs font-bold ring-1 ring-border/60 bg-primary/15 text-primary"
                    >
                        {tenantInitials}
                    </span>
                )}

                <div className="flex flex-col min-w-0 leading-tight">
                    <span className="text-sm font-semibold truncate">{tenantName}</span>
                    {showBranchLabel && branchLabel ? (
                        // key={activeBranchId} forces React to re-mount this
                        // span on switch — pairs with `animate-in fade-in` to
                        // visibly flash the new branch name in.
                        <span
                            key={activeBranchId ?? "all"}
                            className={cn(
                                "flex items-center gap-1 text-[11px] truncate",
                                activeBranchId === null ? "text-warning" : "text-muted-foreground",
                                "animate-in fade-in slide-in-from-left-1 duration-300",
                            )}
                            aria-live="polite"
                        >
                            <Building2 className="h-3 w-3 shrink-0" />
                            <span className="truncate">{branchLabel}</span>
                        </span>
                    ) : (
                        // Subtle secondary line so the tenant block has
                        // consistent two-line height across single- and
                        // multi-branch tenants — keeps the header from
                        // looking off-balance.
                        <span className="text-[11px] text-muted-foreground/70 truncate hidden sm:inline">
                            {ROLE_LABELS[role]} console
                        </span>
                    )}
                </div>
                <Badge
                    variant={isAdminRole ? "default" : "outline"}
                    className={cn(
                        "hidden sm:inline-flex shrink-0 text-[10px] uppercase tracking-wider font-semibold",
                        isAdminRole && "bg-primary/15 text-primary border-primary/30 hover:bg-primary/15",
                    )}
                >
                    {ROLE_LABELS[role]}
                </Badge>
                <div className="hidden md:flex"><OfflineBanner tenantId={tenantId} /></div>
            </div>

            {/* ── CENTER: Global search trigger + live clock ─────────
              * The search button opens the command palette (⌘K / Ctrl+K
              * also work from any page). Looks like a search input but
              * is actually a button — same pattern as Linear / Vercel /
              * Notion. Discoverable for touch users who don't know the
              * shortcut yet. On smaller screens we collapse to a
              * standalone icon button so the bar stays tight. */}
            <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("command-palette:open"))}
                className="hidden md:flex items-center gap-2.5 h-9 px-3 max-w-md flex-1 rounded-full border border-border/60 bg-muted/30 hover:bg-muted/50 transition-colors text-left text-sm text-muted-foreground"
                aria-label="Open global search"
                title="Open global search (⌘K / Ctrl+K)"
            >
                <Search className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 truncate">Search pages, items, customers, bills…</span>
                <kbd className="hidden lg:inline-flex items-center gap-0.5 font-mono text-[10px] bg-background/80 border border-border rounded px-1.5 py-0.5 shrink-0">
                    {typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac") ? "⌘K" : "Ctrl K"}
                </kbd>
            </button>
            {/* Icon-only fallback on small screens so the search is
              * still one tap away when the full input doesn't fit. */}
            <Button
                variant="ghost"
                size="icon"
                className="md:hidden h-9 w-9 shrink-0"
                onClick={() => window.dispatchEvent(new CustomEvent("command-palette:open"))}
                aria-label="Open global search"
                title="Open global search"
            >
                <Search className="h-4 w-4" />
            </Button>

            {/* ── CENTER: Live clock + date — only when there's room
              * past the search bar (xl screens). */}
            {now && (
                <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/60 bg-muted/30 shrink-0">
                    <Clock className="h-3.5 w-3.5 text-primary" />
                    <span className="text-sm font-semibold tabular-nums tracking-tight">{timeStr}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">·  {dateStr}</span>
                </div>
            )}

            {/* ── RIGHT: Toolkit + avatar ────────────────────────── */}
            <div className="flex items-center gap-2 shrink-0">
                <div className="md:hidden"><OfflineBanner tenantId={tenantId} /></div>
                {/* Grouped controls — branch switcher + notification
                  * prompt live in a single softly-tinted "rail" so
                  * they read as one cluster rather than loose icons.
                  * The theme picker used to live here too; it's now
                  * in the app footer (see AppFooter) to keep the
                  * topbar focused on session/context controls. */}
                <div className="flex items-center gap-0.5 rounded-lg bg-muted/30 border border-border/40 p-0.5 shrink-0">
                    <BranchSwitcher />
                    <NotificationPermissionButton />
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="gap-2 shrink-0 relative h-10 pl-1 pr-2 rounded-lg border border-border/40 bg-muted/30 hover:bg-muted/50 transition-colors"
                            aria-label={
                                hasNotifications
                                    ? `Account menu, ${totalUnread} new ${totalUnread === 1 ? "notification" : "notifications"}`
                                    : "Account menu"
                            }
                        >
                            {/* Avatar — falls back to a circled initial,
                              * then to the User icon. We deliberately
                              * don't use next/image here: the URL comes
                              * from Supabase Storage (arbitrary host) and
                              * configuring `images.remotePatterns` for
                              * every tenant bucket isn't worth the
                              * complexity for a 28×28 image. */}
                            {userAvatarUrl
                                /* eslint-disable-next-line @next/next/no-img-element */
                                ? <img
                                    src={userAvatarUrl}
                                    alt=""
                                    className="h-7 w-7 rounded-full object-cover border border-border/60 shrink-0"
                                />
                                : (userName || userEmail)
                                    ? <span
                                        aria-hidden
                                        className="h-7 w-7 rounded-full grid place-items-center shrink-0 text-[11px] font-bold border border-border/60 bg-primary/15 text-primary"
                                    >
                                        {(userName || userEmail).slice(0, 1).toUpperCase()}
                                    </span>
                                    : <UserIcon className="h-4 w-4" />}
                            <span className="hidden sm:inline truncate max-w-[120px] text-sm">{userName || userEmail}</span>
                            {/* Tiny chevron so the trigger reads as a
                              * dropdown rather than a static avatar —
                              * matters on touch devices where there's
                              * no hover cue. Hidden on the smallest
                              * breakpoint where the name is hidden too. */}
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground hidden sm:inline shrink-0" />
                            {/* Count pip — visible the moment a QR order
                              * lands or an admin posts an announcement,
                              * even without the dropdown open. Same
                              * pattern as the MenuLauncher dot, but
                              * numbered so the user knows how many they
                              * missed. The realtime hooks driving these
                              * counts already power the launcher dot +
                              * sidebar badges, so adding it here just
                              * piggybacks on existing state. */}
                            {hasNotifications && (
                                <span
                                    className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 grid place-items-center text-[10px] font-bold rounded-full bg-warning text-warning-foreground border border-background shadow"
                                    aria-hidden
                                >
                                    {totalUnread > 9 ? "9+" : totalUnread}
                                </span>
                            )}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                        <DropdownMenuLabel className="truncate">
                            <div className="text-[11px] text-muted-foreground font-normal">Signed in as</div>
                            <div className="truncate">{userEmail}</div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />

                        {/* ── Notifications ─────────────────────────
                          * Only renders when the role can act on at
                          * least one of the two streams AND there's
                          * something unread. Keeps the dropdown lean
                          * on a quiet day. */}
                        {hasNotifications && (
                            <>
                                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                    Notifications
                                </DropdownMenuLabel>
                                {showPending && (
                                    <DropdownMenuItem asChild>
                                        <Link href="/pending-orders" className="flex items-center">
                                            <AlertCircle className="h-4 w-4 mr-2 text-warning" />
                                            <span className="flex-1">QR Orders</span>
                                            <Badge variant="warning" className="ml-2 text-[10px] h-5 px-1.5">
                                                {pendingCount}
                                            </Badge>
                                        </Link>
                                    </DropdownMenuItem>
                                )}
                                {showUnreadPosts && (
                                    <DropdownMenuItem asChild>
                                        <Link href="/announcements" className="flex items-center">
                                            <Newspaper className="h-4 w-4 mr-2 text-primary" />
                                            <span className="flex-1">Announcements</span>
                                            <Badge variant="warning" className="ml-2 text-[10px] h-5 px-1.5">
                                                {unreadPosts}
                                            </Badge>
                                        </Link>
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                            </>
                        )}

                        {/* ── My profile (self-service editor) ─────── */}
                        <DropdownMenuItem asChild>
                            <Link href="/settings/profile">
                                <UserIcon className="h-4 w-4 mr-2 text-primary" /> My profile
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />

                        {/* ── Quick access — mirrors /menu's hero strip */}
                        {quickLinks.length > 0 && (
                            <>
                                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                    Quick access
                                </DropdownMenuLabel>
                                {quickLinks.map((s) => (
                                    <DropdownMenuItem key={s.href} asChild>
                                        <Link href={s.href}>
                                            <s.icon className="h-4 w-4 mr-2 text-primary" />
                                            {s.label}
                                        </Link>
                                    </DropdownMenuItem>
                                ))}
                                <DropdownMenuSeparator />
                            </>
                        )}

                        {/* ── More tools — second-tier role shortcuts */}
                        {moreLinks.length > 0 && (
                            <>
                                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                    More tools
                                </DropdownMenuLabel>
                                {moreLinks.map((s) => (
                                    <DropdownMenuItem key={s.href} asChild>
                                        <Link href={s.href}>
                                            <s.icon className="h-4 w-4 mr-2 text-muted-foreground" />
                                            {s.label}
                                        </Link>
                                    </DropdownMenuItem>
                                ))}
                                <DropdownMenuSeparator />
                            </>
                        )}

                        {/* ── Settings (tenant-level admin) ────────── */}
                        <DropdownMenuItem asChild>
                            <Link href="/settings">
                                <Settings className="h-4 w-4 mr-2" /> Settings
                            </Link>
                        </DropdownMenuItem>
                        {isSuperAdmin && (
                            <DropdownMenuItem asChild>
                                <Link href="/super-admin">
                                    <ShieldAlert className="h-4 w-4 mr-2 text-destructive" />
                                    Super-admin console
                                </Link>
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={signOut} className="text-destructive">
                            <LogOut className="h-4 w-4 mr-2" /> Sign out
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    )
}
