"use client"

import { Building2, Check, ChevronDown } from "lucide-react"
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
import { useActiveBranch } from "@/lib/branch/active-branch"
import { cn } from "@/lib/utils"
import type { Branch } from "@/types/database"

/**
 * Topbar branch switcher.
 *
 * One button shows the active branch's name. Clicking it opens a list
 * of every active branch + an "All branches" option (admins only).
 *
 * Auto-hides for tenants with fewer than 2 branches — single-branch
 * shops never see this button. Non-admins also see nothing (they can't
 * switch — their branch is set by the OWNER on the Staff page).
 */
export function BranchSwitcher() {
    // `accessibleBranches` honours the per-user `user_branch_access` grants
    // from migration 45 — an admin sees everything; a CASHIER granted two
    // branches sees exactly those two; a single-branch user gets nothing
    // (the view hides itself below 2 branches).
    const { activeBranchId, accessibleBranches, canSwitch, loading, setActiveBranch } = useActiveBranch()
    if (loading) return null

    /** Wraps setActiveBranch so the user gets an explicit "switched"
     *  toast — without this, the only feedback was the dropdown closing
     *  and the topbar text updating, which is easy to miss. */
    function selectWithFeedback(id: string | null) {
        if (id === activeBranchId) return // no-op, no toast
        const target = id === null
            ? "All branches"
            : accessibleBranches.find((b) => b.id === id)?.name ?? "branch"
        setActiveBranch(id)
        toast.success(`Switched to ${target}`, {
            description: id === null
                ? "Aggregating data across every branch you can access."
                : "Orders, bills, menu, and reports are now scoped to this branch.",
        })
    }

    return (
        <BranchSwitcherView
            activeBranchId={activeBranchId}
            branches={accessibleBranches}
            canSwitch={canSwitch}
            onSelect={selectWithFeedback}
        />
    )
}

/**
 * Pure presentational version — no Supabase, no hook. Same rules as the
 * smart wrapper (hide for <2 branches, hide for non-admins). Used by the
 * Storybook story so we can render every state in isolation.
 */
export function BranchSwitcherView({
    activeBranchId, branches, canSwitch, onSelect,
}: {
    activeBranchId: string | null
    branches: Branch[]
    canSwitch: boolean
    onSelect: (id: string | null) => void
}) {
    if (branches.length < 2) return null
    if (!canSwitch) return null

    const active = branches.find((b) => b.id === activeBranchId) ?? null
    const label = active ? active.name : "All branches"

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-8 max-w-[180px]">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{label}</span>
                    <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Switch branch
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onSelect(null)} className="gap-2">
                    <span className={cn("h-4 w-4 grid place-items-center", activeBranchId === null && "text-primary")}>
                        {activeBranchId === null && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className="flex-1">All branches</span>
                    <span className="text-[10px] text-muted-foreground">aggregate view</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {branches.map((b) => (
                    <DropdownMenuItem key={b.id} onClick={() => onSelect(b.id)} className="gap-2">
                        <span className={cn("h-4 w-4 grid place-items-center", activeBranchId === b.id && "text-primary")}>
                            {activeBranchId === b.id && <Check className="h-3.5 w-3.5" />}
                        </span>
                        <span className="flex-1 truncate">{b.name}</span>
                        {b.is_main && <span className="text-[10px] text-muted-foreground">main</span>}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
