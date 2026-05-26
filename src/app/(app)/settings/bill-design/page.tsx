"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, Loader2, Save, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell/page-header"
import { BillPreview } from "@/components/bill/bill-preview"
import { createClient } from "@/lib/supabase/client"
import { getTaxConfig } from "@/lib/tax/locale-config"
import {
    BILL_CATEGORIES, DEFAULT_DESIGN, defaultTemplateId, getTemplate, groupByCategory,
    recommendedTemplates, templatesForCountry,
    type BillCategory, type BillDesign, type BillTemplate,
} from "@/lib/bill/templates"
import type { Tenant } from "@/types/database"

const LAYOUT_LABEL: Record<BillDesign["layout"], string> = {
    "thermal-classic": "Thermal · classic",
    "thermal-modern": "Thermal · modern",
    "invoice-a4": "Full-page invoice",
    "invoice-grid": "Full-page · grid",
    "card-boutique": "Boutique card",
    "qsr-token": "QSR token",
}

// the old design shape used `show_gstin`; map it forward
function migrateStored(stored: Record<string, unknown> | undefined): BillDesign {
    const s = stored ?? {}
    const showTaxId = (s.show_tax_id as boolean | undefined) ?? (s.show_gstin as boolean | undefined) ?? true
    return { ...DEFAULT_DESIGN, ...s, show_tax_id: showTaxId } as BillDesign
}

export default function BillDesignPage() {
    const supabase = createClient()
    const [tenant, setTenant] = useState<Tenant | null>(null)
    const [design, setDesign] = useState<BillDesign>(DEFAULT_DESIGN)
    const [templateId, setTemplateId] = useState<string | null>(null)
    const [activeCat, setActiveCat] = useState<BillCategory>("region")
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        ;(async () => {
            const { data: u } = await supabase.auth.getUser()
            if (!u.user) return
            const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
            if (!row?.tenant_id) return
            const { data: t } = await supabase.from("tenants").select("*").eq("id", row.tenant_id).maybeSingle()
            if (!t) return
            setTenant(t as Tenant)
            const settings = (t as Tenant).settings as { bill_design?: Record<string, unknown>; bill_template_id?: string } | null
            const cc = getTaxConfig((t as Tenant).country).code
            if (settings?.bill_template_id || settings?.bill_design) {
                setDesign(migrateStored(settings.bill_design))
                setTemplateId(settings.bill_template_id ?? null)
            } else {
                // first visit — start them on the country's recommended format
                const def = getTemplate(defaultTemplateId(cc))
                if (def) { setDesign(def.design); setTemplateId(def.id) }
            }
            // open the most relevant category tab
            const tpl = settings?.bill_template_id ? getTemplate(settings.bill_template_id) : getTemplate(defaultTemplateId(cc))
            if (tpl) setActiveCat(tpl.category)
        })()
    }, [supabase])

    const cfg = useMemo(() => getTaxConfig(tenant?.country), [tenant?.country])
    const available = useMemo(() => templatesForCountry(cfg.code), [cfg.code])
    const recommended = useMemo(() => recommendedTemplates(cfg.code), [cfg.code])
    const grouped = useMemo(() => groupByCategory(available), [available])
    const catItems = useMemo(() => grouped.find((g) => g.key === activeCat)?.items ?? [], [grouped, activeCat])

    function applyTemplate(t: BillTemplate) {
        setDesign({ ...t.design })
        setTemplateId(t.id)
        toast.success(`Format: ${t.name}`)
    }

    function update<K extends keyof BillDesign>(k: K, v: BillDesign[K]) {
        setDesign((prev) => ({ ...prev, [k]: v }))
        // edits put us in "custom" territory; keep the template id as the starting point
    }

    async function save() {
        if (!tenant) return
        setBusy(true)
        const newSettings = { ...((tenant.settings as Record<string, unknown>) ?? {}), bill_design: design, bill_template_id: templateId }
        const { error } = await supabase.from("tenants").update({ settings: newSettings } as never).eq("id", tenant.id)
        setBusy(false)
        if (error) return toast.error(error.message)
        toast.success("Bill format saved")
    }

    if (!tenant) return <div className="container mx-auto py-8 text-muted-foreground">Loading…</div>

    const selectedTpl = getTemplate(templateId)

    const TILE = (t: BillTemplate) => {
        const selected = t.id === templateId
        return (
            <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t)}
                className={`text-left rounded-xl border p-3 transition-all ${selected ? "border-primary ring-1 ring-primary bg-primary/5" : "border-border/60 hover:border-primary/50 hover:bg-card/60"}`}
            >
                <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-sm leading-tight">{t.name}</div>
                    {selected && <Check className="h-4 w-4 text-primary shrink-0" />}
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{t.blurb}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                    <Badge variant="outline" className="text-[10px]">{t.design.width}</Badge>
                    <Badge variant="outline" className="text-[10px]">{LAYOUT_LABEL[t.design.layout]}</Badge>
                    {t.recommendedFor.includes(cfg.code) && <Badge variant="success" className="text-[10px]">Recommended</Badge>}
                </div>
            </button>
        )
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-6">
            <PageHeader
                kicker="Configure"
                title="Bill formats"
                highlight={`${available.length}+ to choose from`}
                description={`Pick the printed-bill layout that fits how you serve. We've highlighted the formats that match ${cfg.name}'s tax rules (${cfg.taxShortName}).`}
            />

            <div className="grid lg:grid-cols-[1fr_400px] gap-6 items-start">
                <div className="space-y-4">
                    {/* ── Format gallery ─────────────────────────────────── */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Recommended for {cfg.name}</CardTitle>
                            <CardDescription>The layouts that line up with {cfg.name}'s invoicing norms — a safe place to start.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid sm:grid-cols-2 gap-3">
                                {recommended.map(TILE)}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">All formats</CardTitle>
                            <CardDescription>Browse by category. Country-specific layouts only appear if they apply where you operate.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex flex-wrap gap-1.5">
                                {BILL_CATEGORIES.filter((c) => grouped.some((g) => g.key === c.key)).map((c) => {
                                    const count = grouped.find((g) => g.key === c.key)?.items.length ?? 0
                                    return (
                                        <button
                                            key={c.key}
                                            type="button"
                                            onClick={() => setActiveCat(c.key)}
                                            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${activeCat === c.key ? "bg-primary text-primary-foreground" : "bg-card/60 text-muted-foreground border border-border/60 hover:text-foreground"}`}
                                        >
                                            {c.label} <span className="opacity-70">· {count}</span>
                                        </button>
                                    )
                                })}
                            </div>
                            <p className="text-xs text-muted-foreground">{BILL_CATEGORIES.find((c) => c.key === activeCat)?.blurb}</p>
                            <div className="grid sm:grid-cols-2 gap-3">
                                {catItems.map(TILE)}
                            </div>
                        </CardContent>
                    </Card>

                    {/* ── Fine-tune ──────────────────────────────────────── */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Fine-tune {selectedTpl ? `“${selectedTpl.name}”` : "this format"}</CardTitle>
                            <CardDescription>Tweak the chosen format — the preview on the right updates instantly.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid sm:grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label>Layout style</Label>
                                    <Select value={design.layout} onValueChange={(v) => update("layout", v as BillDesign["layout"])}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {Object.entries(LAYOUT_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Paper size</Label>
                                    <Select value={design.width} onValueChange={(v) => update("width", v as BillDesign["width"])}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="58mm">58 mm thermal</SelectItem>
                                            <SelectItem value="80mm">80 mm thermal</SelectItem>
                                            <SelectItem value="A5">A5</SelectItem>
                                            <SelectItem value="A4">A4</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Font</Label>
                                    <Select value={design.font} onValueChange={(v) => update("font", v as BillDesign["font"])}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="mono">Monospace</SelectItem>
                                            <SelectItem value="sans">Sans-serif</SelectItem>
                                            <SelectItem value="serif">Serif</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Density</Label>
                                    <Select value={design.density} onValueChange={(v) => update("density", v as BillDesign["density"])}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="compact">Compact</SelectItem>
                                            <SelectItem value="normal">Normal</SelectItem>
                                            <SelectItem value="roomy">Roomy</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5 sm:col-span-2">
                                    <Label>Accent colour</Label>
                                    <div className="flex items-center gap-2">
                                        <input type="color" value={design.accent_color} onChange={(e) => update("accent_color", e.target.value)} className="h-9 w-12 rounded border border-border/60 bg-transparent" />
                                        <Input value={design.accent_color} onChange={(e) => update("accent_color", e.target.value)} className="font-mono w-32" />
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle className="text-base">What to show</CardTitle></CardHeader>
                        <CardContent className="space-y-3">
                            {([
                                { k: "show_logo", l: "Restaurant logo" },
                                { k: "show_tax_id", l: `${cfg.taxIdLabel} on header` },
                                ...(cfg.code === "IN" ? [{ k: "show_fssai", l: "FSSAI on header" }, { k: "show_hsn", l: "HSN / SAC code per item" }] : []),
                                { k: "show_serial", l: "Line serial numbers" },
                                { k: "show_item_tax_col", l: "Per-line tax-rate column" },
                                { k: "show_tax_breakup", l: `Show ${cfg.taxModel === "split" ? "GST" : cfg.taxShortName} line(s)` },
                                ...(cfg.serviceChargeAllowed ? [{ k: "show_service_charge_line", l: "Service-charge line" }] : []),
                                { k: "show_qr_verify", l: "Verification QR (links to public bill)" },
                                ...(cfg.code === "IN" ? [{ k: "show_qr_upi", l: "UPI “scan to pay” QR" }] : []),
                                ...(cfg.code === "AE" || cfg.code === "SA" ? [{ k: "bilingual_ar", l: "Bilingual Arabic / English header" }] : []),
                            ] as { k: keyof BillDesign; l: string }[]).map((row) => (
                                <div key={row.k} className="flex items-center justify-between rounded-md border border-border/60 p-3">
                                    <Label>{row.l}</Label>
                                    <Switch checked={design[row.k] as boolean} onCheckedChange={(v) => update(row.k, v as never)} />
                                </div>
                            ))}
                            {cfg.taxModel === "split" && design.show_tax_breakup && (
                                <div className="space-y-1.5">
                                    <Label>GST presentation</Label>
                                    <Select value={design.tax_breakup} onValueChange={(v) => update("tax_breakup", v as BillDesign["tax_breakup"])}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="split">Split — CGST + SGST</SelectItem>
                                            <SelectItem value="combined">Combined — one GST line</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            {design.show_qr_upi && cfg.code === "IN" && (
                                <div className="space-y-1.5">
                                    <Label>UPI ID</Label>
                                    <Input value={design.upi_id} onChange={(e) => update("upi_id", e.target.value)} placeholder="restaurant@upi" className="font-mono" />
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle className="text-base">Footer message</CardTitle></CardHeader>
                        <CardContent>
                            <Textarea value={design.footer_message} onChange={(e) => update("footer_message", e.target.value)} placeholder="Thank you — please visit again!" />
                        </CardContent>
                    </Card>

                    <div className="flex justify-end">
                        <Button variant="neon" onClick={save} disabled={busy}>
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save bill format
                        </Button>
                    </div>
                </div>

                {/* ── Live preview ───────────────────────────────────────── */}
                <div className="lg:sticky lg:top-4 space-y-2">
                    <div className="text-xs text-muted-foreground flex items-center justify-between">
                        <span>Live preview {selectedTpl ? `· ${selectedTpl.name}` : ""}</span>
                        <span>{design.width} · {LAYOUT_LABEL[design.layout]}</span>
                    </div>
                    <BillPreview design={design} tenant={tenant as unknown as Parameters<typeof BillPreview>[0]["tenant"]} className="border border-border/40" />
                    <p className="text-[11px] text-muted-foreground">Sample data shown. Real bills use this format with your own items, taxes and totals.</p>
                </div>
            </div>
        </div>
    )
}
