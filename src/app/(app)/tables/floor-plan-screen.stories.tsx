import type { Meta, StoryObj } from "@storybook/react-vite"
import { Clock, Plus, Users } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * Screen-level twin of the floor plan page (`src/app/(app)/tables/page.tsx`).
 * The real page reads tables + their running-order link from Supabase and
 * lets the staff drill into an occupied table to add KOTs, run the bill,
 * or mark the table free. This story rebuilds the grid + one drilled-in
 * sheet so the color cues + drill-in surface can be reviewed visually.
 *
 *   AVAILABLE  → green
 *   OCCUPIED   → red (open order linked)
 *   RESERVED   → amber (party expected)
 *   DIRTY      → gray (between seatings)
 *   ON_HOLD    → orange (held for cleanup / a regular)
 */
type TableStatus = "AVAILABLE" | "OCCUPIED" | "RESERVED" | "DIRTY" | "ON_HOLD"

interface Tbl {
    number: string
    capacity: number
    section: string
    shape: "square" | "round" | "rectangle"
    status: TableStatus
    /** When OCCUPIED: minutes since the order opened. */
    occupiedFor?: number
    /** When OCCUPIED: running grand total. */
    runningTotal?: number
    /** When RESERVED: time of the booking. */
    reservedFor?: string
}

const TABLES: Tbl[] = [
    { number: "T1", capacity: 2, section: "Indoor", shape: "square", status: "AVAILABLE" },
    { number: "T2", capacity: 4, section: "Indoor", shape: "square", status: "OCCUPIED", occupiedFor: 32, runningTotal: 1240 },
    { number: "T3", capacity: 4, section: "Indoor", shape: "square", status: "OCCUPIED", occupiedFor: 78, runningTotal: 2480 },
    { number: "T4", capacity: 6, section: "Indoor", shape: "rectangle", status: "RESERVED", reservedFor: "8:00 PM" },
    { number: "T5", capacity: 2, section: "Patio", shape: "round", status: "AVAILABLE" },
    { number: "T6", capacity: 2, section: "Patio", shape: "round", status: "OCCUPIED", occupiedFor: 14, runningTotal: 540 },
    { number: "T7", capacity: 4, section: "Patio", shape: "square", status: "DIRTY" },
    { number: "T8", capacity: 8, section: "Patio", shape: "rectangle", status: "ON_HOLD" },
    { number: "P1", capacity: 2, section: "Private", shape: "square", status: "AVAILABLE" },
    { number: "P2", capacity: 8, section: "Private", shape: "rectangle", status: "OCCUPIED", occupiedFor: 110, runningTotal: 5640 },
]

const STATUS_COLOR: Record<TableStatus, string> = {
    AVAILABLE: "bg-success/15 text-success border-success/40",
    OCCUPIED: "bg-destructive/15 text-destructive border-destructive/40",
    RESERVED: "bg-warning/15 text-warning border-warning/40",
    DIRTY: "bg-muted/40 text-muted-foreground border-border",
    ON_HOLD: "bg-orange-500/15 text-orange-400 border-orange-500/40",
}
const STATUS_LABEL: Record<TableStatus, string> = {
    AVAILABLE: "Available", OCCUPIED: "Occupied", RESERVED: "Reserved", DIRTY: "Dirty", ON_HOLD: "On hold",
}

interface FloorPlanViewProps {
    tables: Tbl[]
    /** When set, opens the drill-in side sheet for that table. */
    drilledTableNumber?: string | null
}

function FloorPlanView({ tables, drilledTableNumber }: FloorPlanViewProps) {
    const sections = Array.from(new Set(tables.map((t) => t.section)))
    const drilled = tables.find((t) => t.number === drilledTableNumber) ?? null
    return (
        <div className="min-h-[800px] w-full bg-background text-foreground rounded-md border border-border/40 flex">
            {/* Main grid */}
            <div className="flex-1 min-w-0 p-5 space-y-5">
                {/* Toolbar */}
                <div className="flex items-center gap-3 flex-wrap">
                    <div>
                        <div className="text-xs uppercase tracking-wider text-muted-foreground">Floor plan</div>
                        <h1 className="text-xl font-bold">Tables</h1>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                        <LegendChip color="success" label="Available" />
                        <LegendChip color="destructive" label="Occupied" />
                        <LegendChip color="warning" label="Reserved" />
                        <Button variant="outline" size="sm"><Plus className="h-4 w-4" /> Add table</Button>
                    </div>
                </div>

                {/* By section */}
                {sections.map((section) => (
                    <div key={section}>
                        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">{section}</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                            {tables.filter((t) => t.section === section).map((t) => (
                                <TableTile key={t.number} t={t} highlighted={t.number === drilledTableNumber} />
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Drill-in sheet */}
            {drilled && (
                <div className="w-96 shrink-0 border-l border-border/40 p-4 space-y-4 bg-muted/10">
                    <div className="flex items-center gap-2">
                        <Badge className={cn("text-[10px]", STATUS_COLOR[drilled.status])}>{STATUS_LABEL[drilled.status]}</Badge>
                        <h2 className="text-lg font-semibold">Table {drilled.number}</h2>
                    </div>
                    {drilled.status === "OCCUPIED" ? (
                        <>
                            <div className="rounded-md border border-border/40 p-3 text-sm space-y-1">
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Open for</span>
                                    <span className="font-medium">{drilled.occupiedFor} min</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Running total</span>
                                    <span className="font-semibold tabular-nums">₹{drilled.runningTotal?.toFixed(2)}</span>
                                </div>
                            </div>
                            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Kitchen tickets</div>
                            {[1, 2, 3].map((n) => (
                                <Card key={n} className="p-2.5 text-sm space-y-1">
                                    <div className="flex items-center justify-between">
                                        <span className="font-mono text-xs">KOT #{410 + n}</span>
                                        <Badge variant={n === 3 ? "warning" : "success"} className="text-[10px]">
                                            {n === 3 ? "Cooking" : "Served"}
                                        </Badge>
                                    </div>
                                    <div className="text-xs text-muted-foreground">2 items · 8 min ago</div>
                                </Card>
                            ))}
                            <div className="space-y-2 pt-2">
                                <Button variant="outline" className="w-full">+ Add more items (new KOT)</Button>
                                <Button variant="neon" className="w-full">Checkout in POS</Button>
                                <Button variant="ghost" size="sm" className="w-full text-muted-foreground">Free table without billing</Button>
                            </div>
                        </>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            This table is currently {STATUS_LABEL[drilled.status].toLowerCase()}. Open the POS to take a new order at this table.
                        </p>
                    )}
                </div>
            )}
        </div>
    )
}

function TableTile({ t, highlighted }: { t: Tbl; highlighted: boolean }) {
    return (
        <Card className={cn(
            "p-3 cursor-pointer hover:shadow-md transition-all space-y-2 border-2",
            STATUS_COLOR[t.status],
            highlighted && "ring-2 ring-primary",
        )}>
            <div className="flex items-center justify-between">
                <span className="font-bold tabular-nums">{t.number}</span>
                <Badge variant="outline" className="text-[10px] border-current">
                    {STATUS_LABEL[t.status]}
                </Badge>
            </div>
            <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {t.capacity}</span>
                {t.occupiedFor != null && (
                    <span className="flex items-center gap-1 tabular-nums"><Clock className="h-3 w-3" /> {t.occupiedFor}m</span>
                )}
                {t.reservedFor && <span className="text-[10px]">{t.reservedFor}</span>}
            </div>
            {t.runningTotal != null && (
                <div className="text-sm font-semibold tabular-nums">₹{t.runningTotal.toFixed(0)}</div>
            )}
        </Card>
    )
}

function LegendChip({ color, label }: { color: "success" | "destructive" | "warning"; label: string }) {
    return (
        <span className="inline-flex items-center gap-1.5 text-[11px]">
            <span className={cn(
                "h-2.5 w-2.5 rounded-full",
                color === "success" && "bg-success",
                color === "destructive" && "bg-destructive",
                color === "warning" && "bg-warning",
            )} />
            <span className="text-muted-foreground">{label}</span>
        </span>
    )
}

const meta: Meta<typeof FloorPlanView> = {
    title: "Screens/Floor Plan",
    component: FloorPlanView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Floor plan / tables screen. Sectioned grid of tables color-coded by status. Tapping a table opens a drill-in sheet on the right; an OCCUPIED table shows the running order + every KOT, with one-tap actions to add another KOT, run checkout, or free the table. Real page reads from Supabase + subscribes to realtime so the colors flip as orders open / close in real time.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof FloorPlanView>

/** Mixed-state floor at peak dinner: a few occupied tables, one reserved,
 *  one dirty, one on hold. */
export const Default: Story = {
    args: { tables: TABLES, drilledTableNumber: null },
}

/** Same floor, table T3 drilled in — sheet shows the running order. */
export const TableDrilledIn: Story = {
    args: { tables: TABLES, drilledTableNumber: "T3" },
}

/** Quiet morning — everything available, dirty leftovers from last night. */
export const QuietMorning: Story = {
    args: {
        tables: TABLES.map((t) => ({
            ...t,
            status: t.status === "OCCUPIED" || t.status === "RESERVED" ? "AVAILABLE" : t.status,
            occupiedFor: undefined, runningTotal: undefined, reservedFor: undefined,
        })),
        drilledTableNumber: null,
    },
}
