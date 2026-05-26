"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
    AlertCircle,
    BookOpen,
    Boxes,
    Building2,
    CalendarDays,
    ChefHat,
    Coins,
    LayoutDashboard,
    LogOut,
    Newspaper,
    Receipt,
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
import { ThemeToggle } from "./theme-toggle"
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

    return (
        <header className="h-14 border-b border-border/50 bg-card/40 backdrop-blur-xl flex items-center justify-between px-3 md:px-6 gap-2">
            <div className="flex items-center gap-2 min-w-0">
                {/* The card launcher — a topbar link to /menu, the full
                  * card grid that replaced the old sidebar. Reachable from
                  * any page including kiosk mode. */}
                <MenuLauncher />

                {tenantLogoUrl
                    /* eslint-disable-next-line @next/next/no-img-element */
                    ? <img src={tenantLogoUrl} alt="" className="h-7 w-7 rounded object-cover shrink-0 border border-border/60" />
                    : null}
                <div className="flex flex-col min-w-0 leading-tight">
                    <span className="text-sm font-semibold truncate">{tenantName}</span>
                    {showBranchLabel && branchLabel && (
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
                    )}
                </div>
                <Badge variant="outline" className="hidden sm:inline-flex shrink-0">{ROLE_LABELS[role]}</Badge>
                <div className="hidden md:flex"><OfflineBanner tenantId={tenantId} /></div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
                <div className="md:hidden"><OfflineBanner tenantId={tenantId} /></div>
                <BranchSwitcher />
                <NotificationPermissionButton />
                <ThemeToggle />
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="gap-2 shrink-0 relative pl-1.5"
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
                                        className="h-7 w-7 rounded-full grid place-items-center shrink-0 text-[11px] font-bold border border-border/60 bg-gradient-to-br from-primary/30 to-[hsl(var(--neon-magenta)/0.25)] text-primary"
                                    >
                                        {(userName || userEmail).slice(0, 1).toUpperCase()}
                                    </span>
                                    : <UserIcon className="h-4 w-4" />}
                            <span className="hidden sm:inline truncate max-w-[120px]">{userName || userEmail}</span>
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
