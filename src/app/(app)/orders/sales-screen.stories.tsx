import type { Meta, StoryObj } from "@storybook/react-vite"
import { ArrowUpDown, Download, Filter, Printer, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

/**
 * Screen-level twin of the combined Sales/Orders page
 * (`src/app/(app)/orders/page.tsx`). The real page reads orders embedded
 * with their bills via PostgREST and renders a filter rail + sortable
 * table + pagination. This story freezes the visual at one filtered
 * mid-shift state so designers can iterate the row density.
 */
type Row = {
    orderNumber: string
    invoiceNumber: string | null
    createdAt: string
    customer: string
    source: "POS" | "QR" | "SWIGGY" | "ZOMATO" | "PHONE"
    orderType: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "QSR"
    status: "OPEN" | "BILLED" | "PAID" | "VOID"
    grandTotal: number
    biller: string
}

const ROWS: Row[] = [
    { orderNumber: "POS-00041251", invoiceNumber: "INV-2026-27-00412", createdAt: "14:42", customer: "Anita S.", source: "POS", orderType: "DINE_IN", status: "PAID", grandTotal: 967.5, biller: "Riya" },
    { orderNumber: "POS-00041252", invoiceNumber: null, createdAt: "14:38", customer: "—", source: "POS", orderType: "DINE_IN", status: "OPEN", grandTotal: 0, biller: "Akash" },
    { orderNumber: "QR-78231124", invoiceNumber: "INV-2026-27-00411", createdAt: "14:31", customer: "Walk-in", source: "QR", orderType: "DINE_IN", status: "PAID", grandTotal: 540.0, biller: "—" },
    { orderNumber: "POS-00041250", invoiceNumber: "INV-2026-27-00410", createdAt: "14:18", customer: "Vikram K.", source: "POS", orderType: "TAKEAWAY", status: "PAID", grandTotal: 1240.0, biller: "Riya" },
    { orderNumber: "POS-00041249", invoiceNumber: "INV-2026-27-00409", createdAt: "14:02", customer: "—", source: "SWIGGY", orderType: "DELIVERY", status: "BILLED", grandTotal: 760.0, biller: "Mehul" },
    { orderNumber: "POS-00041248", invoiceNumber: "INV-2026-27-00408", createdAt: "13:48", customer: "Priya M.", source: "POS", orderType: "DINE_IN", status: "PAID", grandTotal: 2480.0, biller: "Akash" },
    { orderNumber: "POS-00041247", invoiceNumber: "INV-2026-27-00407", createdAt: "13:36", customer: "Walk-in", source: "POS", orderType: "QSR", status: "VOID", grandTotal: 380.0, biller: "Riya" },
    { orderNumber: "POS-00041246", invoiceNumber: "INV-2026-27-00406", createdAt: "13:20", customer: "Anita S.", source: "ZOMATO", orderType: "DELIVERY", status: "PAID", grandTotal: 1840.0, biller: "Mehul" },
]

const STATUS_VARIANT: Record<Row["status"], "default" | "success" | "destructive" | "warning"> = {
    OPEN: "warning",
    BILLED: "default",
    PAID: "success",
    VOID: "destructive",
}

interface SalesScreenViewProps {
    rows: Row[]
    showFilters: boolean
    rowCount: number
}

function SalesScreenView({ rows, showFilters, rowCount }: SalesScreenViewProps) {
    return (
        <div className="min-h-[800px] w-full bg-background text-foreground rounded-md border border-border/40 p-5 space-y-4">
            {/* Header */}
            <div className="flex items-center gap-3 flex-wrap">
                <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Manage</div>
                    <h1 className="text-xl font-bold">Sales</h1>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Search order #, notes" className="pl-8 w-64" />
                    </div>
                    <Button variant="outline" size="sm"><Filter className="h-4 w-4" /> Filters</Button>
                    <Button variant="outline" size="sm"><Download className="h-4 w-4" /> CSV</Button>
                </div>
            </div>

            {/* Filter rail */}
            {showFilters && (
                <div className="rounded-lg border border-border/40 p-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                    {["All statuses", "All types", "All sources", "FY 2026-27", "Date · Today"].map((f) => (
                        <div key={f} className="rounded-md border border-border/40 px-3 py-1.5 flex items-center justify-between text-muted-foreground">
                            {f}
                            <ArrowUpDown className="h-3 w-3" />
                        </div>
                    ))}
                </div>
            )}

            {/* Table */}
            <div className="rounded-lg border border-border/40 overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Order #</TableHead>
                            <TableHead>Invoice</TableHead>
                            <TableHead>Time</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Source</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead>Biller</TableHead>
                            <TableHead></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                                    No sales match the active filters.
                                </TableCell>
                            </TableRow>
                        ) : rows.map((r) => (
                            <TableRow key={r.orderNumber}>
                                <TableCell className="font-mono text-xs">{r.orderNumber}</TableCell>
                                <TableCell className="font-mono text-xs">{r.invoiceNumber ?? "—"}</TableCell>
                                <TableCell className="text-muted-foreground">{r.createdAt}</TableCell>
                                <TableCell className="font-medium">{r.customer}</TableCell>
                                <TableCell>
                                    <Badge variant="outline" className="text-[10px]">{r.source}</Badge>
                                </TableCell>
                                <TableCell>
                                    <Badge variant={STATUS_VARIANT[r.status]} className="text-[10px]">{r.status}</Badge>
                                </TableCell>
                                <TableCell className="text-right font-semibold tabular-nums">
                                    ₹{r.grandTotal.toFixed(2)}
                                </TableCell>
                                <TableCell className="text-xs">{r.biller}</TableCell>
                                <TableCell>
                                    {r.invoiceNumber && (
                                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Print">
                                            <Printer className="h-3.5 w-3.5" />
                                        </Button>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Showing {rows.length} of {rowCount} sales</span>
                <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" disabled>‹ Prev</Button>
                    <Button variant="outline" size="sm">Next ›</Button>
                </div>
            </div>
        </div>
    )
}

const meta: Meta<typeof SalesScreenView> = {
    title: "Screens/Sales",
    component: SalesScreenView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Combined Sales page (`/orders`) — every order is a row; rows that have an associated bill show the invoice number, source, status, biller, and a one-click Print action. Filters collapse into a rail toggled from the header. Source filter renders SWIGGY / ZOMATO / ONDC only for India tenants. Real page uses Supabase realtime so paid bills flip from BILLED → PAID without a manual refresh.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof SalesScreenView>

/** Mid-shift state — mix of PAID, BILLED, OPEN, and a recent VOID. */
export const Default: Story = {
    args: { rows: ROWS, showFilters: false, rowCount: 142 },
}

/** Same data, filter rail expanded. */
export const FiltersOpen: Story = {
    args: { rows: ROWS, showFilters: true, rowCount: 142 },
}

/** No matching rows — typical when a filter excludes everything (e.g.
 *  "VOID only" on a clean shift). */
export const NoResults: Story = {
    args: { rows: [], showFilters: true, rowCount: 142 },
}
