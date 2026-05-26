import type { Meta, StoryObj } from "@storybook/react-vite"
import { AlertCircle, CalendarDays, Pencil, Plus, Users } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * Screen-level twin of the reservations page
 * (`src/app/(app)/reservations/page.tsx`). The component-level
 * `reservation-card.stories.tsx` already documents the individual card;
 * this story shows how the cards stack into the day-by-day view, with
 * the day picker on top, party-size + status filters, and an empty
 * state for quiet days.
 */
type ResStatus = "PENDING" | "CONFIRMED" | "SEATED" | "COMPLETED" | "CANCELLED" | "NO_SHOW"

interface Reservation {
    id: string
    customerName: string
    customerPhone?: string
    partySize: number
    reservedAt: string
    durationMin: number
    tableLabel?: string
    status: ResStatus
    specialRequests?: string
    overdue?: boolean
}

const RES: Reservation[] = [
    { id: "r1", customerName: "Priya Mehta", customerPhone: "+91 98XX XX1212", partySize: 4, reservedAt: "12:30 PM", durationMin: 90, tableLabel: "Table 4", status: "CONFIRMED", specialRequests: "Window seat if possible" },
    { id: "r2", customerName: "Vikram Kapoor", partySize: 2, reservedAt: "1:00 PM", durationMin: 60, tableLabel: "Table 5", status: "SEATED" },
    { id: "r3", customerName: "Anita Sharma", partySize: 6, reservedAt: "1:30 PM", durationMin: 120, tableLabel: "Table 8", status: "PENDING", overdue: true },
    { id: "r4", customerName: "Walk-in (called)", customerPhone: "+91 99XX XX3411", partySize: 3, reservedAt: "7:30 PM", durationMin: 90, status: "CONFIRMED" },
    { id: "r5", customerName: "Tarun Iyer", partySize: 8, reservedAt: "8:00 PM", durationMin: 120, tableLabel: "Table 10", status: "CONFIRMED", specialRequests: "Birthday — pls bring out cake at 9:15" },
    { id: "r6", customerName: "Rohit M.", partySize: 2, reservedAt: "9:00 PM", durationMin: 60, status: "COMPLETED" },
]

interface ReservationsViewProps {
    date: string
    reservations: Reservation[]
    /** Filter chip — narrows the rendered list. */
    statusFilter: "ALL" | ResStatus
}

function ReservationsView({ date, reservations, statusFilter }: ReservationsViewProps) {
    const visible = statusFilter === "ALL" ? reservations : reservations.filter((r) => r.status === statusFilter)
    const counts = {
        ALL: reservations.length,
        PENDING: reservations.filter((r) => r.status === "PENDING").length,
        CONFIRMED: reservations.filter((r) => r.status === "CONFIRMED").length,
        SEATED: reservations.filter((r) => r.status === "SEATED").length,
    }

    return (
        <div className="min-h-[800px] w-full bg-background text-foreground rounded-md border border-border/40 p-5 space-y-4">
            {/* Header */}
            <div className="flex items-center gap-3 flex-wrap">
                <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Manage</div>
                    <h1 className="text-xl font-bold">Reservations</h1>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <div className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-1.5 text-sm">
                        <CalendarDays className="h-4 w-4 text-primary" />
                        <span className="font-medium">{date}</span>
                    </div>
                    <Button variant="neon" size="sm"><Plus className="h-4 w-4" /> New reservation</Button>
                </div>
            </div>

            {/* Filter chips */}
            <div className="flex items-center gap-2">
                {(["ALL", "PENDING", "CONFIRMED", "SEATED"] as const).map((s) => (
                    <button key={s} className={cn(
                        "px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5",
                        s === statusFilter ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground",
                    )}>
                        {s === "ALL" ? "All" : s}
                        <Badge variant={s === statusFilter ? "outline" : "secondary"} className="text-[10px]">
                            {counts[s]}
                        </Badge>
                    </button>
                ))}
            </div>

            {/* Reservation grid */}
            {visible.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 p-12 text-center">
                    <CalendarDays className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                    <div className="font-semibold mb-1">No reservations</div>
                    <p className="text-sm text-muted-foreground">Nothing booked for this day yet.</p>
                </div>
            ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {visible.map((r) => <ReservationCard key={r.id} r={r} />)}
                </div>
            )}
        </div>
    )
}

function ReservationCard({ r }: { r: Reservation }) {
    const editable = !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(r.status)
    return (
        <Card className={cn(r.overdue && "border-warning/60")}>
            <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="font-semibold leading-tight truncate">{r.customerName}</div>
                        <div className="text-sm text-muted-foreground">{r.reservedAt}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        {editable && (
                            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Edit">
                                <Pencil className="h-3.5 w-3.5" />
                            </Button>
                        )}
                        <Badge variant={
                            r.status === "CONFIRMED" ? "success" :
                            r.status === "PENDING" ? "warning" :
                            r.status === "SEATED" ? "default" :
                            r.status === "CANCELLED" || r.status === "NO_SHOW" ? "destructive" :
                            "secondary"
                        } className="text-[10px]">
                            {r.status}
                        </Badge>
                    </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {r.partySize}</span>
                    {r.tableLabel && <span>· {r.tableLabel}</span>}
                    <span>· {r.durationMin}m</span>
                    {r.customerPhone && <span className="font-mono text-[10px] ml-auto">{r.customerPhone}</span>}
                </div>
                {r.specialRequests && (
                    <div className="text-xs italic text-amber-500 border-t border-border/30 pt-2">⤷ {r.specialRequests}</div>
                )}
                {r.overdue && (
                    <div className="flex items-center gap-1 text-[11px] text-warning">
                        <AlertCircle className="h-3 w-3" /> Pending confirmation overdue
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

const meta: Meta<typeof ReservationsView> = {
    title: "Screens/Reservations",
    component: ReservationsView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Reservations page (`/reservations`). Day picker on top, filter chips below, then a grid of reservation cards. Status flow: PENDING → CONFIRMED → SEATED → COMPLETED (or CANCELLED / NO_SHOW). Overdue PENDING reservations highlight in amber so the host knows to call back. The card pattern itself is documented in `reservation-card.stories.tsx`; this story shows how they stack across a day.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof ReservationsView>

/** Busy Friday — every status represented. */
export const Default: Story = {
    args: { date: "Friday, May 23", reservations: RES, statusFilter: "ALL" },
}

/** Filter narrowed to PENDING — host's "who still needs a callback" view. */
export const PendingOnly: Story = {
    args: { date: "Friday, May 23", reservations: RES, statusFilter: "PENDING" },
}

/** Quiet Tuesday — empty state. */
export const NoReservations: Story = {
    args: { date: "Tuesday, May 27", reservations: [], statusFilter: "ALL" },
}
