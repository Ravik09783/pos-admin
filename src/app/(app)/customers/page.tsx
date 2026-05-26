"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, Filter, Loader2, Pencil, Plus, Search, Trash2, UserSquare2, X } from "lucide-react"
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
import { Pagination } from "@/components/filters/pagination"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { cn, formatCurrency, gstinStateCode, isValidGSTIN } from "@/lib/utils"
import { INDIAN_STATES } from "@/lib/indian-states"
import type { Customer, LoyaltyTier } from "@/types/database"

const TIERS: LoyaltyTier[] = ["BRONZE", "SILVER", "GOLD", "PLATINUM"]
type SortField = "total_spent" | "total_visits" | "loyalty_points" | "created_at" | "last_visit_at" | "name"

export default function CustomersPage() {
    const supabase = createClient()
    const [tenantId, setTenantId] = useState("")
    const [loading, setLoading] = useState(true)
    const [customers, setCustomers] = useState<Customer[]>([])
    const [total, setTotal] = useState(0)

    const [page, setPage] = useState(0)
    const [pageSize, setPageSize] = useState(50)
    const [sortBy, setSortBy] = useState<SortField>("total_spent")
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

    const [search, setSearch] = useState("")
    const [tiers, setTiers] = useState<Set<LoyaltyTier>>(new Set())
    const [showFilters, setShowFilters] = useState(false)
    const [b2bOnly, setB2bOnly] = useState(false)
    const [hasBirthday, setHasBirthday] = useState(false)
    const [hasAnniversary, setHasAnniversary] = useState(false)
    const [hasPoints, setHasPoints] = useState(false)
    const [minSpent, setMinSpent] = useState("")
    const [maxSpent, setMaxSpent] = useState("")
    const [minVisits, setMinVisits] = useState("")

    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    /** When set, the dialog is in EDIT mode and save() runs UPDATE on this
     *  id. When null, save() runs INSERT. One dialog handles both flows
     *  so the form fields stay in sync. */
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState({
        name: "", phone: "", email: "", state_code: "", gstin: "",
        date_of_birth: "", anniversary_date: "", notes: "",
    })

    function emptyForm() {
        setForm({ name: "", phone: "", email: "", state_code: "", gstin: "", date_of_birth: "", anniversary_date: "", notes: "" })
    }
    function openAdd() {
        setEditingId(null)
        emptyForm()
        setOpen(true)
    }
    function openEdit(c: Customer) {
        setEditingId(c.id)
        setForm({
            name: c.name ?? "",
            phone: c.phone ?? "",
            email: c.email ?? "",
            state_code: c.state_code ?? "",
            gstin: c.gstin ?? "",
            date_of_birth: c.date_of_birth ?? "",
            anniversary_date: c.anniversary_date ?? "",
            notes: c.notes ?? "",
        })
        setOpen(true)
    }
    async function archiveCustomer(c: Customer) {
        if (!confirm(`Remove ${c.name ?? c.phone ?? "customer"}? Their bills will keep the historical snapshot; they just won't appear in the list.`)) return
        const { error } = await supabase
            .from("customers")
            .update({ deleted_at: new Date().toISOString() } as never)
            .eq("id", c.id)
        if (error) return toast.error(error.message)
        toast.success("Customer removed")
        refresh()
    }

    const filtersActive = useMemo(() =>
        search.trim().length > 0 || tiers.size > 0 || b2bOnly || hasBirthday || hasAnniversary || hasPoints || minSpent || maxSpent || minVisits,
    [search, tiers, b2bOnly, hasBirthday, hasAnniversary, hasPoints, minSpent, maxSpent, minVisits])

    function clearFilters() {
        setSearch(""); setTiers(new Set()); setB2bOnly(false)
        setHasBirthday(false); setHasAnniversary(false); setHasPoints(false)
        setMinSpent(""); setMaxSpent(""); setMinVisits(""); setPage(0)
    }

    async function refresh() {
        setLoading(true)
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) return
        const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
        if (!row?.tenant_id) return
        setTenantId(row.tenant_id)

        let q = supabase.from("customers").select("*", { count: "exact" }).is("deleted_at", null)
        if (search.trim()) {
            const s = search.trim()
            q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%`)
        }
        if (tiers.size > 0) q = q.in("loyalty_tier", Array.from(tiers))
        if (b2bOnly) q = q.not("gstin", "is", null)
        if (hasBirthday) q = q.not("date_of_birth", "is", null)
        if (hasAnniversary) q = q.not("anniversary_date", "is", null)
        if (hasPoints) q = q.gt("loyalty_points", 0)
        if (minSpent) q = q.gte("total_spent", Number(minSpent))
        if (maxSpent) q = q.lte("total_spent", Number(maxSpent))
        if (minVisits) q = q.gte("total_visits", Number(minVisits))

        q = q.order(sortBy, { ascending: sortDir === "asc", nullsFirst: false })
        q = q.range(page * pageSize, (page + 1) * pageSize - 1)
        const { data, count } = await q
        setCustomers((data ?? []) as Customer[])
        setTotal(count ?? 0)
        setLoading(false)
    }

    useEffect(() => { refresh() }, [page, pageSize, sortBy, sortDir, tiers.size, b2bOnly, hasBirthday, hasAnniversary, hasPoints, minSpent, maxSpent, minVisits])
    useEffect(() => { const t = setTimeout(refresh, 300); return () => clearTimeout(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search])

    function toggleTier(t: LoyaltyTier) {
        const n = new Set(tiers); if (n.has(t)) n.delete(t); else n.add(t)
        setTiers(n); setPage(0)
    }
    function toggleSort(field: SortField) {
        if (sortBy === field) setSortDir((d) => d === "asc" ? "desc" : "asc")
        else { setSortBy(field); setSortDir("desc") }
    }

    async function save(e: React.FormEvent) {
        e.preventDefault()
        if (!form.phone.trim() && !form.email.trim()) return toast.error("Phone or email required")
        if (form.gstin && !isValidGSTIN(form.gstin)) return toast.error("GSTIN invalid")
        setBusy(true)
        const stateCode = form.state_code || gstinStateCode(form.gstin) || null
        const st = INDIAN_STATES.find((s) => s.code === stateCode)
        const payload = {
            tenant_id: tenantId,
            name: form.name.trim() || null,
            phone: form.phone.trim() || null,
            email: form.email.trim() || null,
            state_code: stateCode,
            state: st?.name ?? null,
            gstin: form.gstin || null,
            date_of_birth: form.date_of_birth || null,
            anniversary_date: form.anniversary_date || null,
            notes: form.notes || null,
        }
        // Same payload shape for both flows; the editing branch sends an
        // UPDATE keyed by id, the add branch inserts a fresh row.
        const { error } = editingId
            ? await supabase.from("customers").update(payload as never).eq("id", editingId)
            : await supabase.from("customers").insert(payload as never)
        setBusy(false)
        if (error) return toast.error(error.message)
        toast.success(editingId ? "Customer updated" : "Customer added")
        setOpen(false)
        setEditingId(null)
        emptyForm()
        refresh()
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-4">
            <PageHeader
                kicker="Growth"
                title="Customers"
                highlight="CRM lite"
                description="Phone-indexed, with loyalty tier &amp; spend."
                actions={
                    <>
                        <Button variant="outline" onClick={() => setShowFilters((s) => !s)}>
                            <Filter className="h-4 w-4" /> Filters
                            {filtersActive && <Badge variant="neon" className="ml-1 text-[10px] px-1.5">on</Badge>}
                        </Button>
                        <Button variant="neon" onClick={openAdd}><Plus className="h-4 w-4" /> Add customer</Button>
                    </>
                }
            />

            <Card>
                <CardContent className="pt-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative flex-1 min-w-[220px]">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} placeholder="Name, phone, email…" className="pl-8" />
                        </div>
                        {filtersActive && (
                            <Button variant="ghost" size="sm" onClick={clearFilters}><X className="h-3.5 w-3.5" /> Clear</Button>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted-foreground mr-1">Tier:</span>
                        {TIERS.map((t) => (
                            <button
                                key={t}
                                onClick={() => toggleTier(t)}
                                className={cn(
                                    "px-2.5 py-1 rounded-md text-xs font-medium transition-colors border",
                                    tiers.has(t)
                                        ? "bg-primary/15 border-primary/40 text-primary"
                                        : "bg-muted/40 border-border/40 text-muted-foreground hover:bg-accent",
                                )}
                            >
                                {t}
                            </button>
                        ))}
                    </div>

                    {showFilters && (
                        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-3 border-t border-border/40">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Min spent (₹)</Label>
                                <Input type="number" min="0" value={minSpent} onChange={(e) => { setMinSpent(e.target.value); setPage(0) }} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Max spent (₹)</Label>
                                <Input type="number" min="0" value={maxSpent} onChange={(e) => { setMaxSpent(e.target.value); setPage(0) }} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Min visits</Label>
                                <Input type="number" min="0" value={minVisits} onChange={(e) => { setMinVisits(e.target.value); setPage(0) }} />
                            </div>
                            <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                                <Label className="text-xs">B2B (has GSTIN)</Label>
                                <Switch checked={b2bOnly} onCheckedChange={(v) => { setB2bOnly(v); setPage(0) }} />
                            </div>
                            <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                                <Label className="text-xs">Has birthday on file</Label>
                                <Switch checked={hasBirthday} onCheckedChange={(v) => { setHasBirthday(v); setPage(0) }} />
                            </div>
                            <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                                <Label className="text-xs">Has anniversary</Label>
                                <Switch checked={hasAnniversary} onCheckedChange={(v) => { setHasAnniversary(v); setPage(0) }} />
                            </div>
                            <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                                <Label className="text-xs">Has loyalty points</Label>
                                <Switch checked={hasPoints} onCheckedChange={(v) => { setHasPoints(v); setPage(0) }} />
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="py-3 flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-base">Results</CardTitle>
                    <div className="text-xs text-muted-foreground">{loading ? "Loading…" : `${total} customer${total === 1 ? "" : "s"}`}</div>
                </CardHeader>
                <CardContent className="px-0">
                    {loading ? (
                        <div className="px-6 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
                    ) : customers.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <UserSquare2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            {filtersActive ? "No customers match the filters." : "No customers yet."}
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <SortHead field="name" label="Name" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                                    <TableHead>Phone</TableHead>
                                    <TableHead>Tier</TableHead>
                                    <TableHead>GSTIN</TableHead>
                                    <SortHead field="total_visits" label="Visits" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} className="text-right" />
                                    <SortHead field="total_spent" label="Spent" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} className="text-right" />
                                    <SortHead field="loyalty_points" label="Points" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} className="text-right" />
                                    <TableHead className="text-right w-[100px]">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {customers.map((c) => (
                                    <TableRow key={c.id}>
                                        <TableCell className="font-medium">{c.name ?? "—"}</TableCell>
                                        <TableCell className="text-sm">{c.phone ?? "—"}</TableCell>
                                        <TableCell>
                                            <Badge variant={c.loyalty_tier === "PLATINUM" ? "neon" : c.loyalty_tier === "GOLD" ? "warning" : c.loyalty_tier === "SILVER" ? "secondary" : "outline"}>
                                                {c.loyalty_tier}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">{c.gstin ?? "—"}</TableCell>
                                        <TableCell className="text-right tabular-nums">{c.total_visits}</TableCell>
                                        <TableCell className="text-right font-medium tabular-nums">{formatCurrency(c.total_spent)}</TableCell>
                                        <TableCell className="text-right">
                                            {c.loyalty_points > 0 ? <Badge variant="neon">{c.loyalty_points}</Badge> : <span className="text-muted-foreground">—</span>}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center gap-1 justify-end">
                                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(c)} aria-label="Edit">
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => archiveCustomer(c)} aria-label="Remove">
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

            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditingId(null) }}>
                <DialogContent>
                    <DialogHeader><DialogTitle>{editingId ? "Edit customer" : "Add customer"}</DialogTitle></DialogHeader>
                    <form onSubmit={save} className="space-y-3">
                        <div className="space-y-1.5">
                            <Label>Name</Label>
                            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5"><Label>GSTIN (B2B)</Label><Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} maxLength={15} /></div>
                            <div className="space-y-1.5">
                                <Label>State</Label>
                                <Select value={form.state_code} onValueChange={(v) => setForm({ ...form, state_code: v })}>
                                    <SelectTrigger><SelectValue placeholder="Pick state" /></SelectTrigger>
                                    <SelectContent>
                                        {INDIAN_STATES.map((s) => <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5"><Label>Birthday</Label><Input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} /></div>
                            <div className="space-y-1.5"><Label>Anniversary</Label><Input type="date" value={form.anniversary_date} onChange={(e) => setForm({ ...form, anniversary_date: e.target.value })} /></div>
                        </div>
                        <div className="space-y-1.5"><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                        <DialogFooter>
                            <Button type="submit" variant="neon" disabled={busy}>
                                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                                {editingId ? "Save changes" : "Add"}
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
