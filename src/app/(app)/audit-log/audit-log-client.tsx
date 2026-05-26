"use client"

/**
 * Audit log viewer.
 *
 * UI principles for this page (per the OWNER's request — "even very low
 * educated people can understand"):
 *   - Never show enum names. ACTION = "BILL_VOIDED" → "Voided the bill".
 *   - Plain-English time. "2 hours ago" with the exact date+time underneath.
 *   - One icon + one short sentence per row. No JSON in the main row.
 *   - Filters that match how an OWNER asks the question: date range, person,
 *     and a few quick chips ("Bill changes", "Voids", "Payments", "Discounts").
 *   - "Show details" reveals the reason + before/after JSON for the rare
 *     case the OWNER wants the technical diff.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
    Banknote, ChevronDown, Download, ExternalLink, FileText, Loader2,
    MinusCircle, Pencil, Percent, PlusCircle, Printer, Receipt, RefreshCw,
    Search, ShieldCheck, XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { ROLE_LABELS } from "@/lib/rbac/permissions"
import { cn, formatDate, timeAgo } from "@/lib/utils"
import type { UserRole } from "@/types/database"

const PAGE_SIZE = 100

type ActionKey =
    | "ORDER_CREATED" | "ITEM_ADDED" | "ITEM_REMOVED" | "ITEM_MODIFIED"
    | "DISCOUNT_APPLIED" | "BILL_GENERATED" | "BILL_EDITED"
    | "PAYMENT_ADDED" | "BILL_VOIDED" | "BILL_REPRINTED"

interface ActionMeta {
    label: string
    icon: React.ComponentType<{ className?: string }>
    tint: "success" | "warning" | "destructive" | "neutral"
}

const ACTION_META: Record<ActionKey, ActionMeta> = {
    ORDER_CREATED:    { label: "Started a new order",          icon: FileText,    tint: "neutral" },
    ITEM_ADDED:       { label: "Added an item to the order",   icon: PlusCircle,  tint: "neutral" },
    ITEM_REMOVED:     { label: "Removed an item from the order", icon: MinusCircle, tint: "warning" },
    ITEM_MODIFIED:    { label: "Changed an item on the order", icon: Pencil,      tint: "warning" },
    DISCOUNT_APPLIED: { label: "Applied a discount",           icon: Percent,     tint: "warning" },
    BILL_GENERATED:   { label: "Generated the bill",           icon: Receipt,     tint: "success" },
    BILL_EDITED:      { label: "Edited a finalised bill",      icon: Pencil,      tint: "warning" },
    PAYMENT_ADDED:    { label: "Recorded a payment",           icon: Banknote,    tint: "success" },
    BILL_VOIDED:      { label: "Voided the bill",              icon: XCircle,     tint: "destructive" },
    BILL_REPRINTED:   { label: "Reprinted the bill",           icon: Printer,     tint: "neutral" },
}

/** Quick-filter chips the OWNER picks first — "show me only the things
 *  someone might want to question". */
const QUICK_FILTERS: { id: string; label: string; actions: ActionKey[] }[] = [
    { id: "all",       label: "All changes",   actions: [] },
    { id: "bill",      label: "Bill changes",  actions: ["BILL_EDITED", "BILL_VOIDED"] },
    { id: "voids",     label: "Voids only",    actions: ["BILL_VOIDED"] },
    { id: "payments",  label: "Payments",      actions: ["PAYMENT_ADDED"] },
    { id: "discounts", label: "Discounts",     actions: ["DISCOUNT_APPLIED"] },
]

interface AuditRow {
    id: string
    created_at: string
    action: ActionKey
    reason: string | null
    user_role: string | null
    user_id: string | null
    bill_id: string | null
    before_state: Record<string, unknown> | null
    after_state: Record<string, unknown> | null
    user: { full_name: string | null; email: string | null } | null
    bill: { invoice_number: string | null; grand_total: number | null } | null
}

interface StaffOption { id: string; name: string }

/** Yesterday's ISO date string for the "from" default. Last 7 days is a
 *  sensible OWNER default — long enough to catch "what happened over the
 *  weekend" without dumping the whole quarter on first render. */
function defaultRange(): { from: string; to: string } {
    const today = new Date()
    const from = new Date(today)
    from.setDate(today.getDate() - 7)
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    return { from: fmt(from), to: fmt(today) }
}

export function AuditLogClient() {
    const supabase = useMemo(() => createClient(), [])
    const init = useMemo(defaultRange, [])
    const [from, setFrom] = useState(init.from)
    const [to, setTo] = useState(init.to)
    const [staffId, setStaffId] = useState<string>("__all__")
    const [billSearch, setBillSearch] = useState("")
    const [quickId, setQuickId] = useState<string>("all")

    const [rows, setRows] = useState<AuditRow[]>([])
    const [loading, setLoading] = useState(true)
    const [loadingMore, setLoadingMore] = useState(false)
    const [hasMore, setHasMore] = useState(false)
    const [totalCount, setTotalCount] = useState<number | null>(null)
    const [staff, setStaff] = useState<StaffOption[]>([])
    const [openRow, setOpenRow] = useState<string | null>(null)
    const [now, setNow] = useState<Date | null>(null)

    // Tick "now" once a minute so the "2 minutes ago" labels stay fresh
    // while the page is open. Null on first render = no relative text =
    // no hydration mismatch (matches the announcements page pattern).
    useEffect(() => {
        setNow(new Date())
        const id = window.setInterval(() => setNow(new Date()), 60_000)
        return () => window.clearInterval(id)
    }, [])

    const quick = QUICK_FILTERS.find((q) => q.id === quickId) ?? QUICK_FILTERS[0]

    /** Build the supabase query for the current filters. */
    const buildQuery = useCallback((offset: number) => {
        // PostgREST date filtering: created_at >= from 00:00 local; < (to + 1) 00:00 local.
        // Browser is the cashier's TZ so this lines up with how they think.
        const fromDate = new Date(`${from}T00:00:00`).toISOString()
        const toDate = new Date(new Date(`${to}T00:00:00`).getTime() + 24 * 60 * 60_000).toISOString()

        let q = supabase
            .from("bill_audit_log")
            .select(`
                id, created_at, action, reason, user_role, user_id, bill_id,
                before_state, after_state,
                user:users!bill_audit_log_user_id_fkey(full_name, email),
                bill:bills!bill_audit_log_bill_id_fkey(invoice_number, grand_total)
            `, { count: "exact" })
            .gte("created_at", fromDate)
            .lt("created_at", toDate)
            .order("created_at", { ascending: false })
            .range(offset, offset + PAGE_SIZE - 1)

        if (staffId !== "__all__") q = q.eq("user_id", staffId)
        if (quick.actions.length > 0) q = q.in("action", quick.actions)
        if (billSearch.trim()) {
            // Filter on the embedded bill's invoice number.
            q = q.ilike("bills.invoice_number", `%${billSearch.trim()}%`)
        }

        return q
    }, [supabase, from, to, staffId, quick.actions, billSearch])

    const refresh = useCallback(async () => {
        setLoading(true)
        setOpenRow(null)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, count, error } = await (buildQuery(0) as any)
        setLoading(false)
        if (error) { toast.error(error.message); return }
        const list = (data ?? []) as AuditRow[]
        setRows(list)
        setTotalCount(typeof count === "number" ? count : list.length)
        setHasMore(list.length === PAGE_SIZE)
    }, [buildQuery])

    const loadMore = useCallback(async () => {
        setLoadingMore(true)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (buildQuery(rows.length) as any)
        setLoadingMore(false)
        if (error) { toast.error(error.message); return }
        const more = (data ?? []) as AuditRow[]
        setRows((prev) => [...prev, ...more])
        setHasMore(more.length === PAGE_SIZE)
    }, [buildQuery, rows.length])

    /** Load staff once for the "Who" filter dropdown. */
    useEffect(() => {
        ;(async () => {
            const { data } = await supabase.from("users").select("id, full_name, email").order("full_name")
            const list = (data ?? []) as { id: string; full_name: string | null; email: string | null }[]
            setStaff(list.map((s) => ({ id: s.id, name: s.full_name || s.email || "Staff member" })))
        })()
    }, [supabase])

    // Refresh whenever a filter changes.
    useEffect(() => { refresh() }, [refresh])

    /** Headline counts — uniques across the currently loaded page so the
     *  numbers always match what the user actually sees. */
    const summary = useMemo(() => {
        const bills = new Set<string>()
        const users = new Set<string>()
        for (const r of rows) {
            if (r.bill_id) bills.add(r.bill_id)
            if (r.user_id) users.add(r.user_id)
        }
        return {
            events: totalCount ?? rows.length,
            bills: bills.size,
            staff: users.size,
        }
    }, [rows, totalCount])

    function downloadCsv() {
        if (rows.length === 0) return toast.error("Nothing to export")
        const header = ["When", "Who", "Role", "What happened", "Bill #", "Reason"]
        const escape = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        const lines = [
            header.join(","),
            ...rows.map((r) => {
                const who = r.user?.full_name || r.user?.email || "—"
                const role = r.user_role ? (ROLE_LABELS[r.user_role as UserRole] ?? r.user_role) : "—"
                const action = ACTION_META[r.action]?.label ?? r.action
                const inv = r.bill?.invoice_number ?? ""
                return [
                    new Date(r.created_at).toISOString(),
                    escape(who),
                    escape(role),
                    escape(action),
                    escape(inv),
                    escape(r.reason ?? ""),
                ].join(",")
            }),
        ]
        const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `audit-log-${from}-to-${to}.csv`
        a.click()
        URL.revokeObjectURL(url)
        toast.success(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"}`)
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-6xl space-y-5">
            <PageHeader
                kicker="History"
                title="Audit log"
                highlight=" — who changed what"
                description="Every bill change, payment, void and edit, with the staff member and the time. Use it to spot what changed and by whom."
                actions={
                    <Button variant="outline" size="sm" onClick={downloadCsv} disabled={rows.length === 0}>
                        <Download className="h-3.5 w-3.5" /> Download CSV
                    </Button>
                }
            />

            {/* ── Quick filter chips ───────────────────────────────── */}
            <div className="flex flex-wrap gap-2">
                {QUICK_FILTERS.map((q) => (
                    <button
                        key={q.id}
                        type="button"
                        onClick={() => setQuickId(q.id)}
                        className={cn(
                            "rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors",
                            quickId === q.id
                                ? "bg-primary text-primary-foreground border-primary shadow-glow"
                                : "border-border/60 hover:bg-accent",
                        )}
                    >
                        {q.label}
                    </button>
                ))}
            </div>

            {/* ── Detailed filters ─────────────────────────────────── */}
            <Card>
                <CardContent className="p-4 grid sm:grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs">From</Label>
                        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} max={to} />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">To</Label>
                        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} min={from} />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Who</Label>
                        <Select value={staffId} onValueChange={setStaffId}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__all__">Everyone</SelectItem>
                                {staff.map((s) => (
                                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Bill number contains</Label>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                            <Input
                                value={billSearch}
                                onChange={(e) => setBillSearch(e.target.value)}
                                placeholder="e.g. 00042"
                                className="pl-7"
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* ── Summary strip ────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="rounded-full px-3 py-1 bg-muted text-muted-foreground">
                    <strong className="text-foreground">{summary.events}</strong>&nbsp;
                    {summary.events === 1 ? "change" : "changes"}
                </span>
                <span className="rounded-full px-3 py-1 bg-muted text-muted-foreground">
                    on <strong className="text-foreground">{summary.bills}</strong>&nbsp;
                    {summary.bills === 1 ? "bill" : "bills"}
                </span>
                <span className="rounded-full px-3 py-1 bg-muted text-muted-foreground">
                    by <strong className="text-foreground">{summary.staff}</strong>&nbsp;
                    {summary.staff === 1 ? "staff member" : "staff members"}
                </span>
                <Button variant="ghost" size="sm" onClick={refresh} disabled={loading} className="ml-auto">
                    <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
                </Button>
            </div>

            {/* ── The log ──────────────────────────────────────────── */}
            <Card>
                <CardContent className="p-0">
                    {loading && rows.length === 0 ? (
                        <div className="py-14 text-center text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="py-14 text-center text-sm text-muted-foreground">
                            <ShieldCheck className="h-7 w-7 mx-auto mb-2 opacity-50" />
                            No changes recorded for this filter.
                        </div>
                    ) : (
                        <ul className="divide-y divide-border/50">
                            {rows.map((r) => (
                                <AuditRowItem
                                    key={r.id}
                                    row={r}
                                    expanded={openRow === r.id}
                                    onToggle={() => setOpenRow((cur) => cur === r.id ? null : r.id)}
                                    now={now}
                                />
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            {hasMore && (
                <div className="flex justify-center">
                    <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                        {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Load older entries
                    </Button>
                </div>
            )}
        </div>
    )
}

function AuditRowItem({
    row, expanded, onToggle, now,
}: {
    row: AuditRow; expanded: boolean; onToggle: () => void; now: Date | null
}) {
    const meta = ACTION_META[row.action] ?? { label: row.action, icon: FileText, tint: "neutral" as const }
    const Icon = meta.icon
    const who = row.user?.full_name || row.user?.email || "Unknown user"
    const role = row.user_role ? (ROLE_LABELS[row.user_role as UserRole] ?? row.user_role) : null
    const invoice = row.bill?.invoice_number

    return (
        <li className="px-4 py-3">
            <div className="flex items-start gap-3">
                {/* Action icon, colour-tinted by severity. */}
                <div
                    className={cn(
                        "grid place-items-center h-9 w-9 rounded-full shrink-0",
                        meta.tint === "success" && "bg-success/15 text-success",
                        meta.tint === "warning" && "bg-warning/15 text-warning",
                        meta.tint === "destructive" && "bg-destructive/15 text-destructive",
                        meta.tint === "neutral" && "bg-muted text-foreground",
                    )}
                    aria-hidden
                >
                    <Icon className="h-4 w-4" />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-sm">{meta.label}</span>
                        {invoice && (
                            <Link
                                href={`/bills/${row.bill_id}`}
                                className="text-xs text-primary inline-flex items-center gap-0.5 hover:underline font-mono"
                            >
                                {invoice} <ExternalLink className="h-3 w-3" />
                            </Link>
                        )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span>{who}</span>
                        {role && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{role}</Badge>}
                        <span>·</span>
                        <span>{formatDate(row.created_at, { dateStyle: "medium", timeStyle: "short" })}</span>
                        {now && <span className="text-muted-foreground/70">({timeAgo(row.created_at, now)})</span>}
                    </div>
                    {row.reason && (
                        <p className="text-xs italic text-muted-foreground mt-1">&ldquo;{row.reason}&rdquo;</p>
                    )}

                    {(row.before_state || row.after_state) && (
                        <button
                            type="button"
                            onClick={onToggle}
                            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                        >
                            <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
                            {expanded ? "Hide details" : "Show details"}
                        </button>
                    )}

                    {expanded && (row.before_state || row.after_state) && (
                        <div className="mt-2 grid sm:grid-cols-2 gap-2 text-[11px]">
                            {row.before_state && (
                                <pre className="rounded-md border border-border/60 bg-muted/40 p-2 overflow-auto max-h-48">
                                    <div className="text-muted-foreground mb-1 font-sans">Before</div>
                                    {JSON.stringify(row.before_state, null, 2)}
                                </pre>
                            )}
                            {row.after_state && (
                                <pre className="rounded-md border border-border/60 bg-muted/40 p-2 overflow-auto max-h-48">
                                    <div className="text-muted-foreground mb-1 font-sans">After</div>
                                    {JSON.stringify(row.after_state, null, 2)}
                                </pre>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </li>
    )
}
