import type { Meta, StoryObj } from "@storybook/react-vite"
import { Building2 } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Story-only twin of `BranchTransition`. The live component reads its
 * "switching" state from the `useActiveBranch()` hook, which Storybook
 * can't drive. Here we re-render the same overlay JSX with a static
 * `switching` boolean + `label` string so the visual can be inspected
 * frozen in either state.
 *
 * Real component: `src/components/app-shell/branch-transition.tsx`.
 */
interface BranchTransitionViewProps {
    /** When true, the overlay is fully opaque (visible). When false, it
     *  fades out via the opacity transition just like the real one. */
    switching: boolean
    /** What the pill announces — typically the branch name being switched
     *  TO. The hook resolves this from the branch row that's about to
     *  become active. */
    label: string
}

function BranchTransitionView({ switching, label }: BranchTransitionViewProps) {
    return (
        <div
            aria-hidden={!switching}
            className={cn(
                "fixed inset-0 z-[90] pointer-events-none transition-opacity duration-300",
                switching ? "opacity-100" : "opacity-0",
            )}
        >
            <div className="absolute inset-0 bg-background/30 backdrop-blur-[2px]" />
            <div className="absolute top-20 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-card/95 border border-border/60 shadow-lg px-4 py-2 text-sm">
                <Building2 className="h-4 w-4 text-primary" />
                <span className="text-muted-foreground">Switching to</span>
                <span className="font-semibold">{label}</span>
            </div>
        </div>
    )
}

const meta: Meta<typeof BranchTransitionView> = {
    title: "AppShell/BranchTransition",
    component: BranchTransitionView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Brief, full-viewport visual cue that fires whenever the active branch changes. Without it, the switch felt invisible — the dropdown closed, tables silently re-queried, and the admin had no anchor for \"yes, the app actually noticed my click.\" The overlay is `pointer-events-none` and dims the page for ~350ms while floating a \"Switching to <Branch>\" pill at top-center. Mounted once in the authenticated layout.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof BranchTransitionView>

/** Mid-switch — full opacity, pill visible. */
export const Switching: Story = {
    args: {
        switching: true,
        label: "Bandra Main",
    },
}

/** Switching back to the cross-branch view (admin only). */
export const SwitchingToAllBranches: Story = {
    args: {
        switching: true,
        label: "All branches",
    },
}

/** Idle state — fully transparent, no visible pill. Documents that the
 *  overlay isn't there to dim the page permanently; it only appears
 *  during a branch change. */
export const Idle: Story = {
    args: {
        switching: false,
        label: "Bandra Main",
    },
}
