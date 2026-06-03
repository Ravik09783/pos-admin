"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import QRCode from "qrcode"
import Link from "next/link"
import { ArrowRight, Ban, Edit3, History, Loader2, Plus, Printer, Send, ShoppingCart, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { PaymentLinkDialog } from "@/components/bill/payment-link-dialog"
import { BillPreview } from "@/components/bill/bill-preview"
import { createClient } from "@/lib/supabase/client"
import { uniqueChannelName } from "@/lib/supabase/realtime"
import { can, ROLE_LABELS } from "@/lib/rbac/permissions"
import { getTaxConfig } from "@/lib/tax/locale-config"
import { billToRenderData } from "@/lib/bill/render"
import { DEFAULT_DESIGN, resolveBillDesign } from "@/lib/bill/templates"
import { formatCurrency, formatDate } from "@/lib/utils"
import type {
    Bill,
    BillAuditLog,
    OrderItem,
    Payment,
    Tenant,
    UserRole,
} from "@/types/database"

export default function BillDetailPage() {
    const params = useParams<{ id: string }>()
    const router = useRouter()
    const searchParams = useSearchParams()
    const supabase = createClient()

    const [loading, setLoading] = useState(true)
    const [bill, setBill] = useState<Bill | null>(null)
    const [tenant, setTenant] = useState<Tenant | null>(null)
    const [items, setItems] = useState<OrderItem[]>([])
    const [payments, setPayments] = useState<Payment[]>([])
    const [audit, setAudit] = useState<BillAuditLog[]>([])
    const [role, setRole] = useState<UserRole>("CASHIER")

    // Manual post-bill payment was removed on 2026-05-18 to close the
    // fraud loophole where a cashier could print a bill, take cash, and
    // never click "Record payment". generate_bill + record_payment now
    // fire together at checkout (see CheckoutPreviewDialog). Online
    // top-ups still arrive via the PhonePe/Stripe webhook.
    const [customer, setCustomer] = useState<{ id: string; name: string | null; loyalty_points: number } | null>(null)
    const [billedBy, setBilledBy] = useState<{ id: string; full_name: string | null; email: string | null; avatar_url: string | null; role: string } | null>(null)

    const [voidOpen, setVoidOpen] = useState(false)
    const [voidReason, setVoidReason] = useState("")
    const [voiding, setVoiding] = useState(false)

    const [linkOpen, setLinkOpen] = useState(false)
    const [verifyQr, setVerifyQr] = useState("")

    /** Modification audit — every change the staff made to the KOTs on
     *  this order before billing. Surfaces a "Modified N times" badge
     *  next to the bill status so supervisors / the admin instantly
     *  spot bills that had a lot of churn during service. The full
     *  detail (who, when, why, what items) opens in a modal on click. */
    interface KotModification {
        id: string
        kot_id: string | null
        modified_by_email: string | null
        reason: string
        voided_items: Array<{ item_name?: string; quantity?: number; line_total?: number }>
        added_items: Array<{ item_name?: string; quantity?: number; unit_price?: number }>
        created_at: string
    }
    const [modifications, setModifications] = useState<KotModification[]>([])
    const [modsOpen, setModsOpen] = useState(false)

    async function refresh() {
        const id = params.id as string
        const { data: b } = await supabase.from("bills").select("*").eq("id", id).maybeSingle()
        if (!b) {
            setLoading(false)
            return
        }
        setBill(b as Bill)
        const [{ data: t }, { data: it }, { data: p }, { data: a }, { data: u }] = await Promise.all([
            supabase.from("tenants").select("*").eq("id", b.tenant_id).maybeSingle(),
            supabase.from("order_items").select("*").eq("order_id", b.order_id).order("created_at"),
            supabase.from("payments").select("*").eq("bill_id", id).order("created_at"),
            supabase
                .from("bill_audit_log")
                .select("*")
                .eq("bill_id", id)
                .order("created_at", { ascending: false }),
            supabase.auth.getUser().then(async (r) =>
                r.data.user
                    ? await supabase.from("users").select("role").eq("id", r.data.user.id).maybeSingle()
                    : { data: null },
            ),
        ])
        setTenant((t ?? null) as Tenant | null)
        setItems((it ?? []) as OrderItem[])
        setPayments((p ?? []) as Payment[])
        setAudit((a ?? []) as BillAuditLog[])
        if (u?.role) setRole(u.role as UserRole)

        // KOT modifications for this order. RLS scopes the read; an
        // empty result is the common (good) case. We sort newest-first
        // so the modal opens on the most recent change.
        const { data: mods } = await supabase
            .from("kot_modifications")
            .select("id, kot_id, modified_by_email, reason, voided_items, added_items, created_at")
            .eq("order_id", b.order_id)
            .order("created_at", { ascending: false })
        setModifications((mods ?? []) as KotModification[])

        // Resolve the linked customer + the biller in ONE PostgREST call —
        // embeds replace the three sequential round-trips we used to do.
        const { data: order } = await supabase
            .from("orders")
            .select(`
                customer_id, billed_by,
                customer:customers(id, name, loyalty_points),
                billed_by_user:users!orders_billed_by_fkey(id, full_name, email, avatar_url, role)
            `)
            .eq("id", b.order_id)
            .maybeSingle()
        const o = order as {
            customer_id: string | null
            billed_by: string | null
            customer: { id: string; name: string | null; loyalty_points: number } | { id: string; name: string | null; loyalty_points: number }[] | null
            billed_by_user: { id: string; full_name: string | null; email: string | null; avatar_url: string | null; role: string } | { id: string; full_name: string | null; email: string | null; avatar_url: string | null; role: string }[] | null
        } | null

        const cust = Array.isArray(o?.customer) ? o?.customer[0] ?? null : o?.customer ?? null
        const bu   = Array.isArray(o?.billed_by_user) ? o?.billed_by_user[0] ?? null : o?.billed_by_user ?? null
        setCustomer(cust)
        setBilledBy(bu)
        setLoading(false)
    }

    useEffect(() => { refresh() }, [params.id])

    /** Live status — subscribe to changes on THIS bill + its payments.
     *  When the cashier hits "Send payment link" and the customer pays
     *  via Stripe/PhonePe, the webhook updates the bill status server-
     *  side. Without this sub, the cashier would have to manually
     *  refresh to see the bill flip from GENERATED to PAID. With it,
     *  the page updates in real time the moment the webhook lands. */
    useEffect(() => {
        if (!params.id) return
        const id = String(params.id)
        const channel = supabase
            .channel(uniqueChannelName(`bill-${id}`))
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "bills", filter: `id=eq.${id}` },
                () => { void refresh() },
            )
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "payments", filter: `bill_id=eq.${id}` },
                () => { void refresh() },
            )
            .subscribe()
        return () => { supabase.removeChannel(channel) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params.id])

    // Auto-trigger print dialog when navigated here with ?autoprint=1
    useEffect(() => {
        if (loading || !bill) return
        if (searchParams.get("autoprint") === "1") {
            const t = setTimeout(() => window.print(), 600)
            return () => clearTimeout(t)
        }
    }, [loading, bill, searchParams])

    // Verification QR for the printed bill (links to the public /b/... copy).
    useEffect(() => {
        if (!tenant || !bill) return
        const url = `${window.location.origin}/b/${tenant.slug ?? ""}/${bill.invoice_number}`
        QRCode.toDataURL(url, { margin: 1, width: 200, color: { dark: "#0a0e1a", light: "#ffffff" } }).then(setVerifyQr).catch(() => {})
    }, [tenant, bill])

    const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0)
    const due = bill ? Math.max(0, Number(bill.grand_total) - totalPaid) : 0

    async function voidBill(e: React.FormEvent) {
        e.preventDefault()
        if (!bill) return
        if (voidReason.trim().length < 3) return toast.error("Reason required (min 3 chars)")
        setVoiding(true)
        const { error } = await supabase.rpc("void_bill", { p_bill_id: bill.id, p_reason: voidReason.trim() })
        setVoiding(false)
        if (error) return toast.error(error.message)
        toast.success("Bill voided")
        setVoidOpen(false)
        refresh()
    }

    if (loading) {
        return (
            <div className="container mx-auto py-8 max-w-5xl space-y-4">
                <Skeleton className="h-10 w-1/3" />
                <Skeleton className="h-96" />
            </div>
        )
    }
    if (!bill || !tenant) {
        return <div className="container mx-auto py-8 text-muted-foreground">Bill not found.</div>
    }

    const cfg = getTaxConfig(tenant.country)
    const money = (v: number | string | null | undefined) => formatCurrency(v, cfg.currency)
    const taxNoun = cfg.taxShortName
    const design = resolveBillDesign(tenant.settings as Parameters<typeof resolveBillDesign>[0])
    const renderData = billToRenderData({ bill, items, cfg, design, extra: { paid: totalPaid, balanceDue: due } })

    return (
        <div className="container mx-auto py-8 max-w-5xl space-y-6">
            {bill.gst_excluded && (
                <div className="no-print rounded-lg border border-yellow-500/50 bg-yellow-500/10 px-4 py-3 text-sm">
                    <span className="font-semibold text-yellow-600 dark:text-yellow-400">Bill without {taxNoun}.</span>{" "}
                    <span className="text-muted-foreground">No tax was computed on this bill, and it is excluded from the CA export bundle.</span>
                </div>
            )}

            {/* ── No-payment warning ────────────────────────────────────
              * A bill that's GENERATED but has zero recorded payments is
              * almost always a bug — either the legacy two-RPC flow
              * dropped the payment mid-call, or someone generated a
              * receipt expecting an online payment-link to arrive later.
              * Either way, surface it explicitly so the cashier knows
              * the receipt is unpaid and the right action is to either
              * Send a payment link (waits for the customer to pay) or
              * Void the bill (cancel + reverse). */}
            {bill.bill_status === "GENERATED" && payments.length === 0 && (
                <div className="no-print rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm space-y-2">
                    <div className="flex items-center gap-2 font-semibold text-destructive">
                        <Ban className="h-4 w-4" />
                        No payment recorded on this bill.
                    </div>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                        The receipt was generated for <span className="font-semibold text-foreground">{money(bill.grand_total)}</span> but nothing was recorded as paid.
                        If the customer paid in cash and it wasn&apos;t captured, <span className="font-semibold">Void this bill</span> and re-bill from the POS so the money lines up with the books.
                        If they haven&apos;t paid yet, send a payment link below.
                    </p>
                </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 no-print">
                <div className="space-y-1">
                    <h1 className="text-3xl font-bold tracking-tight font-mono">{bill.invoice_number}</h1>
                    <p className="text-muted-foreground">{formatDate(bill.created_at)}</p>
                    {billedBy && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                            <span>Billed by</span>
                            {billedBy.avatar_url
                                /* eslint-disable-next-line @next/next/no-img-element */
                                ? <img src={billedBy.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover border border-border/60" />
                                : <span className="h-5 w-5 rounded-full bg-muted grid place-items-center text-[10px] font-semibold">{(billedBy.full_name ?? billedBy.email ?? "?").slice(0, 1).toUpperCase()}</span>}
                            <span className="font-medium text-foreground">{billedBy.full_name ?? billedBy.email ?? "Unknown staff"}</span>
                            <Badge variant="outline" className="text-[10px]">{ROLE_LABELS[billedBy.role as UserRole] ?? billedBy.role}</Badge>
                        </div>
                    )}
                </div>
                <div className="flex flex-wrap gap-2">
                    <Badge variant={bill.bill_status === "PAID" ? "success" : bill.bill_status === "VOID" ? "destructive" : "warning"}>
                        {bill.bill_status}
                    </Badge>
                    {bill.gst_excluded && <Badge variant="warning">No {taxNoun}</Badge>}
                    {/* Modification count — only surfaces when there's
                      * at least one logged change. Clickable: opens
                      * the full who/when/why/what audit modal. */}
                    {modifications.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setModsOpen(true)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/[0.08] text-warning text-xs font-semibold px-2.5 py-0.5 hover:bg-warning/[0.14] transition-colors"
                            title="See who changed what before this bill was generated"
                        >
                            <Edit3 className="h-3 w-3" />
                            Modified {modifications.length}× before billing
                        </button>
                    )}
                    {/* Back-to-POS — the cashier's escape hatch when they
                      * land here (via a search, a notification, or the
                      * Sales list) and want to return to the till without
                      * fumbling through the sidebar. The /pos route is
                      * kiosk-mode so this jumps them straight back to
                      * full-screen billing UI. */}
                    {can(role, "order.create") && (
                        <Button asChild variant="outline">
                            <Link href="/pos">
                                <ShoppingCart className="h-4 w-4" /> Back to POS
                            </Link>
                        </Button>
                    )}
                    <Button variant="outline" onClick={() => window.print()}>
                        <Printer className="h-4 w-4" /> Print
                    </Button>
                    {bill.bill_status === "GENERATED" && (
                        <Button variant="outline" onClick={() => setLinkOpen(true)}>
                            <Send className="h-4 w-4" /> Send payment link
                        </Button>
                    )}
                    {/* "Live" indicator — when a bill is GENERATED with
                      * any prior payment activity (e.g. payment link sent
                      * but customer hasn't paid yet), surface that the
                      * page is listening for the webhook. Disappears as
                      * soon as the bill flips to PAID via Realtime. */}
                    {bill.bill_status === "GENERATED" && (
                        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/40 border border-border/40 text-[11px] text-muted-foreground" title="Page auto-updates when Stripe / PhonePe confirms payment.">
                            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                            Listening for payment…
                        </div>
                    )}
                    {can(role, "bill.void") && bill.bill_status !== "VOID" && (
                        <Button variant="destructive" onClick={() => setVoidOpen(true)}>
                            <Ban className="h-4 w-4" /> Void bill
                        </Button>
                    )}
                </div>
            </div>

            {/* Printable invoice — rendered with the format picked in Settings → Bill formats */}
            <BillPreview
                id="invoice-printable"
                design={design}
                tenant={tenant}
                data={renderData}
                verifyQrUrl={verifyQr}
                className="neon-border print:shadow-none print:border print:border-black"
            />

            <Card className="no-print">
                <CardHeader>
                    <CardTitle className="text-base">Payments</CardTitle>
                </CardHeader>
                <CardContent>
                    {payments.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No payments recorded.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Method</TableHead>
                                    <TableHead>Reference</TableHead>
                                    <TableHead>Time</TableHead>
                                    <TableHead className="text-right">Amount</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {payments.map((p) => (
                                    <TableRow key={p.id}>
                                        <TableCell>{p.method}</TableCell>
                                        <TableCell className="font-mono text-xs">{p.reference ?? "—"}</TableCell>
                                        <TableCell className="text-sm">{formatDate(p.created_at)}</TableCell>
                                        <TableCell className="text-right">{money(p.amount)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Card className="no-print">
                <CardHeader>
                    <CardTitle className="text-base">Audit log</CardTitle>
                </CardHeader>
                <CardContent>
                    {audit.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No log entries.</p>
                    ) : (
                        <ul className="space-y-2 text-sm">
                            {audit.map((a) => (
                                <li key={a.id} className="border-l-2 border-primary/40 pl-3 py-1">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-[10px]">{a.action}</Badge>
                                        <span className="text-xs text-muted-foreground">
                                            {formatDate(a.created_at)} · {a.user_role && ROLE_LABELS[a.user_role as UserRole]}
                                        </span>
                                    </div>
                                    {a.reason && <div className="text-xs mt-0.5 text-muted-foreground">{a.reason}</div>}
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            <PaymentLinkDialog
                bill={bill}
                tenant={tenant}
                open={linkOpen}
                onOpenChange={setLinkOpen}
                onPaid={refresh}
            />

            <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Void bill</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={voidBill} className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            This permanently marks <span className="font-mono">{bill.invoice_number}</span> as void. The audit trail is preserved.
                        </p>
                        <div className="space-y-1.5">
                            <Label>Reason *</Label>
                            <Textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Wrong items, customer cancelled, …" />
                        </div>
                        <DialogFooter>
                            <Button type="submit" variant="destructive" disabled={voiding}>
                                {voiding && <Loader2 className="h-4 w-4 animate-spin" />}
                                Void bill
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* KOT modification history modal — opened by the badge
              * next to the bill status. Shows who changed what + why,
              * newest first. Items are JSONB snapshots captured at
              * modification time so the audit stays accurate even if
              * the menu later changes. */}
            <Dialog open={modsOpen} onOpenChange={setModsOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <History className="h-5 w-5 text-warning" />
                            Modification history
                            <Badge variant="outline" className="text-[10px]">{modifications.length} change{modifications.length === 1 ? "" : "s"}</Badge>
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 max-h-[65vh] overflow-y-auto">
                        {modifications.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-6 text-center">No changes recorded for this order.</p>
                        ) : (
                            modifications.map((m) => (
                                <div key={m.id} className="rounded-md border border-border/60 p-3 space-y-2">
                                    <div className="flex items-start justify-between gap-2 text-xs">
                                        <div className="min-w-0">
                                            <div className="font-semibold">{m.modified_by_email ?? "(deleted user)"}</div>
                                            <div className="text-muted-foreground">{formatDate(m.created_at, { dateStyle: "medium", timeStyle: "short" })}</div>
                                        </div>
                                    </div>
                                    <div className="rounded-md bg-muted/40 border border-border/40 px-2.5 py-2 text-xs">
                                        <span className="font-semibold mr-1">Reason:</span>
                                        <span className="text-muted-foreground">{m.reason}</span>
                                    </div>
                                    {m.voided_items.length > 0 && (
                                        <div className="space-y-0.5">
                                            <div className="text-[10px] uppercase tracking-wider text-destructive font-semibold flex items-center gap-1">
                                                <Trash2 className="h-2.5 w-2.5" /> Voided
                                            </div>
                                            {m.voided_items.map((v, i) => (
                                                <div key={i} className="text-xs text-muted-foreground line-through pl-3">
                                                    ×{Number(v.quantity ?? 0)} {v.item_name ?? "—"}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {m.added_items.length > 0 && (
                                        <div className="space-y-0.5">
                                            <div className="text-[10px] uppercase tracking-wider text-success font-semibold flex items-center gap-1">
                                                <Plus className="h-2.5 w-2.5" /> Added
                                            </div>
                                            {m.added_items.map((a, i) => (
                                                <div key={i} className="text-xs text-muted-foreground pl-3">
                                                    ×{Number(a.quantity ?? 0)} {a.item_name ?? "—"}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setModsOpen(false)}>
                            Close <ArrowRight className="h-3 w-3" />
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
