import type { Meta, StoryObj } from "@storybook/react-vite"
import { Bell, ChefHat, Clock } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * Screen-level twin of the KDS (`src/app/(app)/kds/page.tsx`). The real
 * page subscribes to Supabase Realtime on the `kots` table and flips a
 * KOT through PENDING → PREPARING → READY → SERVED as cooks tap the action
 * buttons. This story rebuilds the same grid from static fixtures so the
 * visual urgency cues + status accents can be iterated on.
 *
 * Each card displays:
 *   - KOT number + batch sequence (the Nth KOT on a given order)
 *   - Source (DINE_IN with table, TAKEAWAY, QR with table, DELIVERY)
 *   - Item list with quantities + cook notes
 *   - Age (in minutes) — color flips amber after 5 min, red after 10
 *   - Per-status action button (Start preparing → Mark ready → Mark served)
 */
type KotStatus = "PENDING" | "PREPARING" | "READY" | "SERVED"

interface KotCard {
    kotNumber: number
    batchSeq: number
    source: "DINE_IN" | "TAKEAWAY" | "QR" | "DELIVERY"
    tableNo?: string
    items: { name: string; qty: number; note?: string }[]
    minutesAgo: number
    status: KotStatus
    waiter?: string
}

const KOTS: KotCard[] = [
    {
        kotNumber: 412, batchSeq: 1, source: "DINE_IN", tableNo: "T3",
        items: [
            { name: "Paneer Tikka", qty: 2, note: "Less spicy" },
            { name: "Garlic Naan", qty: 4 },
            { name: "Dal Makhani", qty: 1 },
        ],
        minutesAgo: 2, status: "PENDING", waiter: "Riya",
    },
    {
        kotNumber: 413, batchSeq: 2, source: "DINE_IN", tableNo: "T7",
        items: [
            { name: "Chicken 65", qty: 1 },
            { name: "Hyderabadi Biryani", qty: 1, note: "Extra raita" },
        ],
        minutesAgo: 6, status: "PREPARING", waiter: "Akash",
    },
    {
        kotNumber: 414, batchSeq: 1, source: "QR", tableNo: "T12",
        items: [
            { name: "Margherita Pizza", qty: 1 },
            { name: "Iced Latte", qty: 2 },
        ],
        minutesAgo: 11, status: "PREPARING",
    },
    {
        kotNumber: 415, batchSeq: 1, source: "TAKEAWAY",
        items: [
            { name: "Butter Naan", qty: 6 },
            { name: "Paneer Tikka", qty: 1 },
        ],
        minutesAgo: 4, status: "READY", waiter: "Mehul",
    },
    {
        kotNumber: 416, batchSeq: 3, source: "DINE_IN", tableNo: "T3",
        items: [
            { name: "Gulab Jamun", qty: 2 },
            { name: "Coke 500ml", qty: 2 },
        ],
        minutesAgo: 17, status: "PENDING", waiter: "Riya",
    },
    {
        kotNumber: 417, batchSeq: 1, source: "DELIVERY",
        items: [
            { name: "Caesar Salad", qty: 1 },
            { name: "Pasta Arrabbiata", qty: 1 },
        ],
        minutesAgo: 3, status: "READY",
    },
]

const STATUS_BG: Record<KotStatus, string> = {
    PENDING: "border-warning/50 bg-warning/[0.06]",
    PREPARING: "border-primary/50 bg-primary/[0.06]",
    READY: "border-success/50 bg-success/[0.06]",
    SERVED: "border-border/30 bg-muted/30 opacity-60",
}
const STATUS_LABEL: Record<KotStatus, string> = {
    PENDING: "Pending", PREPARING: "Preparing", READY: "Ready", SERVED: "Served",
}
const STATUS_ACCENT: Record<KotStatus, "warning" | "default" | "success" | "secondary"> = {
    PENDING: "warning", PREPARING: "default", READY: "success", SERVED: "secondary",
}
const NEXT_ACTION: Record<KotStatus, string | null> = {
    PENDING: "Start preparing",
    PREPARING: "Mark ready",
    READY: "Mark served",
    SERVED: null,
}

function ageAccent(min: number) {
    if (min > 10) return "text-destructive"
    if (min > 5) return "text-warning"
    return "text-muted-foreground"
}

interface KdsScreenViewProps {
    kots: KotCard[]
    /** Filter chip currently active — drives the section header text. */
    activeFilter: "ALL" | "PENDING" | "PREPARING" | "READY"
}

function KdsScreenView({ kots, activeFilter }: KdsScreenViewProps) {
    const visible = activeFilter === "ALL" ? kots : kots.filter((k) => k.status === activeFilter)
    return (
        <div className="min-h-[800px] w-full bg-background text-foreground rounded-md border border-border/40 flex flex-col">
            {/* Header */}
            <div className="px-5 py-4 border-b border-border/40 flex items-center gap-3">
                <span className="grid place-items-center h-10 w-10 rounded-lg bg-gradient-to-br from-primary/25 to-[hsl(var(--neon-magenta)/0.2)]">
                    <ChefHat className="h-5 w-5 text-primary" />
                </span>
                <div>
                    <div className="text-lg font-bold">Kitchen display</div>
                    <div className="text-xs text-muted-foreground">{visible.length} active KOTs</div>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    {(["ALL", "PENDING", "PREPARING", "READY"] as const).map((f) => (
                        <button
                            key={f}
                            className={cn(
                                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                                f === activeFilter ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {f === "ALL" ? "All" : STATUS_LABEL[f as KotStatus]}
                        </button>
                    ))}
                </div>
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-y-auto p-4">
                {visible.length === 0 ? (
                    <div className="grid place-items-center py-20 text-sm text-muted-foreground">
                        <Bell className="h-8 w-8 text-muted-foreground/40 mb-2" />
                        No active KOTs. Newly sent kitchen tickets land here in real time.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {visible.map((k) => (
                            <KotCardView key={k.kotNumber} k={k} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

function KotCardView({ k }: { k: KotCard }) {
    const sourceLabel = k.source === "DINE_IN" ? `Table ${k.tableNo}` : k.source === "QR" ? `QR · T${k.tableNo}` : k.source
    const action = NEXT_ACTION[k.status]
    return (
        <Card className={cn("p-3 space-y-2 border-2", STATUS_BG[k.status])}>
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-bold text-base">#{k.kotNumber}</span>
                    <span className="text-[10px] text-muted-foreground">batch {k.batchSeq}</span>
                </div>
                <Badge variant={STATUS_ACCENT[k.status]} className="text-[10px]">
                    {STATUS_LABEL[k.status]}
                </Badge>
            </div>
            <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{sourceLabel}</span>
                <span className={cn("flex items-center gap-1 tabular-nums", ageAccent(k.minutesAgo))}>
                    <Clock className="h-3 w-3" /> {k.minutesAgo} min
                </span>
            </div>
            <div className="rounded-md border border-border/40 divide-y divide-border/30 text-sm">
                {k.items.map((it, i) => (
                    <div key={i} className="px-2 py-1.5 flex items-start gap-2">
                        <span className="font-mono text-xs text-muted-foreground shrink-0 pt-0.5">{it.qty}×</span>
                        <div className="flex-1 min-w-0">
                            <div className="font-medium leading-tight truncate">{it.name}</div>
                            {it.note && <div className="text-[11px] italic text-amber-500 truncate">⤷ {it.note}</div>}
                        </div>
                    </div>
                ))}
            </div>
            {k.waiter && (
                <div className="text-[11px] text-muted-foreground">Waiter: {k.waiter}</div>
            )}
            {action && (
                <Button
                    variant={k.status === "READY" ? "success" : "neon"}
                    size="sm"
                    className="w-full"
                >
                    {action}
                </Button>
            )}
        </Card>
    )
}

const meta: Meta<typeof KdsScreenView> = {
    title: "Screens/KDS",
    component: KdsScreenView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Kitchen Display Screen — the cook's surface. Mounts in kiosk mode (no sidebar) and listens to Supabase Realtime on the `kots` + `order_items` tables. New KOTs slide in as soon as the cashier hits Send KOT; the card flips through PENDING → PREPARING → READY → SERVED as the cook taps the action button. Cards age into amber after 5 minutes and red after 10 — the urgency cue is the difference between hot food and cold complaints. The four filter pills at top let the kitchen narrow to a single status; ALL stays the default in practice. Once SERVED or CANCELLED, the card disappears (no history view on the KDS by design — closed orders are on /sales).",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof KdsScreenView>

/** Active mid-lunch state with all statuses represented + one overdue KOT. */
export const Default: Story = {
    args: { kots: KOTS, activeFilter: "ALL" },
}

/** "Preparing" filter active — only KOTs in progress visible. Helps the cook
 *  focus when there's a long queue. */
export const PreparingOnly: Story = {
    args: { kots: KOTS, activeFilter: "PREPARING" },
}

/** Quiet kitchen — no active KOTs (between rushes). The empty-state hint
 *  documents what cooks see at slow hours. */
export const Empty: Story = {
    args: { kots: [], activeFilter: "ALL" },
}
