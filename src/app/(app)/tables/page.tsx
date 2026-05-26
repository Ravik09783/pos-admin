"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Ban, Building2, ChefHat, Clock, Edit3, Loader2, Pencil, Plus, QrCode, Receipt, ShoppingCart, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { PageHeader } from "@/components/app-shell/page-header"
import { PageTour } from "@/components/tours/page-tour"
import { TourReplayButton } from "@/components/tours/tour-replay-button"
import { createClient } from "@/lib/supabase/client"
import { scopeQueryToBranch, useActiveBranch } from "@/lib/branch/active-branch"
import { computeOrder } from "@/lib/gst/calculator"
import { getTaxConfig } from "@/lib/tax/locale-config"
import { STATUS_LABEL as KOT_STATUS_LABEL, STATUS_ACCENT as KOT_STATUS_ACCENT, type KotStatus } from "@/lib/kot/state-machine"
import { ModifyKotDialog, type ModifiableKotItem } from "@/components/kds/modify-kot-dialog"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import type { DiningTable } from "@/types/database"

const STATUS_COLOR: Record<string, string> = {
    AVAILABLE: "bg-success/15 text-success border-success/30",
    OCCUPIED: "bg-destructive/15 text-destructive border-destructive/30",
    RESERVED: "bg-warning/15 text-warning border-warning/30",
    DIRTY: "bg-muted text-muted-foreground border-border",
    ON_HOLD: "bg-orange-500/15 text-orange-400 border-orange-500/30",
}

export default function TablesPage() {
    const supabase = createClient()
    const router = useRouter()
    const [tables, setTables] = useState<DiningTable[]>([])
    const [tenantId, setTenantId] = useState("")
    const [tenantCountry, setTenantCountry] = useState<string | null>(null)
    // New tables inherit the active branch (set in the topbar switcher).
    // Read-side filtering of the existing tables list will follow in the
    // read-fix batch.
    const { activeBranchId } = useActiveBranch()
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    /** When set, the dialog is in EDIT mode — save() runs UPDATE on this id.
     *  Editing while occupied is blocked at the UI level (the edit button
     *  only appears on the hover-overlay which is itself hidden on occupied
     *  tables — that's intentional, mid-service edits to capacity/section
     *  are usually a mistake). */
    const [editingId, setEditingId] = useState<string | null>(null)
    const EMPTY_FORM = {
        number: "",
        section: "Indoor",
        capacity: "4",
        shape: "square" as "square" | "round" | "rectangle",
    }
    const [form, setForm] = useState(EMPTY_FORM)
    /** Table currently open in the drill-in sheet (null = closed). */
    const [drillTable, setDrillTable] = useState<DiningTable | null>(null)

    async function refresh() {
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) return
        const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
        if (!row?.tenant_id) return
        setTenantId(row.tenant_id)
        let tablesQ = supabase.from("dining_tables").select("*").order("number")
        tablesQ = scopeQueryToBranch(tablesQ, activeBranchId)
        const [{ data: tables }, { data: tenant }] = await Promise.all([
            tablesQ,
            supabase.from("tenants").select("country").eq("id", row.tenant_id).maybeSingle(),
        ])
        setTables((tables ?? []) as DiningTable[])
        setTenantCountry((tenant as { country?: string } | null)?.country ?? null)
    }
    useEffect(() => { refresh() }, [activeBranchId])

    function openAdd() {
        setEditingId(null)
        setForm(EMPTY_FORM)
        setOpen(true)
    }
    function openEdit(t: DiningTable) {
        setEditingId(t.id)
        setForm({
            number: t.number,
            section: t.section ?? "Indoor",
            capacity: String(t.capacity ?? 4),
            shape: (t.shape ?? "square") as "square" | "round" | "rectangle",
        })
        setOpen(true)
    }

    async function save(e: React.FormEvent) {
        e.preventDefault()
        if (!form.number.trim()) return toast.error("Table number required")
        setBusy(true)
        const payload = {
            tenant_id: tenantId,
            number: form.number.trim(),
            section: form.section,
            capacity: Number(form.capacity) || 4,
            shape: form.shape,
        }
        const { error } = editingId
            ? await supabase.from("dining_tables").update(payload as never).eq("id", editingId)
            // New tables stamp the currently-active branch so QR orders
            // placed at this table route to the right outlet.
            : await supabase.from("dining_tables").insert({ ...payload, branch_id: activeBranchId } as never)
        setBusy(false)
        if (error) return toast.error(error.message)
        toast.success(editingId ? "Table updated" : "Table added")
        setOpen(false)
        setEditingId(null)
        setForm(EMPTY_FORM)
        refresh()
    }

    async function setStatus(t: DiningTable, status: DiningTable["status"]) {
        const { error } = await supabase.from("dining_tables").update({ status } as never).eq("id", t.id)
        if (error) return toast.error(error.message)
        refresh()
    }
    async function remove(t: DiningTable) {
        if (!confirm(`Delete table ${t.number}?`)) return
        const { error } = await supabase.from("dining_tables").delete().eq("id", t.id)
        if (error) return toast.error(error.message)
        refresh()
    }

    const sections = Array.from(new Set(tables.map((t) => t.section)))

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-6">
            <PageTour tourKey="tables" />
            <PageHeader
                kicker="Operations"
                title="Tables"
                highlight="floor plan"
                description="Live status, sections, and QR ordering codes."
                actions={
                    <>
                        <Button asChild variant="outline" disabled={tables.length === 0}>
                            <Link href="/tables/qr-codes"><QrCode className="h-4 w-4" /> Print QR codes</Link>
                        </Button>
                        <Button variant="neon" onClick={openAdd}>
                            <Plus className="h-4 w-4" /> Add table
                        </Button>
                        <TourReplayButton tourKey="tables" />
                    </>
                }
            />

            {tables.length === 0 ? (
                <Card data-tour="tables-grid">
                    <CardContent className="text-center py-16 text-muted-foreground">
                        <Building2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        No tables yet. Add your first one.
                    </CardContent>
                </Card>
            ) : (
                sections.map((sec, idx) => (
                    <div key={sec} className="space-y-3" {...(idx === 0 ? { "data-tour": "tables-grid" } : {})}>
                        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{sec}</h2>
                        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                            {tables.filter((t) => t.section === sec).map((t) => {
                                const occupied = t.status === "OCCUPIED"
                                return (
                                    <div
                                        key={t.id}
                                        onClick={() => {
                                            // Occupied → drill into the running order (KOTs, bill).
                                            // Anything else → land on the POS with this table pre-
                                            // selected so a waiter can start taking orders straight
                                            // away (PetPooja-style "tap table → add items").
                                            if (occupied) setDrillTable(t)
                                            else router.push(`/pos?table=${encodeURIComponent(t.number)}`)
                                        }}
                                        className={cn(
                                            "relative rounded-xl border-2 p-4 aspect-square flex flex-col items-center justify-center text-center group transition-all cursor-pointer hover:scale-[1.03]",
                                            STATUS_COLOR[t.status],
                                            t.shape === "round" && "rounded-full",
                                        )}
                                    >
                                        <div className="font-bold text-xl">{t.number}</div>
                                        <div className="text-xs opacity-80">{t.capacity} seats</div>
                                        <Badge variant="outline" className="mt-1 text-[10px] border-current">{t.status}</Badge>
                                        {occupied ? (
                                            <div className="text-[10px] opacity-80 mt-1 flex items-center gap-1">
                                                <ChefHat className="h-3 w-3" /> Tap to view order
                                            </div>
                                        ) : (
                                            <div className="text-[10px] opacity-80 mt-1 flex items-center gap-1">
                                                <ShoppingCart className="h-3 w-3" /> Tap to start order
                                            </div>
                                        )}
                                        {!occupied && (
                                            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 rounded-xl flex flex-col items-center justify-center gap-1.5">
                                                <Select value={t.status} onValueChange={(v) => setStatus(t, v as DiningTable["status"])}>
                                                    <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {(["AVAILABLE","OCCUPIED","RESERVED","DIRTY","ON_HOLD"] as const).map((s) =>
                                                            <SelectItem key={s} value={s}>{s}</SelectItem>
                                                        )}
                                                    </SelectContent>
                                                </Select>
                                                <div className="flex gap-1">
                                                    <Button size="sm" variant="ghost" className="h-7" onClick={(e) => { e.stopPropagation(); openEdit(t) }} aria-label="Edit table">
                                                        <Pencil className="h-3 w-3" />
                                                    </Button>
                                                    <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={(e) => { e.stopPropagation(); remove(t) }} aria-label="Delete table">
                                                        <Trash2 className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                ))
            )}

            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditingId(null) }}>
                <DialogContent>
                    <DialogHeader><DialogTitle>{editingId ? "Edit table" : "Add table"}</DialogTitle></DialogHeader>
                    <form onSubmit={save} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Table number</Label>
                                <Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="T1" />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Capacity</Label>
                                <Input type="number" min="1" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Section</Label>
                                <Input value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Shape</Label>
                                <Select value={form.shape} onValueChange={(v) => setForm({ ...form, shape: v as typeof form.shape })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="square">Square</SelectItem>
                                        <SelectItem value="round">Round</SelectItem>
                                        <SelectItem value="rectangle">Rectangle</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="submit" variant="neon" disabled={busy}>
                                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                                {editingId ? "Save changes" : "Add table"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Running-order drill-in for occupied tables */}
            <RunningOrderSheet
                table={drillTable}
                tenantCountry={tenantCountry}
                onClose={() => setDrillTable(null)}
                onBilled={() => { setDrillTable(null); refresh() }}
                onFreed={() => { setDrillTable(null); refresh() }}
            />
        </div>
    )
}

// ── Running-order sheet ─────────────────────────────────────────────────────
//
// Opens when a staff member taps an OCCUPIED table. Shows the live order with
// every KOT, every item, the running total, and the two actions that close
// out a seating: "Add more items" (jumps to the POS with the table pre-
// selected for the next KOT) and "Generate bill" (calls generate_bill on the
// existing order and navigates to the bill).
// ─────────────────────────────────────────────────────────────────────────────
interface RunningOrder {
    id: string
    order_number: string
    status: string
    created_at: string
    customer_id: string | null
    customer: { id: string; name: string | null; phone: string | null } | { id: string; name: string | null; phone: string | null }[] | null
    kots: Array<{
        id: string
        kot_number: number
        seq_in_order: number
        status: KotStatus
        note: string | null
        sent_at: string
        waiter: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null
    }>
    order_items: Array<{
        id: string
        item_name: string
        quantity: number | string
        unit_price: number | string
        gst_slab: number | string
        taxable_amount: number | string
        line_total: number | string
        notes: string | null
        is_void: boolean
        kot_id: string | null
    }>
}

function firstEmbed<T>(v: T | T[] | null | undefined): T | null {
    if (v == null) return null
    return Array.isArray(v) ? (v[0] ?? null) : v
}

function RunningOrderSheet({
    table, tenantCountry, onClose, onBilled, onFreed,
}: {
    table: DiningTable | null
    tenantCountry: string | null
    onClose: () => void
    onBilled: () => void
    /** Fires after the table is manually marked AVAILABLE (no bill cut). */
    onFreed: () => void
}) {
    const supabase = createClient()
    const router = useRouter()
    const cfg = getTaxConfig(tenantCountry)
    const money = (v: number) => formatCurrency(v, cfg.currency)

    const [order, setOrder] = useState<RunningOrder | null>(null)
    const [loading, setLoading] = useState(false)
    const [billing, setBilling] = useState(false)
    const [freeing, setFreeing] = useState(false)

    // Bill-time adjustments
    const [serviceChargePct, setServiceChargePct] = useState<string>("0")
    const [orderDiscount, setOrderDiscount] = useState<string>("0")
    const [noGst, setNoGst] = useState(false)

    // Payment captured at billing time. Matches the POS-checkout contract:
    // generate_bill takes a `p_payments` array so the bill row + the
    // payment rows commit together. The drawer used to skip this — that
    // produced "bill generated, nothing paid" orphans that the cashier
    // had to fix on the bill detail page. UPI requires the UTR reference
    // (12-digit txn id); CASH never does; CARD reference is optional.
    type PayMethod = "CASH" | "UPI" | "CARD"
    const [payMethod, setPayMethod] = useState<PayMethod>("CASH")
    const [payRef, setPayRef] = useState("")

    /** The KOT currently being edited via ModifyKotDialog, or null when
     *  the dialog is closed. We open the dialog with the KOT's CURRENT
     *  items snapshot — the dialog calls back into refreshOrder() on
     *  successful save so we always render the updated state. */
    const [modifyingKotId, setModifyingKotId] = useState<string | null>(null)
    const [cancellingKotId, setCancellingKotId] = useState<string | null>(null)

    /** Cancel a KOT outright (the customer changed their mind on the
     *  whole batch). Goes through the existing `cancel_kot` RPC which
     *  voids the items + flips status to CANCELLED in one transaction;
     *  the kitchen card drops off the KDS the moment it commits. The
     *  kitchen ALSO has a Cancel button on /kds for the same RPC —
     *  this just gives the cashier a parallel path from the floor. */
    async function cancelKot(kotId: string, kotNumber: number, kotStatus: KotStatus) {
        if (kotStatus !== "PENDING" && kotStatus !== "PREPARING") {
            toast.error(`KOT #${kotNumber} is already ${kotStatus}. Can't cancel after the kitchen has plated.`)
            return
        }
        const reason = window.prompt(`Cancel KOT #${kotNumber}? Reason:`)
        if (!reason || reason.trim().length < 3) return
        setCancellingKotId(kotId)
        try {
            const { error } = await supabase.rpc("cancel_kot" as never, {
                p_kot_id: kotId,
                p_reason: reason.trim(),
            } as never)
            if (error) throw error
            toast.success(`KOT #${kotNumber} cancelled`)
            await refreshOrder()
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to cancel KOT")
        } finally {
            setCancellingKotId(null)
        }
    }

    async function refreshOrder() {
        if (!table) return
        const { data, error } = await supabase
            .from("orders")
            .select(`
                id, order_number, status, created_at, customer_id,
                customer:customers(id, name, phone),
                kots(id, kot_number, seq_in_order, status, note, sent_at, waiter:users!kots_created_by_fkey(full_name, email)),
                order_items(id, item_name, quantity, unit_price, gst_slab, taxable_amount, line_total, notes, is_void, kot_id)
            `)
            .eq("table_id", table.id)
            .in("status", ["OPEN", "IN_PROGRESS", "ON_HOLD"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        if (error) { toast.error(error.message); return }
        setOrder((data as unknown as RunningOrder | null) ?? null)
    }

    useEffect(() => {
        if (!table) { setOrder(null); return }
        let cancelled = false
        ;(async () => {
            setLoading(true)
            await refreshOrder()
            if (cancelled) return
            setLoading(false)
        })()
        return () => { cancelled = true }
        // refreshOrder closes over `table` already; we re-run whenever
        // `table` changes via the dependency below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [table, supabase])

    if (!table) return null

    // Live totals — uses the same computeOrder helper the POS uses, so the
    // preview here matches what generate_bill will produce on the server.
    const liveItems = (order?.order_items ?? []).filter((it) => !it.is_void)
    const totals = liveItems.length > 0 ? computeOrder({
        lines: liveItems.map((it) => ({
            quantity: Number(it.quantity),
            unit_price: Number(it.unit_price),
            gst_slab: Number(it.gst_slab),
        })),
        isInterState: false,
        taxModel: cfg.taxModel,
        noGst,
        serviceChargePercent: cfg.serviceChargeAllowed ? Number(serviceChargePct) || 0 : 0,
        orderDiscount: Number(orderDiscount) || 0,
        roundToNearestRupee: false,
    }) : null

    const customer = firstEmbed(order?.customer)
    const kots = (order?.kots ?? []).slice().sort((a, b) => a.seq_in_order - b.seq_in_order)
    const itemsByKot = new Map<string | null, typeof liveItems>()
    for (const it of liveItems) {
        const k = it.kot_id ?? null
        const arr = itemsByKot.get(k) ?? []
        arr.push(it)
        itemsByKot.set(k, arr)
    }

    /** Manually flip the table back to AVAILABLE. Two real paths get here:
     *    a) The "no running order linked" case (orphan occupied table).
     *    b) The cashier finished serving and wants to free the table without
     *       running the bill through here (already cashed up elsewhere).
     *  In both cases we double-prompt if there IS an active order so a
     *  click doesn't lose the order silently — the order stays as it is,
     *  only the table flips. */
    async function markAvailable() {
        if (!table) return
        if (order) {
            const ok = window.confirm(
                `This table still has an open order (${order.order_number}). ` +
                `Free the table anyway? The order will remain open and can still be billed from the orders list.`,
            )
            if (!ok) return
        }
        setFreeing(true)
        try {
            const { error } = await supabase
                .from("dining_tables")
                .update({ status: "AVAILABLE" } as never)
                .eq("id", table.id)
            if (error) throw error
            toast.success(`Table ${table.number} is now available`)
            onFreed()
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to free table")
        } finally {
            setFreeing(false)
        }
    }

    async function generateBill() {
        if (!order) return
        if (!totals || totals.grand_total <= 0) {
            return toast.error("Add at least one item before billing")
        }

        // Payment validation — match the POS checkout contract. UPI must
        // carry the UTR (12-digit txn id) because that's the only way to
        // verify the customer actually paid; CASH never needs a reference;
        // CARD reference (last-4) stays optional.
        const trimmedRef = payRef.trim()
        if (payMethod === "UPI" && !/^\d{10,18}$/.test(trimmedRef)) {
            return toast.error("Enter the UPI UTR (10–18 digits from the customer's app) to confirm the payment.")
        }

        setBilling(true)
        try {
            // generate_bill now accepts `p_payments` — the bill row and
            // the payment rows commit in the SAME transaction, so we
            // can't leave "bill generated, nothing paid" orphans like
            // the old two-step path did.
            const { data, error } = await supabase.rpc("generate_bill" as never, {
                p_order_id: order.id,
                p_customer_id: order.customer_id,
                p_service_charge: cfg.serviceChargeAllowed
                    ? (Number(serviceChargePct) ? (totals?.subtotal ?? 0) * Number(serviceChargePct) / 100 : 0)
                    : 0,
                p_order_discount: Number(orderDiscount) || 0,
                p_round_off: 0,
                p_no_gst: noGst,
                p_tax_model: cfg.taxModel,
                p_payments: [{
                    method: payMethod,
                    amount: totals.grand_total,
                    reference: trimmedRef || null,
                }],
            } as never)
            if (error) throw error
            const r = data as {
                bill_id: string
                invoice_number: string
                payments_recorded?: number
                fully_paid?: boolean
            }
            // Sanity guard: if the server somehow committed the bill but
            // dropped the payment, warn loudly so the cashier sees it
            // rather than discovers the orphan on the bill page later.
            if ((r.payments_recorded ?? 0) === 0) {
                toast.warning(`Bill ${r.invoice_number} generated but payment not recorded. Open the bill to record it.`)
            } else {
                toast.success(`Bill ${r.invoice_number} — ${money(totals.grand_total)} ${payMethod === "CASH" ? "in cash" : payMethod === "UPI" ? "via UPI" : "on card"}`)
            }
            // Reset for next seating; the drawer will close as part of onBilled.
            setPayRef("")
            setPayMethod("CASH")
            onBilled()
            router.push(`/bills/${r.bill_id}`)
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to generate bill")
        } finally {
            setBilling(false)
        }
    }

    return (
        <Sheet open={!!table} onOpenChange={(v) => !v && onClose()}>
            {/* SheetContent has no default padding — every section was
              * sitting flush against the edge. p-6 gives a comfortable
              * gutter, pr-12 leaves room for the absolute-positioned
              * close button at top-right, and pb-10 reserves space for
              * the action buttons so they never crowd the bottom edge. */}
            <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto p-6 pr-10 pb-10">
                <SheetTitle className="flex items-center gap-2">
                    Table {table.number}
                    <Badge variant="destructive" className="text-[10px]">OCCUPIED</Badge>
                </SheetTitle>

                {loading ? (
                    <p className="text-sm text-muted-foreground mt-4">Loading running order…</p>
                ) : !order ? (
                    <Card className="mt-4">
                        <CardContent className="text-sm text-muted-foreground py-6 text-center space-y-4">
                            <p>
                                This table is marked occupied but no running order is linked.
                                Free it up to take a new booking, or take a fresh order from the POS.
                            </p>
                            <Button variant="neon" onClick={markAvailable} disabled={freeing}>
                                {freeing && <Loader2 className="h-4 w-4 animate-spin" />}
                                Mark available
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="mt-4 space-y-4">
                        <div className="rounded-md border border-border/60 p-3 text-sm">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="font-mono text-xs text-muted-foreground">{order.order_number}</div>
                                    <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                        <Clock className="h-3 w-3" /> opened {formatDate(order.created_at)}
                                    </div>
                                </div>
                                {customer && (
                                    <div className="text-right text-xs">
                                        <div className="font-medium">{customer.name ?? "—"}</div>
                                        {customer.phone && <div className="text-muted-foreground">{customer.phone}</div>}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* KOTs */}
                        {kots.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No KOTs sent yet on this table.</p>
                        ) : (
                            <div className="space-y-2">
                                <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Kitchen tickets</h3>
                                {kots.map((k) => {
                                    const w = firstEmbed(k.waiter)
                                    const items = (itemsByKot.get(k.id) ?? [])
                                    const accent = KOT_STATUS_ACCENT[k.status]
                                    return (
                                        <div key={k.id} className="rounded-md border border-border/50 p-2.5 text-sm">
                                            <div className="flex items-center justify-between gap-2 mb-1">
                                                <div className="font-mono text-xs">
                                                    KOT #{k.kot_number} <span className="opacity-70">· batch {k.seq_in_order}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    {/* Modify + Cancel both only valid for KOTs the
                                                      * kitchen hasn't plated yet. Modify edits the
                                                      * items (with an audit row if PREPARING).
                                                      * Cancel kills the whole KOT. Both call
                                                      * server RPCs that re-enforce the state guard,
                                                      * so hiding the buttons here is purely UX. */}
                                                    {(k.status === "PENDING" || k.status === "PREPARING") && (
                                                        <>
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-6 w-6"
                                                                title="Modify items on this KOT (logs reason + history)"
                                                                onClick={() => setModifyingKotId(k.id)}
                                                                disabled={cancellingKotId === k.id}
                                                            >
                                                                <Edit3 className="h-3 w-3" />
                                                            </Button>
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-6 w-6"
                                                                title="Cancel this KOT (kitchen stops cooking)"
                                                                onClick={() => cancelKot(k.id, k.kot_number, k.status)}
                                                                disabled={cancellingKotId === k.id}
                                                            >
                                                                {cancellingKotId === k.id
                                                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                                                    : <Ban className="h-3 w-3 text-destructive" />}
                                                            </Button>
                                                        </>
                                                    )}
                                                    <Badge variant={accent === "destructive" ? "destructive" : accent === "success" ? "success" : accent === "warning" ? "warning" : "outline"} className="text-[10px]">
                                                        {KOT_STATUS_LABEL[k.status]}
                                                    </Badge>
                                                </div>
                                            </div>
                                            {w && (
                                                <div className="text-[11px] text-muted-foreground mb-1">
                                                    by {w.full_name ?? w.email ?? "—"} · {formatDate(k.sent_at, { timeStyle: "short", dateStyle: undefined as never })}
                                                </div>
                                            )}
                                            {items.length === 0 ? (
                                                <p className="text-[11px] text-muted-foreground italic">(no items)</p>
                                            ) : (
                                                <ul className="text-xs space-y-0.5">
                                                    {items.map((it) => (
                                                        <li key={it.id} className={cn("flex justify-between gap-2", it.is_void && "line-through opacity-50")}>
                                                            <span><span className="text-primary mr-1">×{Number(it.quantity)}</span>{it.item_name}</span>
                                                            <span className="tabular-nums text-muted-foreground">{money(Number(it.line_total))}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                            {k.note && <div className="text-[11px] text-amber-400 mt-1">⚠ {k.note}</div>}
                                        </div>
                                    )
                                })}
                            </div>
                        )}

                        {/* Bill-time adjustments */}
                        {liveItems.length > 0 && (
                            <div className="space-y-2 border-t border-border/40 pt-3">
                                <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Before billing</h3>
                                <div className="grid grid-cols-2 gap-2">
                                    {cfg.serviceChargeAllowed && (
                                        <div className="space-y-1">
                                            <Label className="text-xs">Service charge %</Label>
                                            <Input type="number" step="0.5" min="0" max="20" value={serviceChargePct} onChange={(e) => setServiceChargePct(e.target.value)} className="h-8" />
                                        </div>
                                    )}
                                    <div className="space-y-1">
                                        <Label className="text-xs">Order discount ({cfg.currency})</Label>
                                        <Input type="number" step="1" min="0" value={orderDiscount} onChange={(e) => setOrderDiscount(e.target.value)} className="h-8" />
                                    </div>
                                </div>
                                <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                                    <Label className="text-xs">Bill without {cfg.taxShortName}</Label>
                                    <Switch checked={noGst} onCheckedChange={setNoGst} />
                                </div>
                            </div>
                        )}

                        {/* Payment capture — locks the bill + payment
                          * into one atomic generate_bill call so the
                          * cashier can't accidentally produce an
                          * unpaid invoice from this drawer. India only
                          * sees UPI; the country-aware POS dialog
                          * applies the same rule. */}
                        {liveItems.length > 0 && (
                            <div className="space-y-2 border-t border-border/40 pt-3">
                                <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Payment</h3>
                                <div className="grid grid-cols-3 gap-2">
                                    <PayBtn active={payMethod === "CASH"} onClick={() => setPayMethod("CASH")} label="Cash" />
                                    {cfg.code === "IN" && (
                                        <PayBtn active={payMethod === "UPI"} onClick={() => setPayMethod("UPI")} label="UPI" />
                                    )}
                                    <PayBtn active={payMethod === "CARD"} onClick={() => setPayMethod("CARD")} label="Card" />
                                </div>
                                {(payMethod === "UPI" || payMethod === "CARD") && (
                                    <div className="space-y-1">
                                        <Label className="text-xs">
                                            {payMethod === "UPI"
                                                ? "UPI UTR (12-digit txn id) *"
                                                : "Card last 4 digits (optional)"}
                                        </Label>
                                        <Input
                                            value={payRef}
                                            onChange={(e) => setPayRef(e.target.value)}
                                            placeholder={payMethod === "UPI" ? "123456789012" : "1234"}
                                            className="h-8 font-mono text-xs"
                                            maxLength={payMethod === "UPI" ? 18 : 4}
                                            inputMode="numeric"
                                        />
                                        {payMethod === "UPI" && (
                                            <p className="text-[10px] text-muted-foreground">
                                                Ask the customer to read out the UTR from their UPI app — it&apos;s how we prove the payment landed.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Totals preview */}
                        {totals && (
                            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm space-y-1">
                                <Row label="Subtotal" value={money(totals.subtotal)} />
                                {totals.order_discount > 0 && <Row label="Discount" value={`− ${money(totals.order_discount)}`} />}
                                {!noGst && cfg.taxModel !== "none" && (
                                    cfg.taxModel === "split"
                                        ? <>
                                            <Row label="CGST" value={money(totals.cgst_amount)} />
                                            <Row label="SGST" value={money(totals.sgst_amount)} />
                                        </>
                                        : <Row label={cfg.taxLabels.single ?? cfg.taxShortName} value={money(totals.igst_amount)} />
                                )}
                                {totals.service_charge > 0 && <Row label="Service charge" value={money(totals.service_charge)} />}
                                <Row label="Grand total" value={money(totals.grand_total)} bold />
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex flex-col gap-2 pt-2">
                            <Button asChild variant="outline" className="w-full" disabled={billing}>
                                <Link href={`/pos?table=${encodeURIComponent(table.number)}`}>
                                    <ShoppingCart className="h-4 w-4" /> Add more items (new KOT)
                                </Link>
                            </Button>
                            <Button variant="neon" className="w-full" onClick={generateBill} disabled={billing || liveItems.length === 0}>
                                {billing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
                                Charge {totals ? money(totals.grand_total) : ""} &amp; generate bill
                            </Button>
                            {/* Escape hatch — free the table without running a bill through
                             *  this sheet. Prompts for confirmation since the order stays open. */}
                            <Button variant="ghost" className="w-full text-xs text-muted-foreground" onClick={markAvailable} disabled={freeing}>
                                {freeing && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                                Free table without billing
                            </Button>
                        </div>
                    </div>
                )}
            </SheetContent>
            {/* Modify-KOT dialog. Resolves the selected KOT from the
              * currently-loaded order; closes via setModifyingKotId(null).
              * The dialog calls refreshOrder() on save so the drawer
              * shows the new state of the KOT immediately. */}
            {modifyingKotId && order && (() => {
                const k = order.kots.find((x) => x.id === modifyingKotId)
                if (!k) return null
                const items = (order.order_items ?? []).filter((it) => it.kot_id === modifyingKotId) as ModifiableKotItem[]
                return (
                    <ModifyKotDialog
                        open={true}
                        onClose={() => setModifyingKotId(null)}
                        kotId={k.id}
                        kotNumber={k.kot_number}
                        kotStatus={k.status}
                        currentItems={items}
                        currency={cfg.currency}
                        onSaved={refreshOrder}
                    />
                )
            })()}
        </Sheet>
    )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
    return (
        <div className={cn("flex items-center justify-between gap-3", bold && "font-semibold text-base pt-1 border-t border-primary/30 mt-1")}>
            <span className="text-muted-foreground">{label}</span>
            <span className="tabular-nums">{value}</span>
        </div>
    )
}

function PayBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "h-9 rounded-md border text-xs font-medium transition-colors",
                active
                    ? "border-primary bg-primary text-primary-foreground shadow-glow"
                    : "border-border/60 bg-card/40 text-muted-foreground hover:text-foreground hover:border-primary/40",
            )}
        >
            {label}
        </button>
    )
}
