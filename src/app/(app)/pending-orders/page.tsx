"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import { AlertCircle, BellOff, CheckCircle2, Clock, Loader2, Printer, Sparkles, Trash2, Volume2, XCircle, ZoomIn } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { scopeQueryToBranch, useActiveBranch } from "@/lib/branch/active-branch"
import { uniqueChannelName } from "@/lib/supabase/realtime"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import type { OrderItem, QrPaymentProof } from "@/types/database"

interface PendingOrder {
    id: string
    order_number: string
    table_id: string | null
    customer_id: string | null
    notes: string | null
    grand_total: number
    awaiting_confirmation: boolean
    created_at: string
    order_items: OrderItem[]
    qr_payment_proofs: QrPaymentProof[]
    dining_tables: { number: string } | null
    customers: { name: string | null; phone: string | null } | null
}

export default function PendingOrdersPage() {
    const supabase = createClient()
    const router = useRouter()
    const [orders, setOrders] = useState<PendingOrder[]>([])
    const [loading, setLoading] = useState(true)
    const [soundOn, setSoundOn] = useState(true)
    const [zoom, setZoom] = useState<string | null>(null)
    const [rejectFor, setRejectFor] = useState<string | null>(null)
    const [rejectReason, setRejectReason] = useState("")
    const [busy, setBusy] = useState<string | null>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const knownIdsRef = useRef<Set<string>>(new Set())
    /** Active branch — drives which pending QR orders we show. Realtime
     *  subscription filters client-side in the callback (refresh() applies
     *  the same scope). */
    const { activeBranchId } = useActiveBranch()

    async function refresh() {
        // Typed as `any` to prevent "type instantiation is excessively deep" —
        // Supabase's chained generics exceed TS's recursion limit once
        // scopeQueryToBranch is applied on top of the long .select() chain.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q: any = supabase
            .from("orders")
            .select(`
                id, order_number, table_id, customer_id, notes, grand_total, awaiting_confirmation, created_at,
                order_items(id, item_name, quantity, unit_price, line_total, gst_slab, notes, is_void),
                qr_payment_proofs(id, screenshot_url, customer_name, customer_phone, amount, status, upi_id_used, created_at),
                dining_tables:table_id(number),
                customers:customer_id(name, phone)
            `)
            .eq("awaiting_confirmation", true)
            .order("created_at", { ascending: true })
        q = scopeQueryToBranch(q, activeBranchId)
        const { data } = await q
        const next = (data ?? []) as unknown as PendingOrder[]

        // Detect new orders → play chime
        const newIds = next.map((o) => o.id).filter((id) => !knownIdsRef.current.has(id))
        if (newIds.length > 0 && knownIdsRef.current.size > 0 && soundOn) {
            try { audioRef.current?.play() } catch {}
            toast.message("New order needs confirmation", { description: `${newIds.length} new` })
        }
        knownIdsRef.current = new Set(next.map((o) => o.id))
        setOrders(next)
        setLoading(false)
    }

    useEffect(() => {
        refresh()
        const channel = supabase
            .channel(uniqueChannelName("pending-orders"))
            .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, refresh)
            .on("postgres_changes", { event: "*", schema: "public", table: "qr_payment_proofs" }, refresh)
            .subscribe()
        return () => { supabase.removeChannel(channel) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [soundOn, activeBranchId])

    async function approve(orderId: string) {
        setBusy(orderId)
        try {
            const { data, error } = await supabase.rpc("confirm_qr_order" as never, { p_order_id: orderId } as never)
            if (error) throw error
            const r = data as { ok: boolean; bill_id: string; invoice_number: string }
            toast.success(`Bill ${r.invoice_number} created — opening print`)
            router.push(`/bills/${r.bill_id}?autoprint=1`)
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to confirm")
        } finally {
            setBusy(null)
        }
    }

    async function cleanupStale() {
        if (!confirm("Auto-void any QR order awaiting payment for more than 30 minutes?")) return
        const { data, error } = await supabase.rpc("cleanup_stale_qr_orders" as never, { p_minutes: 30 } as never)
        if (error) return toast.error(error.message)
        const r = data as { voided: number }
        toast.success(r.voided > 0 ? `Voided ${r.voided} stale order(s)` : "Nothing stale to clean up")
        refresh()
    }

    // auto-cleanup: run silently on mount (skip if already ran in last hour)
    useEffect(() => {
        const last = Number(localStorage.getItem("qr_cleanup_at") ?? 0)
        if (Date.now() - last < 3600_000) return
        localStorage.setItem("qr_cleanup_at", String(Date.now()))
        ;(async () => {
            try { await supabase.rpc("cleanup_stale_qr_orders" as never, { p_minutes: 30 } as never) } catch {}
        })()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function reject(orderId: string) {
        if (rejectReason.trim().length < 3) return toast.error("Reason required")
        setBusy(orderId)
        try {
            const { error } = await supabase.rpc("reject_qr_order" as never, { p_order_id: orderId, p_reason: rejectReason.trim() } as never)
            if (error) throw error
            toast.success("Order rejected, customer notified")
            setRejectFor(null); setRejectReason("")
            refresh()
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Reject failed")
        } finally {
            setBusy(null)
        }
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-6">
            <audio
                ref={audioRef}
                src="data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU"
                preload="auto"
            />

            {/* Hero */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="relative rounded-2xl glass-strong border border-border/50 neon-border overflow-hidden"
            >
                <div className="absolute -top-24 -right-24 h-56 w-56 rounded-full bg-warning/15 blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 -left-24 h-56 w-56 rounded-full bg-[hsl(var(--neon-magenta)/0.15)] blur-3xl pointer-events-none" />
                <div className="relative p-5 md:p-6 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                        <motion.div
                            animate={orders.length > 0 ? { scale: [1, 1.08, 1] } : {}}
                            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                            className="grid place-items-center h-12 w-12 rounded-2xl bg-gradient-to-br from-warning/30 to-[hsl(var(--neon-magenta)/0.25)] shrink-0"
                        >
                            <AlertCircle className="h-6 w-6 text-warning" />
                        </motion.div>
                        <div className="min-w-0">
                            <h1 className="text-xl md:text-2xl font-bold tracking-tight">
                                Pending <span className="text-gradient">QR orders</span>
                            </h1>
                            <p className="text-xs md:text-sm text-muted-foreground">
                                Customer-paid orders awaiting your confirmation.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <Button variant="outline" size="sm" onClick={cleanupStale} title="Auto-void orders stale > 30 min">
                            <Trash2 className="h-3.5 w-3.5" /> Clean up stale
                        </Button>
                        <Button variant={soundOn ? "neon" : "outline"} size="sm" onClick={() => setSoundOn(!soundOn)}>
                            {soundOn ? <Volume2 className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                            {soundOn ? "Sound on" : "Sound off"}
                        </Button>
                        <Badge variant={orders.length > 0 ? "warning" : "secondary"} className="text-sm px-3 py-1">
                            {orders.length} pending
                        </Badge>
                    </div>
                </div>
            </motion.div>

            {loading ? (
                <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-96 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>
            ) : orders.length === 0 ? (
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.5 }}
                    className="rounded-2xl glass-strong border border-border/50 neon-border p-12 text-center"
                >
                    <div className="mx-auto grid place-items-center h-16 w-16 rounded-full bg-gradient-to-br from-success/25 to-primary/25 mb-4">
                        <CheckCircle2 className="h-7 w-7 text-success" />
                    </div>
                    <h2 className="text-xl md:text-2xl font-bold tracking-tight">
                        All <span className="text-gradient">caught up</span>
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground inline-flex items-center gap-1">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                        We&apos;ll alert you when an order comes in.
                    </p>
                </motion.div>
            ) : (
                <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={{ visible: { transition: { staggerChildren: 0.07 } } }}
                    className="grid gap-4 lg:grid-cols-2"
                >
                    <AnimatePresence>
                    {orders.map((o) => {
                        const ageMin = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 60000)
                        const proof = o.qr_payment_proofs?.find((p) => p.status === "PENDING") ?? o.qr_payment_proofs?.[0]
                        const items = (o.order_items ?? []).filter((i) => !i.is_void)
                        const subtotal = items.reduce((s, i) => s + Number(i.line_total ?? Number(i.unit_price) * Number(i.quantity)), 0)
                        const urgent = ageMin > 10
                        return (
                            <motion.div
                                key={o.id}
                                layout
                                variants={{
                                    hidden: { opacity: 0, y: 16 },
                                    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
                                }}
                                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.25 } }}
                                className={cn(
                                    "relative rounded-2xl glass-strong border p-5 transition-all",
                                    urgent
                                        ? "border-destructive/60 shadow-[0_0_24px_-4px_hsl(var(--destructive)/0.4)] animate-pulse-glow"
                                        : "border-border/50 neon-border",
                                )}
                            >
                                {/* Order header */}
                                <div className="flex items-start justify-between gap-2 pb-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-mono font-semibold">{o.order_number}</span>
                                            {o.dining_tables?.number && <Badge variant="outline">Table {o.dining_tables.number}</Badge>}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {formatDate(o.created_at)} · {ageMin}m ago
                                        </p>
                                    </div>
                                    <Badge variant={urgent ? "destructive" : ageMin > 5 ? "warning" : "neon"}>
                                        <Clock className="h-3 w-3 mr-1" /> {ageMin}m
                                    </Badge>
                                </div>

                                {/* Customer */}
                                <div className="rounded-lg border border-border/50 bg-card/40 p-3 text-sm space-y-1">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground text-xs uppercase tracking-wider">Customer</span>
                                        <span className="font-medium">{proof?.customer_name ?? o.customers?.name ?? "—"}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground text-xs uppercase tracking-wider">Phone</span>
                                        <span className="font-mono text-xs">{proof?.customer_phone ?? o.customers?.phone ?? "—"}</span>
                                    </div>
                                    {o.notes && (
                                        <div className="text-xs italic text-amber-400 mt-1">⚠ {o.notes}</div>
                                    )}
                                </div>

                                {/* Items */}
                                <div className="mt-4">
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Order ({items.length})</div>
                                    <ul className="text-sm space-y-1">
                                        {items.map((it) => (
                                            <li key={it.id} className="flex justify-between">
                                                <span><span className="text-primary font-mono mr-1.5">×{it.quantity}</span>{it.item_name}</span>
                                                <span className="tabular-nums">{formatCurrency(it.line_total ?? Number(it.unit_price) * Number(it.quantity))}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    <div className="border-t border-border/40 mt-2 pt-2 flex justify-between font-semibold">
                                        <span>Total</span>
                                        <span className="text-gradient">{formatCurrency(subtotal * 1.05)}</span>
                                    </div>
                                </div>

                                {/* Payment proof */}
                                {proof && (
                                    <div className="mt-4 space-y-2">
                                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Payment proof</div>
                                        <div className="rounded-lg border border-border/50 bg-card/40 p-3 text-xs space-y-1">
                                            <div className="flex justify-between"><span className="text-muted-foreground">Amount paid</span><span className="font-semibold">{formatCurrency(proof.amount)}</span></div>
                                            <div className="flex justify-between"><span className="text-muted-foreground">Paid to UPI</span><span className="font-mono">{proof.upi_id_used ?? "—"}</span></div>
                                            <div className="flex justify-between"><span className="text-muted-foreground">Submitted</span><span>{formatDate(proof.created_at, { timeStyle: "short" })}</span></div>
                                        </div>
                                        <button
                                            onClick={() => setZoom(proof.screenshot_url)}
                                            className="block w-full rounded-lg overflow-hidden border border-border/60 hover:border-primary/60 transition-colors relative group"
                                        >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={proof.screenshot_url}
                                                alt="Payment screenshot"
                                                className="w-full max-h-48 object-cover"
                                            />
                                            <div className="absolute inset-0 grid place-items-center bg-background/0 group-hover:bg-background/40 transition-colors">
                                                <ZoomIn className="h-6 w-6 text-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                            </div>
                                        </button>
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="flex gap-2 mt-4">
                                    <Button
                                        variant="neon"
                                        className="flex-1"
                                        onClick={() => approve(o.id)}
                                        disabled={busy === o.id}
                                    >
                                        {busy === o.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                                        Approve &amp; print bill
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        onClick={() => { setRejectFor(o.id); setRejectReason("") }}
                                        disabled={busy === o.id}
                                    >
                                        <XCircle className="h-4 w-4" /> Reject
                                    </Button>
                                </div>
                            </motion.div>
                        )
                    })}
                    </AnimatePresence>
                </motion.div>
            )}

            {/* zoom modal */}
            <Dialog open={!!zoom} onOpenChange={(v) => !v && setZoom(null)}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader><DialogTitle>Payment screenshot</DialogTitle></DialogHeader>
                    {zoom && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={zoom} alt="Payment screenshot" className="w-full rounded-md" />
                    )}
                </DialogContent>
            </Dialog>

            {/* reject modal */}
            <Dialog open={!!rejectFor} onOpenChange={(v) => { if (!v) { setRejectFor(null); setRejectReason("") } }}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Reject this order</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                            The customer's screen will show this reason. Their order will be voided and the table freed.
                        </p>
                        <div className="space-y-1.5">
                            <Label>Reason *</Label>
                            <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Payment screenshot doesn't show the correct amount / payment not received yet / ..." />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => { setRejectFor(null); setRejectReason("") }}>Cancel</Button>
                        <Button variant="destructive" onClick={() => rejectFor && reject(rejectFor)} disabled={busy === rejectFor}>
                            {busy === rejectFor && <Loader2 className="h-4 w-4 animate-spin" />}
                            Reject order
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}