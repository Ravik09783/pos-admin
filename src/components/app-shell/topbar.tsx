"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Building2, LogOut, ShieldAlert, User as UserIcon } from "lucide-react"
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
import { NotificationPermissionButton } from "./notification-permission-button"
import { ThemeToggle } from "./theme-toggle"
import { OfflineBanner } from "./offline-banner"
import type { UserRole } from "@/types/database"

export function Topbar({
    tenantId,
    tenantName,
    tenantLogoUrl,
    userName,
    userEmail,
    role,
    isSuperAdmin = false,
}: {
    tenantId: string
    tenantName: string
    tenantLogoUrl: string | null
    userName: string
    userEmail: string
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
                        <Button variant="ghost" size="sm" className="gap-2 shrink-0">
                            <UserIcon className="h-4 w-4" />
                            <span className="hidden sm:inline truncate max-w-[120px]">{userName || userEmail}</span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel className="truncate">{userEmail}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {isSuperAdmin && (
                            <>
                                <DropdownMenuItem asChild>
                                    <Link href="/super-admin">
                                        <ShieldAlert className="h-4 w-4 mr-2 text-destructive" />
                                        Super-admin console
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                            </>
                        )}
                        <DropdownMenuItem onSelect={signOut} className="text-destructive">
                            <LogOut className="h-4 w-4 mr-2" /> Sign out
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    )
}
