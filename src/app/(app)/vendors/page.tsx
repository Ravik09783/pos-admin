"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Loader2, Pencil, Plus, Trash2, Truck } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { INDIAN_STATES } from "@/lib/indian-states"
import { isValidGSTIN } from "@/lib/utils"
import type { Vendor } from "@/types/database"

const EMPTY_FORM = { name: "", gstin: "", pan: "", phone: "", email: "", state_code: "", address: "" }

export default function VendorsPage() {
    const supabase = createClient()
    const [vendors, setVendors] = useState<Vendor[]>([])
    const [tenantId, setTenantId] = useState("")
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    /** When set, the dialog is in EDIT mode — save() runs UPDATE keyed on
     *  this id. When null, save() inserts a new vendor row. One form
     *  handles both flows so contact-info fixes don't need a workaround. */
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState(EMPTY_FORM)

    async function refresh() {
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) return
        const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
        if (!row?.tenant_id) return
        setTenantId(row.tenant_id)
        const { data } = await supabase.from("vendors").select("*").is("deleted_at", null).order("name")
        setVendors((data ?? []) as Vendor[])
    }
    useEffect(() => { refresh() }, [])

    function openAdd() {
        setEditingId(null)
        setForm(EMPTY_FORM)
        setOpen(true)
    }
    function openEdit(v: Vendor) {
        setEditingId(v.id)
        setForm({
            name: v.name ?? "",
            gstin: v.gstin ?? "",
            pan: v.pan ?? "",
            phone: v.phone ?? "",
            email: v.email ?? "",
            state_code: v.state_code ?? "",
            address: v.address ?? "",
        })
        setOpen(true)
    }
    async function archive(v: Vendor) {
        if (!confirm(`Remove vendor "${v.name}"? Historical purchases keep the vendor name snapshot; the vendor just won't appear in pickers.`)) return
        const { error } = await supabase
            .from("vendors")
            .update({ deleted_at: new Date().toISOString() } as never)
            .eq("id", v.id)
        if (error) return toast.error(error.message)
        toast.success("Vendor removed")
        refresh()
    }

    async function save(e: React.FormEvent) {
        e.preventDefault()
        if (!form.name.trim()) return toast.error("Name required")
        if (form.gstin && !isValidGSTIN(form.gstin)) return toast.error("GSTIN invalid")
        setBusy(true)
        const st = INDIAN_STATES.find((s) => s.code === form.state_code)
        const payload = {
            tenant_id: tenantId,
            name: form.name.trim(),
            gstin: form.gstin || null,
            pan: form.pan || null,
            phone: form.phone || null,
            email: form.email || null,
            state_code: form.state_code || null,
            state: st?.name ?? null,
            address: form.address || null,
        }
        const { error } = editingId
            ? await supabase.from("vendors").update(payload as never).eq("id", editingId)
            : await supabase.from("vendors").insert(payload as never)
        setBusy(false)
        if (error) return toast.error(error.message)
        toast.success(editingId ? "Vendor updated" : "Vendor added")
        setOpen(false)
        setEditingId(null)
        setForm(EMPTY_FORM)
        refresh()
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-6">
            <PageHeader
                kicker="Catalog"
                title="Vendors"
                highlight="GSTIN-ready"
                description="Suppliers for purchases — GSTIN, PAN, contacts."
                actions={
                    <>
                        <Button asChild variant="outline"><Link href="/purchases">View purchases</Link></Button>
                        <Button variant="neon" onClick={openAdd}><Plus className="h-4 w-4" /> Add vendor</Button>
                    </>
                }
            />

            <Card>
                <CardHeader><CardTitle className="text-base">All vendors</CardTitle></CardHeader>
                <CardContent className="px-0">
                    {vendors.length === 0 ? (
                        <div className="text-center py-16 text-muted-foreground">
                            <Truck className="h-8 w-8 mx-auto mb-2 opacity-50" /> No vendors yet.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>GSTIN</TableHead>
                                    <TableHead>State</TableHead>
                                    <TableHead>Phone</TableHead>
                                    <TableHead>Email</TableHead>
                                    <TableHead className="text-right w-[100px]">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {vendors.map((v) => (
                                    <TableRow key={v.id}>
                                        <TableCell className="font-medium">{v.name}</TableCell>
                                        <TableCell className="font-mono text-xs">{v.gstin ?? "—"}</TableCell>
                                        <TableCell className="text-sm">{v.state ?? "—"}</TableCell>
                                        <TableCell className="text-sm">{v.phone ?? "—"}</TableCell>
                                        <TableCell className="text-sm">{v.email ?? "—"}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center gap-1 justify-end">
                                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(v)} aria-label="Edit">
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => archive(v)} aria-label="Remove">
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
            </Card>

            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditingId(null) }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader><DialogTitle>{editingId ? "Edit vendor" : "Add vendor"}</DialogTitle></DialogHeader>
                    <form onSubmit={save} className="space-y-3">
                        <div className="space-y-1.5">
                            <Label>Vendor name *</Label>
                            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>GSTIN</Label>
                                <Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} maxLength={15} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>PAN</Label>
                                <Input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} maxLength={10} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Phone</Label>
                                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Email</Label>
                                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label>State</Label>
                            <Select value={form.state_code} onValueChange={(v) => setForm({ ...form, state_code: v })}>
                                <SelectTrigger><SelectValue placeholder="Pick state" /></SelectTrigger>
                                <SelectContent>
                                    {INDIAN_STATES.map((s) => <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Address</Label>
                            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                        </div>
                        <DialogFooter>
                            <Button type="submit" variant="neon" disabled={busy}>
                                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                                {editingId ? "Save changes" : "Add vendor"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
