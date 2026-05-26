import type { Meta, StoryObj } from "@storybook/react-vite"
import { AlertTriangle, History, Pause, Play, Plus, QrCode, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

/**
 * Screen-level twin of the inventory page
 * (`src/app/(app)/inventory/page.tsx`). The real page renders a stock-
 * item list (per SKU), lets the operator open a batch dialog to record
 * receipts, and opens a per-item history sheet on the right. This story
 * freezes the visual at three states: default list, batch-add dialog
 * open, and the per-item history sheet open.
 */
type Stock = {
    sku: string
    name: string
    barcode?: string
    onHand: number
    reorderAt: number
    unit: string
    hsn?: string
    paused?: boolean
    note?: string
}

const STOCKS: Stock[] = [
    { sku: "ING-001", name: "Paneer (1kg)", barcode: "8901234567891", onHand: 12, reorderAt: 5, unit: "kg", hsn: "0406" },
    { sku: "ING-002", name: "Tomato Ketchup (1L)", barcode: "8901234567892", onHand: 3, reorderAt: 10, unit: "L", hsn: "2103", paused: true, note: "Stopped — switching to Maggi brand" },
    { sku: "ING-003", name: "Basmati Rice", onHand: 28, reorderAt: 15, unit: "kg", hsn: "1006" },
    { sku: "ING-004", name: "Chicken (raw)", onHand: 0, reorderAt: 8, unit: "kg", hsn: "0207" },
    { sku: "ING-005", name: "Onions", onHand: 22, reorderAt: 10, unit: "kg", hsn: "0703" },
    { sku: "ING-006", name: "Garlic Naan dough", onHand: 6, reorderAt: 5, unit: "kg", hsn: "1905" },
]

interface InventoryViewProps {
    rows: Stock[]
    /** Drives which overlay is open. */
    overlay: "none" | "batch-add" | "history"
    /** When overlay = history, which row's history is shown. */
    historySku?: string
}

function InventoryView({ rows, overlay, historySku }: InventoryViewProps) {
    const lowCount = rows.filter((r) => r.onHand <= r.reorderAt).length
    const historyRow = rows.find((r) => r.sku === historySku) ?? null

    return (
        <div className="min-h-[800px] w-full bg-background text-foreground rounded-md border border-border/40 p-5 space-y-4 relative">
            {/* Header */}
            <div className="flex items-center gap-3 flex-wrap">
                <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Operations</div>
                    <h1 className="text-xl font-bold">Inventory</h1>
                </div>
                {lowCount > 0 && (
                    <Badge variant="warning" className="text-[10px]">
                        <AlertTriangle className="h-3 w-3" /> {lowCount} item{lowCount > 1 ? "s" : ""} below reorder
                    </Badge>
                )}
                <div className="ml-auto flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Search SKU / name" className="pl-8 w-56" />
                    </div>
                    <Button variant="outline" size="sm"><QrCode className="h-4 w-4" /> Scan barcode</Button>
                    <Button variant="neon" size="sm"><Plus className="h-4 w-4" /> Record batch</Button>
                </div>
            </div>

            {/* Table */}
            <div className={cn("rounded-lg border border-border/40 overflow-hidden", overlay === "history" && "lg:mr-96")}>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>SKU</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>On hand</TableHead>
                            <TableHead>Reorder at</TableHead>
                            <TableHead>HSN</TableHead>
                            <TableHead></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((r) => {
                            const low = r.onHand <= r.reorderAt
                            const out = r.onHand === 0
                            return (
                                <TableRow key={r.sku} className={cn(r.paused && "opacity-50")}>
                                    <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">{r.name}</span>
                                            {r.paused && <Badge variant="secondary" className="text-[10px]">Paused</Badge>}
                                        </div>
                                        {r.barcode && <div className="text-[10px] font-mono text-muted-foreground">{r.barcode}</div>}
                                    </TableCell>
                                    <TableCell className={cn(
                                        "font-semibold tabular-nums",
                                        out && "text-destructive",
                                        low && !out && "text-warning",
                                    )}>
                                        {r.onHand} {r.unit}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground tabular-nums">{r.reorderAt} {r.unit}</TableCell>
                                    <TableCell className="text-xs font-mono text-muted-foreground">{r.hsn ?? "—"}</TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1">
                                            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="History">
                                                <History className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={r.paused ? "Resume" : "Pause"}>
                                                {r.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            </div>

            {/* Batch-add dialog overlay */}
            {overlay === "batch-add" && (
                <div className="absolute inset-x-0 top-20 max-w-2xl mx-auto bg-card border border-border/60 rounded-xl shadow-2xl p-5 space-y-3 z-10">
                    <div className="font-semibold">Record new batch</div>
                    <p className="text-xs text-muted-foreground">Add multiple SKUs in one batch. Verification is required from a second user (audit trail).</p>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>SKU</TableHead><TableHead>Quantity</TableHead><TableHead>Unit cost</TableHead><TableHead>Expiry</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {[1, 2, 3].map((n) => (
                                <TableRow key={n}>
                                    <TableCell><Input className="h-8" placeholder="ING-XXX" /></TableCell>
                                    <TableCell><Input className="h-8 w-24" placeholder="0" inputMode="decimal" /></TableCell>
                                    <TableCell><Input className="h-8 w-24" placeholder="₹" /></TableCell>
                                    <TableCell><Input className="h-8 w-32" placeholder="2026-08-30" /></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    <div className="flex items-center justify-end gap-2 pt-2">
                        <Button variant="ghost" size="sm">Cancel</Button>
                        <Button variant="neon" size="sm">Save &amp; request verification</Button>
                    </div>
                </div>
            )}

            {/* Per-item history sheet (right side) */}
            {overlay === "history" && historyRow && (
                <div className="absolute top-5 right-5 bottom-5 w-96 bg-card border border-border/60 rounded-xl shadow-2xl p-4 space-y-3 overflow-y-auto z-10">
                    <div>
                        <div className="text-xs uppercase tracking-wider text-muted-foreground">SKU</div>
                        <div className="font-mono text-xs">{historyRow.sku}</div>
                        <div className="font-semibold text-base mt-1">{historyRow.name}</div>
                    </div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Recent movements</div>
                    {([
                        { type: "BATCH_IN", qty: 10, when: "Today, 09:14", by: "Vendor delivery · verified by Riya" },
                        { type: "ADJUSTMENT", qty: -2.5, when: "Today, 12:38", by: "Riya · 'manual deduction, kitchen usage'" },
                        { type: "WASTE", qty: -0.5, when: "Yesterday", by: "Riya · 'spoiled, refrigeration fault'" },
                        { type: "BATCH_IN", qty: 5, when: "2 days ago", by: "Vendor delivery · verified by Akash" },
                    ]).map((m, i) => (
                        <div key={i} className="rounded-md border border-border/40 p-2.5 text-xs space-y-0.5">
                            <div className="flex items-center justify-between">
                                <Badge variant={m.qty > 0 ? "success" : "destructive"} className="text-[10px]">
                                    {m.type.replace("_", " ")}
                                </Badge>
                                <span className={cn("font-mono font-semibold tabular-nums", m.qty > 0 ? "text-success" : "text-destructive")}>
                                    {m.qty > 0 ? "+" : ""}{m.qty} {historyRow.unit}
                                </span>
                            </div>
                            <div className="text-muted-foreground">{m.when}</div>
                            <div className="text-[10px] text-muted-foreground">{m.by}</div>
                        </div>
                    ))}
                    <Button variant="outline" size="sm" className="w-full">Load older movements</Button>
                </div>
            )}
        </div>
    )
}

const meta: Meta<typeof InventoryView> = {
    title: "Screens/Inventory",
    component: InventoryView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Inventory / stock movement page. Each row is a stock item (SKU) with on-hand quantity, reorder threshold, optional barcode and HSN code. Items can be paused (the restaurant stopped carrying them — they stay in the system for historical reporting). The 'Record batch' dialog lets the operator add multiple SKUs at once with a verification step. The per-item history sheet on the right shows every movement: receipts, waste, manual adjustments. Real page uses the `stock_movement_batches` table introduced in migration 9.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof InventoryView>

export const Default: Story = {
    args: { rows: STOCKS, overlay: "none" },
}

export const BatchAddDialog: Story = {
    args: { rows: STOCKS, overlay: "batch-add" },
}

export const PerItemHistory: Story = {
    args: { rows: STOCKS, overlay: "history", historySku: "ING-001" },
}
