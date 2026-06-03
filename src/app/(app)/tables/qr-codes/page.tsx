"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import QRCode from "qrcode"
import { ArrowLeft, Download, Loader2, Palette, Printer, RotateCcw, Save, Search, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { quoteForSeed, type FoodQuote } from "@/lib/food-quotes"
import { QR_CARD_DEFAULTS, darkenHex, qrSizePercent, resolveQrCardSettings } from "@/lib/qr-card-settings"
import type { DiningTable, QrCardSettings, Tenant } from "@/types/database"

interface CardData {
    table: DiningTable
    qrPng: string
    url: string
    quote: FoodQuote
}

type ResolvedSettings = ReturnType<typeof resolveQrCardSettings>

const STEPS = [
    "Open phone camera & scan QR",
    "Browse menu and add items",
    "Pay via UPI or card",
    "Food arrives at your table",
]

export default function QrCodesPrintPage() {
    const supabase = createClient()
    const [loading, setLoading] = useState(true)
    const [tenant, setTenant] = useState<Tenant | null>(null)
    const [cards, setCards] = useState<CardData[]>([])
    const [search, setSearch] = useState("")
    const [printOnly, setPrintOnly] = useState<string | null>(null)

    // Live settings drive the preview; `savedSignature` is the last-saved
    // JSON snapshot so we can show a "Save & apply" affordance only when
    // there are unsaved tweaks.
    const [settings, setSettings] = useState<ResolvedSettings>(resolveQrCardSettings(null))
    const [savedSignature, setSavedSignature] = useState<string>(JSON.stringify(resolveQrCardSettings(null)))
    const [savingSettings, setSavingSettings] = useState(false)

    useEffect(() => {
        ;(async () => {
            const { data: u } = await supabase.auth.getUser()
            if (!u.user) return
            const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
            if (!row?.tenant_id) return
            const { data: t } = await supabase.from("tenants").select("*").eq("id", row.tenant_id).maybeSingle()
            if (!t) return
            const tenantRow = t as Tenant
            setTenant(tenantRow)
            const initial = resolveQrCardSettings(tenantRow.qr_card_settings)
            setSettings(initial)
            setSavedSignature(JSON.stringify(initial))
            const { data: tables } = await supabase
                .from("dining_tables")
                .select("*")
                .eq("is_active", true)
                .order("section")
                .order("number")
            const origin = typeof window !== "undefined" ? window.location.origin : ""
            const out: CardData[] = []
            for (const tab of (tables ?? []) as DiningTable[]) {
                const url = `${origin}/qr/${tenantRow.slug}/${tab.number}`
                const qr = await QRCode.toDataURL(url, {
                    margin: 1, width: 600,
                    color: { dark: "#0a0e1a", light: "#ffffff" },
                    errorCorrectionLevel: "H",
                })
                out.push({ table: tab, qrPng: qr, url, quote: quoteForSeed(tab.id) })
            }
            setCards(out)
            setLoading(false)
        })()
    }, [supabase])

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return cards
        return cards.filter(({ table }) =>
            table.number.toLowerCase().includes(q)
            || (table.section ?? "").toLowerCase().includes(q),
        )
    }, [cards, search])

    const dirty = JSON.stringify(settings) !== savedSignature

    function patchSettings(patch: Partial<QrCardSettings>) {
        setSettings((prev) => resolveQrCardSettings({ ...prev, ...patch }))
    }

    function resetSettings() {
        setSettings(resolveQrCardSettings(null))
    }

    async function saveSettings() {
        if (!tenant) return
        setSavingSettings(true)
        try {
            const payload: QrCardSettings = { ...settings }
            const { error } = await supabase
                .from("tenants")
                .update({ qr_card_settings: payload } as never)
                .eq("id", tenant.id)
            if (error) throw error
            setSavedSignature(JSON.stringify(settings))
            setTenant({ ...tenant, qr_card_settings: payload })
            toast.success("Card design saved — new tables will use this style")
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't save settings")
        } finally {
            setSavingSettings(false)
        }
    }

    function printOne(tableId: string) {
        setPrintOnly(tableId)
        setTimeout(() => {
            window.print()
            setTimeout(() => setPrintOnly(null), 500)
        }, 50)
    }

    function printAll() {
        setPrintOnly(null)
        setTimeout(() => window.print(), 50)
    }

    async function downloadCard(card: CardData) {
        if (!tenant) return
        try {
            const blob = await renderPrintableCardPng(card, tenant, settings)
            const filename = `qr-table-${card.table.number}-${tenant.slug}.png`
            triggerDownload(blob, filename)
            toast.success(`Downloaded QR for table ${card.table.number}`)
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't generate PNG")
        }
    }

    if (loading) {
        return <div className="container mx-auto py-8 max-w-4xl space-y-4"><Skeleton className="h-12" /><Skeleton className="h-96" /></div>
    }
    if (!tenant) return <div className="container mx-auto py-8 text-muted-foreground">Loading…</div>
    if (cards.length === 0) {
        return (
            <div className="container mx-auto py-8 max-w-4xl space-y-4">
                <Button asChild variant="ghost" size="sm" className="no-print"><Link href="/tables"><ArrowLeft className="h-4 w-4" /> Back</Link></Button>
                <Card><CardContent className="text-center py-16 text-muted-foreground">No tables yet — add some on the Tables page first.</CardContent></Card>
            </div>
        )
    }

    return (
        <div className={`bg-background min-h-screen qr-print-root ${printOnly ? "print-single" : ""}`}>
            <style>{`
                @media print {
                    @page { margin: 12mm; }
                    .qr-print-root.print-single .qr-card-wrap:not(.print-target) { display: none !important; }
                    .qr-card { -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
                    .no-print { display: none !important; }
                }
            `}</style>

            <header className="container mx-auto py-6 max-w-5xl flex flex-wrap items-center gap-3 justify-between no-print">
                <div className="flex items-center gap-2">
                    <Button asChild variant="ghost" size="sm"><Link href="/tables"><ArrowLeft className="h-4 w-4" /> Back</Link></Button>
                    <h1 className="text-xl font-semibold">Table QR codes ({cards.length})</h1>
                </div>
                <div className="flex items-center gap-2 flex-1 min-w-[200px] justify-end">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Find table…"
                            className="pl-8 w-44 h-9"
                        />
                    </div>
                    <Button variant="neon" onClick={printAll}>
                        <Printer className="h-4 w-4" /> Print all
                    </Button>
                </div>
            </header>

            <main className="container mx-auto max-w-5xl pb-10 px-4 space-y-6">
                <CustomizePanel
                    tenant={tenant}
                    sampleCard={cards[0] ?? null}
                    settings={settings}
                    dirty={dirty}
                    saving={savingSettings}
                    onPatch={patchSettings}
                    onReset={resetSettings}
                    onSave={saveSettings}
                />

                {filtered.length === 0 ? (
                    <Card className="no-print"><CardContent className="text-center py-12 text-muted-foreground">No tables match &ldquo;{search}&rdquo;.</CardContent></Card>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 print:gap-3">
                        {filtered.map((card) => (
                            <div
                                key={card.table.id}
                                className={`qr-card-wrap ${printOnly === card.table.id ? "print-target" : ""}`}
                            >
                                <PrintableCard tenant={tenant} card={card} settings={settings} />
                                <div className="no-print flex gap-2 mt-3 justify-center">
                                    <Button size="sm" variant="outline" onClick={() => downloadCard(card)}>
                                        <Download className="h-3.5 w-3.5" /> Download PNG
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => printOne(card.table.id)}>
                                        <Printer className="h-3.5 w-3.5" /> Print this one
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    )
}

// --------------------------------------------------------------------------
// Customization panel — show/hide bits of the card, pick header colors,
// add a custom note. Live-previews against every visible card; saving
// persists the choices to the tenant row so the next visit (and the next
// table created) starts from the same look.
// --------------------------------------------------------------------------
function CustomizePanel({
    tenant, sampleCard, settings, dirty, saving, onPatch, onReset, onSave,
}: {
    tenant: Tenant
    sampleCard: CardData | null
    settings: ResolvedSettings
    dirty: boolean
    saving: boolean
    onPatch: (patch: Partial<QrCardSettings>) => void
    onReset: () => void
    onSave: () => void
}) {
    return (
        <Card className="no-print">
            <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-5">
                    <Palette className="h-4 w-4 text-muted-foreground" />
                    <h2 className="font-semibold">Customize card design</h2>
                    <span className="text-xs text-muted-foreground ml-1 hidden sm:inline">
                        Tweaks preview live on the right. Save to apply to future tables too.
                    </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
                    {/* Controls */}
                    <div className="space-y-5 min-w-0">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <ToggleRow
                                label="Show restaurant name"
                                description="Big restaurant name in the header"
                                checked={settings.show_restaurant_name}
                                onChange={(v) => onPatch({ show_restaurant_name: v })}
                            />
                            <ToggleRow
                                label="Show city"
                                description="Small city line under the name"
                                checked={settings.show_city}
                                onChange={(v) => onPatch({ show_city: v })}
                            />
                            <ToggleRow
                                label="Show logo"
                                description="Logo or sparkle badge"
                                checked={settings.show_logo}
                                onChange={(v) => onPatch({ show_logo: v })}
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <ColorRow
                                label="Header color"
                                value={settings.header_color_1}
                                onChange={(v) => onPatch({ header_color_1: v })}
                            />
                            {settings.use_solid_header ? (
                                <div className="flex items-end pb-1">
                                    <p className="text-xs text-muted-foreground">Solid color is on — gradient end is hidden.</p>
                                </div>
                            ) : (
                                <ColorRow
                                    label="Gradient end"
                                    value={settings.header_color_2}
                                    onChange={(v) => onPatch({ header_color_2: v })}
                                />
                            )}
                            <ToggleRow
                                label="Solid header color"
                                description="Skip the gradient"
                                checked={settings.use_solid_header}
                                onChange={(v) => onPatch({ use_solid_header: v })}
                            />
                        </div>

                        <QrSizeRow settings={settings} onPatch={onPatch} />

                        <div className="space-y-1.5">
                            <Label htmlFor="qr-custom-text">Custom message (optional)</Label>
                            <Textarea
                                id="qr-custom-text"
                                value={settings.custom_text}
                                onChange={(e) => onPatch({ custom_text: e.target.value.slice(0, 120) })}
                                placeholder="e.g. Free dessert on orders over ₹500 — show this card at the counter"
                                rows={2}
                                maxLength={120}
                            />
                            <p className="text-[11px] text-muted-foreground text-right">{settings.custom_text.length}/120</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                            <Button onClick={onSave} disabled={!dirty || saving} variant="neon">
                                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                Save &amp; apply to future tables
                            </Button>
                            <Button variant="ghost" size="sm" onClick={onReset} disabled={saving}>
                                <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
                            </Button>
                            {dirty && !saving && (
                                <span className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes — preview only.</span>
                            )}
                        </div>
                    </div>

                    {/* Live preview */}
                    <div className="lg:sticky lg:top-4 lg:self-start">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold mb-2 text-center">
                            Live preview
                        </div>
                        <div className="max-w-[260px] mx-auto pointer-events-none select-none">
                            {sampleCard ? (
                                <PrintableCard tenant={tenant} card={sampleCard} settings={settings} />
                            ) : (
                                <div className="aspect-[5/7] rounded-2xl border border-dashed grid place-items-center text-xs text-muted-foreground">
                                    Add a table to see a preview
                                </div>
                            )}
                        </div>
                        {sampleCard && (
                            <p className="text-[10px] text-muted-foreground text-center mt-2">
                                Preview uses table <span className="font-mono">{sampleCard.table.number}</span>.
                            </p>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

function QrSizeRow({
    settings, onPatch,
}: { settings: ResolvedSettings; onPatch: (patch: Partial<QrCardSettings>) => void }) {
    const presets: Array<{ key: QrCardSettings["qr_size"]; label: string; hint: string }> = [
        { key: "sm", label: "Small", hint: "Compact" },
        { key: "md", label: "Medium", hint: "Default" },
        { key: "lg", label: "Large", hint: "Easier scan" },
        { key: "custom", label: "Custom", hint: "Pick %" },
    ]
    return (
        <div className="space-y-2">
            <div className="flex items-end justify-between gap-2">
                <Label>QR code size</Label>
                <span className="text-[11px] text-muted-foreground">
                    {qrSizePercent(settings)}% of card width
                </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
                {presets.map((p) => {
                    const active = settings.qr_size === p.key
                    return (
                        <button
                            key={p.key}
                            type="button"
                            onClick={() => onPatch({ qr_size: p.key })}
                            className={`rounded-md border px-2 py-1.5 text-xs transition ${
                                active
                                    ? "border-primary bg-primary/10 text-primary font-semibold"
                                    : "hover:bg-muted text-muted-foreground"
                            }`}
                            aria-pressed={active}
                        >
                            <div>{p.label}</div>
                            <div className="text-[9px] opacity-70">{p.hint}</div>
                        </button>
                    )
                })}
            </div>
            {settings.qr_size === "custom" && (
                <div className="flex items-center gap-3 pt-1">
                    <input
                        type="range"
                        min={30}
                        max={80}
                        step={1}
                        value={settings.qr_size_custom_percent}
                        onChange={(e) => onPatch({ qr_size_custom_percent: Number(e.target.value) })}
                        className="flex-1 accent-primary"
                        aria-label="QR size percent"
                    />
                    <div className="flex items-center gap-1">
                        <Input
                            type="number"
                            min={30}
                            max={80}
                            value={settings.qr_size_custom_percent}
                            onChange={(e) => {
                                const n = Number(e.target.value)
                                if (Number.isFinite(n)) onPatch({ qr_size_custom_percent: Math.max(30, Math.min(80, n)) })
                            }}
                            className="h-8 w-16 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                    </div>
                </div>
            )}
        </div>
    )
}

function ToggleRow({
    label, description, checked, onChange,
}: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <div className="flex items-start justify-between gap-3 rounded-md border p-3">
            <div className="min-w-0">
                <div className="text-sm font-medium">{label}</div>
                <p className="text-[11px] text-muted-foreground leading-snug">{description}</p>
            </div>
            <Switch checked={checked} onCheckedChange={onChange} />
        </div>
    )
}

function ColorRow({
    label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
    return (
        <div className="space-y-1.5">
            <Label className="text-sm">{label}</Label>
            <div className="flex items-center gap-2">
                <input
                    type="color"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="h-9 w-12 rounded-md border bg-background cursor-pointer p-1"
                    aria-label={`${label} swatch`}
                />
                <Input
                    value={value}
                    onChange={(e) => {
                        const v = e.target.value
                        if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v)
                    }}
                    className="h-9 font-mono text-xs uppercase"
                    maxLength={7}
                />
            </div>
        </div>
    )
}

// --------------------------------------------------------------------------
// HTML card — PhonePe-shop-style portrait card. Brand gradient header,
// table number badge, big QR with quote underneath, numbered steps,
// footer with the public URL. Look is driven by `settings`.
// --------------------------------------------------------------------------
function PrintableCard({ tenant, card, settings }: { tenant: Tenant; card: CardData; settings: ResolvedSettings }) {
    const headerBg = settings.use_solid_header
        ? settings.header_color_1
        : `linear-gradient(135deg, ${settings.header_color_1} 0%, ${settings.header_color_2} 100%)`
    const accentBg = settings.use_solid_header
        ? settings.header_color_1
        : `linear-gradient(135deg, ${settings.header_color_1}, ${settings.header_color_2})`
    const footerBg = settings.use_solid_header
        ? darkenHex(settings.header_color_1, 0.35)
        : `linear-gradient(135deg, ${darkenHex(settings.header_color_1, 0.35)} 0%, ${darkenHex(settings.header_color_2, 0.35)} 100%)`
    const showHeaderText = settings.show_restaurant_name || (settings.show_city && tenant.city)
    const qrPct = qrSizePercent(settings)

    return (
        <div
            className="qr-card relative bg-white text-slate-900 rounded-2xl overflow-hidden shadow-md break-inside-avoid border border-slate-200"
            style={{ pageBreakInside: "avoid" }}
        >
            {/* Header */}
            <div
                className="px-5 pt-5 pb-4 text-white relative"
                style={{ background: headerBg }}
            >
                <div className="flex items-center gap-3">
                    {settings.show_logo && (
                        tenant.logo_url ? (
                            <div className="h-12 w-12 rounded-xl bg-white grid place-items-center overflow-hidden shrink-0 ring-2 ring-white/40">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={tenant.logo_url} alt="" className="h-full w-full object-cover" />
                            </div>
                        ) : (
                            // No tenant logo on file — render the
                            // restaurant's initial in their accent
                            // colour. Replaces the old Sparkles icon
                            // which read as RestoPOS branding on a
                            // printed QR card the customer holds.
                            <div className="h-12 w-12 rounded-xl bg-white/95 grid place-items-center shrink-0 ring-2 ring-white/40 font-extrabold text-2xl" style={{ color: settings.header_color_1 }}>
                                {tenant.name.slice(0, 1).toUpperCase()}
                            </div>
                        )
                    )}
                    <div className="min-w-0 flex-1">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-white/85 font-semibold">Scan to order</div>
                        {showHeaderText && (
                            <>
                                {settings.show_restaurant_name && (
                                    <div className="text-xl font-extrabold leading-tight truncate">{tenant.name}</div>
                                )}
                                {settings.show_city && tenant.city && (
                                    <div className="text-[11px] text-white/80 truncate">{tenant.city}</div>
                                )}
                            </>
                        )}
                    </div>
                </div>
                <div className="mt-3 inline-flex items-center gap-1.5 bg-white text-slate-900 rounded-full px-3 py-1 text-sm font-bold shadow">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Table</span>
                    <span className="font-mono">{card.table.number}</span>
                </div>
            </div>

            {/* QR + quote */}
            <div className="px-5 pt-4 pb-3 flex flex-col items-center">
                <div className="relative" style={{ width: `${qrPct}%` }}>
                    <div className="absolute -inset-2 rounded-2xl" style={{ background: accentBg }} />
                    <div className="relative bg-white rounded-xl p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={card.qrPng}
                            alt={`QR for table ${card.table.number}`}
                            className="block w-full h-auto"
                            style={{ aspectRatio: "1 / 1" }}
                        />
                    </div>
                </div>
                <blockquote className="mt-4 text-center px-2">
                    <p className="text-sm font-medium leading-snug text-slate-800 text-balance">&ldquo;{card.quote.text}&rdquo;</p>
                    <footer className="text-[10px] text-slate-500 mt-0.5">— {card.quote.author}</footer>
                </blockquote>
            </div>

            {/* Custom message — only rendered when set, so an empty
                customization doesn't add an empty block. */}
            {settings.custom_text.trim() && (
                <div className="px-5 pb-2">
                    <div
                        className="rounded-lg px-3 py-2 text-[11px] leading-snug text-center text-white font-medium"
                        style={{ background: accentBg }}
                    >
                        {settings.custom_text.trim()}
                    </div>
                </div>
            )}

            {/* Steps */}
            <div className="px-5 pb-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-bold text-center mb-2">How to order</div>
                <ol className="space-y-1.5">
                    {STEPS.map((step, idx) => (
                        <li key={idx} className="flex items-center gap-2 text-[12px] text-slate-700">
                            <span
                                className="shrink-0 h-5 w-5 rounded-full text-white text-[11px] font-bold grid place-items-center"
                                style={{ background: accentBg }}
                            >
                                {idx + 1}
                            </span>
                            <span className="leading-tight">{step}</span>
                        </li>
                    ))}
                </ol>
            </div>

            {/* Footer bar */}
            <div
                className="px-4 py-2 text-[9px] text-white/95 break-all text-center font-mono"
                style={{ background: footerBg }}
            >
                {card.url.replace(/^https?:\/\//, "")}
            </div>
        </div>
    )
}

// --------------------------------------------------------------------------
// PNG rendering — mirrors the HTML card on a 1200×1680 canvas (5:7,
// comfortably prints at A6 300dpi). The HTML version is responsive but
// browsers vary on print color fidelity, so a downloadable PNG is the
// reliable way to reprint a damaged card. Look driven by `settings` so
// the PNG matches the on-screen preview.
// --------------------------------------------------------------------------
async function renderPrintableCardPng(card: CardData, tenant: Tenant, settings: ResolvedSettings): Promise<Blob> {
    const W = 1200
    // QR pixel size feeds into canvas height: bigger QR → taller canvas
    // so steps + footer never overlap. Base of 1680 matches the legacy
    // 5:7 layout when the QR is at the original 640px.
    const qrPctEarly = qrSizePercent(settings)
    const qrSizeEarly = Math.round(W * (qrPctEarly / 100))
    const baseQrSize = 640
    const H = 1680 + Math.max(0, qrSizeEarly - baseQrSize)
    const canvas = document.createElement("canvas")
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas not supported")

    // Card background
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, W, H)

    // ----- Header -----
    const HEADER_H = 360
    if (settings.use_solid_header) {
        ctx.fillStyle = settings.header_color_1
    } else {
        const headerGrad = ctx.createLinearGradient(0, 0, W, HEADER_H)
        headerGrad.addColorStop(0, settings.header_color_1)
        headerGrad.addColorStop(1, settings.header_color_2)
        ctx.fillStyle = headerGrad
    }
    ctx.fillRect(0, 0, W, HEADER_H)

    // Logo / fallback badge — only when enabled
    const logoSize = 130
    const logoX = 64
    const logoY = 70
    let logoImg: HTMLImageElement | null = null
    if (settings.show_logo && tenant.logo_url) {
        try {
            logoImg = await loadImage(tenant.logo_url, /* crossOrigin */ true)
        } catch { logoImg = null }
    }
    if (settings.show_logo) {
        drawRoundedRect(ctx, logoX, logoY, logoSize, logoSize, 24)
        ctx.fillStyle = "#ffffff"
        ctx.fill()
        if (logoImg) {
            ctx.save()
            drawRoundedRect(ctx, logoX + 6, logoY + 6, logoSize - 12, logoSize - 12, 18)
            ctx.clip()
            ctx.drawImage(logoImg, logoX + 6, logoY + 6, logoSize - 12, logoSize - 12)
            ctx.restore()
        } else {
            // No tenant logo on file — paint the restaurant's initial
            // in their accent colour instead of a Sparkles glyph
            // (which read as RestoPOS branding on a customer-facing
            // printed QR card).
            ctx.fillStyle = settings.header_color_1
            ctx.font = "800 64px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
            ctx.textAlign = "center"
            ctx.textBaseline = "middle"
            ctx.fillText(
                (tenant.name?.slice(0, 1) ?? "").toUpperCase(),
                logoX + logoSize / 2,
                logoY + logoSize / 2 + 4, // +4 visually centers most fonts on baseline
            )
            // Restore the default baseline used by the rest of the
            // canvas (header text expects 'alphabetic').
            ctx.textBaseline = "alphabetic"
            ctx.textAlign = "left"
        }
    }

    // Header text — shifted left when the logo is hidden so the block stays balanced
    const textX = settings.show_logo ? logoX + logoSize + 30 : logoX
    ctx.fillStyle = "rgba(255,255,255,0.88)"
    ctx.font = "700 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    ctx.textAlign = "left"
    ctx.fillText("SCAN TO ORDER", textX, 110)

    if (settings.show_restaurant_name) {
        ctx.fillStyle = "#ffffff"
        ctx.font = "800 56px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        ctx.fillText(truncate(tenant.name, 22), textX, 175)
    }

    if (settings.show_city && tenant.city) {
        ctx.fillStyle = "rgba(255,255,255,0.85)"
        ctx.font = "500 24px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        ctx.fillText(truncate(tenant.city, 30), textX, settings.show_restaurant_name ? 215 : 175)
    }

    // Table-number pill
    const pillText = `TABLE  ${card.table.number}`
    ctx.font = "800 32px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    const pillTextW = ctx.measureText(pillText).width
    const pillW = pillTextW + 64
    const pillH = 58
    const pillX = logoX
    const pillY = HEADER_H - pillH - 30
    drawRoundedRect(ctx, pillX, pillY, pillW, pillH, pillH / 2)
    ctx.fillStyle = "#ffffff"
    ctx.fill()
    ctx.fillStyle = "#0f172a"
    ctx.textAlign = "left"
    ctx.font = "800 32px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    ctx.fillText(pillText, pillX + 32, pillY + 40)

    // ----- QR with accent frame -----
    // Size is driven by the same percentage the HTML card uses, so the
    // PNG and on-screen preview match.
    const qrSize = qrSizeEarly
    const qrX = (W - qrSize) / 2
    const qrY = HEADER_H + 60
    const frameInset = 18

    if (settings.use_solid_header) {
        ctx.fillStyle = settings.header_color_1
    } else {
        const frameGrad = ctx.createLinearGradient(qrX - frameInset, qrY - frameInset, qrX + qrSize + frameInset, qrY + qrSize + frameInset)
        frameGrad.addColorStop(0, settings.header_color_1)
        frameGrad.addColorStop(1, settings.header_color_2)
        ctx.fillStyle = frameGrad
    }
    drawRoundedRect(ctx, qrX - frameInset, qrY - frameInset, qrSize + frameInset * 2, qrSize + frameInset * 2, 24)
    ctx.fill()

    // White inner
    ctx.fillStyle = "#ffffff"
    drawRoundedRect(ctx, qrX - 8, qrY - 8, qrSize + 16, qrSize + 16, 14)
    ctx.fill()

    // QR
    const qrDataUrl = await QRCode.toDataURL(card.url, {
        margin: 1, width: qrSize,
        color: { dark: "#0a0e1a", light: "#ffffff" },
        errorCorrectionLevel: "H",
    })
    const qrImg = await loadImage(qrDataUrl)
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize)

    // ----- Quote -----
    const quoteY = qrY + qrSize + 70
    ctx.fillStyle = "#1f2937"
    ctx.font = "italic 600 26px Georgia, serif"
    ctx.textAlign = "center"
    const wrappedQuote = wrapText(ctx, `"${card.quote.text}"`, W - 200)
    let lineY = quoteY
    for (const line of wrappedQuote) {
        ctx.fillText(line, W / 2, lineY)
        lineY += 36
    }
    ctx.fillStyle = "#6b7280"
    ctx.font = "500 20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    ctx.fillText(`— ${card.quote.author}`, W / 2, lineY + 8)
    let cursorY = lineY + 50

    // ----- Custom message banner -----
    if (settings.custom_text.trim()) {
        const banner = settings.custom_text.trim()
        const padX = 60
        const bannerW = W - padX * 2
        const bannerH = 80
        const bannerX = padX
        const bannerY = cursorY
        if (settings.use_solid_header) {
            ctx.fillStyle = settings.header_color_1
        } else {
            const bg = ctx.createLinearGradient(bannerX, bannerY, bannerX + bannerW, bannerY + bannerH)
            bg.addColorStop(0, settings.header_color_1)
            bg.addColorStop(1, settings.header_color_2)
            ctx.fillStyle = bg
        }
        drawRoundedRect(ctx, bannerX, bannerY, bannerW, bannerH, 16)
        ctx.fill()
        ctx.fillStyle = "#ffffff"
        ctx.font = "600 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        ctx.textAlign = "center"
        const wrapped = wrapText(ctx, banner, bannerW - 60)
        const lineH = 28
        const visible = wrapped.slice(0, 2)
        const startY = bannerY + bannerH / 2 - ((visible.length - 1) * lineH) / 2 + 8
        visible.forEach((ln, i) => ctx.fillText(ln, W / 2, startY + i * lineH))
        cursorY = bannerY + bannerH + 30
    }

    // ----- Steps -----
    const stepsTitleY = cursorY + 20
    ctx.fillStyle = "#6b7280"
    ctx.font = "800 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    ctx.textAlign = "center"
    ctx.fillText("HOW TO ORDER", W / 2, stepsTitleY)

    const stepStartY = stepsTitleY + 50
    const stepLineH = 56
    ctx.textAlign = "left"
    const stepX = 130
    for (let i = 0; i < STEPS.length; i++) {
        const y = stepStartY + i * stepLineH
        const cx = stepX
        const cy = y - 22
        const r = 22
        if (settings.use_solid_header) {
            ctx.fillStyle = settings.header_color_1
        } else {
            const numGrad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
            numGrad.addColorStop(0, settings.header_color_1)
            numGrad.addColorStop(1, settings.header_color_2)
            ctx.fillStyle = numGrad
        }
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = "#ffffff"
        ctx.font = "800 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        ctx.textAlign = "center"
        ctx.fillText(String(i + 1), cx, cy + 8)

        ctx.fillStyle = "#1f2937"
        ctx.font = "500 24px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        ctx.textAlign = "left"
        ctx.fillText(STEPS[i]!, cx + 40, cy + 8)
    }

    // ----- Footer -----
    const footerH = 70
    const footerY = H - footerH
    if (settings.use_solid_header) {
        ctx.fillStyle = darkenHex(settings.header_color_1, 0.35)
    } else {
        const footerGrad = ctx.createLinearGradient(0, footerY, W, H)
        footerGrad.addColorStop(0, darkenHex(settings.header_color_1, 0.35))
        footerGrad.addColorStop(1, darkenHex(settings.header_color_2, 0.35))
        ctx.fillStyle = footerGrad
    }
    ctx.fillRect(0, footerY, W, footerH)
    ctx.fillStyle = "rgba(255,255,255,0.95)"
    ctx.font = "500 22px ui-monospace, SFMono-Regular, Menlo, monospace"
    ctx.textAlign = "center"
    ctx.fillText(truncate(card.url.replace(/^https?:\/\//, ""), 60), W / 2, footerY + 44)

    return await canvasToBlob(canvas, "image/png")
}

// --------------------------------------------------------------------------
// Canvas helpers
// --------------------------------------------------------------------------
function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const radius = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.arcTo(x + w, y, x + w, y + h, radius)
    ctx.arcTo(x + w, y + h, x, y + h, radius)
    ctx.arcTo(x, y + h, x, y, radius)
    ctx.arcTo(x, y, x + w, y, radius)
    ctx.closePath()
}

function drawSparkle(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
    const s = size / 2
    ctx.beginPath()
    ctx.moveTo(cx, cy - s)
    ctx.lineTo(cx + s * 0.25, cy - s * 0.25)
    ctx.lineTo(cx + s, cy)
    ctx.lineTo(cx + s * 0.25, cy + s * 0.25)
    ctx.lineTo(cx, cy + s)
    ctx.lineTo(cx - s * 0.25, cy + s * 0.25)
    ctx.lineTo(cx - s, cy)
    ctx.lineTo(cx - s * 0.25, cy - s * 0.25)
    ctx.closePath()
    ctx.fill()
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(" ")
    const lines: string[] = []
    let current = ""
    for (const w of words) {
        const test = current ? current + " " + w : w
        if (ctx.measureText(test).width > maxWidth && current) {
            lines.push(current)
            current = w
        } else {
            current = test
        }
    }
    if (current) lines.push(current)
    return lines
}

function loadImage(src: string, crossOrigin = false): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        if (crossOrigin) img.crossOrigin = "anonymous"
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error("Failed to load image"))
        img.src = src
    })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((b) => {
            if (b) resolve(b)
            else reject(new Error("toBlob returned null"))
        }, type)
    })
}

function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function truncate(s: string, n: number): string {
    return s.length <= n ? s : s.slice(0, n - 1) + "…"
}

// Defaults are exported from the helper module too — re-export here so
// future code in this file can reference the same authoritative shape
// without going through resolveQrCardSettings.
export const __QR_CARD_DEFAULTS = QR_CARD_DEFAULTS
