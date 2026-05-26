"use client"

import { useEffect, useState } from "react"
import { Download, ExternalLink, FileText, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency, formatDate } from "@/lib/utils"

interface Invoice {
    id: string
    number: string | null
    status: string
    amount_paid: number
    amount_due: number
    currency: string
    created: string | null
    period_start: string | null
    period_end: string | null
    hosted_invoice_url: string | null
    invoice_pdf: string | null
}

/**
 * Invoices history card. Pulls the last 12 invoices from Stripe (via
 * /api/billing/invoices) and renders a tight table. "Download" links
 * directly to Stripe's CDN-hosted PDF — no proxy through our server,
 * no risk of leaking auth tokens, the PDF opens in a new tab so the
 * OWNER doesn't lose their place on the settings page.
 */
export function InvoicesCard() {
    const [invoices, setInvoices] = useState<Invoice[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        ;(async () => {
            try {
                const r = await fetch("/api/billing/invoices")
                const data = await r.json() as { invoices?: Invoice[]; error?: string }
                if (!r.ok) throw new Error(data.error ?? "Failed to load invoices")
                setInvoices(data.invoices ?? [])
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't load invoices")
            } finally {
                setLoading(false)
            }
        })()
    }, [])

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="h-4 w-4" /> Invoice history
                </CardTitle>
                <CardDescription>
                    Recent subscription invoices from Stripe. Click Download for the receipt PDF.
                </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 px-6">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading invoices…
                    </div>
                ) : invoices.length === 0 ? (
                    <div className="px-6 py-6 text-sm text-muted-foreground">
                        No invoices yet — your first one lands after your trial converts.
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Invoice</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Period</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                                <TableHead className="text-right w-[140px]" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {invoices.map((inv) => (
                                <TableRow key={inv.id}>
                                    <TableCell className="font-mono text-xs">
                                        {inv.number ?? inv.id.slice(0, 12)}
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {inv.created ? formatDate(inv.created, { dateStyle: "medium" }) : "—"}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                        {inv.period_start && inv.period_end
                                            ? `${formatDate(inv.period_start, { dateStyle: "short" })} → ${formatDate(inv.period_end, { dateStyle: "short" })}`
                                            : "—"}
                                    </TableCell>
                                    <TableCell>
                                        <InvoiceStatusBadge status={inv.status} />
                                    </TableCell>
                                    <TableCell className="text-right font-semibold tabular-nums">
                                        {formatCurrency(inv.amount_paid > 0 ? inv.amount_paid : inv.amount_due, inv.currency)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            {inv.invoice_pdf && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    asChild
                                                >
                                                    <a
                                                        href={inv.invoice_pdf}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        title="Download invoice PDF"
                                                    >
                                                        <Download className="h-3.5 w-3.5" /> PDF
                                                    </a>
                                                </Button>
                                            )}
                                            {inv.hosted_invoice_url && (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    asChild
                                                >
                                                    <a
                                                        href={inv.hosted_invoice_url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        title="Open invoice on Stripe"
                                                    >
                                                        <ExternalLink className="h-3.5 w-3.5" />
                                                    </a>
                                                </Button>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    )
}

function InvoiceStatusBadge({ status }: { status: string }) {
    const variant = status === "paid" ? "success"
        : status === "open" ? "warning"
        : status === "draft" ? "secondary"
        : status === "void" || status === "uncollectible" ? "destructive"
        : "outline"
    return (
        <Badge variant={variant} className="text-[10px] capitalize">
            {status}
        </Badge>
    )
}
