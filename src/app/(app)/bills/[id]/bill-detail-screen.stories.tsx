import type { Meta, StoryObj } from "@storybook/react-vite"
import { ArrowLeft, Ban, Download, Printer, Send } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * Screen-level twin of the bill detail page
 * (`src/app/(app)/bills/[id]/page.tsx`). The real page subscribes to
 * Supabase Realtime so the cashier sees the bill flip to PAID the
 * moment a webhook confirms the payment. This story freezes the visual
 * at four canonical states: GENERATED (awaiting payment), PAID,
 * PARTIALLY paid, and VOID.
 *
 * Layout:
 *   - Toolbar: Back to POS · Print · Send payment link · Void
 *   - Status banner (PAID = green, GENERATED = warning, VOID = red)
 *   - Bill preview canvas (the printable receipt) on the left
 *   - Sidebar with payment rows + customer + audit log on the right
 */
type BillStatus = "GENERATED" | "PAID" | "PARTIAL" | "VOID"

interface BillDetailViewProps {
    invoiceNumber: string
    grandTotal: number
    status: BillStatus
    paidAmount: number
    items: { name: string; qty: number; price: number }[]
    customerName?: string
    customerPhone?: string
    payments: { method: "CASH" | "UPI" | "CARD" | "RAZORPAY"; amount: number; ref?: string }[]
    voidedReason?: string
}

function BillDetailView({
    invoiceNumber, grandTotal, status, paidAmount, items,
    customerName, customerPhone, payments, voidedReason,
}: BillDetailViewProps) {
    const subtotal = items.reduce((s, it) => s + it.qty * it.price, 0)
    const tax = +(subtotal * 0.05).toFixed(2)
    const remaining = Math.max(0, grandTotal - paidAmount)

    return (
        <div className="min-h-[800px] w-full bg-background text-foreground rounded-md border border-border/40 p-5 space-y-4">
            {/* Toolbar */}
            <div className="flex items-center gap-2 flex-wrap">
                <Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4" /> Back to POS</Button>
                <div className="ml-auto flex items-center gap-2">
                    <Button variant="outline" size="sm"><Printer className="h-4 w-4" /> Print</Button>
                    <Button variant="outline" size="sm"><Download className="h-4 w-4" /> PDF</Button>
                    {status === "GENERATED" || status === "PARTIAL" ? (
                        <Button variant="neon" size="sm"><Send className="h-4 w-4" /> Send payment link</Button>
                    ) : null}
                    {status !== "VOID" && (
                        <Button variant="ghost" size="sm" className="text-destructive"><Ban className="h-4 w-4" /> Void</Button>
                    )}
                </div>
            </div>

            {/* Status banner */}
            <StatusBanner status={status} remaining={remaining} voidedReason={voidedReason} />

            {/* Body: receipt + sidebar */}
            <div className="grid lg:grid-cols-[1fr_320px] gap-4">
                {/* Receipt */}
                <div className="rounded-lg border border-border/40 bg-white text-zinc-900 p-6 max-w-[480px]">
                    <div className="text-center space-y-0.5 border-b border-dashed border-zinc-300 pb-3">
                        <div className="font-bold text-base">Bandra Bistro</div>
                        <div className="text-[11px]">GSTIN: 27AAACR1234Z1Z5</div>
                        <div className="text-[11px]">12, Hill Road, Bandra (W), Mumbai 400050</div>
                    </div>
                    <div className="flex items-baseline justify-between text-xs mt-3">
                        <span>Invoice</span>
                        <span className="font-mono font-semibold">{invoiceNumber}</span>
                    </div>
                    <div className="flex items-baseline justify-between text-xs">
                        <span>Date</span>
                        <span>18 May 2026, 14:32</span>
                    </div>
                    {customerName && (
                        <div className="mt-3 pt-2 border-t border-dashed border-zinc-300 text-xs space-y-0.5">
                            <div className="text-zinc-500 uppercase tracking-wider text-[10px]">Billed to</div>
                            <div className="font-medium">{customerName}</div>
                            {customerPhone && <div>{customerPhone}</div>}
                        </div>
                    )}
                    <table className="w-full text-xs mt-3 border-t border-dashed border-zinc-300 pt-2">
                        <thead className="text-zinc-500">
                            <tr><th className="text-left font-medium pb-1">Item</th><th className="text-right font-medium">Qty</th><th className="text-right font-medium">₹</th></tr>
                        </thead>
                        <tbody>
                            {items.map((it, i) => (
                                <tr key={i}>
                                    <td className="py-0.5">{it.name}</td>
                                    <td className="text-right">{it.qty}</td>
                                    <td className="text-right tabular-nums">{(it.qty * it.price).toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="border-t border-dashed border-zinc-300 mt-2 pt-2 text-xs space-y-0.5">
                        <Row label="Subtotal" value={subtotal} />
                        <Row label="CGST 2.5%" value={tax / 2} />
                        <Row label="SGST 2.5%" value={tax / 2} />
                    </div>
                    <div className="border-t border-zinc-300 mt-2 pt-2 flex items-baseline justify-between font-bold">
                        <span>Total</span>
                        <span className="tabular-nums">₹{grandTotal.toFixed(2)}</span>
                    </div>
                    <div className="mt-4 text-center text-[10px] text-zinc-500">
                        Thank you — verify this bill at b/<span className="font-mono">bandra-bistro/{invoiceNumber}</span>
                    </div>
                </div>

                {/* Sidebar */}
                <div className="space-y-3">
                    <Card>
                        <CardContent className="p-4 space-y-1.5 text-sm">
                            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Payments</div>
                            {payments.length === 0 ? (
                                <div className="text-muted-foreground py-2">None yet — waiting for customer.</div>
                            ) : payments.map((p, i) => (
                                <div key={i} className="flex items-center justify-between text-xs py-1 border-t border-border/30 first:border-t-0">
                                    <div>
                                        <div className="font-medium">{p.method}</div>
                                        {p.ref && <div className="text-[10px] font-mono text-muted-foreground truncate max-w-[140px]">{p.ref}</div>}
                                    </div>
                                    <div className="tabular-nums">₹{p.amount.toFixed(2)}</div>
                                </div>
                            ))}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="p-4 text-sm space-y-1">
                            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Audit log</div>
                            <div className="text-[11px] text-muted-foreground">14:32 — Bill generated by Riya</div>
                            {payments.map((p, i) => (
                                <div key={i} className="text-[11px] text-muted-foreground">
                                    {`14:${33 + i} — Payment ${p.method} ₹${p.amount.toFixed(2)} received`}
                                </div>
                            ))}
                            {status === "VOID" && voidedReason && (
                                <div className="text-[11px] text-destructive">15:01 — Voided ({voidedReason})</div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}

function Row({ label, value }: { label: string; value: number }) {
    return (
        <div className="flex items-baseline justify-between">
            <span className="text-zinc-600">{label}</span>
            <span className="tabular-nums">₹{value.toFixed(2)}</span>
        </div>
    )
}

function StatusBanner({ status, remaining, voidedReason }: { status: BillStatus; remaining: number; voidedReason?: string }) {
    if (status === "PAID") {
        return (
            <div className="rounded-md border border-success/40 bg-success/[0.06] px-3 py-2 text-sm flex items-center gap-2">
                <Badge variant="success" className="text-[10px]">PAID</Badge>
                <span className="text-muted-foreground">Bill closed — all payments recorded.</span>
            </div>
        )
    }
    if (status === "GENERATED") {
        return (
            <div className="rounded-md border border-warning/40 bg-warning/[0.06] px-3 py-2 text-sm flex items-center gap-2">
                <Badge variant="warning" className="text-[10px]">GENERATED</Badge>
                <span className="text-muted-foreground">Awaiting payment · ₹{remaining.toFixed(2)} pending</span>
            </div>
        )
    }
    if (status === "PARTIAL") {
        return (
            <div className="rounded-md border border-primary/40 bg-primary/[0.06] px-3 py-2 text-sm flex items-center gap-2">
                <Badge variant="default" className="text-[10px]">PARTIAL</Badge>
                <span className="text-muted-foreground">₹{remaining.toFixed(2)} still pending</span>
            </div>
        )
    }
    return (
        <div className="rounded-md border border-destructive/40 bg-destructive/[0.08] px-3 py-2 text-sm flex items-center gap-2">
            <Badge variant="destructive" className="text-[10px]">VOID</Badge>
            <span className={cn("text-muted-foreground")}>Voided — {voidedReason ?? "no reason given"}</span>
        </div>
    )
}

const meta: Meta<typeof BillDetailView> = {
    title: "Screens/Bill Detail",
    component: BillDetailView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Bill detail page — `/bills/[id]`. Shows the printable receipt + payment history + audit log. The real page subscribes to Supabase Realtime so the status flips from GENERATED → PAID the moment the Razorpay/Stripe webhook lands. Toolbar offers Back to POS, Print, PDF, Send payment link (only when unpaid), and Void (OWNER-only, requires a reason). Receipt rendering is GST-aware: CGST+SGST for intra-state, IGST for inter-state, single tax line for non-India.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof BillDetailView>

const ITEMS = [
    { name: "Paneer Tikka", qty: 2, price: 224 },
    { name: "Garlic Naan", qty: 4, price: 60 },
    { name: "Dal Makhani", qty: 1, price: 240 },
]

/** Paid bill — green banner, full payment trail, void still allowed. */
export const Paid: Story = {
    args: {
        invoiceNumber: "INV-2026-27-00412",
        grandTotal: 967.50,
        status: "PAID",
        paidAmount: 967.50,
        items: ITEMS,
        customerName: "Anita Sharma",
        customerPhone: "+91 98XX XX1234",
        payments: [{ method: "UPI", amount: 967.50, ref: "456789012345" }],
    },
}

/** Just-generated, unpaid — warning banner, "Send payment link" CTA visible. */
export const AwaitingPayment: Story = {
    args: {
        invoiceNumber: "INV-2026-27-00413",
        grandTotal: 540.00,
        status: "GENERATED",
        paidAmount: 0,
        items: ITEMS.slice(0, 2),
        payments: [],
    },
}

/** Partially paid (e.g. cash deposit, balance pending). */
export const PartiallyPaid: Story = {
    args: {
        invoiceNumber: "INV-2026-27-00414",
        grandTotal: 1240.00,
        status: "PARTIAL",
        paidAmount: 500,
        items: [
            { name: "Hyderabadi Biryani", qty: 2, price: 360 },
            { name: "Chicken 65", qty: 1, price: 320 },
            { name: "Coke 500ml", qty: 2, price: 80 },
        ],
        customerName: "Walk-in",
        payments: [{ method: "CASH", amount: 500 }],
    },
}

/** Voided — full audit reason visible. Void action no longer offered. */
export const Voided: Story = {
    args: {
        invoiceNumber: "INV-2026-27-00407",
        grandTotal: 380.00,
        status: "VOID",
        paidAmount: 0,
        items: [
            { name: "Margherita Pizza", qty: 1, price: 320 },
            { name: "Iced Latte", qty: 1, price: 60 },
        ],
        voidedReason: "Customer changed order; new bill issued.",
        payments: [],
    },
}
