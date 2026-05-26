import type { Meta, StoryObj } from "@storybook/react-vite"
import { AlertCircle, Pencil, Users } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * Storybook reference for the **reservation card** pattern used on the
 * Reservations page (`/reservations`). It's not a standalone component
 * today — the JSX lives inline in `src/app/(app)/reservations/page.tsx`.
 * This story documents every visual state so designers can iterate the
 * card pattern without spinning up the live page.
 */
interface ReservationCardProps {
    customer_name: string
    customer_phone?: string | null
    party_size: number
    duration_minutes: number
    reserved_at: string                 // formatted display string
    table_label?: string | null         // "Table 3" or null
    status: "PENDING" | "CONFIRMED" | "SEATED" | "COMPLETED" | "CANCELLED" | "NO_SHOW"
    special_requests?: string | null
    overdue?: boolean
    creator_name?: string | null
}

function ReservationCard(p: ReservationCardProps) {
    const editable = !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(p.status)
    return (
        <Card className={cn("max-w-md", p.overdue && "border-warning/60")}>
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <CardTitle className="text-base truncate">{p.customer_name}</CardTitle>
                        <p className="text-sm text-muted-foreground">{p.reserved_at}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        {editable && (
                            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Edit">
                                <Pencil className="h-3.5 w-3.5" />
                            </Button>
                        )}
                        <Badge variant={
                            p.status === "CONFIRMED" ? "success" :
                            p.status === "PENDING" ? "warning" :
                            p.status === "CANCELLED" || p.status === "NO_SHOW" ? "destructive" :
                            "secondary"
                        }>
                            {p.status}
                        </Badge>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-3 text-muted-foreground">
                    <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {p.party_size}</span>
                    {p.table_label && <span>· {p.table_label}</span>}
                    <span>· {p.duration_minutes}m</span>
                </div>
                {p.customer_phone && <div className="text-muted-foreground">{p.customer_phone}</div>}
                {p.special_requests && (
                    <div className="text-xs italic">&ldquo;{p.special_requests}&rdquo;</div>
                )}
                {p.overdue && (
                    <div className="rounded-md bg-warning/10 border border-warning/40 px-2.5 py-2 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-warning">
                            <AlertCircle className="h-3.5 w-3.5" />
                            Reservation time has passed — did the guest arrive?
                        </div>
                        <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="outline">Mark arrived</Button>
                            <Button size="sm" variant="outline">Arrived &amp; complete</Button>
                            <Button size="sm" variant="ghost" className="text-destructive">No-show</Button>
                        </div>
                    </div>
                )}
                <div className="flex flex-wrap gap-1 pt-1">
                    {p.status === "CONFIRMED" && !p.overdue && (
                        <Button size="sm" variant="outline">Mark arrived</Button>
                    )}
                    {p.status === "SEATED" && (
                        <Button size="sm" variant="outline">Complete</Button>
                    )}
                    {!["CANCELLED", "COMPLETED", "NO_SHOW"].includes(p.status) && !p.overdue && (
                        <Button size="sm" variant="ghost" className="text-destructive">Cancel</Button>
                    )}
                </div>
                {p.creator_name && (
                    <div className="text-[10px] text-muted-foreground pt-1">
                        Booked by {p.creator_name}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

const meta = {
    title: "Reservations/Reservation Card",
    component: ReservationCard,
    tags: ["autodocs"],
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "Visual reference for the reservation card used on `/reservations`. Each booking renders as a card with customer, party size, time, status badge, and contextual quick-action buttons. Overdue bookings (15+ minutes past reserved time, still CONFIRMED) get a yellow prompt strip with arrived / no-show / complete shortcuts.",
            },
        },
    },
} satisfies Meta<typeof ReservationCard>
export default meta
type Story = StoryObj<typeof meta>

const TIME_TODAY = new Date(Date.now() + 60 * 60 * 1000).toLocaleString("en-IN", {
    weekday: "short", hour: "numeric", minute: "2-digit", hour12: true,
})

export const Confirmed: Story = {
    args: {
        customer_name: "Priya Sharma",
        customer_phone: "+91 90000 11122",
        party_size: 4,
        duration_minutes: 90,
        reserved_at: TIME_TODAY,
        table_label: "Table T3",
        status: "CONFIRMED",
        creator_name: "Karan",
    },
}

export const Pending: Story = {
    args: {
        customer_name: "Walk-in caller",
        customer_phone: "+91 98000 22334",
        party_size: 2,
        duration_minutes: 60,
        reserved_at: TIME_TODAY,
        table_label: null,
        status: "PENDING",
        special_requests: "Window seat if possible",
    },
}

export const Overdue: Story = {
    args: {
        customer_name: "Rohit Mehta",
        customer_phone: "+91 91111 22233",
        party_size: 6,
        duration_minutes: 120,
        reserved_at: "Fri, 7:30 PM (35 min ago)",
        table_label: "Table T6",
        status: "CONFIRMED",
        overdue: true,
    },
}

export const Seated: Story = {
    args: {
        customer_name: "Aarav Iyer",
        party_size: 3,
        duration_minutes: 90,
        reserved_at: "Sat, 8:00 PM",
        table_label: "Table T5",
        status: "SEATED",
        creator_name: "Karan",
    },
}

export const Completed: Story = {
    args: {
        customer_name: "Anniversary — Singh family",
        party_size: 8,
        duration_minutes: 120,
        reserved_at: "Sat, 7:30 PM",
        table_label: "Table T1",
        status: "COMPLETED",
        special_requests: "Cake at 8:15 PM, no candles",
        creator_name: "Priya",
    },
}

export const NoShow: Story = {
    args: {
        customer_name: "Cancelled booking",
        party_size: 2,
        duration_minutes: 60,
        reserved_at: "Fri, 8:30 PM",
        table_label: null,
        status: "NO_SHOW",
    },
}
