import type { Meta, StoryObj } from "@storybook/react-vite"
import { LogOut, Menu, User as UserIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
    DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ThemeToggle } from "./theme-toggle"
import { ROLE_LABELS } from "@/lib/rbac/permissions"
import type { UserRole } from "@/types/database"

/**
 * Story-only twin of `Topbar`. The live component plumbs through
 * Supabase auth, `usePendingCount`, `useActiveBranch`, the OfflineBanner
 * side-effects, and the BranchSwitcher / NotificationPermissionButton
 * hooks. Here we render a deterministic snapshot using static props +
 * placeholder stand-ins so designers can iterate the layout without
 * spinning up the full app.
 *
 * Real component: `src/components/app-shell/topbar.tsx`.
 */
interface TopbarViewProps {
    tenantName: string
    tenantLogoUrl?: string | null
    userName: string
    userEmail: string
    role: UserRole
    /** Visual chip to show in the right cluster — substitute for the live
     *  BranchSwitcher (which needs Supabase). Pass `null` to hide. */
    activeBranchLabel?: string | null
    /** Substitute for OfflineBanner. Null = banner hidden (online + idle). */
    offlinePill?: React.ReactNode
    /** Pending QR-order count — drives the red dot on the mobile hamburger. */
    pendingDot?: number
}

function TopbarView({
    tenantName, tenantLogoUrl = null, userName, userEmail, role,
    activeBranchLabel = null, offlinePill = null, pendingDot = 0,
}: TopbarViewProps) {
    return (
        <header className="h-14 border-b border-border/50 bg-card/40 backdrop-blur-xl flex items-center justify-between px-3 md:px-6 gap-2">
            <div className="flex items-center gap-2 min-w-0">
                {/* Mobile hamburger trigger — non-interactive in the story */}
                <Button variant="ghost" size="icon" className="md:hidden h-9 w-9 shrink-0 relative" aria-label="Open navigation">
                    <Menu className="h-5 w-5" />
                    {pendingDot > 0 && (
                        <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-warning animate-pulse" />
                    )}
                </Button>

                {tenantLogoUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={tenantLogoUrl} alt="" className="h-7 w-7 rounded object-cover shrink-0 border border-border/60" />
                ) : null}
                <span className="text-sm font-semibold truncate">{tenantName}</span>
                <Badge variant="outline" className="hidden sm:inline-flex shrink-0">{ROLE_LABELS[role]}</Badge>
                {offlinePill && <div className="hidden md:flex">{offlinePill}</div>}
            </div>

            <div className="flex items-center gap-1 shrink-0">
                {offlinePill && <div className="md:hidden">{offlinePill}</div>}
                {activeBranchLabel && (
                    <Button variant="outline" size="sm" className="gap-1.5 h-8 max-w-[180px]">
                        <span className="truncate">{activeBranchLabel}</span>
                    </Button>
                )}
                <ThemeToggle />
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="gap-2 shrink-0">
                            <UserIcon className="h-4 w-4" />
                            <span className="hidden sm:inline truncate max-w-[120px]">{userName || userEmail}</span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel className="truncate">{userEmail}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive">
                            <LogOut className="h-4 w-4 mr-2" /> Sign out
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    )
}

const meta: Meta<typeof TopbarView> = {
    title: "AppShell/Topbar",
    component: TopbarView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "The persistent header — mobile hamburger on the left, tenant identity + role badge + offline status, then the right cluster (branch switcher, theme toggle, user menu). Bound to live Supabase context in production; the story uses static stand-ins so every variant renders deterministically.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof TopbarView>

/** Owner of a single-branch tenant — no branch switcher visible. */
export const OwnerSingleBranch: Story = {
    args: {
        tenantName: "Spice Garden Bistro",
        tenantLogoUrl: null,
        userName: "Karan Sharma",
        userEmail: "karan@spicegarden.in",
        role: "OWNER",
        activeBranchLabel: null,
    },
}

/** Owner of a multi-branch tenant — branch switcher pill on. */
export const OwnerMultiBranch: Story = {
    args: {
        tenantName: "Cafe Lumière (Chain)",
        userName: "Priya Iyer",
        userEmail: "priya@lumiere.cafe",
        role: "OWNER",
        activeBranchLabel: "Bandra Kurla Complex",
    },
}

/** Cashier role — locked to a branch, no switcher. Pending badge on
 *  the mobile hamburger because QR orders are awaiting confirmation. */
export const CashierWithPending: Story = {
    args: {
        tenantName: "Spice Garden Bistro",
        userName: "Anjali",
        userEmail: "anjali@spicegarden.in",
        role: "CASHIER",
        pendingDot: 3,
    },
}

/** With the tenant logo. */
export const WithLogo: Story = {
    args: {
        tenantName: "Spice Garden",
        tenantLogoUrl: "https://images.unsplash.com/photo-1572799454557-d533a8be6175?w=80&q=80",
        userName: "Karan",
        userEmail: "karan@spicegarden.in",
        role: "OWNER",
    },
}

/** Offline scenario — the inline pill highlights the queued bills. */
export const OfflineState: Story = {
    args: {
        tenantName: "Spice Garden Bistro",
        userName: "Karan",
        userEmail: "karan@spicegarden.in",
        role: "OWNER",
        offlinePill: (
            <div className="flex items-center gap-2 px-2 py-1 rounded-md border text-xs"
                 style={{ borderColor: "hsl(var(--warning) / 0.5)", background: "hsl(var(--warning) / 0.1)" }}>
                <span className="font-medium text-warning">Offline — bills queued locally</span>
                <Badge variant="warning" className="text-[10px] py-0">3 pending</Badge>
            </div>
        ),
    },
}
