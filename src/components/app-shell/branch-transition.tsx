"use client"

import { Building2 } from "lucide-react"

import { useActiveBranch } from "@/lib/branch/active-branch"
import { cn } from "@/lib/utils"

/**
 * Brief, full-viewport visual cue that fires whenever the active branch
 * changes. Without it the switch felt invisible — the dropdown closed,
 * tables silently re-queried, and the admin had no anchor for "yes, the
 * app actually noticed my click."
 *
 * The overlay is `pointer-events-none` so it never blocks input; it just
 * dims the page for ~350ms and floats a "Switching to <Branch>" pill in
 * the top-center. The hook clears `switching` automatically.
 *
 * Mount this once inside the authenticated app layout — it sits as a
 * fixed sibling above <main>.
 */
export function BranchTransition() {
    const { switching, activeBranch, activeBranchId } = useActiveBranch()
    const label = activeBranch?.name ?? (activeBranchId === null ? "All branches" : null)
    return (
        <div
            aria-hidden={!switching}
            className={cn(
                "fixed inset-0 z-[90] pointer-events-none transition-opacity duration-300",
                switching ? "opacity-100" : "opacity-0",
            )}
        >
            <div className="absolute inset-0 bg-background/30 backdrop-blur-[2px]" />
            <div className="absolute top-20 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-card/95 border border-border/60 shadow-lg px-4 py-2 text-sm animate-in fade-in slide-in-from-top-2 duration-200">
                <Building2 className="h-4 w-4 text-primary" />
                <span className="text-muted-foreground">Switching to</span>
                <span className="font-semibold">{label ?? "…"}</span>
            </div>
        </div>
    )
}
