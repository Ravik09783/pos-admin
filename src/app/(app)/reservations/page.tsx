"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Users } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell/page-header"
import { PageTour } from "@/components/tours/page-tour"
import { TourReplayButton } from "@/components/tours/tour-replay-button"
import { createClient } from "@/lib/supabase/client"
import { cn, formatDate } from "@/lib/utils"
import { scopeQueryToBranch, useActiveBranch } from "@/lib/branch/active-branch"
import type { DiningTable, Reservation } from "@/types/database"

const STATUSES = ["PENDING", "CONFIRMED", "SEATED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const

/** Reservation row with creator info pulled in via the FK embed. Supabase
 *  may return the embed as either an object or a single-element array. */
type ReservationWithCreator = Reservation & {
    arrived_at?: string | null
    completed_at?: string | null
    creator?: { full_name: string | null; email: string | null } | Array<{ full_name: string | null; email: string | null }> | null
}

/** Lift "any single-element-array OR object" embed into a single object. */
function firstEmbed<T>(v: T | T[] | null | undefined): T | null {
    if (!v) return null
    return Array.isArray(v) ? (v[0] ?? null) : v
}

/** Considered overdue when CONFIRMED and the reserved time has passed by 15+
 *  minutes — staff probably forgot to mark the guest arrived. Earlier than
 *  that and we'd nag for guests who are just slightly late. */
function isOverdue(r: Reservation): boolean {
    if (r.status !== "CONFIRMED" && r.status !== "PENDING") return false
    const reservedTime = new Date(r.reserved_for).getTime()
    return reservedTime + 15 * 60 * 1000 < Date.now()
}

const EMPTY_FORM = {
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    party_size: "2",
    reserved_for: new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16),
    duration_minutes: "90",
    table_id: "",
    special_requests: "",
}

export default function ReservationsPage() {
    const supabase = createClient()
    const [tenantId, setTenantId] = useState("")
    const [userId, setUserId] = useState("")
    const [reservations, setReservations] = useState<ReservationWithCreator[]>([])
    const [tables, setTables] = useState<DiningTable[]>([])
    /** Global active branch — drives both list filter + new-reservation
     *  assignment. New rows inherit this so the admin doesn't pick per row. */
    const { activeBranchId } = useActiveBranch()
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const [dayOffset, setDayOffset] = useState(0)
    const [filter, setFilter] = useState<"upcoming" | "all">("upcoming")
    /** When non-null the dialog opens in edit mode, prefilled with this row. */
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState(EMPTY_FORM)

    const today = useMemo(() => {
        const d = new Date()
        d.setHours(0, 0, 0, 0)
        d.setDate(d.getDate() + dayOffset)
        return d
    }, [dayOffset])

    async function refresh() {
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) return
        setUserId(u.user.id)
        const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
        if (!row?.tenant_id) return
        setTenantId(row.tenant_id)
        let resQ = supabase
            .from("reservations")
            .select("*, creator:users!reservations_created_by_fkey(full_name, email)")
            .order("reserved_for")
        resQ = scopeQueryToBranch(resQ, activeBranchId)
        // Dining tables dropdown in the new-reservation form also needs
        // scoping — otherwise admins see tables from other branches when
        // booking.
        let tblsQ = supabase.from("dining_tables").select("*").order("number")
        tblsQ = scopeQueryToBranch(tblsQ, activeBranchId)
        const [{ data: rs }, { data: ts }] = await Promise.all([
            resQ,
            tblsQ,
        ])
        setReservations((rs ?? []) as ReservationWithCreator[])
        setTables((ts ?? []) as DiningTable[])
    }
    useEffect(() => { refresh() }, [activeBranchId])

    const visible = useMemo(() => {
        if (filter === "all") return reservations
        const start = new Date(today).getTime()
        const end = start + 24 * 60 * 60 * 1000
        return reservations.filter((r) => {
            const t = new Date(r.reserved_for).getTime()
            return t >= start && t < end
        })
    }, [reservations, today, filter])

    function openCreate() {
        setEditingId(null)
        setForm({ ...EMPTY_FORM, reserved_for: new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16) })
        setOpen(true)
    }

    function openEdit(r: Reservation) {
        setEditingId(r.id)
        setForm({
            customer_name: r.customer_name ?? "",
            customer_phone: r.customer_phone ?? "",
            customer_email: r.customer_email ?? "",
            party_size: String(r.party_size ?? 2),
            // datetime-local needs "YYYY-MM-DDTHH:MM" — slice off the seconds + Z.
            reserved_for: new Date(r.reserved_for).toISOString().slice(0, 16),
            duration_minutes: String(r.duration_minutes ?? 90),
            table_id: r.table_id ?? "",
            special_requests: r.special_requests ?? "",
        })
        setOpen(true)
    }

    async function save(e: React.FormEvent) {
        e.preventDefault()
        if (!form.customer_name.trim()) return toast.error("Customer name required")
        setBusy(true)
        const payload = {
            customer_name: form.customer_name.trim(),
            customer_phone: form.customer_phone || null,
            customer_email: form.customer_email || null,
            party_size: Number(form.party_size) || 2,
            reserved_for: new Date(form.reserved_for).toISOString(),
            duration_minutes: Number(form.duration_minutes) || 90,
            table_id: form.table_id || null,
            special_requests: form.special_requests || null,
            // New reservations inherit the currently-active branch — no
            // per-form picker. Editing leaves the existing branch_id
            // alone so admins can't accidentally re-assign by saving.
            ...(editingId ? {} : { branch_id: activeBranchId }),
        }
        const { error } = editingId
            ? await supabase.from("reservations").update(payload as never).eq("id", editingId)
            : await supabase.from("reservations").insert({
                ...payload,
                tenant_id: tenantId,
                status: "CONFIRMED",
                // Audit: who made this booking. The creator embed reads it back
                // so each card shows "booked by …".
                created_by: userId || null,
            } as never)
        setBusy(false)
        if (error) return toast.error(error.message)
        toast.success(editingId ? "Reservation updated" : "Reservation booked")
        setOpen(false)
        setEditingId(null)
        setForm(EMPTY_FORM)
        refresh()
    }

    /** Transition a reservation. We stamp arrived_at on SEATED and
     *  completed_at on COMPLETED so reports can ask "average dwell time"
     *  without inferring from status-change audit logs.
     *
     *  `skipConfirm` lets callers (e.g. "Mark seated") move forward without
     *  the dialog; the overdue "Complete (arrived)" shortcut prompts first. */
    async function setStatus(
        r: Reservation,
        status: Reservation["status"],
        opts: { skipConfirm?: boolean; alsoMarkArrived?: boolean } = {},
    ) {
        if (!opts.skipConfirm) {
            if (status === "COMPLETED" && r.status !== "SEATED") {
                const ok = window.confirm(
                    `This reservation was never marked as arrived. Mark "${r.customer_name}" as completed (and record arrival now)?`,
                )
                if (!ok) return
                opts.alsoMarkArrived = true
            } else if (status === "NO_SHOW") {
                const ok = window.confirm(`Mark "${r.customer_name}" as a no-show?`)
                if (!ok) return
            } else if (status === "CANCELLED") {
                const ok = window.confirm(`Cancel reservation for "${r.customer_name}"?`)
                if (!ok) return
            }
        }
        const now = new Date().toISOString()
        const patch: Record<string, unknown> = { status }
        if (status === "SEATED") patch.arrived_at = now
        if (status === "COMPLETED") {
            patch.completed_at = now
            if (opts.alsoMarkArrived) patch.arrived_at = now
        }
        const { error } = await supabase.from("reservations").update(patch as never).eq("id", r.id)
        if (error) return toast.error(error.message)
        toast.success(
            status === "SEATED" ? "Guest seated" :
            status === "COMPLETED" ? "Reservation completed" :
            status === "NO_SHOW" ? "Marked no-show" :
            status === "CANCELLED" ? "Reservation cancelled" :
            "Updated",
        )
        refresh()
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-6">
            <PageTour tourKey="reservations" />
            <PageHeader
                kicker="Operations"
                title="Reservations"
                highlight="up to 30 days"
                description="Bookings in advance, walk-in waitlist, and seating flow."
                actions={
                    <>
                        <Button variant="neon" onClick={openCreate} data-tour="reservations-new"><Plus className="h-4 w-4" /> New reservation</Button>
                        <TourReplayButton tourKey="reservations" />
                    </>
                }
            />

            <div className="flex items-center justify-between flex-wrap gap-2">
                <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
                    <TabsList>
                        <TabsTrigger value="upcoming">By day</TabsTrigger>
                        <TabsTrigger value="all">All</TabsTrigger>
                    </TabsList>
                </Tabs>
                {filter === "upcoming" && (
                    <div className="flex items-center gap-2">
                        <Button size="icon" variant="outline" onClick={() => setDayOffset(dayOffset - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                        <div className="font-medium px-3 min-w-[140px] text-center">
                            {dayOffset === 0 ? "Today" : dayOffset === 1 ? "Tomorrow" : today.toLocaleDateString("en-IN", { weekday: "short", month: "short", day: "numeric" })}
                        </div>
                        <Button size="icon" variant="outline" onClick={() => setDayOffset(dayOffset + 1)}><ChevronRight className="h-4 w-4" /></Button>
                    </div>
                )}
            </div>

            {visible.length === 0 ? (
                <Card data-tour="reservations-list"><CardContent className="text-center py-16 text-muted-foreground">
                    <CalendarDays className="h-8 w-8 mx-auto mb-2 opacity-50" /> No reservations.
                </CardContent></Card>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-tour="reservations-list">
                    {visible.map((r) => {
                        const time = new Date(r.reserved_for)
                        const tbl = tables.find((t) => t.id === r.table_id)
                        const creator = firstEmbed(r.creator)
                        const creatorLabel = creator?.full_name ?? creator?.email ?? null
                        const overdue = isOverdue(r)
                        const editable = !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(r.status)
                        return (
                            <Card
                                key={r.id}
                                className={cn(
                                    "hover:border-primary/40 transition-colors",
                                    overdue && "border-warning/60",
                                )}
                            >
                                <CardHeader className="pb-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <CardTitle className="text-base truncate">{r.customer_name}</CardTitle>
                                            <p className="text-sm text-muted-foreground">
                                                {time.toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true })}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            {editable && (
                                                <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => openEdit(r)}>
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                            )}
                                            <Badge variant={
                                                r.status === "CONFIRMED" ? "success" :
                                                r.status === "PENDING" ? "warning" :
                                                r.status === "CANCELLED" || r.status === "NO_SHOW" ? "destructive" : "secondary"
                                            }>{r.status}</Badge>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-2 text-sm">
                                    <div className="flex items-center gap-3 text-muted-foreground">
                                        <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {r.party_size}</span>
                                        {tbl && <span>· Table {tbl.number}</span>}
                                        <span>· {r.duration_minutes}m</span>
                                    </div>
                                    {r.customer_phone && <div className="text-muted-foreground">{r.customer_phone}</div>}
                                    {r.special_requests && <div className="text-xs italic">&ldquo;{r.special_requests}&rdquo;</div>}

                                    {/* Overdue prompt — reservation time has passed by 15+ minutes
                                     *  but staff never marked the guest arrived. Surface a clear
                                     *  banner so the booking doesn't quietly stay open forever. */}
                                    {overdue && (
                                        <div className="rounded-md bg-warning/10 border border-warning/40 px-2.5 py-2 space-y-1.5">
                                            <div className="flex items-center gap-1.5 text-xs font-medium text-warning">
                                                <AlertCircle className="h-3.5 w-3.5" />
                                                Reservation time has passed — did the guest arrive?
                                            </div>
                                            <div className="flex flex-wrap gap-1">
                                                <Button size="sm" variant="outline" onClick={() => setStatus(r, "SEATED", { skipConfirm: true })}>
                                                    Mark arrived
                                                </Button>
                                                <Button size="sm" variant="outline" onClick={() => setStatus(r, "COMPLETED")}>
                                                    Arrived &amp; complete
                                                </Button>
                                                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setStatus(r, "NO_SHOW")}>
                                                    No-show
                                                </Button>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex flex-wrap gap-1 pt-1">
                                        {r.status === "CONFIRMED" && !overdue && (
                                            <Button size="sm" variant="outline" onClick={() => setStatus(r, "SEATED", { skipConfirm: true })}>Mark arrived</Button>
                                        )}
                                        {r.status === "SEATED" && (
                                            <Button size="sm" variant="outline" onClick={() => setStatus(r, "COMPLETED", { skipConfirm: true })}>Complete</Button>
                                        )}
                                        {!["CANCELLED", "COMPLETED", "NO_SHOW"].includes(r.status) && !overdue && (
                                            <>
                                                <Button size="sm" variant="ghost" onClick={() => setStatus(r, "NO_SHOW")} className="text-destructive">No-show</Button>
                                                <Button size="sm" variant="ghost" onClick={() => setStatus(r, "CANCELLED")}>Cancel</Button>
                                            </>
                                        )}
                                    </div>

                                    {/* Audit footer — when + who. created_at + created_by */}
                                    {(creatorLabel || r.created_at) && (
                                        <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                                            Booked {creatorLabel ? <>by <span className="font-medium text-foreground">{creatorLabel}</span></> : null}
                                            {r.created_at ? <> · {formatDate(r.created_at, { dateStyle: "medium", timeStyle: "short" })}</> : null}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}

            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditingId(null) }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader><DialogTitle>{editingId ? "Edit reservation" : "New reservation"}</DialogTitle></DialogHeader>
                    <form onSubmit={save} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5"><Label>Customer name *</Label><Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></div>
                            <div className="space-y-1.5"><Label>Phone</Label><Input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} /></div>
                        </div>
                        <div className="space-y-1.5"><Label>Email (optional)</Label><Input type="email" value={form.customer_email} onChange={(e) => setForm({ ...form, customer_email: e.target.value })} /></div>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-1.5"><Label>Party size</Label><Input type="number" min="1" value={form.party_size} onChange={(e) => setForm({ ...form, party_size: e.target.value })} /></div>
                            <div className="space-y-1.5 col-span-2"><Label>Date & time</Label><Input type="datetime-local" value={form.reserved_for} onChange={(e) => setForm({ ...form, reserved_for: e.target.value })} /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5"><Label>Duration (min)</Label><Input type="number" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} /></div>
                            <div className="space-y-1.5">
                                <Label>Table (optional)</Label>
                                <Select value={form.table_id} onValueChange={(v) => setForm({ ...form, table_id: v })}>
                                    <SelectTrigger><SelectValue placeholder="Auto-assign" /></SelectTrigger>
                                    <SelectContent>
                                        {tables
                                            .filter((t) => {
                                                // When a branch is active, only show its tables (plus legacy
                                                // unscoped null-branch tables). When viewing "All branches"
                                                // we keep the full list.
                                                if (!activeBranchId) return true
                                                const tb = (t as DiningTable & { branch_id?: string | null }).branch_id
                                                return !tb || tb === activeBranchId
                                            })
                                            .map((t) => <SelectItem key={t.id} value={t.id}>{t.number} ({t.capacity})</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="space-y-1.5"><Label>Special requests</Label><Textarea value={form.special_requests} onChange={(e) => setForm({ ...form, special_requests: e.target.value })} /></div>
                        <DialogFooter>
                            <Button type="submit" variant="neon" disabled={busy}>
                                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                                {editingId ? "Save changes" : "Book"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
