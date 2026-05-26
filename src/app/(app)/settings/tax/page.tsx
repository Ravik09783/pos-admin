"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Plus, Save, Wand2, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { getTaxConfig, mergedTaxRates } from "@/lib/tax/locale-config"
import { formatDate } from "@/lib/utils"
import type { Tenant } from "@/types/database"

/** Sentinel Select value meaning "no explicit default — use the country's". */
const USE_COUNTRY_DEFAULT = "__country_default__"

/** A row of public.tax_rate_change_log (migration 39). */
interface RateChange {
    id: string
    old_rate: number
    new_rate: number
    items_affected: number
    fy_label: string | null
    created_at: string
}

export default function TaxSettingsPage() {
    const supabase = createClient()
    const [tenant, setTenant] = useState<Tenant | null>(null)
    const [busy, setBusy] = useState(false)

    // Custom-rate entry box.
    const [customInput, setCustomInput] = useState("")

    // Re-rate (bulk slab change) state.
    const [slabCounts, setSlabCounts] = useState<Map<number, number>>(new Map())
    const [fromRate, setFromRate] = useState<string>("")
    const [toRate, setToRate] = useState<string>("")
    const [reRateOpen, setReRateOpen] = useState(false)
    const [reRateBusy, setReRateBusy] = useState(false)

    // Audit trail of past bulk re-rates (migration 39).
    const [history, setHistory] = useState<RateChange[]>([])

    useEffect(() => {
        ;(async () => {
            const { data: u } = await supabase.auth.getUser()
            if (!u.user) return
            const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
            if (!row?.tenant_id) return
            const [{ data: t }, { data: items }, { data: log }] = await Promise.all([
                supabase.from("tenants").select("*").eq("id", row.tenant_id).maybeSingle(),
                supabase.from("menu_items").select("gst_slab").eq("tenant_id", row.tenant_id).is("deleted_at", null),
                supabase.from("tax_rate_change_log").select("*")
                    .eq("tenant_id", row.tenant_id).order("created_at", { ascending: false }).limit(20),
            ])
            setTenant(t as Tenant)
            setSlabCounts(tallySlabs((items ?? []) as Array<{ gst_slab: number }>))
            setHistory((log ?? []) as RateChange[])
        })()
    }, [supabase])

    const cfg = useMemo(() => getTaxConfig(tenant?.country), [tenant?.country])

    /** Every rate selectable for this restaurant — official + custom. */
    const pickableRates = useMemo(
        () => mergedTaxRates(cfg, {
            stateCode: tenant?.state_code,
            customRates: tenant?.custom_tax_rates,
            include: [tenant?.default_tax_rate],
        }),
        [cfg, tenant?.state_code, tenant?.custom_tax_rates, tenant?.default_tax_rate],
    )

    function patch<K extends keyof Tenant>(k: K, v: Tenant[K]) {
        setTenant((prev) => (prev ? { ...prev, [k]: v } : prev))
    }

    function addCustomRate() {
        if (!tenant) return
        const r = Number(customInput)
        if (!Number.isFinite(r) || r < 0 || r > 100) {
            return toast.error("Enter a rate between 0 and 100")
        }
        const rounded = Math.round(r * 100) / 100
        const official = mergedTaxRates(cfg, { stateCode: tenant.state_code })
        if (official.includes(rounded)) {
            return toast.error(`${rounded}% is already an official ${cfg.taxShortName} rate`)
        }
        if ((tenant.custom_tax_rates ?? []).includes(rounded)) {
            return toast.error(`${rounded}% is already in your custom list`)
        }
        patch("custom_tax_rates", [...(tenant.custom_tax_rates ?? []), rounded].sort((a, b) => a - b))
        setCustomInput("")
    }

    function removeCustomRate(rate: number) {
        if (!tenant) return
        patch("custom_tax_rates", (tenant.custom_tax_rates ?? []).filter((r) => r !== rate))
    }

    async function save() {
        if (!tenant) return
        setBusy(true)
        const { error } = await supabase
            .from("tenants")
            .update({
                default_tax_rate: tenant.default_tax_rate,
                prices_include_tax: tenant.prices_include_tax,
                tax_enabled: tenant.tax_enabled,
                custom_tax_rates: tenant.custom_tax_rates ?? [],
            } as never)
            .eq("id", tenant.id)
        setBusy(false)
        if (error) return toast.error(error.message)
        toast.success("Tax settings saved")
    }

    async function applyReRate() {
        if (!tenant || fromRate === "" || toRate === "") return
        const from = Number(fromRate)
        const to = Number(toRate)
        setReRateBusy(true)
        // rerate_menu_items (migration 39) updates menu_items AND writes the
        // audit row atomically — so the change and its record can't drift.
        // Forward-only: only menu_items move; existing bills keep their rate.
        const { data, error } = await supabase.rpc("rerate_menu_items" as never, {
            p_from_rate: from,
            p_to_rate: to,
        } as never)
        setReRateBusy(false)
        setReRateOpen(false)
        if (error) return toast.error(error.message)
        const res = data as { ok: boolean; items_affected: number; fy_label: string | null } | null
        const n = res?.items_affected ?? 0
        toast.success(
            n > 0
                ? `Re-rated ${n} item${n === 1 ? "" : "s"} ${from}% → ${to}% — new bills use ${to}%, existing bills unchanged`
                : `No live menu items were at ${from}%`,
        )
        // Refresh the histogram + the audit history.
        const [{ data: items }, { data: log }] = await Promise.all([
            supabase.from("menu_items").select("gst_slab").eq("tenant_id", tenant.id).is("deleted_at", null),
            supabase.from("tax_rate_change_log").select("*")
                .eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(20),
        ])
        setSlabCounts(tallySlabs((items ?? []) as Array<{ gst_slab: number }>))
        setHistory((log ?? []) as RateChange[])
        setFromRate("")
        setToRate("")
    }

    if (!tenant) {
        return <div className="container mx-auto py-8 text-muted-foreground">Loading…</div>
    }

    const noTax = cfg.taxModel === "none"
    const modelLine =
        cfg.taxModel === "split"
            ? `${cfg.taxShortName} — CGST + SGST within your state, IGST across states`
            : cfg.taxModel === "single"
                ? `${cfg.taxShortName} — one combined rate per item`
                : "No automatic tax is applied in this country"
    const ratesInUse = Array.from(slabCounts.keys()).sort((a, b) => a - b)

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-3xl space-y-6">
            <PageHeader
                kicker="Configure"
                title="Tax"
                highlight="settings"
                description="Default rates for new items, inclusive pricing, and a tool to re-rate the menu when a tax slab changes."
            />

            {/* ── Tax model (read-only, jurisdiction-driven) ───────────────── */}
            <Card>
                <CardHeader>
                    <CardTitle>Your tax model</CardTitle>
                    <CardDescription>
                        Set by your country ({cfg.name}). To change it, update your country in
                        {" "}<span className="font-medium">Settings → Restaurant profile</span>.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    <Row k="Tax type" v={`${cfg.taxShortName} (${cfg.taxModel})`} />
                    <Row k="How it works" v={modelLine} />
                    <Row k="Fiscal year starts" v={monthName(cfg.fiscalYearStartMonth)} />
                    {!noTax && (
                        <div className="flex items-start justify-between gap-4">
                            <span className="text-muted-foreground">Official {cfg.taxShortName} rates</span>
                            <div className="flex flex-wrap gap-1 justify-end">
                                {mergedTaxRates(cfg, { stateCode: tenant.state_code }).map((r) => (
                                    <Badge key={r} variant="outline">{r}%</Badge>
                                ))}
                            </div>
                        </div>
                    )}
                    <p className="text-xs text-muted-foreground rounded-md bg-muted/40 px-3 py-2">
                        Official rates are maintained centrally — if {cfg.name} changes a {cfg.taxShortName} rate,
                        it updates here automatically. Use “Custom tax rates” below only for rates specific to
                        your restaurant.
                    </p>
                </CardContent>
            </Card>

            {/* ── Defaults for new menu items ──────────────────────────────── */}
            <Card>
                <CardHeader>
                    <CardTitle>Defaults for new menu items</CardTitle>
                    <CardDescription>
                        Pre-filled when you add an item. Each item can still override its own rate in the Menu screen.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label>Default tax rate</Label>
                            <Select
                                value={tenant.default_tax_rate == null ? USE_COUNTRY_DEFAULT : String(tenant.default_tax_rate)}
                                onValueChange={(v) =>
                                    patch("default_tax_rate", v === USE_COUNTRY_DEFAULT ? null : Number(v))
                                }
                                disabled={noTax}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={USE_COUNTRY_DEFAULT}>
                                        Country default ({cfg.defaultRate}%)
                                    </SelectItem>
                                    {pickableRates.map((r) => (
                                        <SelectItem key={r} value={String(r)}>{r}%</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {noTax && <p className="text-xs text-muted-foreground">Not applicable — {cfg.name} has no automatic tax.</p>}
                        </div>
                    </div>
                    <ToggleRow
                        label="Menu prices already include tax"
                        hint={`New items default to tax-inclusive — the ${cfg.taxShortName} is backed out of the price you enter.`}
                        checked={tenant.prices_include_tax}
                        onChange={(v) => patch("prices_include_tax", v)}
                        disabled={noTax}
                    />
                </CardContent>
            </Card>

            {/* ── Charge tax on bills ──────────────────────────────────────── */}
            <Card>
                <CardHeader>
                    <CardTitle>Charge tax on bills</CardTitle>
                    <CardDescription>
                        Turn this off if your restaurant is on a composition scheme or below the
                        tax-registration threshold. New bills then default to “without {cfg.taxShortName}” —
                        the cashier can still flip it per bill.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ToggleRow
                        label={`Apply ${cfg.taxShortName} to bills by default`}
                        hint={tenant.tax_enabled
                            ? "Bills are taxed unless the cashier opts out."
                            : "Bills default to no tax — turn on per bill if needed."}
                        checked={tenant.tax_enabled}
                        onChange={(v) => patch("tax_enabled", v)}
                        disabled={noTax}
                    />
                </CardContent>
            </Card>

            {/* ── Custom tax rates ─────────────────────────────────────────── */}
            {!noTax && (
                <Card>
                    <CardHeader>
                        <CardTitle>Custom tax rates</CardTitle>
                        <CardDescription>
                            Extra rates your restaurant can pick beyond the official {cfg.taxShortName} slabs —
                            e.g. a special-zone rate. They appear in the rate picker on the Menu screen.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                            {(tenant.custom_tax_rates ?? []).length === 0 ? (
                                <p className="text-sm text-muted-foreground">No custom rates yet.</p>
                            ) : (
                                (tenant.custom_tax_rates ?? []).map((r) => (
                                    <Badge key={r} variant="secondary" className="gap-1 pr-1">
                                        {r}%
                                        <button
                                            type="button"
                                            onClick={() => removeCustomRate(r)}
                                            className="rounded-sm hover:bg-foreground/10 p-0.5"
                                            aria-label={`Remove ${r}%`}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                ))
                            )}
                        </div>
                        <div className="flex gap-2 items-end">
                            <div className="space-y-1.5">
                                <Label>Add a rate (%)</Label>
                                <Input
                                    type="number" min="0" max="100" step="0.01"
                                    value={customInput}
                                    onChange={(e) => setCustomInput(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomRate() } }}
                                    placeholder="e.g. 1.5"
                                    className="w-32"
                                />
                            </div>
                            <Button type="button" variant="outline" onClick={addCustomRate}>
                                <Plus className="h-4 w-4" /> Add
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <div className="flex justify-end">
                <Button variant="neon" onClick={save} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save tax settings
                </Button>
            </div>

            {/* ── Re-rate the menu (bulk slab change) ──────────────────────── */}
            {!noTax && (
                <Card>
                    <CardHeader>
                        <CardTitle>Re-rate the menu</CardTitle>
                        <CardDescription>
                            When a {cfg.taxShortName} slab changes, move every menu item from the old rate to the
                            new one in one step. This updates items immediately — it isn’t part of “Save”.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {ratesInUse.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No menu items yet.</p>
                        ) : (
                            <>
                                <div className="grid sm:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <Label>Change items currently at</Label>
                                        <Select value={fromRate} onValueChange={setFromRate}>
                                            <SelectTrigger><SelectValue placeholder="Pick a rate" /></SelectTrigger>
                                            <SelectContent>
                                                {ratesInUse.map((r) => (
                                                    <SelectItem key={r} value={String(r)}>
                                                        {r}% — {slabCounts.get(r) ?? 0} item{(slabCounts.get(r) ?? 0) === 1 ? "" : "s"}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>To new rate</Label>
                                        <Select value={toRate} onValueChange={setToRate}>
                                            <SelectTrigger><SelectValue placeholder="Pick a rate" /></SelectTrigger>
                                            <SelectContent>
                                                {pickableRates.map((r) => (
                                                    <SelectItem key={r} value={String(r)}>{r}%</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={fromRate === "" || toRate === "" || fromRate === toRate}
                                    onClick={() => setReRateOpen(true)}
                                >
                                    <Wand2 className="h-4 w-4" />
                                    {fromRate !== "" && toRate !== "" && fromRate !== toRate
                                        ? `Move ${slabCounts.get(Number(fromRate)) ?? 0} item(s) ${fromRate}% → ${toRate}%`
                                        : "Apply rate change"}
                                </Button>
                            </>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* ── Rate change history (audit trail) ────────────────────────── */}
            {!noTax && history.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>Rate change history</CardTitle>
                        <CardDescription>
                            When the menu was re-rated. Bills issued before each change keep the
                            old rate, so a financial year that straddles a change reports both —
                            this is the timeline your accountant uses to reconcile it.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="divide-y divide-border/50">
                            {history.map((h) => (
                                <div key={h.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline">{h.old_rate}%</Badge>
                                        <span className="text-muted-foreground">→</span>
                                        <Badge variant="secondary">{h.new_rate}%</Badge>
                                        <span className="text-muted-foreground">
                                            · {h.items_affected} item{h.items_affected === 1 ? "" : "s"}
                                        </span>
                                    </div>
                                    <div className="text-right text-xs text-muted-foreground">
                                        {h.fy_label && <div>FY {h.fy_label}</div>}
                                        <div>{formatDate(h.created_at)}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            <Dialog open={reRateOpen} onOpenChange={setReRateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Re-rate menu items?</DialogTitle>
                        <DialogDescription>
                            {fromRate !== "" && toRate !== "" && (
                                <>
                                    This changes {slabCounts.get(Number(fromRate)) ?? 0} menu item(s) from{" "}
                                    <span className="font-medium">{fromRate}%</span> to{" "}
                                    <span className="font-medium">{toRate}%</span>. Existing bills are not affected —
                                    only new orders. This can’t be undone in bulk.
                                </>
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setReRateOpen(false)} disabled={reRateBusy}>Cancel</Button>
                        <Button variant="neon" onClick={applyReRate} disabled={reRateBusy}>
                            {reRateBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                            Re-rate items
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function tallySlabs(items: Array<{ gst_slab: number }>): Map<number, number> {
    const m = new Map<number, number>()
    for (const it of items) {
        const r = Number(it.gst_slab)
        if (!Number.isFinite(r)) continue
        m.set(r, (m.get(r) ?? 0) + 1)
    }
    return m
}

function monthName(m: number): string {
    return ["January", "February", "March", "April", "May", "June", "July",
        "August", "September", "October", "November", "December"][(m - 1 + 12) % 12] ?? "—"
}

function Row({ k, v }: { k: string; v: string }) {
    return (
        <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground">{k}</span>
            <span className="text-right font-medium">{v}</span>
        </div>
    )
}

function ToggleRow({
    label, hint, checked, onChange, disabled,
}: {
    label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean
}) {
    return (
        <div className="flex items-center justify-between rounded-md border border-border/60 p-3 gap-4">
            <div className="min-w-0">
                <div className="font-medium text-sm">{label}</div>
                <p className="text-xs text-muted-foreground">{hint}</p>
            </div>
            <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
        </div>
    )
}
