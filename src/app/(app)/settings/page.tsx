"use client"

import { useEffect, useState } from "react"
import { Loader2, Save } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PageHeader } from "@/components/app-shell/page-header"
import { ImageUploader } from "@/components/ui/image-uploader"
import { createClient } from "@/lib/supabase/client"
import { tenantImagePath } from "@/lib/storage/image-upload"
import { COUNTRY_OPTIONS, getTaxConfig } from "@/lib/tax/locale-config"
import { isValidGSTIN } from "@/lib/utils"
import type { Tenant } from "@/types/database"

export default function SettingsPage() {
    const supabase = createClient()
    const [tenant, setTenant] = useState<Tenant | null>(null)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        ;(async () => {
            const { data: u } = await supabase.auth.getUser()
            if (!u.user) return
            const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
            if (!row?.tenant_id) return
            const { data: t } = await supabase.from("tenants").select("*").eq("id", row.tenant_id).maybeSingle()
            setTenant(t as Tenant)
        })()
    }, [supabase])

    function update<K extends keyof Tenant>(k: K, v: Tenant[K]) {
        setTenant((prev) => (prev ? { ...prev, [k]: v } : prev))
    }

    async function save() {
        if (!tenant) return
        const c = getTaxConfig(tenant.country)
        if (c.code === "IN" && tenant.gstin && !isValidGSTIN(tenant.gstin)) return toast.error("GSTIN format invalid")
        setBusy(true)
        const t = tenant as Tenant & { upi_id?: string | null; upi_payee_name?: string | null; qr_ordering_enabled?: boolean; logo_url?: string | null }
        const { error } = await supabase
            .from("tenants")
            .update({
                name: tenant.name,
                phone: tenant.phone,
                email: tenant.email,
                country: tenant.country,
                currency: tenant.currency,
                fy_start_month: tenant.fy_start_month,
                gstin: tenant.gstin,
                fssai: tenant.fssai,
                pan: tenant.pan,
                state: tenant.state,
                state_code: tenant.state_code,
                city: tenant.city,
                pincode: tenant.pincode,
                address_line1: tenant.address_line1,
                invoice_prefix: tenant.invoice_prefix,
                logo_url: t.logo_url ?? null,
                // service charge can't be applied in some countries — store 0 there
                service_charge_percent: c.serviceChargeAllowed ? tenant.service_charge_percent : 0,
                upi_id: t.upi_id ?? null,
                upi_payee_name: t.upi_payee_name ?? null,
                qr_ordering_enabled: t.qr_ordering_enabled ?? true,
            } as never)
            .eq("id", tenant.id)
        setBusy(false)
        if (error) return toast.error(error.message)
        toast.success("Saved")
    }

    function setCountry(code: string) {
        const c = getTaxConfig(code)
        setTenant((prev) => prev ? {
            ...prev,
            country: c.name,
            currency: c.currency,
            fy_start_month: c.fiscalYearStartMonth,
            // the state list changes with the country — clear the old selection
            state: null,
            state_code: null,
            ...(c.serviceChargeAllowed ? {} : { service_charge_percent: 0 }),
        } : prev)
    }

    if (!tenant) {
        return <div className="container mx-auto py-8 text-muted-foreground">Loading…</div>
    }
    const cfg = getTaxConfig(tenant.country)

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-3xl space-y-6">
            <PageHeader
                kicker="Configure"
                title="Settings"
                highlight="your restaurant"
                description="Profile, tax IDs, invoicing, and printed-bill details."
            />

            <Card>
                <CardHeader>
                    <CardTitle>Restaurant profile</CardTitle>
                    <CardDescription>Shown on every printed bill, the customer QR ordering page, and the topbar.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-start gap-4">
                        <ImageUploader
                            label="Logo"
                            hint="Square works best · auto-compressed"
                            value={(tenant as Tenant & { logo_url?: string | null }).logo_url ?? null}
                            onChange={(url) => update("logo_url" as keyof Tenant, url as never)}
                            bucket="tenant-logos"
                            path={tenantImagePath(tenant.id, "logo", tenant.id)}
                            aspect="square"
                            size={96}
                        />
                        <div className="flex-1 min-w-[200px] grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Restaurant name</Label>
                                <Input value={tenant.name ?? ""} onChange={(e) => update("name", e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Phone</Label>
                                <Input value={tenant.phone ?? ""} onChange={(e) => update("phone", e.target.value)} />
                            </div>
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Email</Label>
                        <Input value={tenant.email ?? ""} onChange={(e) => update("email", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Address</Label>
                        <Input value={tenant.address_line1 ?? ""} onChange={(e) => update("address_line1", e.target.value)} />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label>Country</Label>
                            <Select value={cfg.code} onValueChange={setCountry}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {COUNTRY_OPTIONS.map((o) => <SelectItem key={o.code} value={o.code}>{o.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">Sets the tax model ({cfg.taxShortName}), currency ({cfg.currency}) and fiscal year.</p>
                        </div>
                        <div className="space-y-1.5">
                            <Label>City</Label>
                            <Input value={tenant.city ?? ""} onChange={(e) => update("city", e.target.value)} />
                        </div>
                    </div>
                    {cfg.stateMatters && cfg.states && cfg.states.length > 0 && (
                        <div className="grid sm:grid-cols-3 gap-3">
                            <div className="space-y-1.5 sm:col-span-2">
                                <Label>{cfg.code === "IN" ? "State" : cfg.code === "US" ? "State" : cfg.code === "CA" ? "Province" : "Region"}</Label>
                                <Select value={tenant.state_code ?? ""} onValueChange={(v) => {
                                    const st = cfg.states?.find((s) => s.code === v)
                                    update("state_code", v)
                                    if (st) update("state", st.name)
                                }}>
                                    <SelectTrigger><SelectValue placeholder="Pick one" /></SelectTrigger>
                                    <SelectContent>
                                        {cfg.states.map((s) => (
                                            <SelectItem key={s.code} value={s.code}>
                                                {s.code} — {s.name}{s.defaultRate != null ? ` (${s.defaultRate}%)` : ""}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Postal code</Label>
                                <Input value={tenant.pincode ?? ""} onChange={(e) => update("pincode", e.target.value)} />
                            </div>
                        </div>
                    )}
                    {!(cfg.stateMatters && cfg.states && cfg.states.length > 0) && (
                        <div className="space-y-1.5">
                            <Label>Postal code</Label>
                            <Input value={tenant.pincode ?? ""} onChange={(e) => update("pincode", e.target.value)} />
                        </div>
                    )}
                    {cfg.note && <p className="text-xs text-muted-foreground rounded-md bg-muted/40 px-3 py-2">{cfg.note}</p>}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Tax registration</CardTitle>
                    <CardDescription>
                        {cfg.code === "IN" ? "Used for GST-compliant invoices and the CA export." : `Your ${cfg.taxIdLabel} appears on invoices.`}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label>{cfg.taxIdLabel}{cfg.taxIdRequired ? " *" : ""}</Label>
                            <Input
                                value={tenant.gstin ?? ""}
                                maxLength={cfg.code === "IN" ? 15 : 32}
                                onChange={(e) => update("gstin", e.target.value.toUpperCase())}
                                placeholder={cfg.code === "IN" ? "03ABCDE1234F1Z5" : cfg.taxIdLabel}
                            />
                        </div>
                        {cfg.code === "IN" && (
                            <div className="space-y-1.5">
                                <Label>PAN</Label>
                                <Input value={tenant.pan ?? ""} maxLength={10} onChange={(e) => update("pan", e.target.value.toUpperCase())} />
                            </div>
                        )}
                    </div>
                    {cfg.code === "IN" && (
                        <div className="space-y-1.5">
                            <Label>FSSAI</Label>
                            <Input value={tenant.fssai ?? ""} maxLength={14} onChange={(e) => update("fssai", e.target.value)} />
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Invoicing</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label>Invoice prefix</Label>
                            <Input
                                value={tenant.invoice_prefix ?? "INV"}
                                onChange={(e) => update("invoice_prefix", e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                                e.g. {tenant.invoice_prefix || "INV"}-2025-26-00001
                            </p>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Default service charge %</Label>
                            <Input
                                type="number"
                                step="0.5"
                                disabled={!cfg.serviceChargeAllowed}
                                value={cfg.serviceChargeAllowed ? (tenant.service_charge_percent ?? 0) : 0}
                                onChange={(e) => update("service_charge_percent", Number(e.target.value))}
                            />
                            {!cfg.serviceChargeAllowed && (
                                <p className="text-xs text-warning">A service charge isn&apos;t allowed in {cfg.name} — bills won&apos;t add one.</p>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* UPI is an India-only payment rail. International tenants
              * use Stripe Connect for QR table-ordering (configured in
              * Settings → Payment gateway). Showing UPI fields here on
              * a Swiss / US / EU tenant was confusing and unactionable. */}
            {cfg.code === "IN" && (
                <Card className="neon-border">
                    <CardHeader>
                        <CardTitle>UPI &amp; QR ordering</CardTitle>
                        <CardDescription>Required for QR table-ordering. Customers pay you directly via UPI before the order is sent to the kitchen.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>UPI ID *</Label>
                                <Input
                                    value={(tenant as Tenant & { upi_id?: string }).upi_id ?? ""}
                                    onChange={(e) => update("upi_id" as keyof Tenant, e.target.value as never)}
                                    placeholder="restaurant@upi"
                                    className="font-mono"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Payee name</Label>
                                <Input
                                    value={(tenant as Tenant & { upi_payee_name?: string }).upi_payee_name ?? ""}
                                    onChange={(e) => update("upi_payee_name" as keyof Tenant, e.target.value as never)}
                                    placeholder="defaults to restaurant name"
                                />
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Customers will see this name and ID when scanning the table QR code. We embed the bill amount + a transaction reference in the UPI payment so they don&apos;t mistype.
                        </p>
                    </CardContent>
                </Card>
            )}

            <div className="flex justify-end">
                <Button variant="neon" onClick={save} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save changes
                </Button>
            </div>
        </div>
    )
}
