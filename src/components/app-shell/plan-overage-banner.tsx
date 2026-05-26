"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Lock, X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Plan-overage banner — mounted in the authenticated app layout for
 * OWNERs only. Renders when the tenant's plan caps are being exceeded by
 * the current data (more branches than the plan covers, or more staff in
 * a branch than the plan covers).
 *
 *   "2 branches and 5 staff seats are over your plan. Upgrade →"
 *
 * The locked accounts can't sign in until the owner either picks a
 * higher tier or removes the extras. Banner is dismissible per session
 * but reappears on next login.
 *
 * Data comes from /api/billing/plan-overage which wraps the SQL
 * `plan_overage(uuid)` RPC.
 */
interface OverageResponse {
    extra_branches: number
    extra_staff: number
    locked: boolean
    plan_tier: string | null
    max_branches: number | null
    max_staff_per_branch: number | null
}

const DISMISS_KEY = "restopos:plan-overage-dismissed"

export function PlanOverageBanner({ role }: { role: string }) {
    const [data, setData] = useState<OverageResponse | null>(null)
    const [dismissed, setDismissed] = useState(false)

    const isOwner = role === "OWNER"

    useEffect(() => {
        if (!isOwner) return
        ;(async () => {
            try {
                const { dedupedFetch } = await import("@/lib/fetch/deduped")
                const r = await dedupedFetch("/api/billing/plan-overage")
                if (!r.ok) return
                setData(await r.json() as OverageResponse)
            } catch { /* silent */ }
        })()
    }, [isOwner])

    useEffect(() => {
        if (typeof window === "undefined") return
        setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1")
    }, [])

    if (!isOwner || !data || !data.locked || dismissed) return null

    function dismiss() {
        if (typeof window === "undefined") return
        sessionStorage.setItem(DISMISS_KEY, "1")
        setDismissed(true)
    }

    const parts: string[] = []
    if (data.extra_branches > 0) {
        parts.push(`${data.extra_branches} outlet${data.extra_branches === 1 ? "" : "s"}`)
    }
    if (data.extra_staff > 0) {
        parts.push(`${data.extra_staff} staff seat${data.extra_staff === 1 ? "" : "s"}`)
    }
    const subject = parts.join(" and ")

    return (
        <div className={cn(
            "no-print border-b border-warning/40 bg-warning/10 px-4 py-2.5 flex items-center gap-3 text-sm",
        )}>
            <Lock className="h-4 w-4 shrink-0 text-warning" />
            <div className="flex-1 min-w-0">
                <span className="font-semibold">{subject} locked out by your plan.</span>
                <span className="text-muted-foreground ml-2">
                    Upgrade to restore access — nothing has been deleted.
                </span>
            </div>
            <Link
                href="/settings/billing"
                className="inline-flex items-center gap-1 rounded-md bg-warning px-3 py-1 text-xs font-medium text-warning-foreground hover:bg-warning/90 shrink-0 transition-colors"
            >
                Upgrade plan <ArrowRight className="h-3 w-3" />
            </Link>
            <button
                type="button"
                onClick={dismiss}
                aria-label="Dismiss"
                className="text-muted-foreground hover:text-foreground h-6 w-6 grid place-items-center shrink-0"
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    )
}
