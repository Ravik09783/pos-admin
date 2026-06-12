"use client"

import { useEffect, useMemo, useState } from "react"
import { Building2, Loader2, MapPin, Pencil, Plus, Trash2 } from "lucide-react"
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
import { PageHeader } from "@/components/app-shell/page-header"
import { BRANCHES_CHANGED_EVENT } from "@/lib/branch/active-branch"
import { createClient } from "@/lib/supabase/client"
import { COUNTRY_OPTIONS, getTaxConfig } from "@/lib/tax/locale-config"
import { gstinStateCode, isValidGSTIN } from "@/lib/utils"
import { PlanCapacityCard, type PlanCapacitySummary } from "@/components/billing/plan-capacity-card"
import type { Branch, BranchTaxProfile } from "@/types/database"

const EMPTY_FORM = {
    name: "",
    code: "",
    phone: "",
    email: "",
    country_code: "IN",
    state_code: "",
    city: "",
    pincode: "",
    address_line1: "",
    tax_id: "",
    pan: "",
    fssai: "",
    is_main: false,
    // Geofenced attendance pin (migration 60). Strings in the form;
    // parsed + validated on save. Empty = no geofence.
    latitude: "",
    longitude: "",
    geofence_radius_m: "50",
}

export default function BranchesPage() {
    const supabase = createClient()
    const [tenantId, setTenantId] = useState("")
    const [tenantCountry, setTenantCountry] = useState("India")
    const [branches, setBranches] = useState<Branch[]>([])
    const [taxProfiles, setTaxProfiles] = useState<Record<string, BranchTaxProfile>>({})
    const [capacity, setCapacity] = useState<PlanCapacitySummary | null>(null)
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    /** When set, the dialog is in EDIT mode — save() runs UPDATE keyed
     *  on this id. Single dialog handles both flows. */
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState(EMPTY_FORM)
    const cfg = useMemo(() => getTaxConfig(form.country_code), [form.country_code])
    const isIndia = cfg.code === "IN"
    const hasRegions = cfg.stateMatters && (cfg.states?.length ?? 0) > 0
    const regionLabel = cfg.code === "IN" ? "State" : cfg.code === "CA" ? "Province" : cfg.code === "US" ? "State" : "Region"

    async function refresh() {
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) return
        const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
        if (!row?.tenant_id) return
        setTenantId(row.tenant_id)
        const [{ data: tenant }, { data }, capRes] = await Promise.all([
            supabase.from("tenants").select("country").eq("id", row.tenant_id).maybeSingle(),
            supabase.from("branches").select("*").order("name"),
            // Capacity meter lives next to the outlet table — fetch it in
            // the same trip so the page never paints a stale "X of Y" header.
            fetch("/api/billing/plan-capacity").then((r) => r.ok ? r.json() : null).catch(() => null),
        ])
        if (capRes && typeof capRes === "object" && !("error" in capRes)) {
            setCapacity(capRes as PlanCapacitySummary)
        }
        const tc = (tenant as { country?: string | null } | null)?.country ?? "India"
        setTenantCountry(tc)
        const nextBranches = (data ?? []) as Branch[]
        setBranches(nextBranches)

        const ids = nextBranches.map((b) => b.id)
        if (ids.length === 0) {
            setTaxProfiles({})
        } else {
            const { data: profiles, error } = await supabase
                .from("branch_tax_profiles")
                .select("*")
                .in("branch_id", ids)
            if (error) {
                setTaxProfiles({})
                toast.error(error.message)
            } else {
                const byBranch: Record<string, BranchTaxProfile> = {}
                for (const p of (profiles ?? []) as BranchTaxProfile[]) byBranch[p.branch_id] = p
                setTaxProfiles(byBranch)
            }
        }
    }
    useEffect(() => { refresh() }, [])

    function defaultCountryCode() {
        return getTaxConfig(tenantCountry).code
    }

    function pickCountry(code: string) {
        setForm((f) => ({ ...f, country_code: code, state_code: "", tax_id: "", pan: "", fssai: "" }))
    }

    function openAdd() {
        setEditingId(null)
        setForm({ ...EMPTY_FORM, country_code: defaultCountryCode(), is_main: branches.length === 0 })
        setOpen(true)
    }
    function openEdit(b: Branch) {
        const tax = taxProfiles[b.id]
        setEditingId(b.id)
        setForm({
            name: b.name ?? "",
            code: b.code ?? "",
            phone: b.phone ?? "",
            email: b.email ?? "",
            country_code: getTaxConfig(tax?.country ?? tenantCountry).code,
            state_code: b.state_code ?? "",
            city: b.city ?? "",
            pincode: b.pincode ?? "",
            address_line1: b.address_line1 ?? "",
            tax_id: tax?.gstin ?? "",
            pan: tax?.pan ?? "",
            fssai: tax?.fssai ?? "",
            is_main: b.is_main ?? false,
            latitude: b.latitude != null ? String(b.latitude) : "",
            longitude: b.longitude != null ? String(b.longitude) : "",
            geofence_radius_m: String(b.geofence_radius_m ?? 50),
        })
        setOpen(true)
    }

    /** Fill the geofence pin from the device's current position — the owner
     *  stands at the counter and taps once instead of hunting coordinates. */
    function useMyLocation() {
        if (typeof navigator === "undefined" || !navigator.geolocation) {
            return toast.error("This browser can't access location.")
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setForm((f) => ({
                    ...f,
                    latitude: pos.coords.latitude.toFixed(6),
                    longitude: pos.coords.longitude.toFixed(6),
                }))
                toast.success("Location captured — save to apply.")
            },
            () => toast.error("Couldn't read your location — allow location access and try again."),
            { enableHighAccuracy: true, timeout: 10000 },
        )
    }

    async function save(e: React.FormEvent) {
        e.preventDefault()
        if (!form.name.trim()) return toast.error("Branch name required")
        if (hasRegions && !form.state_code) return toast.error(`Pick branch ${regionLabel.toLowerCase()}`)
        if (cfg.taxIdRequired && !form.tax_id.trim()) return toast.error(`${cfg.taxIdLabel} is required in ${cfg.name}`)

        // Plan cap: refuse to add a new branch when the tenant is at the
        // limit. Editing existing branches is always allowed. The RPC
        // returns true during TRIAL and when the tier has unlimited caps,
        // so this only fires on a paid plan with branches at-cap.
        if (!editingId) {
            const { data: ok, error: capErr } = await supabase.rpc(
                "can_create_branch" as never,
                { p_tenant_id: tenantId } as never,
            )
            if (!capErr && ok === false) {
                return toast.error("Your plan has reached its outlet limit. Upgrade in Settings → Billing to add another branch.", {
                    action: { label: "Open Billing", onClick: () => window.location.assign("/settings/billing") },
                })
            }
        }
        if (isIndia) {
            if (form.tax_id && !isValidGSTIN(form.tax_id)) return toast.error("GSTIN format looks wrong")
            if (form.tax_id) {
                const sc = gstinStateCode(form.tax_id)
                if (sc && form.state_code && sc !== form.state_code) {
                    return toast.error(`GSTIN state code (${sc}) doesn't match selected state (${form.state_code}).`)
                }
            }
            if (form.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(form.pan)) return toast.error("PAN format looks wrong")
            if (form.pincode && !/^\d{6}$/.test(form.pincode)) return toast.error("PIN code should be 6 digits")
        }
        // Geofence pin: both coordinates or neither; sane ranges.
        const lat = form.latitude.trim() ? Number(form.latitude) : null
        const lng = form.longitude.trim() ? Number(form.longitude) : null
        const radius = Math.round(Number(form.geofence_radius_m) || 50)
        if ((lat == null) !== (lng == null)) {
            return toast.error("Enter both latitude and longitude (or clear both to disable the geofence).")
        }
        if (lat != null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) return toast.error("Latitude must be between -90 and 90.")
        if (lng != null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) return toast.error("Longitude must be between -180 and 180.")
        if (lat != null && (radius < 10 || radius > 5000)) return toast.error("Geofence radius should be 10–5000 metres.")

        setBusy(true)
        const st = cfg.states?.find((s) => s.code === form.state_code)
        const isMain = form.is_main || (!editingId && branches.length === 0)
        const payload = {
            tenant_id: tenantId,
            name: form.name.trim(),
            code: form.code || null,
            phone: form.phone || null,
            email: form.email || null,
            state_code: form.state_code || null,
            state: st?.name ?? null,
            city: form.city || null,
            pincode: form.pincode || null,
            address_line1: form.address_line1 || null,
            latitude: lat,
            longitude: lng,
            geofence_radius_m: radius,
            is_main: isMain,
            ...(editingId ? {} : { is_active: true }),
        }
        if (isMain) {
            const clearMain = editingId
                ? await supabase.from("branches").update({ is_main: false } as never).eq("tenant_id", tenantId).neq("id", editingId)
                : await supabase.from("branches").update({ is_main: false } as never).eq("tenant_id", tenantId)
            if (clearMain.error) {
                setBusy(false)
                return toast.error(clearMain.error.message)
            }
        }
        const savedBranch = editingId
            ? await supabase.from("branches").update(payload as never).eq("id", editingId).select("id").single()
            : await supabase.from("branches").insert(payload as never).select("id").single()
        const branchId = (savedBranch.data as { id: string } | null)?.id
        if (savedBranch.error || !branchId) {
            setBusy(false)
            return toast.error(savedBranch.error?.message ?? "Could not save branch")
        }

        const { error: taxError } = await supabase
            .from("branch_tax_profiles")
            .upsert({
                tenant_id: tenantId,
                branch_id: branchId,
                country: cfg.name,
                currency: cfg.currency,
                gstin: form.tax_id.trim() || null,
                pan: isIndia ? (form.pan.trim() || null) : null,
                fssai: isIndia ? (form.fssai.trim() || null) : null,
            } as never, { onConflict: "branch_id" })
        setBusy(false)
        if (taxError) return toast.error(taxError.message)
        toast.success(editingId ? "Branch updated" : "Branch added")
        setOpen(false)
        setEditingId(null)
        setForm(EMPTY_FORM)
        window.dispatchEvent(new Event(BRANCHES_CHANGED_EVENT))
        refresh()
    }

    async function setActive(b: Branch, active: boolean) {
        // Reactivating an inactive outlet has to go through the same
        // cap check as creating a new one — otherwise an OWNER who
        // downgraded their plan + deactivated outlets to fit could
        // silently push the tenant back over its limit by flipping
        // them on again.
        if (active && !b.is_active) {
            const { data: ok, error: capErr } = await supabase.rpc(
                "can_reactivate_branch" as never,
                { p_branch_id: b.id } as never,
            )
            if (!capErr && ok === false) {
                return toast.error("Your plan has reached its outlet limit. Deactivate another outlet, or upgrade your plan, before reactivating this one.", {
                    action: { label: "Open Billing", onClick: () => window.location.assign("/settings/billing") },
                })
            }
        }
        const { error } = await supabase.from("branches").update({ is_active: active } as never).eq("id", b.id)
        if (error) return toast.error(error.message)
        window.dispatchEvent(new Event(BRANCHES_CHANGED_EVENT))
        refresh()
    }

    async function remove(b: Branch) {
        if (!confirm(`Delete branch "${b.name}"? This is irreversible. Historical reports stay attached to the deleted branch via snapshots.`)) return
        const { error } = await supabase.from("branches").delete().eq("id", b.id)
        if (error) return toast.error(error.message)
        window.dispatchEvent(new Event(BRANCHES_CHANGED_EVENT))
        refresh()
    }

    // Pre-flight cap state for the "Add branch" CTA. When the plan is
    // at cap (and we're not on TRIAL), the button stays disabled with
    // a tooltip — clicking would just toast an error and waste a click.
    const branchesAtCap = capacity != null && !capacity.unlimited && capacity.branches_at_cap

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-6xl space-y-6">
            <PageHeader
                kicker="Configure"
                title="Branches"
                highlight="multi-outlet"
                description="Each branch has its own staff, inventory, and reports."
                actions={
                    <Button
                        variant="neon"
                        onClick={openAdd}
                        disabled={branchesAtCap}
                        title={branchesAtCap ? "Your plan has reached its outlet limit. Open Billing to upgrade." : undefined}
                    >
                        <Plus className="h-4 w-4" /> Add branch
                    </Button>
                }
            />

            <PlanCapacityCard mode="branches" summary={capacity} />

            <Card>
                <CardHeader><CardTitle className="text-base">Outlets</CardTitle></CardHeader>
                <CardContent className="px-0">
                    {branches.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <Building2 className="h-8 w-8 mx-auto mb-2 opacity-50" /> No branches yet. The default tenant is your &ldquo;main&rdquo; location.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Code</TableHead>
                                    <TableHead>City</TableHead>
                                    <TableHead>State</TableHead>
                                    <TableHead>Tax</TableHead>
                                    <TableHead>Phone</TableHead>
                                    <TableHead>Main</TableHead>
                                    <TableHead>Active</TableHead>
                                    <TableHead className="text-right w-[100px]">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {branches.map((b) => (
                                    <TableRow key={b.id}>
                                        <TableCell className="font-medium">{b.name}</TableCell>
                                        <TableCell><Badge variant="outline">{b.code ?? "—"}</Badge></TableCell>
                                        <TableCell className="text-sm">{b.city ?? "—"}</TableCell>
                                        <TableCell className="text-sm">{b.state ?? "—"}</TableCell>
                                        <TableCell className="text-sm">{taxProfiles[b.id]?.gstin ? <Badge variant="outline">{taxProfiles[b.id]!.gstin}</Badge> : "-"}</TableCell>
                                        <TableCell className="text-sm">{b.phone ?? "-"}</TableCell>
                                        <TableCell>{b.is_main && <Badge variant="neon">MAIN</Badge>}</TableCell>
                                        <TableCell><Switch checked={b.is_active} onCheckedChange={(v) => setActive(b, v)} /></TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1 justify-end">
                                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(b)} aria-label="Edit">
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(b)} aria-label="Delete">
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
                <DialogContent className="max-h-[90vh] overflow-y-auto">
                    <DialogHeader><DialogTitle>{editingId ? "Edit branch" : "Add branch"}</DialogTitle></DialogHeader>
                    <form onSubmit={save} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5"><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                            <div className="space-y-1.5"><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="CP-01" /></div>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Country *</Label>
                            <Select value={form.country_code} onValueChange={pickCountry}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {COUNTRY_OPTIONS.map((o) => <SelectItem key={o.code} value={o.code}>{o.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>{regionLabel}{hasRegions ? " *" : ""}</Label>
                                {hasRegions ? (
                                    <Select value={form.state_code} onValueChange={(v) => setForm({ ...form, state_code: v })}>
                                        <SelectTrigger><SelectValue placeholder={`Pick ${regionLabel.toLowerCase()}`} /></SelectTrigger>
                                        <SelectContent>{cfg.states!.map((s) => <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                ) : (
                                    <Input value="" placeholder="Not required" disabled />
                                )}
                            </div>
                            <div className="space-y-1.5"><Label>PIN code</Label><Input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} /></div>
                        </div>
                        <div className="space-y-1.5"><Label>City</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
                        <div className="space-y-1.5"><Label>Address</Label><Input value={form.address_line1} onChange={(e) => setForm({ ...form, address_line1: e.target.value })} /></div>

                        {/* ── Attendance geofence ───────────────────────────
                          * Pin the outlet; staff can then self-punch only
                          * within the radius (enforced server-side in
                          * hr_self_punch). Clear both fields to disable. */}
                        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Attendance geofence</div>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                        Staff can punch in/out only within this radius of the pin. Leave blank to allow from anywhere.
                                    </p>
                                </div>
                                <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={useMyLocation}>
                                    <MapPin className="h-3.5 w-3.5" /> Use my location
                                </Button>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Latitude</Label>
                                    <Input inputMode="decimal" placeholder="28.6139" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Longitude</Label>
                                    <Input inputMode="decimal" placeholder="77.2090" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Radius (m)</Label>
                                    <Input inputMode="numeric" value={form.geofence_radius_m} onChange={(e) => setForm({ ...form, geofence_radius_m: e.target.value })} />
                                </div>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label>{cfg.taxIdLabel}{cfg.taxIdRequired ? " *" : ""}</Label>
                            <Input
                                value={form.tax_id}
                                onChange={(e) => setForm({ ...form, tax_id: e.target.value.toUpperCase() })}
                                maxLength={isIndia ? 15 : 32}
                                className={isIndia ? "font-mono" : ""}
                            />
                        </div>
                        {isIndia && (
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5"><Label>PAN</Label><Input value={form.pan} maxLength={10} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} /></div>
                                <div className="space-y-1.5"><Label>FSSAI license</Label><Input value={form.fssai} maxLength={14} onChange={(e) => setForm({ ...form, fssai: e.target.value })} /></div>
                            </div>
                        )}
                        <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                            <Label>Set as main branch</Label>
                            <Switch checked={form.is_main} onCheckedChange={(v) => setForm({ ...form, is_main: v })} />
                        </div>
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
