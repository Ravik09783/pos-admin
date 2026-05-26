"use client"

import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import {
    Download,
    FileJson,
    FileSpreadsheet,
    FileText,
    FileCode,
    FileType,
    Loader2,
    Package,
    Sparkles,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { buildPeriod, fetchExportDataset } from "@/lib/ca-export/fetch"
import { exportLocale } from "@/lib/ca-export/locale"
import {
    BUNDLE_FORMAT,
    getReportFormatsForCountry,
    type ReportFileExtension,
    type ReportFormat,
} from "@/lib/tax-reports/registry"
import { formatCurrency } from "@/lib/utils"
import type { ExportDataset } from "@/lib/ca-export/types"

/** Icon picked per file type so each card / dropdown row has visual identity
 *  without the registry caring about react components. */
const ICON_FOR_EXT: Record<ReportFileExtension, React.ComponentType<{ className?: string }>> = {
    xlsx: FileSpreadsheet,
    pdf:  FileText,
    json: FileJson,
    xml:  FileCode,
    csv:  FileType,
    zip:  Package,
}

const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

export default function CaExportPage() {
    const now = new Date()
    const [year, setYear] = useState(now.getFullYear())
    const [month, setMonth] = useState(now.getMonth() + 1)
    const [data, setData] = useState<ExportDataset | null>(null)
    const [loading, setLoading] = useState(false)
    const [busy, setBusy] = useState<string | null>(null)

    const period = useMemo(() => buildPeriod(year, month), [year, month])
    const years = useMemo(() => {
        const y = []
        for (let i = now.getFullYear(); i >= now.getFullYear() - 4; i--) y.push(i)
        return y
    }, [now])

    useEffect(() => {
        ;(async () => {
            setLoading(true)
            try {
                const ds = await fetchExportDataset(period)
                setData(ds)
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : "Failed to load data")
            } finally {
                setLoading(false)
            }
        })()
    }, [period])

    // Country-driven report config. The registry decides which formats are
    // surfaced based on tenant.country — Indian restaurants see GSTR-1 JSON
    // + Tally XML alongside the universal Excel/PDF/CSV; a UK restaurant
    // sees just the universal formats with the HMRC authority label.
    const reportConfig = useMemo(
        () => getReportFormatsForCountry(data?.tenant.country),
        [data?.tenant.country],
    )

    // Country-aware presentation for the on-screen preview — currency and tax
    // wording. Mirrors what the downloaded files produce so a UK restaurant
    // sees "£ / VAT", an Indian one "₹ / CGST+SGST+IGST", etc.
    const loc = useMemo(() => exportLocale(data?.tenant.country), [data?.tenant.country])
    const money = (v: number) => formatCurrency(v, loc.currency)

    /** Single generic download — drives every per-country card AND the
     *  "Download in any format" dropdown. Pass any ReportFormat. */
    async function runDownload(format: ReportFormat) {
        if (!data) return
        setBusy(format.id)
        try {
            const { blob, filename } = await format.build(data)
            // The full-bundle adapter saves to disk itself (it's wrapping
            // existing bundle.ts logic) — when blob is empty we skip the
            // saveAs() so we don't write a zero-byte file alongside.
            if (blob.size > 0) {
                const { saveAs } = await import("file-saver")
                saveAs(blob, filename)
            }
            toast.success(`Downloaded ${format.label}`)
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : `Failed to build ${format.label}`)
        } finally {
            setBusy(null)
        }
    }

    /** "Download everything as ZIP" card — uses the same generic builder. */
    function downloadAll() { runDownload(BUNDLE_FORMAT) }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-6">
            {/* Hero */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="relative rounded-2xl glass-strong border border-border/50 neon-border overflow-hidden"
            >
                <div className="absolute -top-32 -right-32 h-72 w-72 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
                <div className="absolute -bottom-32 -left-32 h-72 w-72 rounded-full bg-[hsl(var(--neon-magenta)/0.2)] blur-3xl pointer-events-none" />
                <div className="relative p-6 md:p-8">
                    <Badge variant="neon" className="mb-3"><Sparkles className="h-3 w-3 mr-1" /> Differentiator</Badge>
                    <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                        CA Export — <span className="text-gradient">file in minutes</span>
                    </h1>
                    <p className="mt-3 text-sm md:text-base text-muted-foreground max-w-2xl">
                        Pick a month, hit download. Send the ZIP to your accountant — they file, you save on data-entry fees.
                        {loc.isIndia
                            ? " Everything formatted for the GST portal, Tally, Excel, and a human-readable PDF."
                            : ` Everything formatted for ${loc.taxName} filing — Excel workbook, CSV and a human-readable PDF.`}
                    </p>
                </div>
            </motion.div>

            {/* Period selector */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-2xl glass border border-border/50 p-5"
            >
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-3">Filing period</div>
                <div className="flex flex-wrap gap-3 items-end">
                    <div className="space-y-1.5 w-40">
                        <Label>Month</Label>
                        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5 w-32">
                        <Label>Year</Label>
                        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    {/* The page builds `period` with the April default; once data
                     *  loads we show the FY label re-derived from the tenant's
                     *  country (Jan for US/EU, July for Australia, …). */}
                    <Badge variant="outline" className="self-end mb-2">FY {data?.period.fyLabel ?? period.fyLabel}</Badge>
                </div>
            </motion.div>

            {loading || !data ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
                </div>
            ) : (
                <>
                    <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.1 }}
                        className="grid gap-3 md:gap-4 grid-cols-2 lg:grid-cols-4"
                    >
                        <Kpi label="Bills issued" value={String(data.sales.length - data.summary.void_count)} accent="primary" />
                        <Kpi label="Taxable outward" value={money(data.summary.taxable_outward)} accent="magenta" />
                        <Kpi label={`${loc.taxName} collected`} value={money(data.summary.cgst_collected + data.summary.sgst_collected + data.summary.igst_collected)} accent="primary" />
                        <Kpi label={`Net ${loc.taxName} payable`} value={money(data.summary.net_tax_payable)} accent="magenta" highlight />
                    </motion.div>

                    {/* Big download CTA — bundle + "any format" dropdown together.
                     *  The primary button downloads everything as a ZIP. The
                     *  dropdown lets the admin grab a specific format on demand
                     *  even if it isn't promoted on the country-specific cards
                     *  below (e.g. the raw sales CSV for a custom workflow). */}
                    <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.15 }}
                        className="relative rounded-2xl glass-strong border border-border/50 neon-border overflow-hidden"
                    >
                        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/15 blur-3xl pointer-events-none" />
                        <div className="relative p-6 md:p-8 flex flex-wrap items-center gap-4 justify-between">
                            <div className="flex items-center gap-4 min-w-0">
                                <div className="grid place-items-center h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/25 to-[hsl(var(--neon-magenta)/0.25)] shrink-0">
                                    <Package className="h-7 w-7 text-primary" />
                                </div>
                                <div className="min-w-0">
                                    <h2 className="text-xl md:text-2xl font-bold tracking-tight">Download everything</h2>
                                    <p className="text-xs md:text-sm text-muted-foreground mt-1 max-w-md">
                                        One ZIP, every format for {reportConfig.countryLabel}. Attach to an email and your CA has everything.
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                {/* Format dropdown — every format in the registry, including
                                 *  advanced ones the country cards don't promote. */}
                                <Select
                                    value=""
                                    onValueChange={(id) => {
                                        const f = reportConfig.formats.find((x) => x.id === id)
                                        if (f) runDownload(f)
                                    }}
                                    disabled={busy !== null}
                                >
                                    <SelectTrigger className="w-[220px]">
                                        <SelectValue placeholder="Download as…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {reportConfig.formats.map((f) => (
                                            <SelectItem key={f.id} value={f.id}>
                                                {f.label} ({f.fileExtension.toUpperCase()})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button variant="neon" size="xl" onClick={downloadAll} disabled={busy !== null}>
                                    {busy === BUNDLE_FORMAT.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
                                    Full bundle (ZIP)
                                </Button>
                            </div>
                        </div>
                    </motion.div>

                    {/* Country-aware format cards. The labels reflect what the
                     *  tenant's tax authority actually accepts ("GSTR-1 JSON"
                     *  for India, "Excel workbook" for everyone, etc.).
                     *  Adding a country = editing src/lib/tax-reports/registry.ts. */}
                    <div className="flex items-center justify-between mb-1">
                        <div>
                            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                                Formats for {reportConfig.countryLabel}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Ready for {reportConfig.authorityLabel}. Pick a format below or use the dropdown above.
                            </p>
                        </div>
                    </div>
                    <motion.div
                        initial="hidden"
                        animate="visible"
                        variants={{
                            visible: { transition: { staggerChildren: 0.05, delayChildren: 0.2 } },
                        }}
                        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
                    >
                        {reportConfig.formats.filter((f) => !f.advanced).map((f, i) => (
                            <FormatCard
                                key={f.id}
                                icon={ICON_FOR_EXT[f.fileExtension] ?? FileText}
                                title={f.label}
                                desc={f.description}
                                onDownload={() => runDownload(f)}
                                loading={busy === f.id}
                                accent={i % 2 === 0 ? "primary" : "magenta"}
                            />
                        ))}
                    </motion.div>

                    <Tabs defaultValue="summary" className="space-y-3">
                        <TabsList>
                            <TabsTrigger value="summary">Summary</TabsTrigger>
                            <TabsTrigger value="slabs">By {loc.taxName} rate</TabsTrigger>
                            {/* HSN is an Indian GST classification — only India files it. */}
                            {loc.isIndia && <TabsTrigger value="hsn">HSN summary</TabsTrigger>}
                            <TabsTrigger value="pl">P&amp;L preview</TabsTrigger>
                        </TabsList>

                        <TabsContent value="summary">
                            <Card className="rounded-2xl border-border/50">
                                <CardContent className="pt-6 grid sm:grid-cols-2 gap-y-2 gap-x-12 text-sm">
                                    <Row k="Gross sales (incl. tax)" v={money(data.summary.gross_sales)} />
                                    <Row k="Voided bills" v={String(data.summary.void_count)} />
                                    <Row k={`Taxable B2B (with ${loc.taxIdLabel})`} v={money(data.summary.taxable_b2b)} />
                                    <Row k="Taxable B2C / retail" v={money(data.summary.taxable_b2c)} />
                                    {loc.taxModel === "split" && <>
                                        <Row k="CGST collected" v={money(data.summary.cgst_collected)} />
                                        <Row k="SGST collected" v={money(data.summary.sgst_collected)} />
                                        <Row k="IGST collected" v={money(data.summary.igst_collected)} />
                                    </>}
                                    {loc.taxModel === "single" && (
                                        <Row
                                            k={`${loc.taxName} collected`}
                                            v={money(data.summary.cgst_collected + data.summary.sgst_collected + data.summary.igst_collected)}
                                        />
                                    )}
                                    <Row k="Purchase value" v={money(data.summary.purchase_value)} />
                                    {loc.taxModel !== "none" && (
                                        <Row
                                            k={loc.isIndia ? "ITC (CGST/SGST/IGST)" : `Input ${loc.taxName} credit`}
                                            v={money(data.summary.itc_cgst + data.summary.itc_sgst + data.summary.itc_igst)}
                                        />
                                    )}
                                    <Row k="Operating expenses" v={money(data.summary.total_expenses_pl)} />
                                    <Row k="Gross profit" v={money(data.summary.gross_profit)} />
                                    <Row k="Net profit (before tax)" v={money(data.summary.net_profit)} bold />
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="slabs">
                            <Card className="rounded-2xl border-border/50">
                                <CardContent className="pt-6">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Rate</TableHead>
                                                <TableHead className="text-right">Taxable</TableHead>
                                                {loc.taxColumns.map((c) => (
                                                    <TableHead key={c} className="text-right">{c}</TableHead>
                                                ))}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {data.by_slab.length === 0 ? (
                                                <TableRow><TableCell colSpan={2 + loc.taxColumns.length} className="text-muted-foreground">No taxable sales in this period.</TableCell></TableRow>
                                            ) : data.by_slab.map((s) => {
                                                const cells = loc.taxModel === "split"
                                                    ? [s.cgst, s.sgst, s.igst]
                                                    : loc.taxModel === "single"
                                                        ? [s.cgst + s.sgst + s.igst]
                                                        : []
                                                return (
                                                    <TableRow key={s.slab}>
                                                        <TableCell>{s.slab}%</TableCell>
                                                        <TableCell className="text-right">{money(s.taxable)}</TableCell>
                                                        {cells.map((v, i) => (
                                                            <TableCell key={i} className="text-right">{money(v)}</TableCell>
                                                        ))}
                                                    </TableRow>
                                                )
                                            })}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        {loc.isIndia && (
                            <TabsContent value="hsn">
                                <Card className="rounded-2xl border-border/50">
                                    <CardContent className="pt-6">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>HSN/SAC</TableHead>
                                                    <TableHead className="text-right">Qty</TableHead>
                                                    <TableHead className="text-right">Taxable</TableHead>
                                                    <TableHead className="text-right">CGST</TableHead>
                                                    <TableHead className="text-right">SGST</TableHead>
                                                    <TableHead className="text-right">IGST</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {data.hsn_summary.map((h) => (
                                                    <TableRow key={h.hsn_code}>
                                                        <TableCell className="font-mono text-xs">{h.hsn_code}</TableCell>
                                                        <TableCell className="text-right">{h.total_quantity.toFixed(2)}</TableCell>
                                                        <TableCell className="text-right">{money(h.taxable_amount)}</TableCell>
                                                        <TableCell className="text-right">{money(h.cgst)}</TableCell>
                                                        <TableCell className="text-right">{money(h.sgst)}</TableCell>
                                                        <TableCell className="text-right">{money(h.igst)}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </CardContent>
                                </Card>
                            </TabsContent>
                        )}

                        <TabsContent value="pl">
                            <Card className="rounded-2xl border-border/50">
                                <CardContent className="pt-6 space-y-1">
                                    {data.pl.map((b) => (
                                        <div key={b.group} className="border-b border-border/40 py-2">
                                            <div className="flex items-center justify-between font-medium">
                                                <span>{b.group}</span>
                                                <span>{money(b.amount)}</span>
                                            </div>
                                            {b.rows.slice(0, 4).map((r, i) => (
                                                <div key={i} className="flex items-center justify-between text-xs text-muted-foreground pl-4">
                                                    <span>{r.description}</span>
                                                    <span>{money(r.amount)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                    <div className="flex items-center justify-between text-base font-semibold pt-3">
                                        <span>Net profit (before tax)</span>
                                        <span>{money(data.summary.net_profit)}</span>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </>
            )}
        </div>
    )
}

function Kpi({ label, value, accent, highlight }: {
    label: string; value: string; accent: "primary" | "magenta"; highlight?: boolean
}) {
    return (
        <div
            className={`group relative rounded-2xl glass border p-4 md:p-5 transition-all ${
                highlight ? "border-warning/40 hover:shadow-glow" : "border-border/50 hover:border-primary/40 hover:shadow-glow"
            }`}
        >
            <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
                <div
                    className="h-2 w-2 rounded-full"
                    style={{
                        background: accent === "primary"
                            ? "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--neon-magenta)))"
                            : "linear-gradient(135deg, hsl(var(--neon-magenta)), hsl(var(--primary)))",
                    }}
                />
            </div>
            <div className={`text-xl md:text-2xl font-bold tabular-nums ${highlight ? "text-warning" : ""}`}>{value}</div>
        </div>
    )
}

function FormatCard({
    icon: Icon, title, desc, onDownload, loading, accent,
}: {
    icon: React.ComponentType<{ className?: string }>
    title: string
    desc: string
    onDownload: () => void
    loading: boolean
    accent: "primary" | "magenta"
}) {
    return (
        <motion.div
            variants={{
                hidden: { opacity: 0, y: 12 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
            }}
            whileHover={{ y: -2 }}
            className="group rounded-2xl glass border border-border/50 p-5 transition-all hover:border-primary/40 hover:shadow-glow"
        >
            <div
                className="grid place-items-center h-11 w-11 rounded-lg mb-3"
                style={{
                    background: accent === "primary"
                        ? "linear-gradient(135deg, hsl(var(--primary)/0.2), hsl(var(--neon-magenta)/0.15))"
                        : "linear-gradient(135deg, hsl(var(--neon-magenta)/0.2), hsl(var(--primary)/0.15))",
                }}
            >
                <Icon className="h-5 w-5 text-primary" />
            </div>
            <div className="font-semibold">{title}</div>
            <p className="text-xs text-muted-foreground mt-1 mb-4 leading-snug">{desc}</p>
            <Button variant="outline" className="w-full" onClick={onDownload} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download
            </Button>
        </motion.div>
    )
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
    return (
        <div className={`flex items-center justify-between gap-4 ${bold ? "font-semibold pt-2 border-t border-border/40" : ""}`}>
            <span className="text-muted-foreground">{k}</span>
            <span className="tabular-nums">{v}</span>
        </div>
    )
}
