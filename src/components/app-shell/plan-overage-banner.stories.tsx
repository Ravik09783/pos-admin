import type { Meta, StoryObj } from "@storybook/react-vite"
import Link from "next/link"
import { ArrowRight, Lock, X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Story-only twin of `PlanOverageBanner`. The live component fetches
 * `/api/billing/plan-overage` inside `useEffect`, which Storybook can't
 * resolve. Here we re-render the same banner JSX from static counts so
 * designers can iterate the wording for each overage shape (only extra
 * branches, only extra staff, or both).
 *
 * Real component: `src/components/app-shell/plan-overage-banner.tsx`.
 */
interface PlanOverageBannerViewProps {
    /** Number of branches past the plan cap that are currently locked. */
    extraBranches: number
    /** Number of staff seats past the per-branch cap that are currently locked. */
    extraStaff: number
}

function PlanOverageBannerView({ extraBranches, extraStaff }: PlanOverageBannerViewProps) {
    if (extraBranches === 0 && extraStaff === 0) return null

    const parts: string[] = []
    if (extraBranches > 0) {
        parts.push(`${extraBranches} outlet${extraBranches === 1 ? "" : "s"}`)
    }
    if (extraStaff > 0) {
        parts.push(`${extraStaff} staff seat${extraStaff === 1 ? "" : "s"}`)
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
                aria-label="Dismiss"
                className="text-muted-foreground hover:text-foreground h-6 w-6 grid place-items-center shrink-0"
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    )
}

const meta: Meta<typeof PlanOverageBannerView> = {
    title: "AppShell/PlanOverageBanner",
    component: PlanOverageBannerView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "OWNER-only banner that surfaces when the tenant's current plan tier doesn't cover the data they have: more outlets than the cap allows, more staff seats per outlet than the cap allows, or both. The locked accounts (extra branches' staff, or per-branch extras) can't sign in until the owner upgrades. Non-OWNER roles see nothing; the locked accounts themselves land on `/locked`. Real component reads `/api/billing/plan-overage`; this story stubs the response statically. Renders nothing when both counts are zero — the `Hidden` story documents that path.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof PlanOverageBannerView>

/** Within plan limits — banner renders nothing. Documents the empty state
 *  so design reviewers don't miss that it's intentional silence rather
 *  than a bug. */
export const Hidden: Story = {
    args: {
        extraBranches: 0,
        extraStaff: 0,
    },
}

/** Owner downgraded from Growth to Starter (3 outlets → 1). The two newer
 *  outlets and every staff seat in them get locked. */
export const OneOutletOver: Story = {
    args: {
        extraBranches: 1,
        extraStaff: 0,
    },
}

/** Multiple outlets past the cap — pluralized copy. */
export const MultipleOutletsOver: Story = {
    args: {
        extraBranches: 4,
        extraStaff: 0,
    },
}

/** Within the outlet cap but over the per-outlet staff cap. Typical when
 *  a Growth tenant downgrades to Starter (1 staff/outlet) — every
 *  non-OWNER seat in every branch becomes "extra". */
export const StaffSeatsOver: Story = {
    args: {
        extraBranches: 0,
        extraStaff: 7,
    },
}

/** Both axes over at once — the wording combines them with "and". */
export const BothOver: Story = {
    args: {
        extraBranches: 2,
        extraStaff: 5,
    },
}

/** Edge: exactly one of each, so singular forms (no plural "s"). */
export const SingularBoth: Story = {
    args: {
        extraBranches: 1,
        extraStaff: 1,
    },
}
