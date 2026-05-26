import type { Meta, StoryObj } from "@storybook/react-vite"
import { AlertTriangle, CloudOff, RefreshCw, Wifi } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Storybook visual-only twin of the live `OfflineBanner`. The real
 * component owns side effects (Supabase, health probe, sync worker) that
 * don't make sense in a story; here we render each of its visual states
 * deterministically from props. Live component:
 * `src/components/app-shell/offline-banner.tsx`.
 */
function BannerView({
    online, pending, stuck,
}: { online: boolean; pending: number; stuck: number }) {
    return (
        <div
            className="flex items-center gap-2 px-2 py-1 rounded-md border text-xs"
            style={{
                borderColor: online ? "hsl(var(--success) / 0.4)" : "hsl(var(--warning) / 0.5)",
                background: online ? "hsl(var(--success) / 0.1)" : "hsl(var(--warning) / 0.1)",
            }}
        >
            {online
                ? <Wifi className="h-3.5 w-3.5 text-success" />
                : <CloudOff className="h-3.5 w-3.5 text-warning" />}
            <span className={cn("font-medium", online ? "text-success" : "text-warning")}>
                {online ? "Online" : "Offline — bills queued locally"}
            </span>
            {pending > 0 && (
                <Badge variant="warning" className="text-[10px] py-0">{pending} pending</Badge>
            )}
            {stuck > 0 && (
                <Badge variant="destructive" className="text-[10px] py-0">
                    <AlertTriangle className="h-3 w-3 mr-0.5" />
                    {stuck} stuck
                </Badge>
            )}
            {online && pending > 0 && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs">
                    <RefreshCw className="h-3 w-3" /> Sync now
                </Button>
            )}
        </div>
    )
}

const meta = {
    title: "AppShell/OfflineBanner",
    component: BannerView,
    tags: ["autodocs"],
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "Sits in the topbar. Tells the cashier whether the till can actually reach the server, how many bills are queued offline, whether any are stuck (failed after many retries), and offers a manual sync trigger when something's waiting.",
            },
        },
    },
} satisfies Meta<typeof BannerView>
export default meta
type Story = StoryObj<typeof meta>

/** Healthy + nothing queued — the live component returns null. We show
 *  the banner here only for visual reference. */
export const Online_Clean: Story = {
    args: { online: true, pending: 0, stuck: 0 },
    parameters: { docs: { description: { story: "In production this state renders nothing — banner hides until there's something to say." } } },
}

/** Network down — the most common abnormal state. */
export const Offline: Story = {
    args: { online: false, pending: 0, stuck: 0 },
}

/** Offline with bills accumulating in the local queue. */
export const Offline_WithPending: Story = {
    args: { online: false, pending: 3, stuck: 0 },
}

/** Came back online but the queue hasn't drained yet — sync button visible. */
export const Online_WithPending: Story = {
    args: { online: true, pending: 5, stuck: 0 },
}

/** Some bills have failed too many times — dead-letter state. */
export const Offline_WithStuck: Story = {
    args: { online: false, pending: 1, stuck: 2 },
    parameters: { docs: { description: { story: "Stuck bills are in dead-letter: they exhausted retries. Admin needs to open each bill detail to investigate." } } },
}

/** Worst case: offline, lots queued, some stuck. */
export const Offline_HighLoad: Story = {
    args: { online: false, pending: 12, stuck: 3 },
}
