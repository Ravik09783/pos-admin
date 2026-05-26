"use client"

import { useEffect, useState } from "react"
import { Loader2, Lock, Pencil, Plus, Tag, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency, formatDate } from "@/lib/utils"
import type { Coupon, LoyaltyTier, UserRole } from "@/types/database"

/** Shape of a coupon row enriched with its creator (joined via the FK).
 *  Supabase returns embeds as either an object or a single-element array
 *  depending on context — we normalise in the render. */
type CouponWithCreator = Coupon & {
    creator?: { full_name: string | null; email: string | null } | Array<{ full_name: string | null; email: string | null }> | null
}

const APPLIES_TO = [
    { value: "ALL", label: "All customers" },
    { value: "BIRTHDAY", label: "Birthday only" },
    { value: "WIN_BACK", label: "Win-back (lapsed)" },
    { value: "NEW_CUSTOMER", label: "New customers" },
    { value: "TIER", label: "Loyalty tier" },
] as const

const TIERS: LoyaltyTier[] = ["BRONZE", "SILVER", "GOLD", "PLATINUM"]

export default function CouponsPage() {
    const supabase = createClient()
    const [tenantId, setTenantId] = useState("")
    const [userId, setUserId] = useState("")
    const [role, setRole] = useState<UserRole | null>(null)
    const [coupons, setCoupons] = useState<CouponWithCreator[]>([])
    const [loading, setLoading] = useState(true)
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    /** When set, the dialog is in EDIT mode — save() runs UPDATE keyed on
     *  this id. Editing a coupon that already has redemptions is allowed:
     *  the audit log keeps the previous values, and changing parameters
     *  (% off, expiry, etc.) is a real campaign use-case. */
    const [editingId, setEditingId] = useState<string | null>(null)
    const EMPTY_FORM = {
        code: "",
        description: "",
        type: "PERCENT" as "PERCENT" | "FLAT",
        value: "10",
        min_order_amount: "0",
        max_discount: "",
        valid_until: "",
        usage_limit: "",
        usage_per_customer: "1",
        applies_to: "ALL" as Coupon["applies_to"],
        required_tier: "" as "" | LoyaltyTier,
    }
    const [form, setForm] = useState(EMPTY_FORM)

    /** datetime-local input expects YYYY-MM-DDTHH:mm; convert from the
     *  ISO timestamps stored in DB so an edit reload shows the original. */
    function toDateTimeLocal(iso: string | null): string {
        if (!iso) return ""
        const d = new Date(iso)
        if (isNaN(d.getTime())) return ""
        const pad = (n: number) => String(n).padStart(2, "0")
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    function openAdd() {
        setEditingId(null)
        setForm(EMPTY_FORM)
        setOpen(true)
    }
    function openEdit(c: Coupon) {
        setEditingId(c.id)
        setForm({
            code: c.code,
            description: c.description ?? "",
            type: c.type as "PERCENT" | "FLAT",
            value: String(c.value),
            min_order_amount: String(c.min_order_amount ?? 0),
            max_discount: c.max_discount != null ? String(c.max_discount) : "",
            valid_until: toDateTimeLocal(c.valid_until),
            usage_limit: c.usage_limit != null ? String(c.usage_limit) : "",
            usage_per_customer: String(c.usage_per_customer ?? 1),
            applies_to: c.applies_to,
            required_tier: (c.required_tier ?? "") as "" | LoyaltyTier,
        })
        setOpen(true)
    }

    const canManage = role === "OWNER" || role === "MANAGER"

    async function refresh() {
        setLoading(true)
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) { setLoading(false); return }
        setUserId(u.user.id)
        const { data: row } = await supabase.from("users").select("tenant_id, role").eq("id", u.user.id).maybeSingle()
        if (!row?.tenant_id) { setLoading(false); return }
        setTenantId(row.tenant_id)
        setRole((row as { role?: UserRole }).role ?? null)
        // Embed the creator's name/email. The cp_read RLS policy on coupons
        // (migration 12) only returns rows for OWNER/MANAGER, so non-admins
        // get an empty list here — we also show a "no access" panel below
        // so they don't think it's just an empty catalog.
        const { data } = await supabase
            .from("coupons")
            .select("*, creator:users!coupons_created_by_fkey(full_name, email)")
            .order("created_at", { ascending: false })
        setCoupons((data ?? []) as CouponWithCreator[])
        setLoading(false)
    }
    useEffect(() => { refresh() }, [])

    async function save(e: React.FormEvent) {
        e.preventDefault()
        if (!form.code.trim()) return toast.error("Code required")
        const value = Number(form.value)
        if (!Number.isFinite(value) || value <= 0) return toast.error("Value must be > 0")
        if (form.type === "PERCENT" && value > 100) return toast.error("Percent cannot exceed 100")
        setBusy(true)
        // Payload identical for insert + update except `created_by` (only
        // stamped on create — UPDATE never overwrites the audit trail).
        const base = {
            tenant_id: tenantId,
            code: form.code.toUpperCase().trim(),
            description: form.description || null,
            type: form.type,
            value,
            min_order_amount: Number(form.min_order_amount) || 0,
            max_discount: form.max_discount ? Number(form.max_discount) : null,
            valid_until: form.valid_until ? new Date(form.valid_until).toISOString() : null,
            usage_limit: form.usage_limit ? Number(form.usage_limit) : null,
            usage_per_customer: Number(form.usage_per_customer) || 1,
            applies_to: form.applies_to,
            required_tier: form.applies_to === "TIER" && form.required_tier ? form.required_tier : null,
        }
        const { error } = editingId
            ? await supabase.from("coupons").update(base as never).eq("id", editingId)
            : await supabase.from("coupons").insert({ ...base, created_by: userId || null } as never)
        setBusy(false)
        if (error) return toast.error(error.message)
        toast.success(editingId ? "Coupon updated" : "Coupon created")
        setOpen(false)
        setEditingId(null)
        setForm(EMPTY_FORM)
        refresh()
    }

    async function toggleActive(c: Coupon, active: boolean) {
        const { error } = await supabase.from("coupons").update({ is_active: active } as never).eq("id", c.id)
        if (error) return toast.error(error.message)
        refresh()
    }
    async function remove(c: Coupon) {
        if (!confirm(`Delete coupon ${c.code}?`)) return
        const { error } = await supabase.from("coupons").delete().eq("id", c.id)
        if (error) return toast.error(error.message)
        refresh()
    }

    // Non-admin guard. The RLS policy already returns an empty result for
    // CASHIER/CAPTAIN/AUDITOR, but showing them a friendly "Restricted"
    // panel is less confusing than a perpetually-empty table.
    if (!loading && role && !canManage) {
        return (
            <div className="container mx-auto py-6 md:py-8 px-4 max-w-3xl">
                <PageHeader kicker="Configure" title="Coupons" highlight="restricted" description="Promo-code settings are limited to admins." />
                <Card>
                    <CardContent className="py-16 text-center text-muted-foreground space-y-3">
                        <Lock className="h-10 w-10 mx-auto opacity-60" />
                        <div>
                            <div className="font-medium text-foreground">Only owners and managers can view coupons</div>
                            <p className="text-sm mt-1">
                                Cashiers can still apply a coupon at the till by typing its code into the POS.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-6xl space-y-6">
            <PageHeader
                kicker="Configure"
                title="Coupons"
                highlight="promo codes"
                description="For marketing campaigns and walk-in discounts. Only owners and managers can view this page."
                actions={
                    <Button variant="neon" onClick={openAdd}><Plus className="h-4 w-4" /> New coupon</Button>
                }
            />

            <Card>
                <CardHeader><CardTitle className="text-base">Active coupons</CardTitle></CardHeader>
                <CardContent className="px-0">
                    {coupons.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <Tag className="h-8 w-8 mx-auto mb-2 opacity-50" /> No coupons yet.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Code</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Value</TableHead>
                                    <TableHead>Audience</TableHead>
                                    <TableHead>Used</TableHead>
                                    <TableHead>Expires</TableHead>
                                    <TableHead>Created by</TableHead>
                                    <TableHead>Active</TableHead>
                                    <TableHead className="text-right w-[100px]">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {coupons.map((c) => {
                                    // Normalise the embed: Supabase returns it as either an
                                    // object or a single-element array depending on the join.
                                    const creator = Array.isArray(c.creator) ? c.creator[0] : c.creator
                                    const creatorLabel = creator?.full_name ?? creator?.email ?? "—"
                                    return (
                                        <TableRow key={c.id}>
                                            <TableCell className="font-mono font-semibold">{c.code}</TableCell>
                                            <TableCell><Badge variant="outline">{c.type}</Badge></TableCell>
                                            <TableCell>{c.type === "PERCENT" ? `${c.value}%` : formatCurrency(c.value)}</TableCell>
                                            <TableCell className="text-sm">
                                                <Badge variant="neon" className="text-[10px]">{c.applies_to}</Badge>
                                                {c.required_tier && <Badge variant="outline" className="ml-1 text-[10px]">{c.required_tier}</Badge>}
                                            </TableCell>
                                            <TableCell className="text-sm">{c.times_used}{c.usage_limit ? `/${c.usage_limit}` : ""}</TableCell>
                                            <TableCell className="text-sm">{c.valid_until ? formatDate(c.valid_until, { dateStyle: "medium" }) : "—"}</TableCell>
                                            <TableCell className="text-sm">
                                                <div className="font-medium">{creatorLabel}</div>
                                                <div className="text-[11px] text-muted-foreground">{formatDate(c.created_at, { dateStyle: "medium" })}</div>
                                            </TableCell>
                                            <TableCell><Switch checked={c.is_active} onCheckedChange={(v) => toggleActive(c, v)} /></TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1 justify-end">
                                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)} aria-label="Edit">
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(c)} aria-label="Delete">
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditingId(null) }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader><DialogTitle>{editingId ? "Edit coupon" : "New coupon"}</DialogTitle></DialogHeader>
                    <form onSubmit={save} className="space-y-3 max-h-[75vh] overflow-y-auto pr-1 scrollbar-thin">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5"><Label>Code *</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="WELCOME20" maxLength={20} /></div>
                            <div className="space-y-1.5">
                                <Label>Type</Label>
                                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as typeof form.type })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="PERCENT">Percent off</SelectItem>
                                        <SelectItem value="FLAT">Flat amount off</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Description</Label>
                            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="20% off your first order" />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-1.5">
                                <Label>{form.type === "PERCENT" ? "Percent" : "Amount (₹)"}</Label>
                                <Input type="number" step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
                            </div>
                            <div className="space-y-1.5"><Label>Min order ₹</Label><Input type="number" step="0.01" value={form.min_order_amount} onChange={(e) => setForm({ ...form, min_order_amount: e.target.value })} /></div>
                            {form.type === "PERCENT" && (
                                <div className="space-y-1.5"><Label>Max ₹ off</Label><Input type="number" step="0.01" value={form.max_discount} onChange={(e) => setForm({ ...form, max_discount: e.target.value })} /></div>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5"><Label>Valid until</Label><Input type="datetime-local" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} /></div>
                            <div className="space-y-1.5"><Label>Usage limit (total)</Label><Input type="number" value={form.usage_limit} onChange={(e) => setForm({ ...form, usage_limit: e.target.value })} placeholder="∞" /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5"><Label>Per customer</Label><Input type="number" min="1" value={form.usage_per_customer} onChange={(e) => setForm({ ...form, usage_per_customer: e.target.value })} /></div>
                            <div className="space-y-1.5">
                                <Label>Audience</Label>
                                <Select value={form.applies_to} onValueChange={(v) => setForm({ ...form, applies_to: v as Coupon["applies_to"] })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>{APPLIES_TO.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                        </div>
                        {form.applies_to === "TIER" && (
                            <div className="space-y-1.5">
                                <Label>Required tier</Label>
                                <Select value={form.required_tier} onValueChange={(v) => setForm({ ...form, required_tier: v as LoyaltyTier })}>
                                    <SelectTrigger><SelectValue placeholder="Pick" /></SelectTrigger>
                                    <SelectContent>{TIERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                        )}
                        <DialogFooter>
                            <Button type="submit" variant="neon" disabled={busy}>
                                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                                {editingId ? "Save changes" : "Create"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
