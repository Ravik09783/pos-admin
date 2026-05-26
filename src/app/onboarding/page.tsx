"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronRight, Loader2, LogOut, Sparkles, User as UserIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { createClient } from "@/lib/supabase/client"
import { ThemeToggle } from "@/components/app-shell/theme-toggle"
import { COUNTRY_OPTIONS, getTaxConfig, taxRatesFor } from "@/lib/tax/locale-config"
import { gstinStateCode, isValidGSTIN } from "@/lib/utils"

const STEPS = ["Restaurant", "Address & tax", "Billing", "Done"] as const

export default function OnboardingPage() {
    const router = useRouter()
    const supabase = createClient()
    const [step, setStep] = useState<number>(0)
    const [busy, setBusy] = useState(false)
    const [loading, setLoading] = useState(true)
    const [userEmail, setUserEmail] = useState("")

    // form state
    const [name, setName] = useState("")
    const [countryCode, setCountryCode] = useState("IN")
    const [phone, setPhone] = useState("")
    const [email, setEmail] = useState("")
    const [stateCode, setStateCode] = useState("")
    const [city, setCity] = useState("")
    const [pincode, setPincode] = useState("")
    const [addressLine1, setAddressLine1] = useState("")
    const [taxId, setTaxId] = useState("")            // GSTIN / VAT No. / TRN / EIN …
    const [fssai, setFssai] = useState("")            // India only
    const [pan, setPan] = useState("")                // India only
    const [invoicePrefix, setInvoicePrefix] = useState("INV")
    const [serviceCharge, setServiceCharge] = useState("0")
    // Tax defaults — "" = use the country's default rate (see locale-config).
    const [defaultTaxRate, setDefaultTaxRate] = useState("")
    const [pricesIncludeTax, setPricesIncludeTax] = useState(false)
    const [chargeTax, setChargeTax] = useState(true)

    const cfg = useMemo(() => getTaxConfig(countryCode), [countryCode])
    const isIndia = cfg.code === "IN"
    const hasRegions = cfg.stateMatters && (cfg.states?.length ?? 0) > 0
    const regionLabel = cfg.code === "IN" ? "State" : cfg.code === "CA" ? "Province" : cfg.code === "US" ? "State" : "Region"

    // When the country changes, reset region + clamp service charge.
    function pickCountry(code: string) {
        setCountryCode(code)
        setStateCode("")
        if (!getTaxConfig(code).serviceChargeAllowed) setServiceCharge("0")
    }

    // bail out if already onboarded
    useEffect(() => {
        ;(async () => {
            const { data: { user }, error: userErr } = await supabase.auth.getUser()
            if (userErr || !user) { router.replace("/login"); return }
            setUserEmail(user.email ?? "")
            const { data: u } = await supabase
                .from("users").select("tenant_id, email, full_name").eq("id", user.id).maybeSingle()
            if (u?.tenant_id) { router.replace("/dashboard"); return }
            if (!u) {
                try { await supabase.rpc("repair_my_user_row" as never) } catch { /* complete_onboarding self-heals */ }
            }
            setEmail((u as { email?: string } | null)?.email ?? user.email ?? "")
            setLoading(false)
        })()
    }, [supabase, router])

    function next() {
        if (step === 0) {
            if (!name.trim()) return toast.error("Restaurant name is required")
            if (name.trim().length < 2) return toast.error("Name too short")
        }
        if (step === 1) {
            if (hasRegions && !stateCode) return toast.error(`Pick your ${regionLabel.toLowerCase()} — needed for tax`)
            if (cfg.taxIdRequired && !taxId.trim()) return toast.error(`${cfg.taxIdLabel} is required in ${cfg.name}`)
            if (isIndia) {
                if (taxId && !isValidGSTIN(taxId)) return toast.error("GSTIN format looks wrong (should be 15 chars)")
                if (taxId) {
                    const sc = gstinStateCode(taxId)
                    if (sc && stateCode && sc !== stateCode) {
                        return toast.error(`GSTIN state code (${sc}) doesn't match selected state (${stateCode}).`)
                    }
                }
                if (pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) return toast.error("PAN format looks wrong")
                if (pincode && !/^\d{6}$/.test(pincode)) return toast.error("PIN code should be 6 digits")
            }
        }
        if (step === 2 && cfg.serviceChargeAllowed) {
            const sc = Number(serviceCharge)
            if (!Number.isFinite(sc) || sc < 0 || sc > 25) return toast.error("Service charge should be 0–25%")
        }
        setStep((s) => Math.min(STEPS.length - 1, s + 1))
    }
    function back() { setStep((s) => Math.max(0, s - 1)) }

    async function signOut() {
        await supabase.auth.signOut()
        toast.success("Signed out")
        router.replace("/login")
    }

    async function finish() {
        if (busy) return
        setBusy(true)
        try {
            const { data, error } = await supabase.rpc("complete_onboarding" as never, {
                p_name: name.trim(),
                p_slug_base: name.trim(),
                p_phone: phone.trim() || null,
                p_email: email.trim() || null,
                p_gstin: taxId.trim() || null,                       // generic tax-registration column
                p_fssai: isIndia ? (fssai.trim() || null) : null,
                p_pan: isIndia ? (pan.trim() || null) : null,
                p_address_line1: addressLine1.trim() || null,
                p_city: city.trim() || null,
                p_state: hasRegions ? (cfg.states?.find((s) => s.code === stateCode)?.name ?? null) : null,
                p_state_code: hasRegions ? (stateCode || null) : null,
                p_pincode: pincode.trim() || null,
                p_invoice_prefix: (invoicePrefix.trim() || "INV").toUpperCase(),
                p_service_charge: cfg.serviceChargeAllowed ? (Number(serviceCharge) || 0) : 0,
                p_country: cfg.name,
                p_currency: cfg.currency,
                p_fy_start_month: cfg.fiscalYearStartMonth,
            } as never)
            if (error) throw error
            const r = data as { ok: boolean; tenant_id: string; branch_id?: string; already_onboarded?: boolean }
            if (!r.ok) throw new Error("Onboarding RPC returned not-ok")
            if (!r.already_onboarded) {
                await ensureMainBranch(r.tenant_id, r.branch_id ?? null)
                // Persist the tax defaults picked in step 2. complete_onboarding
                // predates the migration-38 columns, so a follow-up UPDATE keeps
                // its RPC signature stable. RLS: tenants UPDATE is OWNER +
                // own-tenant — satisfied (this user is the fresh OWNER).
                // Best-effort: onboarding already succeeded, and these are all
                // editable later in Settings → Tax, so a failure here is soft.
                const { error: taxErr } = await supabase
                    .from("tenants")
                    .update({
                        default_tax_rate: defaultTaxRate === "" ? null : Number(defaultTaxRate),
                        prices_include_tax: cfg.taxModel === "none" ? false : pricesIncludeTax,
                        tax_enabled: cfg.taxModel === "none" ? true : chargeTax,
                    } as never)
                    .eq("id", r.tenant_id)
                if (taxErr) console.warn("Could not save tax defaults at onboarding:", taxErr.message)
            }

            toast[r.already_onboarded ? "message" : "success"](r.already_onboarded ? "You're already set up — redirecting." : "Welcome to RestoPOS!")
            setStep(STEPS.length - 1)
            setTimeout(() => { router.push("/dashboard"); router.refresh() }, 700)
        } catch (e: unknown) {
            const raw = e instanceof Error ? e.message : "Failed to set up restaurant"
            if (/not_authenticated/i.test(raw)) {
                toast.error("Session expired — please sign in again."); router.push("/login")
            } else if (/restaurant_name_required/i.test(raw)) {
                toast.error("Restaurant name is required."); setStep(0)
            } else if (/slug_generation_failed/i.test(raw)) {
                toast.error("Couldn't generate a unique URL for your restaurant — try a slightly different name."); setStep(0)
            } else if (/duplicate key|unique constraint/i.test(raw)) {
                toast.error("This restaurant looks like it already exists — try signing in.")
            } else {
                toast.error(raw)
            }
        } finally {
            setBusy(false)
        }
    }

    async function ensureMainBranch(tenantId: string, branchId: string | null) {
        if (branchId) return
        const { data: existing, error: existingError } = await supabase
            .from("branches")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("is_main", true)
            .maybeSingle()
        if (existingError) throw existingError
        if (existing?.id) return

        const { data: branch, error: branchError } = await supabase
            .from("branches")
            .insert({
                tenant_id: tenantId,
                name: name.trim(),
                phone: phone.trim() || null,
                email: email.trim() || null,
                address_line1: addressLine1.trim() || null,
                city: city.trim() || null,
                state: hasRegions ? (cfg.states?.find((s) => s.code === stateCode)?.name ?? null) : null,
                state_code: hasRegions ? (stateCode || null) : null,
                pincode: pincode.trim() || null,
                is_main: true,
                is_active: true,
            } as never)
            .select("id")
            .single()
        if (branchError) throw branchError

        const { error: taxProfileError } = await supabase
            .from("branch_tax_profiles")
            .upsert({
                tenant_id: tenantId,
                branch_id: branch.id,
                country: cfg.name,
                currency: cfg.currency,
                gstin: taxId.trim() || null,
                pan: isIndia ? (pan.trim() || null) : null,
                fssai: isIndia ? (fssai.trim() || null) : null,
            } as never, { onConflict: "branch_id" })
        if (taxProfileError) throw taxProfileError

        const { error: userError } = await supabase
            .from("users")
            .update({ branch_id: branch.id } as never)
            .eq("tenant_id", tenantId)
            .eq("role", "OWNER")
            .is("branch_id", null)
        if (userError) throw userError
    }

    if (loading) {
        return (
            <div className="min-h-screen grid place-items-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
        )
    }

    return (
        <div className="relative min-h-screen overflow-hidden">
            <div className="absolute inset-0 grid-bg pointer-events-none" />
            <div className="relative z-10 container mx-auto py-10 px-4">
                <div className="mb-6 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <span className="grid place-items-center h-8 w-8 rounded-md bg-gradient-to-br from-primary to-[hsl(var(--neon-magenta))] text-primary-foreground">
                            <Sparkles className="h-4 w-4" />
                        </span>
                        <span className="font-semibold text-lg">RestoPOS</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <ThemeToggle />
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="gap-2">
                                    <UserIcon className="h-4 w-4" />
                                    <span className="hidden sm:inline truncate max-w-[180px]">
                                        {userEmail || "Account"}
                                    </span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuLabel className="truncate">{userEmail || "Signed in"}</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={signOut} className="text-destructive">
                                    <LogOut className="h-4 w-4 mr-2" /> Sign out
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>

                <Card className="max-w-2xl mx-auto neon-border">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-2xl">{STEPS[step]}</CardTitle>
                                <CardDescription>Step {Math.min(step + 1, STEPS.length)} of {STEPS.length}</CardDescription>
                            </div>
                            <div className="flex gap-1">
                                {STEPS.map((_, i) => (
                                    <div key={i} className={`h-1.5 w-8 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`} />
                                ))}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {step === 0 && (
                            <>
                                <div className="space-y-1.5">
                                    <Label htmlFor="name">Restaurant name *</Label>
                                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Spice Junction" disabled={busy} />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Country *</Label>
                                    <Select value={countryCode} onValueChange={pickCountry} disabled={busy}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {COUNTRY_OPTIONS.map((o) => <SelectItem key={o.code} value={o.code}>{o.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">Sets your tax model ({cfg.taxShortName}), currency ({cfg.currency}) and fiscal year.</p>
                                </div>
                                <div className="grid sm:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <Label htmlFor="phone">Phone</Label>
                                        <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="email">Contact email</Label>
                                        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
                                    </div>
                                </div>
                            </>
                        )}

                        {step === 1 && (
                            <>
                                <div className="space-y-1.5">
                                    <Label htmlFor="addr">Address</Label>
                                    <Input id="addr" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder="Shop 12, MG Road" disabled={busy} />
                                </div>
                                <div className="grid sm:grid-cols-3 gap-4">
                                    {hasRegions ? (
                                        <div className="space-y-1.5 sm:col-span-2">
                                            <Label>{regionLabel} *</Label>
                                            <Select value={stateCode} onValueChange={setStateCode} disabled={busy}>
                                                <SelectTrigger><SelectValue placeholder={`Select ${regionLabel.toLowerCase()}`} /></SelectTrigger>
                                                <SelectContent>
                                                    {cfg.states!.map((s) => (
                                                        <SelectItem key={s.code} value={s.code}>
                                                            {s.code} — {s.name}{s.defaultRate != null ? ` (${s.defaultRate}%)` : ""}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ) : (
                                        <div className="space-y-1.5 sm:col-span-2">
                                            <Label htmlFor="city2">City</Label>
                                            <Input id="city2" value={city} onChange={(e) => setCity(e.target.value)} disabled={busy} />
                                        </div>
                                    )}
                                    <div className="space-y-1.5">
                                        <Label htmlFor="pincode">Postal code</Label>
                                        <Input id="pincode" value={pincode} onChange={(e) => setPincode(e.target.value)} maxLength={isIndia ? 6 : 12} disabled={busy} />
                                    </div>
                                </div>
                                {hasRegions && (
                                    <div className="space-y-1.5">
                                        <Label htmlFor="city">City</Label>
                                        <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} disabled={busy} />
                                    </div>
                                )}
                                <div className="space-y-1.5">
                                    <Label htmlFor="taxId">{cfg.taxIdLabel}{cfg.taxIdRequired ? " *" : ""}</Label>
                                    <Input
                                        id="taxId"
                                        value={taxId}
                                        onChange={(e) => setTaxId(e.target.value.toUpperCase())}
                                        placeholder={isIndia ? "03ABCDE1234F1Z5" : cfg.taxIdLabel}
                                        maxLength={isIndia ? 15 : 32}
                                        disabled={busy}
                                        className={isIndia ? "font-mono" : ""}
                                    />
                                    {!cfg.taxIdRequired && <p className="text-xs text-muted-foreground">Optional — you can add it later in Settings.</p>}
                                </div>
                                {isIndia && (
                                    <div className="grid sm:grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <Label htmlFor="pan">PAN</Label>
                                            <Input id="pan" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} maxLength={10} disabled={busy} />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="fssai">FSSAI license</Label>
                                            <Input id="fssai" value={fssai} onChange={(e) => setFssai(e.target.value)} maxLength={14} disabled={busy} />
                                        </div>
                                    </div>
                                )}
                                {cfg.note && <p className="text-xs text-muted-foreground rounded-md bg-muted/40 px-3 py-2">{cfg.note}</p>}
                            </>
                        )}

                        {step === 2 && (
                            <>
                                <div className="grid sm:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <Label htmlFor="prefix">Invoice prefix</Label>
                                        <Input id="prefix" value={invoicePrefix} onChange={(e) => setInvoicePrefix(e.target.value)} maxLength={8} disabled={busy} />
                                        <p className="text-xs text-muted-foreground">Bills will look like: {invoicePrefix || "INV"}-2025-26-00001</p>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="svc">Service charge %</Label>
                                        <Input
                                            id="svc" type="number" min="0" max="25" step="0.5"
                                            value={cfg.serviceChargeAllowed ? serviceCharge : "0"}
                                            onChange={(e) => setServiceCharge(e.target.value)}
                                            disabled={busy || !cfg.serviceChargeAllowed}
                                        />
                                        {!cfg.serviceChargeAllowed && <p className="text-xs text-warning">Not allowed in {cfg.name} — bills won&apos;t add one.</p>}
                                    </div>
                                </div>
                                {cfg.taxModel !== "none" && (
                                    <div className="space-y-3 rounded-lg border border-border/60 p-4">
                                        <div className="text-sm font-medium">Tax on bills</div>
                                        <div className="space-y-1.5">
                                            <Label>Default {cfg.taxShortName} rate for menu items</Label>
                                            <Select
                                                value={defaultTaxRate === "" ? "__default__" : defaultTaxRate}
                                                onValueChange={(v) => setDefaultTaxRate(v === "__default__" ? "" : v)}
                                                disabled={busy}
                                            >
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__default__">{cfg.name} default ({cfg.defaultRate}%)</SelectItem>
                                                    {taxRatesFor(cfg, stateCode).map((r) => (
                                                        <SelectItem key={r} value={String(r)}>{r}%</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <p className="text-xs text-muted-foreground">Pre-fills new menu items — each item can override it later.</p>
                                        </div>
                                        <div className="flex items-center justify-between rounded-md border border-border/60 p-3 gap-4">
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium">Menu prices include {cfg.taxShortName}</div>
                                                <p className="text-xs text-muted-foreground">On = the price you type already has tax baked in.</p>
                                            </div>
                                            <Switch checked={pricesIncludeTax} onCheckedChange={setPricesIncludeTax} disabled={busy} />
                                        </div>
                                        <div className="flex items-center justify-between rounded-md border border-border/60 p-3 gap-4">
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium">Charge {cfg.taxShortName} on bills</div>
                                                <p className="text-xs text-muted-foreground">Turn off if you&apos;re on a composition scheme / below the tax threshold.</p>
                                            </div>
                                            <Switch checked={chargeTax} onCheckedChange={setChargeTax} disabled={busy} />
                                        </div>
                                    </div>
                                )}
                                <div className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">
                                    You can upload a logo, configure thermal printers, and add staff once you&apos;re inside the dashboard.
                                </div>
                            </>
                        )}

                        {step === 3 && (
                            <div className="text-center py-8 space-y-3">
                                <div className="mx-auto grid place-items-center h-14 w-14 rounded-full bg-success/15 text-success">
                                    <Sparkles className="h-7 w-7" />
                                </div>
                                <div className="text-xl font-semibold">You&apos;re all set</div>
                                <p className="text-muted-foreground">Redirecting to your dashboard…</p>
                            </div>
                        )}
                    </CardContent>
                    {step < 3 && (
                        <div className="px-6 pb-6 flex justify-between gap-2">
                            <Button variant="ghost" onClick={back} disabled={step === 0 || busy}>Back</Button>
                            {step < 2 ? (
                                <Button variant="neon" onClick={next} disabled={busy}>
                                    Next <ChevronRight className="h-4 w-4" />
                                </Button>
                            ) : (
                                <Button variant="neon" onClick={finish} disabled={busy}>
                                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                                    Finish setup
                                </Button>
                            )}
                        </div>
                    )}
                </Card>
            </div>
        </div>
    )
}
