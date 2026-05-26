"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, Filter, Loader2, Pencil, Plus, ReceiptText, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DateRangePicker, type DateRange } from "@/components/filters/date-range"
import { Pagination } from "@/components/filters/pagination"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { buildPeriod } from "@/lib/ca-export/fetch"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import type { Purchase, Vendor } from "@/types/database"

type SortField = "vendor_invoice_date" | "grand_total" | "purchase_number"

export default function PurchasesPage() {
    const supabase = createClient()
    const [tenantId, setTenantId] = useState("")
    const [tenantStateCode, setTenantStateCode] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [vendors, setVendors] = useState<Vendor[]>([])
    const [purchases, setPurchases] = useState<(Purchase & { vendors?: { name: string } | null })[]>([])
    const [total, setTotal] = useState(0)

    const [page, setPage] = useState(0)
    const [pageSize, setPageSize] = useState(50)
    const [sortBy, setSortBy] = useState<SortField>("vendor_invoice_date")
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

    const [search, setSearch] = useState("")
    const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null })
    const [vendorId, setVendorId] = useState<string>("ALL")
    const [interStateOnly, setInterStateOnly] = useState(false)
    const [intraStateOnly, setIntraStateOnly] = useState(false)
    const [itcEligibleOnly, setItcEligibleOnly] = useState(false)
    const [itcUnclaimedOnly, setItcUnclaimedOnly] = useState(false)
    const [paymentStatus, setPaymentStatus] = useState<"ALL" | "UNPAID" | "PARTIAL" | "PAID">("ALL")
    const [showFilters, setShowFilters] = useState(false)
    const [minAmount, setMinAmount] = useState("")
    const [maxAmount, setMaxAmount] = useState("")

    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    /** When set, the dialog is in EDIT mode — save() runs UPDATE on this id.
     *  We preserve the original purchase_number + fy_label (the sequence
     *  allocation is immutable; reissuing would corrupt the FY ordering),
     *  and warn the admin if they're editing a purchase whose ITC has
     *  already been CLAIMED in a GST filing. */
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editingMeta, setEditingMeta] = useState<{ purchase_number: string; fy_label: string; itc_claimed: boolean } | null>(null)
    const EMPTY_FORM = {
        vendor_id: "",
        vendor_invoice_no: "",
        invoice_date: new Date().toISOString().slice(0, 10),
        taxable: "",
        gst_slab: "5",
        is_inter_state: false,
        other_charges: "0",
        itc_eligible: true,
    }
    const [form, setForm] = useState(EMPTY_FORM)

    const filtersActive = useMemo(() =>
        search.trim().length > 0 ||
        dateRange.from || dateRange.to ||
        vendorId !== "ALL" ||
        interStateOnly || intraStateOnly ||
        itcEligibleOnly || itcUnclaimedOnly ||
        paymentStatus !== "ALL" ||
        minAmount || maxAmount,
    [search, dateRange, vendorId, interStateOnly, intraStateOnly, itcEligibleOnly, itcUnclaimedOnly, paymentStatus, minAmount, maxAmount])

    function clearFilters() {
        setSearch(""); setDateRange({ from: null, to: null }); setVendorId("ALL")
        setInterStateOnly(false); setIntraStateOnly(false)
        setItcEligibleOnly(false); setItcUnclaimedOnly(false)
        setPaymentStatus("ALL"); setMinAmount(""); setMaxAmount(""); setPage(0)
    }

    async function refresh() {
        setLoading(true)
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) return
        const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
        if (!row?.tenant_id) return
        setTenantId(row.tenant_id)

        const [{ data: tenant }, { data: vs }] = await Promise.all([
            supabase.from("tenants").select("state_code").eq("id", row.tenant_id).maybeSingle(),
            supabase.from("vendors").select("*").is("deleted_at", null).order("name"),
        ])
        setTenantStateCode((tenant as { state_code?: string } | null)?.state_code ?? null)
        setVendors((vs ?? []) as Vendor[])

        let q = supabase.from("purchases").select("*, vendors:vendor_id(name)", { count: "exact" })
        if (search.trim()) {
            const s = search.trim()
            q = q.or(`purchase_number.ilike.%${s}%,vendor_invoice_no.ilike.%${s}%`)
        }
        if (dateRange.from) q = q.gte("vendor_invoice_date", dateRange.from)
        if (dateRange.to)   q = q.lte("vendor_invoice_date", dateRange.to)
        if (vendorId !== "ALL") q = q.eq("vendor_id", vendorId)
        if (interStateOnly) q = q.eq("is_inter_state", true)
        if (intraStateOnly) q = q.eq("is_inter_state", false)
        if (itcEligibleOnly) q = q.eq("itc_eligible", true)
        if (itcUnclaimedOnly) q = q.eq("itc_claimed", false).eq("itc_eligible", true)
        if (paymentStatus !== "ALL") q = q.eq("payment_status", paymentStatus)
        if (minAmount) q = q.gte("grand_total", Number(minAmount))
        if (maxAmount) q = q.lte("grand_total", Number(maxAmount))

        q = q.order(sortBy, { ascending: sortDir === "asc" })
        q = q.range(page * pageSize, (page + 1) * pageSize - 1)
        const { data, count } = await q
        setPurchases((data ?? []) as (Purchase & { vendors?: { name: string } | null })[])
        setTotal(count ?? 0)
        setLoading(false)
    }

    useEffect(() => { refresh() }, [page, pageSize, sortBy, sortDir, dateRange.from, dateRange.to, vendorId, interStateOnly, intraStateOnly, itcEligibleOnly, itcUnclaimedOnly, paymentStatus, minAmount, maxAmount])
    useEffect(() => { const t = setTimeout(refresh, 300); return () => clearTimeout(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search])

    const calculated = useMemo(() => {
        const taxable = Number(form.taxable) || 0
        const slab = Number(form.gst_slab) || 0
        const cgst = form.is_inter_state ? 0 : Math.round((taxable * slab / 200) * 100) / 100
        const sgst = cgst
        const igst = form.is_inter_state ? Math.round((taxable * slab / 100) * 100) / 100 : 0
        const other = Number(form.other_charges) || 0
        return { cgst, sgst, igst, total: taxable + cgst + sgst + igst + other }
    }, [form])

    function toggleSort(field: SortField) {
        if (sortBy === field) setSortDir((d) => d === "asc" ? "desc" : "asc")
        else { setSortBy(field); setSortDir("desc") }
    }

    function openAdd() {
        setEditingId(null)
        setEditingMeta(null)
        setForm(EMPTY_FORM)
        setOpen(true)
    }
    function openEdit(p: Purchase) {
        // ITC-claimed purchases trip a warning; admin can still proceed if
        // they really need to fix a typo, but they have to acknowledge.
        if (p.itc_claimed) {
            const ok = window.confirm(
                `Purchase ${p.purchase_number} has its ITC marked CLAIMED — it's already in a filed GST return. ` +
                `Editing it now will desync the historical filing. Continue anyway?`,
            )
            if (!ok) return
        }
        setEditingId(p.id)
        setEditingMeta({
            purchase_number: p.purchase_number,
            fy_label: p.fy_label,
            itc_claimed: p.itc_claimed,
        })
        // Reverse-derive the GST slab from the saved tax + taxable amount.
        // Inter-state purchases use IGST; intra-state use CGST+SGST. Round
        // to the nearest standard slab so the picker shows a sensible value.
        const tax = Number(p.is_inter_state ? p.igst_amount : (Number(p.cgst_amount) + Number(p.sgst_amount)))
        const slab = Number(p.taxable_amount) > 0
            ? Math.round((tax / Number(p.taxable_amount)) * 100)
            : 0
        const standardSlab = [0, 5, 12, 18, 28].includes(slab) ? slab : 5
        setForm({
            vendor_id: p.vendor_id ?? "",
            vendor_invoice_no: p.vendor_invoice_no ?? "",
            invoice_date: p.vendor_invoice_date,
            taxable: String(p.taxable_amount),
            gst_slab: String(standardSlab),
            is_inter_state: p.is_inter_state,
            other_charges: String(p.other_charges ?? 0),
            itc_eligible: p.itc_eligible,
        })
        setOpen(true)
    }

    async function save(e: React.FormEvent) {
        e.preventDefault()
        if (!form.vendor_id) return toast.error("Pick a vendor")
        const taxable = Number(form.taxable)
        if (!Number.isFinite(taxable) || taxable <= 0) return toast.error("Taxable amount required")
        setBusy(true)
        try {
            const v = vendors.find((x) => x.id === form.vendor_id)
            const inter = form.is_inter_state || (v?.state_code && tenantStateCode && v.state_code !== tenantStateCode)

            // The financial fields below are recomputed on every save, but
            // purchase_number + fy_label only get assigned on CREATE so the
            // sequence stays stable across edits.
            const financials = {
                tenant_id: tenantId,
                vendor_id: form.vendor_id,
                vendor_invoice_no: form.vendor_invoice_no || null,
                vendor_invoice_date: form.invoice_date,
                is_inter_state: !!inter,
                subtotal: taxable,
                taxable_amount: taxable,
                cgst_amount: inter ? 0 : calculated.cgst,
                sgst_amount: inter ? 0 : calculated.sgst,
                igst_amount: inter ? Math.round((taxable * Number(form.gst_slab) / 100) * 100) / 100 : 0,
                other_charges: Number(form.other_charges) || 0,
                grand_total: calculated.total,
                itc_eligible: form.itc_eligible,
            }

            if (editingId) {
                const { error } = await supabase
                    .from("purchases")
                    .update(financials as never)
                    .eq("id", editingId)
                if (error) throw error
                toast.success(`Purchase ${editingMeta?.purchase_number ?? ""} updated`)
            } else {
                const { data: seq, error: se } = await supabase.rpc("next_sequence" as never, { p_tenant: tenantId, p_type: "purchase" } as never)
                if (se) throw se
                const fy = buildPeriod(new Date(form.invoice_date).getFullYear(), new Date(form.invoice_date).getMonth() + 1).fyLabel
                const purchaseNumber = `PUR-${fy}-${String(seq as number).padStart(5, "0")}`
                const { error } = await supabase
                    .from("purchases")
                    .insert({ ...financials, purchase_number: purchaseNumber, fy_label: fy } as never)
                if (error) throw error
                toast.success("Purchase saved")
            }
            setOpen(false)
            setEditingId(null)
            setEditingMeta(null)
            setForm(EMPTY_FORM)
            refresh()
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to save")
        } finally {
            setBusy(false)
        }
    }

    async function remove(p: Purchase) {
        if (p.itc_claimed) {
            const ok = window.confirm(
                `Purchase ${p.purchase_number} has its ITC marked CLAIMED — it's already in a filed GST return. ` +
                `Deleting it will create a gap in the audit trail. Continue?`,
            )
            if (!ok) return
        } else if (!confirm(`Delete purchase ${p.purchase_number}?`)) {
            return
        }
        const { error } = await supabase.from("purchases").delete().eq("id", p.id)
        if (error) return toast.error(error.message)
        refresh()
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-4">
            <PageHeader
                kicker="Finance"
                title="Purchases"
                highlight="ITC-ready"
                description="Vendor invoices feeding the CA Export and ITC."
                actions={
                    <>
                        <Button variant="outline" onClick={() => setShowFilters((s) => !s)}>
                            <Filter className="h-4 w-4" /> Filters
                            {filtersActive && <Badge variant="neon" className="ml-1 text-[10px] px-1.5">on</Badge>}
                        </Button>
                        <Button variant="neon" onClick={openAdd} disabled={vendors.length === 0}>
                            <Plus className="h-4 w-4" /> Record purchase
                        </Button>
                    </>
                }
            />

            {vendors.length === 0 && (
                <Card><CardContent className="text-sm text-muted-foreground py-4">Add a vendor first from <a href="/vendors" className="text-primary hover:underline">Vendors</a>.</CardContent></Card>
            )}

            <Card>
                <CardContent className="pt-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative flex-1 min-w-[200px]">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(e) => { setSearch(e.target.value); setPage(0) }}
                                placeholder="Purchase # or vendor invoice #"
                                className="pl-8"
                            />
                        </div>
                        <DateRangePicker value={dateRange} onChange={(v) => { setDateRange(v); setPage(0) }} />
                        <Select value={vendorId} onValueChange={(v) => { setVendorId(v); setPage(0) }}>
                            <SelectTrigger className="w-44 h-9"><SelectValue placeholder="Vendor" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">All vendors</SelectItem>
                                {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={paymentStatus} onValueChange={(v) => { setPaymentStatus(v as typeof paymentStatus); setPage(0) }}>
                            <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">Any payment</SelectItem>
                                <SelectItem value="UNPAID">Unpaid</SelectItem>
                                <SelectItem value="PARTIAL">Partial</SelectItem>
                                <SelectItem value="PAID">Paid</SelectItem>
                            </SelectContent>
                        </Select>
                        {filtersActive && <Button variant="ghost" size="sm" onClick={clearFilters}><X className="h-3.5 w-3.5" /> Clear</Button>}
                    </div>

                    {showFilters && (
                        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-border/40">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Min total (₹)</Label>
                                <Input type="number" min="0" value={minAmount} onChange={(e) => { setMinAmount(e.target.value); setPage(0) }} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Max total (₹)</Label>
                                <Input type="number" min="0" value={maxAmount} onChange={(e) => { setMaxAmount(e.target.value); setPage(0) }} />
                            </div>
                            <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                                <Label className="text-xs">Inter-state only</Label>
                                <Switch checked={interStateOnly} onCheckedChange={(v) => { setInterStateOnly(v); if (v) setIntraStateOnly(false); setPage(0) }} />
                            </div>
                            <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                                <Label className="text-xs">Intra-state only</Label>
                                <Switch checked={intraStateOnly} onCheckedChange={(v) => { setIntraStateOnly(v); if (v) setInterStateOnly(false); setPage(0) }} />
                            </div>
                            <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                                <Label className="text-xs">ITC eligible</Label>
                                <Switch checked={itcEligibleOnly} onCheckedChange={(v) => { setItcEligibleOnly(v); setPage(0) }} />
                            </div>
                            <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                                <Label className="text-xs">ITC unclaimed</Label>
                                <Switch checked={itcUnclaimedOnly} onCheckedChange={(v) => { setItcUnclaimedOnly(v); setPage(0) }} />
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="py-3 flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-base">Results</CardTitle>
                    <div className="text-xs text-muted-foreground">{loading ? "Loading…" : `${total} purchase${total === 1 ? "" : "s"}`}</div>
                </CardHeader>
                <CardContent className="px-0">
                    {loading ? (
                        <div className="px-6 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
                    ) : purchases.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <ReceiptText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            {filtersActive ? "No purchases match the filters." : "No purchases yet."}
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <SortHead field="purchase_number" label="Purchase #" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                                    <TableHead>Vendor inv</TableHead>
                                    <SortHead field="vendor_invoice_date" label="Date" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                                    <TableHead>Vendor</TableHead>
                                    <TableHead>POS</TableHead>
                                    <TableHead className="text-right">Taxable</TableHead>
                                    <TableHead className="text-right">Tax</TableHead>
                                    <SortHead field="grand_total" label="Total" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} className="text-right" />
                                    <TableHead>ITC</TableHead>
                                    <TableHead>Pay</TableHead>
                                    <TableHead className="text-right w-[100px]">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {purchases.map((p) => (
                                    <TableRow key={p.id}>
                                        <TableCell className="font-mono text-xs">{p.purchase_number}</TableCell>
                                        <TableCell className="text-sm">{p.vendor_invoice_no ?? "—"}</TableCell>
                                        <TableCell className="text-sm">{formatDate(p.vendor_invoice_date, { dateStyle: "short" })}</TableCell>
                                        <TableCell>{p.vendors?.name ?? "—"}</TableCell>
                                        <TableCell><Badge variant="outline">{p.is_inter_state ? "Inter" : "Intra"}</Badge></TableCell>
                                        <TableCell className="text-right tabular-nums">{formatCurrency(p.taxable_amount)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatCurrency(Number(p.cgst_amount) + Number(p.sgst_amount) + Number(p.igst_amount))}</TableCell>
                                        <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(p.grand_total)}</TableCell>
                                        <TableCell>
                                            <Badge variant={p.itc_eligible ? (p.itc_claimed ? "success" : "warning") : "secondary"} className="text-[10px]">
                                                {p.itc_eligible ? (p.itc_claimed ? "Claimed" : "Eligible") : "No"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell><Badge variant={p.payment_status === "PAID" ? "success" : p.payment_status === "PARTIAL" ? "warning" : "secondary"} className="text-[10px]">{p.payment_status}</Badge></TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center gap-1 justify-end">
                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)} aria-label="Edit purchase">
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(p)} aria-label="Delete purchase">
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
                <Pagination
                    page={page} pageSize={pageSize} total={total}
                    onPageChange={setPage} onPageSizeChange={setPageSize}
                    className="border-t border-border/40"
                />
            </Card>

            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditingId(null); setEditingMeta(null) } }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {editingId
                                ? `Edit purchase${editingMeta?.purchase_number ? ` · ${editingMeta.purchase_number}` : ""}`
                                : "Record purchase"}
                        </DialogTitle>
                    </DialogHeader>
                    {editingMeta?.itc_claimed && (
                        <div className="rounded-md bg-warning/10 border border-warning/40 px-3 py-2 text-xs text-warning-foreground/90 mb-1">
                            ITC for this purchase has been claimed. Edits will desync this row from any GST return already filed.
                        </div>
                    )}
                    <form onSubmit={save} className="space-y-3">
                        <div className="space-y-1.5">
                            <Label>Vendor *</Label>
                            <Select value={form.vendor_id} onValueChange={(v) => setForm({ ...form, vendor_id: v })}>
                                <SelectTrigger><SelectValue placeholder="Pick vendor" /></SelectTrigger>
                                <SelectContent>
                                    {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}{v.gstin ? ` (${v.gstin})` : ""}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Vendor invoice #</Label>
                                <Input value={form.vendor_invoice_no} onChange={(e) => setForm({ ...form, vendor_invoice_no: e.target.value })} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Invoice date</Label>
                                <Input type="date" value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} />
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-1.5">
                                <Label>Taxable amount *</Label>
                                <Input type="number" step="0.01" value={form.taxable} onChange={(e) => setForm({ ...form, taxable: e.target.value })} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>GST slab</Label>
                                <Select value={form.gst_slab} onValueChange={(v) => setForm({ ...form, gst_slab: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>{[0, 5, 12, 18, 28].map((s) => <SelectItem key={s} value={String(s)}>{s}%</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Other charges</Label>
                                <Input type="number" step="0.01" value={form.other_charges} onChange={(e) => setForm({ ...form, other_charges: e.target.value })} />
                            </div>
                        </div>
                        <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
                            {!form.is_inter_state ? (
                                <>
                                    <div className="flex justify-between"><span>CGST</span><span>{formatCurrency(calculated.cgst)}</span></div>
                                    <div className="flex justify-between"><span>SGST</span><span>{formatCurrency(calculated.sgst)}</span></div>
                                </>
                            ) : (
                                <div className="flex justify-between"><span>IGST</span><span>{formatCurrency(calculated.igst)}</span></div>
                            )}
                            <div className="flex justify-between font-semibold pt-1 border-t border-border/40"><span>Grand total</span><span>{formatCurrency(calculated.total)}</span></div>
                        </div>
                        <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                            <Label>Inter-state supply (IGST)</Label>
                            <Switch checked={form.is_inter_state} onCheckedChange={(v) => setForm({ ...form, is_inter_state: v })} />
                        </div>
                        <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                            <Label>ITC eligible</Label>
                            <Switch checked={form.itc_eligible} onCheckedChange={(v) => setForm({ ...form, itc_eligible: v })} />
                        </div>
                        <DialogFooter>
                            <Button type="submit" variant="neon" disabled={busy}>
                                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                                {editingId ? "Save changes" : "Save purchase"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function SortHead({ field, label, sortBy, sortDir, onSort, className }: {
    field: SortField; label: string;
    sortBy: SortField; sortDir: "asc" | "desc";
    onSort: (f: SortField) => void; className?: string
}) {
    const active = sortBy === field
    return (
        <TableHead className={className}>
            <button onClick={() => onSort(field)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                {label}
                {active
                    ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
                    : <ArrowUpDown className="h-3 w-3 opacity-40" />}
            </button>
        </TableHead>
    )
}
