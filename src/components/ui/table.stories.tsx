import type { Meta, StoryObj } from "@storybook/react-vite"

import { Badge } from "./badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table"

const meta = {
    title: "UI/Table",
    component: Table,
    tags: ["autodocs"],
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Thin styling wrapper over a native `<table>`. Used for the Bills, Orders, Customers, Vendors, Purchases, Staff, Coupons lists. Auto-scrolls horizontally when the row content overflows on narrow viewports.",
            },
        },
    },
} satisfies Meta<typeof Table>
export default meta
type Story = StoryObj<typeof meta>

const ROWS = [
    { invoice: "INV-2025-26-00042", date: "2026-05-14", customer: "Priya", status: "PAID", total: "₹ 787.50" },
    { invoice: "INV-2025-26-00041", date: "2026-05-14", customer: "Walk-in", status: "GENERATED", total: "₹ 320.00" },
    { invoice: "INV-2025-26-00040", date: "2026-05-13", customer: "ACME Corp", status: "PAID", total: "₹ 5,250.00" },
    { invoice: "INV-2025-26-00039", date: "2026-05-13", customer: "Walk-in", status: "VOID", total: "₹ 480.00" },
]

export const BillsList: Story = {
    render: () => (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {ROWS.map((r) => (
                    <TableRow key={r.invoice}>
                        <TableCell className="font-mono text-xs">{r.invoice}</TableCell>
                        <TableCell className="text-sm">{r.date}</TableCell>
                        <TableCell className="text-sm">{r.customer}</TableCell>
                        <TableCell>
                            <Badge variant={r.status === "PAID" ? "success" : r.status === "VOID" ? "destructive" : "warning"}>
                                {r.status}
                            </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{r.total}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    ),
}

export const Empty: Story = {
    render: () => (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-12">
                        No bills yet — generate your first one from the POS.
                    </TableCell>
                </TableRow>
            </TableBody>
        </Table>
    ),
}
