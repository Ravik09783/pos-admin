"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Download, Filter, Printer, Search, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DateRangePicker, type DateRange } from "@/components/filters/date-range"
import { Pagination } from "@/components/filters/pagination"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { scopeQueryToBranch, useActiveBranch } from "@/lib/branch/active-branch"
import { uniqueChannelName } from "@/lib/supabase/realtime"
import { getTaxConfig } from "@/lib/tax/locale-config"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import type { Order, OrderStatus, OrderType } from "@/types/database"

// Combined "Sales" page — every order is a row; if a bill exists for the
// order, the row shows the invoice #, B2B/inter-state/FY tags, the biller,
// and a one-click Print action that opens /bills/<id>?autoprint=1 in a new tab.
//
// Bills are embedded via PostgREST; the bills page is now a redirect here.

const ORDER_STATUS_VARIANT: Record<OrderStatus, "default" | "success" | "destructive" | "warning" | "secondary"> = {
    OPEN: "warning",
    IN_PROGRESS: "warning",
    BILLED: "default",
    PAID: "success",
    CLOSED: "secondary",
    VOID: "destructive",
    ON_HOLD: "secondary",
}
const ALL_STATUSES: OrderStatus[] = ["OPEN", "IN_PROGRESS", "BILLED", "PAID", "CLOSED", "VOID", "ON_HOLD"]
const ALL_TYPES: OrderType[] = ["DINE_IN", "TAKEAWAY", "DELIVERY", "QSR"]
// Swiggy / Zomato / ONDC only operate in India — for tenants outside India
// we drop them from the filter list (the column on the DB row still works,
// it just isn't a useful filter for them).
const SOURCES_IN  = ["POS", "QR", "PHONE", "SWIGGY", "ZOMATO", "ONDC"] as const
const SOURCES_INTL = ["POS", "QR", "PHONE"] as const
const ALL_SOURCES = SOURCES_IN
type SortField = "created_at" | "grand_total" | "order_number"

/** Shape of a row returned by the embedded query. The `bill` and
 *  `billed_by_user` joins are arrays in the PostgREST response; we collapse
 *  them with the helper below. */
type SaleRow = Order & {
    bill?:
        | { id: string; invoice_number: string; bill_status: string; customer_name: string | null; customer_gstin: string | null; customer_phone: string | null; fy_label: string; is_inter_state: boolean; gst_excluded: boolean | null }
        | { id: string; invoice_number: string; bill_status: string; customer_name: string | null; customer_gstin: string | null; customer_phone: string | null; fy_label: string; is_inter_state: boolean; gst_excluded: boolean | null }[]
        | null
    billed_by_user?:
        | { id: string; full_name: string | null; email: string | null; avatar_url: string | null }
        | { id: string; full_name: string | null; email: string | null; avatar_url: string | null }[]
        | null
}

function pickOne<T>(v: T | T[] | null | undefined): T | null {
    if (Array.isArray(v)) return v[0] ?? null
    return v ?? null
}

export default function OrdersPage() {
    const supabase = createClient()
    const [loading, setLoading] = useState(true)
    const [rows, setRows] = useState<SaleRow[]>([])
    const [total, setTotal] = useState(0)
    const [exporting, setExporting] = useState(false)

    const [page, setPage] = useState(0)
    const [pageSize, setPageSize] = useState(50)
    const [sortBy, setSortBy] = useState<SortField>("created_at")
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

    const [showFilters, setShowFilters] = useState(false)
    const [tenantCountry, setTenantCountry] = useState<string | null>(null)
    const [search, setSearch] = useState("")
    const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null })
    const [statuses, setStatuses] = useState<Set<OrderStatus>>(new Set())
    const [orderType, setOrderType] = useState<OrderType | "ALL">("ALL")
    const [source, setSource] = useState<typeof ALL_SOURCES[number] | "ALL">("ALL")
    const [minAmount, setMinAmount] = useState("")
    const [maxAmount, setMaxAmount] = useState("")
    const [awaitingOnly, setAwaitingOnly] = useState(false)
    const [hasNotesOnly, setHasNotesOnly] = useState(false)
    // Bill-only filters (merged in from the old bills page). Toggling any
    // of these implicitly restricts to billed orders via INNER join.
    //
    // We default `billedOnly` to true so the page lives up to its "Sales"
    // name — in-flight OPEN / IN_PROGRESS orders that never produced a
    // bill don't show up by default. Cashiers can flip the toggle to see
    // the full order pipeline.
    const [billedOnly, setBilledOnly] = useState(true)
    const [b2bOnly, setB2bOnly] = useState(false)
    const [interStateOnly, setInterStateOnly] = useState(false)
    const [fyLabel, setFyLabel] = useState("ALL")
    const [availableFys, setAvailableFys] = useState<string[]>([])

    const { activeBranchId } = useActiveBranch()

    /** True when any filter that requires a bill is engaged. Used to flip
     *  the embed from LEFT to INNER so the count matches what's rendered. */
    const requireBill = useMemo(
        () => billedOnly || b2bOnly || interStateOnly || fyLabel !== "ALL",
        [billedOnly, b2bOnly, interStateOnly, fyLabel],
    )

    // `billedOnly` is the page's *default* state, not a user-applied
    // filter, so don't count it in filtersActive. Otherwise the "Clear"
    // button would always render and clearing would reset to a view the
    // user didn't ask for.
    const filtersActive = useMemo(() =>
        search.trim().length > 0 ||
        dateRange.from || dateRange.to ||
        statuses.size > 0 ||
        orderType !== "ALL" ||
        source !== "ALL" ||
        minAmount || maxAmount ||
        awaitingOnly || hasNotesOnly ||
        b2bOnly || interStateOnly || fyLabel !== "ALL",
    [search, dateRange, statuses, orderType, source, minAmount, maxAmount, awaitingOnly, hasNotesOnly, b2bOnly, interStateOnly, fyLabel])

    function clearFilters() {
        setSearch("")
        setDateRange({ from: null, to: null })
        setStatuses(new Set())
        setOrderType("ALL")
        setSource("ALL")
        setMinAmount("")
        setMaxAmount("")
        setAwaitingOnly(false)
        setHasNotesOnly(false)
        // Keep billedOnly at its default (true) — "Clear filters" should
        // restore the default Sales view, not turn it off.
        setBilledOnly(true)
        setB2bOnly(false)
        setInterStateOnly(false)
        setFyLabel("ALL")
        setPage(0)
    }

    async function refresh() {
        setLoading(true)
        // The embed on bills uses !inner when any bill-only filter is on,
        // so the row count returned by Postgres matches what we render.
        const billEmbed = requireBill
            ? "bill:bills!inner(id, invoice_number, bill_status, customer_name, customer_gstin, customer_phone, fy_label, is_inter_state, gst_excluded)"
            : "bill:bills(id, invoice_number, bill_status, customer_name, customer_gstin, customer_phone, fy_label, is_inter_state, gst_excluded)"
        const select = `*, ${billEmbed}, billed_by_user:users!orders_billed_by_fkey(id, full_name, email, avatar_url)`
        let q = supabase.from("orders").select(select, { count: "exact" })

        if (search.trim()) {
            // Search the order # and notes on the order itself. Invoice #
            // and customer name are visible in each row so the user can
            // still scan for them visually after a fuzzy text search.
            const s = search.trim()
            q = q.or(`order_number.ilike.%${s}%,notes.ilike.%${s}%`)
        }
        if (dateRange.from) q = q.gte("created_at", `${dateRange.from}T00:00:00`)
        if (dateRange.to)   q = q.lte("created_at", `${dateRange.to}T23:59:59`)
        if (statuses.size > 0) q = q.in("status", Array.from(statuses))
        if (orderType !== "ALL") q = q.eq("order_type", orderType)
        if (source !== "ALL") q = q.eq("source", source)
        if (minAmount) q = q.gte("grand_total", Number(minAmount))
        if (maxAmount) q = q.lte("grand_total", Number(maxAmount))
        if (awaitingOnly) q = q.eq("awaiting_confirmation", true)
        if (hasNotesOnly) q = q.not("notes", "is", null)
        // Bill-only filters apply to the embedded bills row (note the
        // dotted PostgREST path).
        if (b2bOnly) q = q.not("bill.customer_gstin", "is", null)
        if (interStateOnly) q = q.eq("bill.is_inter_state", true)
        if (fyLabel !== "ALL") q = q.eq("bill.fy_label", fyLabel)
        q = scopeQueryToBranch(q, activeBranchId)

        q = q.order(sortBy, { ascending: sortDir === "asc" })
        q = q.range(page * pageSize, (page + 1) * pageSize - 1)
        const { data, count, error } = await q
        if (error) {
            // Surface to the console; UI shows "no rows" + filter hint.
            console.error("orders refresh failed", error)
            setRows([])
            setTotal(0)
        } else {
            setRows((data ?? []) as unknown as SaleRow[])
            setTotal(count ?? 0)
        }
        setLoading(false)
    }

    useEffect(() => { refresh() }, [
        page, pageSize, sortBy, sortDir,
        dateRange.from, dateRange.to,
        orderType, source, minAmount, maxAmount,
        awaitingOnly, hasNotesOnly,
        billedOnly, b2bOnly, interStateOnly, fyLabel,
        statuses.size, activeBranchId,
    ])
    useEffect(() => {
        const t = setTimeout(refresh, 300)
        return () => clearTimeout(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search])

    // Available FYs for the dropdown — pulled from the bills table once.
    useEffect(() => {
        ;(async () => {
            const { data } = await supabase.from("bills").select("fy_label").limit(2000)
            const fys = new Set<string>()
            ;((data ?? []) as { fy_label: string }[]).forEach((r) => fys.add(r.fy_label))
            setAvailableFys(Array.from(fys).sort().reverse())
        })()
    }, [supabase])

    // Resolve tenant country once — drives whether the Source filter shows
    // Swiggy/Zomato/ONDC (India only).
    useEffect(() => {
        ;(async () => {
            const { data: u } = await supabase.auth.getUser()
            if (!u.user) return
            const { data: row } = await supabase
                .from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
            const tid = (row as { tenant_id?: string } | null)?.tenant_id
            if (!tid) return
            const { data: tenant } = await supabase
                .from("tenants").select("country").eq("id", tid).maybeSingle()
            setTenantCountry((tenant as { country?: string | null } | null)?.country ?? null)
        })()
    }, [supabase])

    const sourcesForUI = useMemo(
        () => (getTaxConfig(tenantCountry).code === "IN" ? SOURCES_IN : SOURCES_INTL),
        [tenantCountry],
    )

    // Realtime: refresh when orders OR bills change. A new bill flips an
    // order from BILLED to PAID-eligible and adds invoice metadata; both
    // need to land in the table without a manual refresh.
    useEffect(() => {
        const channel = supabase
            .channel(uniqueChannelName("sales-list"))
            .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, refresh)
            .on("postgres_changes", { event: "*", schema: "public", table: "bills" }, refresh)
            .subscribe()
        return () => { supabase.removeChannel(channel) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    function toggleStatus(s: OrderStatus) {
        const next = new Set(statuses)
        if (next.has(s)) next.delete(s); else next.add(s)
        setStatuses(next)
        setPage(0)
    }

    function toggleSort(field: SortField) {
        if (sortBy === field) {
            setSortDir((d) => d === "asc" ? "desc" : "asc")
        } else {
            setSortBy(field)
            setSortDir("desc")
        }
    }

    async function exportCsv() {
        setExporting(true)
        try {
            const billEmbed = requireBill
                ? "bill:bills!inner(invoice_number, fy_label, customer_name, customer_gstin, customer_phone, is_inter_state)"
                : "bill:bills(invoice_number, fy_label, customer_name, customer_gstin, customer_phone, is_inter_state)"
            let q = supabase.from("orders").select(`*, ${billEmbed}`)
            if (search.trim()) q = q.or(`order_number.ilike.%${search.trim()}%,notes.ilike.%${search.trim()}%`)
            if (dateRange.from) q = q.gte("created_at", `${dateRange.from}T00:00:00`)
            if (dateRange.to)   q = q.lte("created_at", `${dateRange.to}T23:59:59`)
            if (statuses.size > 0) q = q.in("status", Array.from(statuses))
            if (orderType !== "ALL") q = q.eq("order_type", orderType)
            if (source !== "ALL") q = q.eq("source", source)
            if (minAmount) q = q.gte("grand_total", Number(minAmount))
            if (maxAmount) q = q.lte("grand_total", Number(maxAmount))
            if (b2bOnly) q = q.not("bill.customer_gstin", "is", null)
            if (interStateOnly) q = q.eq("bill.is_inter_state", true)
            if (fyLabel !== "ALL") q = q.eq("bill.fy_label", fyLabel)
            q = scopeQueryToBranch(q, activeBranchId)
            q = q.order(sortBy, { ascending: sortDir === "asc" }).limit(10000)
            const { data } = await q
            const exportRows = (data ?? []) as unknown as SaleRow[]

            const header = ["Order #", "Invoice #", "Date", "Type", "Source", "Order status", "Customer", "GSTIN", "Inter-state", "FY", "Subtotal", "Tax", "Discount", "Service", "Grand total", "Notes"]
            const csv = [
                header.join(","),
                ...exportRows.map((r) => {
                    const b = pickOne(r.bill)
                    return [
                        r.order_number,
                        b?.invoice_number ?? "",
                        new Date(r.created_at).toISOString(),
                        r.order_type,
                        (r as { source?: string }).source ?? "",
                        r.status,
                        `"${(b?.customer_name ?? "").replace(/"/g, '""')}"`,
                        b?.customer_gstin ?? "",
                        b?.is_inter_state ? "YES" : "NO",
                        b?.fy_label ?? "",
                        r.subtotal,
                        Number(r.cgst_amount) + Number(r.sgst_amount) + Number(r.igst_amount),
                        Number(r.item_discount) + Number(r.order_discount),
                        r.service_charge,
                        r.grand_total,
                        `"${(r.notes ?? "").replace(/"/g, '""')}"`,
                    ].join(",")
                })
            ].join("\n")

            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = `sales_${new Date().toISOString().slice(0, 10)}.csv`
            document.body.appendChild(a); a.click(); a.remove()
            URL.revokeObjectURL(url)
        } finally {
            setExporting(false)
        }
    }

    function printBill(billId: string) {
        // Open the bill detail page in a new tab. The detail page auto-fires
        // window.print() when ?autoprint=1 is present.
        window.open(`/bills/${billId}?autoprint=1`, "_blank", "noopener")
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-4">
            <PageHeader
                kicker="Operations + Finance"
                title="Sales"
                highlight="orders & invoices"
                description={
                    billedOnly
                        ? "Billed orders only — every row is a real sale. Toggle 'Billed orders only' in Filters to see open / in-flight orders too."
                        : "Every order in one place. Bills surface inline — one click to print."
                }
                actions={
                    <>
                        <Button variant="outline" onClick={() => setShowFilters((s) => !s)}>
                            <Filter className="h-4 w-4" /> Filters
                            {filtersActive && <Badge variant="neon" className="ml-1 text-[10px] px-1.5">on</Badge>}
                        </Button>
                        <Button variant="outline" onClick={exportCsv} disabled={exporting || total === 0}>
                            <Download className="h-4 w-4" /> Export CSV
                        </Button>
                    </>
                }
            />

            <Card>
                <CardContent className="pt-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative flex-1 min-w-[200px]">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(e) => { setSearch(e.target.value); setPage(0) }}
                                placeholder="Search order # or notes…"
                                className="pl-8"
                            />
                        </div>
                        <DateRangePicker value={dateRange} onChange={(v) => { setDateRange(v); setPage(0) }} />
                        <Select value={orderType} onValueChange={(v) => { setOrderType(v as typeof orderType); setPage(0) }}>
                            <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Type" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">All types</SelectItem>
                                {ALL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={source} onValueChange={(v) => { setSource(v as typeof source); setPage(0) }}>
                            <SelectTrigger className="w-32 h-9"><SelectValue placeholder="Source" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">All sources</SelectItem>
                                {sourcesForUI.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={fyLabel} onValueChange={(v) => { setFyLabel(v); setPage(0) }}>
                            <SelectTrigger className="w-28 h-9"><SelectValue placeholder="FY" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">All FYs</SelectItem>
                                {availableFys.map((fy) => <SelectItem key={fy} value={fy}>FY {fy}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        {filtersActive && (
                            <Button variant="ghost" size="sm" onClick={clearFilters}>
                                <X className="h-3.5 w-3.5" /> Clear
                            </Button>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted-foreground mr-1">Status:</span>
                        {ALL_STATUSES.map((s) => (
                            <button
                                key={s}
                                onClick={() => toggleStatus(s)}
                                className={cn(
                                    "px-2.5 py-1 rounded-md text-xs font-medium transition-colors border",
                                    statuses.has(s)
                                        ? "bg-primary/15 border-primary/40 text-primary"
                                        : "bg-muted/40 border-border/40 text-muted-foreground hover:bg-accent",
                                )}
                            >
                                {s}
                            </button>
                        ))}
                    </div>

                    {showFilters && (
                        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-border/40">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Min amount (₹)</Label>
                                <Input type="number" min="0" value={minAmount} onChange={(e) => { setMinAmount(e.target.value); setPage(0) }} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Max amount (₹)</Label>
                                <Input type="number" min="0" value={maxAmount} onChange={(e) => { setMaxAmount(e.target.value); setPage(0) }} />
                            </div>
                            <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                                <Label className="text-xs">Awaiting payment confirmation</Label>
                                <Switch checked={awaitingOnly} onCheckedChange={(v) => { setAwaitingOnly(v); setPage(0) }} />
                            </div>
                            <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                                <Label className="text-xs">Has special requests</Label>
                                <Switch checked={hasNotesOnly} onCheckedChange={(v) => { setHasNotesOnly(v); setPage(0) }} />
                            </div>
                            <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                                <div className="flex flex-col">
                                    <Label className="text-xs">Billed orders only</Label>
                                    <span className="text-[10px] text-muted-foreground">On by default — hides OPEN / in-flight orders.</span>
                                </div>
                                <Switch checked={billedOnly} onCheckedChange={(v) => { setBilledOnly(v); setPage(0) }} />
                            </div>
                            <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                                <Label className="text-xs">B2B only (has GSTIN)</Label>
                                <Switch checked={b2bOnly} onCheckedChange={(v) => { setB2bOnly(v); setPage(0) }} />
                            </div>
                            <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                                <Label className="text-xs">Inter-state only (IGST)</Label>
                                <Switch checked={interStateOnly} onCheckedChange={(v) => { setInterStateOnly(v); setPage(0) }} />
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="py-3 flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-base">Results</CardTitle>
                    <div className="text-xs text-muted-foreground">
                        {loading ? "Loading…" : `${total} order${total === 1 ? "" : "s"}`}
                    </div>
                </CardHeader>
                <CardContent className="px-0">
                    {loading ? (
                        <div className="px-6 space-y-2">
                            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            {filtersActive ? "No orders match the filters." : "No orders yet."}
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <SortHead field="order_number" label="Order / Invoice" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                                    <SortHead field="created_at" label="Date" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                                    <TableHead>Customer</TableHead>
                                    <TableHead>Type · Source</TableHead>
                                    <TableHead>Billed by</TableHead>
                                    <TableHead>Status</TableHead>
                                    <SortHead field="grand_total" label="Total" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} className="text-right" />
                                    <TableHead className="w-[110px]" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map((r) => {
                                    const bill = pickOne(r.bill)
                                    const by = pickOne(r.billed_by_user)
                                    const noGst = (r as { gst_excluded?: boolean }).gst_excluded === true || bill?.gst_excluded === true
                                    const awaiting = (r as { awaiting_confirmation?: boolean }).awaiting_confirmation === true
                                    const src = (r as { source?: string }).source ?? "POS"
                                    return (
                                        <TableRow
                                            key={r.id}
                                            title={noGst ? "Bill without GST — excluded from CA exports" : undefined}
                                            className={cn(
                                                noGst && "bg-yellow-500/10 hover:bg-yellow-500/15",
                                                !noGst && awaiting && "bg-warning/5",
                                            )}
                                        >
                                            <TableCell className="text-xs font-mono">
                                                <div className="leading-tight">
                                                    <div>{r.order_number}</div>
                                                    {bill && (
                                                        <Link href={`/bills/${bill.id}`} className="text-primary hover:underline">
                                                            {bill.invoice_number}
                                                        </Link>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-sm">{formatDate(r.created_at)}</TableCell>
                                            <TableCell className="text-sm">
                                                {bill?.customer_name ?? <span className="text-muted-foreground">Walk-in</span>}
                                                {bill?.customer_gstin && (
                                                    <Badge variant="outline" className="ml-1 text-[10px]">B2B</Badge>
                                                )}
                                                {bill?.customer_phone && (
                                                    <div className="text-[11px] text-muted-foreground">{bill.customer_phone}</div>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                <div className="flex flex-col gap-0.5">
                                                    <Badge variant="outline" className="w-fit">{r.order_type}</Badge>
                                                    <Badge variant={src === "QR" ? "neon" : "secondary"} className="w-fit text-[10px]">
                                                        {src}
                                                    </Badge>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs">
                                                {by ? (
                                                    <span className="inline-flex items-center gap-1.5">
                                                        {by.avatar_url
                                                            /* eslint-disable-next-line @next/next/no-img-element */
                                                            ? <img src={by.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover border border-border/60" />
                                                            : <span className="h-5 w-5 rounded-full bg-muted grid place-items-center text-[10px] font-semibold">
                                                                {(by.full_name ?? by.email ?? "?").slice(0, 1).toUpperCase()}
                                                              </span>}
                                                        <span className="truncate max-w-[100px]">{by.full_name ?? by.email ?? "Staff"}</span>
                                                    </span>
                                                ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1 flex-wrap">
                                                    <Badge variant={ORDER_STATUS_VARIANT[r.status]}>{r.status}</Badge>
                                                    {awaiting && <Badge variant="warning" className="text-[10px]">⏳</Badge>}
                                                    {bill?.is_inter_state && <Badge variant="outline" className="text-[10px]">IGST</Badge>}
                                                    {noGst && <Badge variant="warning" className="text-[10px]">No GST</Badge>}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(r.grand_total)}</TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1 justify-end">
                                                    {bill ? (
                                                        <>
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-7 w-7"
                                                                onClick={() => printBill(bill.id)}
                                                                title="Print / download bill"
                                                                aria-label="Print bill"
                                                            >
                                                                <Printer className="h-3.5 w-3.5" />
                                                            </Button>
                                                            <Link href={`/bills/${bill.id}`} className="text-primary inline-flex items-center" title="Open bill">
                                                                <ChevronRight className="h-4 w-4" />
                                                            </Link>
                                                        </>
                                                    ) : (
                                                        <span className="text-[11px] text-muted-foreground italic pr-1">Not billed</span>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
                <Pagination
                    page={page}
                    pageSize={pageSize}
                    total={total}
                    onPageChange={setPage}
                    onPageSizeChange={setPageSize}
                    className="border-t border-border/40"
                />
            </Card>
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
