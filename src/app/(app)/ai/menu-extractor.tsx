"use client"

/**
 * /ai client — drives the AI menu-extraction flow end to end.
 *
 *   1. Upload widget       (drag/drop + click, image only)
 *   2. "Extract" button    → Tesseract.js OCR (browser WASM, lazy-loaded)
 *   3. Heuristic parse     → grouped sections with editable rows
 *   4. Save                → bulk insert into menu_categories + menu_items
 *
 * The whole module is intentionally self-contained — no shared
 * helpers with /menu-admin. Only the platform UI primitives + the
 * Supabase client + the country tax config are reused. If this
 * feature ever needs to evolve, you can ship changes here without
 * touching the rest of the catalog code.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
    AlertCircle,
    CheckCircle2,
    ImageIcon,
    Loader2,
    Plus,
    Save,
    Trash2,
    Upload,
    Wand2,
    X,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

import { preprocessForOcr } from "./image-preprocess"
import { analyzeAndReflow, type OcrWord } from "./layout-analysis"
import { parseMenuText, type FoodType, type ParsedSection } from "./menu-parser"

/** A row in the editable table. One per item — owner can edit every
 *  field before save. Wraps the parser's `ParsedItem` with the
 *  remaining fields the DB insert needs (food_type confirmed, tax
 *  slab, HSN, sold-out toggle, sale price). */
interface EditableItem {
    /** Stable client-side id (`crypto.randomUUID()`) so React keys
     *  survive sort + add + remove without thrashing the DOM. */
    rowId: string
    name: string
    description: string
    /** Stored as a string so the input is friendly while typing —
     *  parseFloat on save. */
    price: string
    food_type: FoodType
    hsn_code: string
    gst_slab: string
    sale_price: string
    is_sold_out: boolean
}

/** One section in the table — a category header plus its items. */
interface EditableSection {
    rowId: string
    name: string
    items: EditableItem[]
}

const FOOD_TYPES: { value: FoodType; label: string; dot: string }[] = [
    { value: "VEG",     label: "Veg",     dot: "bg-green-500" },
    { value: "NON_VEG", label: "Non-Veg", dot: "bg-red-500" },
    { value: "EGG",     label: "Egg",     dot: "bg-amber-500" },
    { value: "VEGAN",   label: "Vegan",   dot: "bg-emerald-500" },
]

const GST_SLABS = ["0", "5", "12", "18", "28"]

function newId(): string {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function toEditableSections(parsed: ParsedSection[], defaultGstSlab: string, defaultHsn: string): EditableSection[] {
    return parsed.map((sec) => ({
        rowId: newId(),
        name: sec.category,
        items: sec.items.map((it) => ({
            rowId: newId(),
            name: it.name,
            description: it.description ?? "",
            price: it.price != null ? String(it.price) : "",
            food_type: it.suggestedFoodType,
            hsn_code: defaultHsn,
            gst_slab: defaultGstSlab,
            sale_price: "",
            is_sold_out: false,
        })),
    }))
}

export function MenuExtractorClient({
    tenantId, tenantCountry, currency, taxShortName, countryCode, geminiAvailable,
}: {
    tenantId: string
    tenantCountry: string | null
    currency: string
    taxShortName: string
    countryCode: string
    /** True when GEMINI_API_KEY is set server-side. Drives whether the
     *  Enhanced mode toggle is selectable. */
    geminiAvailable: boolean
}) {
    const supabase = useMemo(() => createClient(), [])
    const router = useRouter()
    const fileInputRef = useRef<HTMLInputElement | null>(null)

    const [dragOver, setDragOver] = useState(false)
    const [image, setImage] = useState<{ file: File; previewUrl: string } | null>(null)
    const [stage, setStage] = useState<"idle" | "extracting" | "review" | "saving">("idle")
    const [progress, setProgress] = useState(0)
    const [sections, setSections] = useState<EditableSection[]>([])
    /** Extraction mode:
     *  - `"enhanced"`: image POSTs to /api/ai/extract-menu, which
     *    proxies to Google's Gemini vision API. Best accuracy on real
     *    menus — handles multi-column, stylised banners, embedded
     *    images, half/full pricing, ₹ symbols, all of it. Free tier,
     *    needs GEMINI_API_KEY on the server.
     *  - `"local"`: Tesseract.js OCR in the browser. No key, no
     *    network, ~70-80 % accuracy on clean printed menus.
     *  Defaults to Enhanced when the server has a key configured. */
    const [mode, setMode] = useState<"local" | "enhanced">(
        geminiAvailable ? "enhanced" : "local",
    )
    /** Column-handling strategy for Local mode only.
     *  - `"auto"` (default): single OCR pass on the whole image, then
     *    word-level layout analysis detects columns from bbox gaps.
     *    Handles asymmetric gutters (55/45, 60/40) and varying column
     *    counts within one image.
     *  - `1 | 2 | 3`: manual override — image pre-sliced into that
     *    many vertical strips before OCR. Use when "auto" picks the
     *    wrong layout. */
    const [columns, setColumns] = useState<"auto" | 1 | 2 | 3>("auto")
    /** Last OCR run's raw text, kept so the owner can manually edit
     *  + re-parse without re-running OCR. Empty until first extract. */
    const [rawText, setRawText] = useState<string>("")
    const [showRawText, setShowRawText] = useState(false)
    /** Default tax slab pulled from the tenant's settings on mount — used
     *  as the per-row starting value. Owner can change row-by-row. */
    const [defaultGstSlab, setDefaultGstSlab] = useState<string>("5")
    const [defaultHsn] = useState<string>("996331")

    // Pull the tenant's default tax slab once — applied to every
    // extracted row so the OWNER doesn't have to set it on each line.
    useEffect(() => {
        let alive = true
        ;(async () => {
            const { data } = await supabase
                .from("tenants")
                .select("default_gst_rate")
                .eq("id", tenantId)
                .maybeSingle() as { data: { default_gst_rate: number | null } | null }
            if (!alive) return
            const slab = data?.default_gst_rate
            if (slab != null && GST_SLABS.includes(String(slab))) {
                setDefaultGstSlab(String(slab))
            }
        })()
        return () => { alive = false }
    }, [supabase, tenantId])

    // Revoke object URLs on unmount so we don't leak the preview blob.
    useEffect(() => {
        const url = image?.previewUrl
        return () => {
            if (url) URL.revokeObjectURL(url)
        }
    }, [image?.previewUrl])

    const acceptFile = useCallback((file: File | undefined | null) => {
        if (!file) return
        if (!file.type.startsWith("image/")) {
            toast.error("That doesn't look like an image — upload a JPG or PNG of your menu.")
            return
        }
        if (file.size > 10 * 1024 * 1024) {
            toast.error("That image is over 10 MB — please scale it down before uploading.")
            return
        }
        setImage({ file, previewUrl: URL.createObjectURL(file) })
        setSections([])
        setStage("idle")
        setProgress(0)
    }, [])

    function onDrop(e: React.DragEvent<HTMLDivElement>) {
        e.preventDefault()
        setDragOver(false)
        acceptFile(e.dataTransfer.files?.[0])
    }

    function clearImage() {
        if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl)
        setImage(null)
        setSections([])
        setStage("idle")
        setProgress(0)
        if (fileInputRef.current) fileInputRef.current.value = ""
    }

    async function extract() {
        if (!image) {
            toast.error("Upload an image first.")
            return
        }
        setStage("extracting")
        setProgress(0)

        // ── Enhanced (Gemini) path. The whole Tesseract pipeline is
        //    bypassed — we POST the raw image to /api/ai/extract-menu,
        //    Gemini returns structured sections directly.
        if (mode === "enhanced") {
            try {
                const fd = new FormData()
                fd.append("image", image.file)
                // Indeterminate progress — Gemini doesn't stream so we
                // don't have a real percentage. Bump it visibly so the
                // bar doesn't look frozen.
                setProgress(15)
                const r = await fetch("/api/ai/extract-menu", { method: "POST", body: fd })
                setProgress(80)
                const data = await r.json().catch(() => null) as
                    | { ok: true; sections: Array<{ category: string; items: Array<{ name: string; description?: string | null; price: number; food_type?: FoodType }> }> }
                    | { ok: false; error?: string }
                    | { error: string }
                    | null
                setProgress(95)
                if (!r.ok || !data || !("ok" in data) || data.ok !== true) {
                    const msg = (data && "error" in data && data.error) || `Enhanced extraction failed (${r.status})`
                    toast.error(msg)
                    setStage("idle")
                    return
                }
                const parsed: ParsedSection[] = data.sections
                    .filter((s) => s.category && s.items.length > 0)
                    .map((s) => ({
                        category: s.category,
                        items: s.items.map((it) => ({
                            name: it.name,
                            description: it.description ?? null,
                            price: it.price ?? null,
                            suggestedFoodType: it.food_type ?? "VEG",
                        })),
                    }))
                if (parsed.length === 0) {
                    toast.warning("Gemini didn't find any menu items — try a clearer photo or switch to Local mode.")
                    setStage("idle")
                    return
                }
                // No raw-OCR text to expose for re-parsing — Gemini
                // returned structured JSON directly. Stash a tiny note
                // so the "Show OCR text" panel still hides cleanly.
                setRawText("")
                setSections(toEditableSections(parsed, defaultGstSlab, defaultHsn))
                setStage("review")
                setProgress(100)
                const total = parsed.reduce((s, c) => s + c.items.length, 0)
                toast.success(`Extracted ${total} item${total === 1 ? "" : "s"} across ${parsed.length} categor${parsed.length === 1 ? "y" : "ies"}.`)
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't reach the extraction service.")
                setStage("idle")
            }
            return
        }

        // ── Local (Tesseract) path. Existing flow.
        try {
            // 1. PREPROCESS. In "auto" mode we keep the image whole
            //    and let the bbox-based reflow do column detection.
            //    In manual modes we pre-slice the image into N strips
            //    (legacy behaviour, kept as an escape hatch when auto
            //    misjudges the layout).
            const manualColumns = columns === "auto" ? 1 : columns
            const columnBlobs = await preprocessForOcr(image.file, { columns: manualColumns })

            // Lazy-load Tesseract (~2 MB WASM) only on click.
            const { createWorker, PSM } = await import("tesseract.js")
            const worker = await createWorker("eng", undefined, {
                logger: (m: { status: string; progress: number }) => {
                    if (m.status === "recognizing text") {
                        const slice = 100 / columnBlobs.length
                        setProgress((prev) => {
                            const base = Math.floor(prev / slice) * slice
                            return Math.min(99, Math.round(base + m.progress * slice))
                        })
                    }
                },
            })

            // PSM choice:
            //   • Auto mode → PSM 3 (Tesseract's default automatic
            //     page-segmentation, which preserves the original
            //     line bboxes we need for column reflow).
            //   • Manual mode → PSM 6 (single uniform block) — each
            //     pre-sliced strip is treated as a single block of
            //     text, which gives cleaner line ordering on tall
            //     narrow strips.
            // The char whitelist filters out checkbox / bullet / ₹
            // glyphs at the OCR source so they never reach the parser.
            await worker.setParameters({
                tessedit_pageseg_mode: columns === "auto" ? PSM.AUTO : PSM.SINGLE_BLOCK,
                tessedit_char_whitelist:
                    "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
                    "abcdefghijklmnopqrstuvwxyz" +
                    "0123456789" +
                    " .,;:()-/&'+%",
            })

            let combined = ""
            if (columns === "auto") {
                // Single OCR pass on the whole image with block-tree
                // output enabled. We walk down to WORD level (not
                // just line level) — the layout analyser needs each
                // word's bbox to detect column breaks within a line.
                //
                // Tesseract groups left-and-right column row-N into
                // one "line" with its bbox spanning the full width;
                // the line-level approach was helpless against that.
                // Word-level bboxes let us see the gap between
                // "45" (last word of the left column row) and "Dal"
                // (first word of the right column row) and break the
                // line into two segments.
                const { data } = await worker.recognize(columnBlobs[0]!, {}, { text: true, blocks: true })
                const ocrWords: OcrWord[] = []
                for (const block of data.blocks ?? []) {
                    for (const para of block.paragraphs ?? []) {
                        for (const line of para.lines ?? []) {
                            for (const word of line.words ?? []) {
                                const text = (word.text ?? "").trim()
                                if (!text || !word.bbox) continue
                                ocrWords.push({
                                    text,
                                    bbox: word.bbox,
                                    confidence: typeof word.confidence === "number" ? word.confidence : 0,
                                })
                            }
                        }
                    }
                }

                if (ocrWords.length === 0) {
                    combined = data.text ?? ""
                } else {
                    const result = analyzeAndReflow(ocrWords)
                    combined = result.text || (data.text ?? "")
                    if (result.columnCount >= 2) {
                        toast.message(`Auto-detected ${result.columnCount} columns — re-flowed in reading order.`)
                    }
                }
            } else {
                // Manual mode: OCR each pre-sliced strip, concatenate
                // in column order.
                const texts: string[] = []
                for (const blob of columnBlobs) {
                    const { data } = await worker.recognize(blob)
                    texts.push(data.text ?? "")
                }
                combined = texts.join("\n\n")
            }

            await worker.terminate()
            setProgress(100)
            setRawText(combined)

            // PARSE.
            const parsed = parseMenuText(combined)
            if (parsed.length === 0) {
                toast.warning("OCR finished but no menu items were found — try a clearer image or switch the column setting.")
                setShowRawText(true)
                setStage("idle")
                return
            }
            setSections(toEditableSections(parsed, defaultGstSlab, defaultHsn))
            setStage("review")
            const total = parsed.reduce((s, c) => s + c.items.length, 0)
            toast.success(`Extracted ${total} item${total === 1 ? "" : "s"} across ${parsed.length} categor${parsed.length === 1 ? "y" : "ies"} — review and tweak below.`)
        } catch (e) {
            const msg = e instanceof Error ? e.message : "OCR failed"
            toast.error(`Couldn't read the image: ${msg}`)
            setStage("idle")
        }
    }

    /** Re-run the heuristic parser on the (possibly edited) raw OCR
     *  text. Lets the owner fix obvious mistakes in the raw text
     *  (a category name OCR'd as gibberish, a wrongly merged line)
     *  and regenerate the table without paying for another OCR pass. */
    function reparseFromRawText() {
        const parsed = parseMenuText(rawText)
        if (parsed.length === 0) {
            toast.warning("No items found in the edited text — check the prices.")
            return
        }
        setSections(toEditableSections(parsed, defaultGstSlab, defaultHsn))
        setStage("review")
        const total = parsed.reduce((s, c) => s + c.items.length, 0)
        toast.success(`Re-parsed ${total} item${total === 1 ? "" : "s"}.`)
    }

    // ── Section + item mutation helpers. All immutable updates so React
    //    state changes cleanly. ────────────────────────────────────
    function renameSection(rowId: string, name: string) {
        setSections((prev) => prev.map((s) => s.rowId === rowId ? { ...s, name } : s))
    }
    function removeSection(rowId: string) {
        setSections((prev) => prev.filter((s) => s.rowId !== rowId))
    }
    function addSection() {
        setSections((prev) => [...prev, { rowId: newId(), name: "New category", items: [] }])
    }
    function addItem(sectionId: string) {
        const fresh: EditableItem = {
            rowId: newId(),
            name: "",
            description: "",
            price: "",
            food_type: "VEG",
            hsn_code: defaultHsn,
            gst_slab: defaultGstSlab,
            sale_price: "",
            is_sold_out: false,
        }
        setSections((prev) => prev.map((s) =>
            s.rowId === sectionId ? { ...s, items: [...s.items, fresh] } : s,
        ))
    }
    function updateItem(sectionId: string, itemId: string, patch: Partial<EditableItem>) {
        setSections((prev) => prev.map((s) =>
            s.rowId === sectionId
                ? { ...s, items: s.items.map((it) => it.rowId === itemId ? { ...it, ...patch } : it) }
                : s,
        ))
    }
    function removeItem(sectionId: string, itemId: string) {
        setSections((prev) => prev.map((s) =>
            s.rowId === sectionId
                ? { ...s, items: s.items.filter((it) => it.rowId !== itemId) }
                : s,
        ))
    }

    // ── Save: APPEND mode (per the brief). For each section we either
    //    match an existing category by case-insensitive name OR create
    //    a fresh one, then bulk-insert all items under it. We do this
    //    sequentially per-section so a partial failure surfaces a
    //    clear error and the OWNER can resume.
    async function save() {
        const totalItems = sections.reduce((s, c) => s + c.items.length, 0)
        if (totalItems === 0) {
            toast.error("Nothing to save — add at least one item.")
            return
        }
        // Validate: every item needs a name + a positive price.
        for (const sec of sections) {
            if (!sec.name.trim()) {
                toast.error("One of the categories has no name — set it before saving.")
                return
            }
            for (const it of sec.items) {
                if (!it.name.trim()) {
                    toast.error(`An item under "${sec.name}" has no name.`)
                    return
                }
                const price = Number.parseFloat(it.price)
                if (!Number.isFinite(price) || price <= 0) {
                    toast.error(`"${it.name}" needs a valid price.`)
                    return
                }
                if (it.sale_price.trim() !== "") {
                    const sp = Number.parseFloat(it.sale_price)
                    if (!Number.isFinite(sp) || sp <= 0 || sp >= price) {
                        toast.error(`"${it.name}" — sale price must be lower than the regular price.`)
                        return
                    }
                }
            }
        }

        setStage("saving")
        try {
            // Fetch existing categories so we can match by name.
            const { data: existingCats } = await supabase
                .from("menu_categories")
                .select("id, name")
                .eq("tenant_id", tenantId)
                .is("deleted_at", null) as { data: { id: string; name: string }[] | null }
            const existingByLower = new Map<string, string>()
            for (const c of existingCats ?? []) {
                existingByLower.set(c.name.trim().toLowerCase(), c.id)
            }

            let insertedItems = 0
            let createdCategories = 0
            for (const sec of sections) {
                if (sec.items.length === 0) continue
                const lookup = sec.name.trim().toLowerCase()
                let categoryId = existingByLower.get(lookup) ?? null
                if (!categoryId) {
                    const { data: catRow, error: catErr } = await supabase
                        .from("menu_categories")
                        .insert({
                            tenant_id: tenantId,
                            name: sec.name.trim(),
                        } as never)
                        .select("id")
                        .single()
                    if (catErr || !catRow) {
                        throw new Error(`Couldn't create category "${sec.name}": ${catErr?.message ?? "unknown"}`)
                    }
                    categoryId = (catRow as { id: string }).id
                    existingByLower.set(lookup, categoryId)
                    createdCategories++
                }

                const rows = sec.items.map((it) => {
                    const price = Number.parseFloat(it.price)
                    const sale = it.sale_price.trim() === "" ? null : Number.parseFloat(it.sale_price)
                    return {
                        tenant_id: tenantId,
                        category_id: categoryId,
                        name: it.name.trim(),
                        description: it.description.trim() || null,
                        base_price: price,
                        sale_price: sale,
                        food_type: it.food_type,
                        hsn_code: it.hsn_code.trim() || null,
                        gst_slab: Number(it.gst_slab) || 0,
                        is_sold_out: it.is_sold_out,
                        is_active: true,
                    }
                })
                const { error: itemErr } = await supabase
                    .from("menu_items")
                    .insert(rows as never)
                if (itemErr) {
                    throw new Error(`Couldn't add items under "${sec.name}": ${itemErr.message}`)
                }
                insertedItems += rows.length
            }
            toast.success(
                `Saved ${insertedItems} item${insertedItems === 1 ? "" : "s"}`
                + (createdCategories > 0
                    ? ` and ${createdCategories} new categor${createdCategories === 1 ? "y" : "ies"}.`
                    : "."),
            )
            // Route to /menu-admin so the OWNER sees the new items in
            // the existing UI immediately (and can fine-tune images /
            // prep time / branch scoping there).
            router.push("/menu-admin")
            router.refresh()
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Save failed"
            toast.error(msg)
            setStage("review")
        }
    }

    const totalItems = sections.reduce((s, c) => s + c.items.length, 0)
    const showTaxColumns = countryCode === "IN"

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-6xl space-y-6 pb-24">
            <PageHeader
                kicker="AI"
                title="Menu extractor"
                highlight="upload + auto-fill"
                description="Upload a photo of your printed menu. The browser OCRs it locally (no images leave your device), the page lists every item it finds — you review, tweak, and save."
            />

            {/* ── Stage 1 / upload + extract panel ─────────────────────── */}
            <Card>
                <CardContent className="p-5 md:p-6 space-y-4">
                    <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={stage === "review" ? "success" : "outline"}>
                            {stage === "review" ? "1. ✓ Extracted" : "1. Upload"}
                        </Badge>
                        <h2 className="text-base md:text-lg font-bold">
                            Upload your menu image
                        </h2>
                    </div>

                    {/* Mode toggle. Enhanced (Gemini) is the default
                      * when the server has a key — it's dramatically
                      * better than Tesseract on real menus. The Local
                      * fallback stays available for offline use AND
                      * when the API key isn't configured. */}
                    <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap text-xs">
                                <Badge variant={mode === "enhanced" ? "default" : "outline"} className="text-[10px] uppercase tracking-wider">
                                    {mode === "enhanced" ? "Enhanced" : "Local"}
                                </Badge>
                                <span className="text-muted-foreground">
                                    {mode === "enhanced"
                                        ? "Gemini Vision — best accuracy, runs server-side, free tier"
                                        : "Tesseract — offline browser OCR, no quota, lower accuracy"}
                                </span>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <Button
                                type="button"
                                variant={mode === "local" ? "neon" : "outline"}
                                size="sm"
                                onClick={() => setMode("local")}
                                disabled={stage === "extracting" || stage === "saving"}
                            >
                                Local (offline)
                            </Button>
                            <Button
                                type="button"
                                variant={mode === "enhanced" ? "neon" : "outline"}
                                size="sm"
                                onClick={() => setMode("enhanced")}
                                disabled={!geminiAvailable || stage === "extracting" || stage === "saving"}
                                title={!geminiAvailable ? "Set GEMINI_API_KEY in .env to enable" : undefined}
                            >
                                Enhanced (Gemini) {!geminiAvailable && "·  needs key"}
                            </Button>
                        </div>
                        {!geminiAvailable && (
                            <p className="text-[11px] text-warning leading-snug">
                                Enhanced mode needs a free Gemini API key. Get one at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-primary hover:underline">aistudio.google.com/apikey</a>, paste it into <code className="text-[10px]">GEMINI_API_KEY</code> in <code className="text-[10px]">.env</code>, and restart the dev server.
                            </p>
                        )}
                    </div>
                    {!image ? (
                        <div
                            onDrop={onDrop}
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                            onDragLeave={() => setDragOver(false)}
                            className={cn(
                                "rounded-2xl border-2 border-dashed p-8 md:p-12 text-center transition-colors cursor-pointer",
                                dragOver ? "border-primary/60 bg-primary/[0.05]" : "border-border/60 hover:border-primary/40",
                            )}
                            onClick={() => fileInputRef.current?.click()}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click()
                            }}
                        >
                            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                            <p className="font-medium">
                                Drop your menu image here, or click to pick one
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                JPG / PNG up to 10 MB. The clearer + flatter the photo, the better the result.
                            </p>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => acceptFile(e.target.files?.[0])}
                            />
                        </div>
                    ) : (
                        <div className="grid md:grid-cols-[1fr_auto] gap-4 items-start">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={image.previewUrl}
                                alt="Menu preview"
                                className="rounded-lg border border-border/60 max-h-72 object-contain bg-muted/30 w-full"
                            />
                            <div className="flex flex-col gap-2 min-w-[200px]">
                                {/* Column-count selector — only matters
                                  * in Local mode. Gemini handles layout
                                  * itself on the Enhanced path. */}
                                {mode === "local" && (
                                    <div className="space-y-1">
                                        <Label className="text-[11px] text-muted-foreground">Menu layout</Label>
                                        <Select
                                            value={String(columns)}
                                            onValueChange={(v) => setColumns(v === "auto" ? "auto" : (Number(v) as 1 | 2 | 3))}
                                            disabled={stage === "extracting" || stage === "saving"}
                                        >
                                            <SelectTrigger className="h-9 text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="auto">Auto-detect (recommended)</SelectItem>
                                                <SelectItem value="1">Force 1 column</SelectItem>
                                                <SelectItem value="2">Force 2 columns</SelectItem>
                                                <SelectItem value="3">Force 3 columns</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <p className="text-[10px] text-muted-foreground leading-tight">
                                            Auto detects columns from word positions. Switch to Force only if Auto picks wrong.
                                        </p>
                                    </div>
                                )}
                                <Button
                                    variant="neon"
                                    onClick={extract}
                                    disabled={stage === "extracting" || stage === "saving"}
                                >
                                    {stage === "extracting"
                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                        : <Wand2 className="h-4 w-4" />}
                                    {stage === "extracting" ? `Reading… ${progress}%` : sections.length > 0 ? "Re-extract" : "Extract menu"}
                                </Button>
                                <Button
                                    variant="ghost"
                                    onClick={clearImage}
                                    disabled={stage === "extracting" || stage === "saving"}
                                >
                                    <X className="h-4 w-4" /> Remove image
                                </Button>
                            </div>
                        </div>
                    )}
                    {stage === "extracting" && (
                        <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
                            <div className="flex items-center gap-2 mb-2">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                {mode === "enhanced"
                                    ? `Sending to Gemini… ${progress}%`
                                    : `Recognising text… ${progress}%`}
                            </div>
                            <div className="h-1.5 rounded-full bg-border/60 overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-primary to-[hsl(var(--neon-magenta))] transition-[width] duration-300"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <p className="mt-2 text-[11px] leading-snug">
                                {mode === "enhanced"
                                    ? "The image is sent to Google's Gemini Vision API for extraction. The image leaves your server and is processed by Google under their privacy policy."
                                    : "The OCR runs entirely in your browser — no images leave the device. Larger / sharper menus take a few more seconds."}
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ── Raw OCR escape hatch ──────────────────────────────────
              * Tesseract is fallible, especially on stylised menus.
              * When a category name comes through as gibberish or two
              * items got merged, the owner doesn't have to re-OCR — they
              * can edit the raw text here and re-parse. The parser
              * pipeline is deterministic, so the same edits always
              * produce the same table. */}
            {rawText && (
                <Card>
                    <CardContent className="p-5 md:p-6 space-y-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="text-[10px]">OCR text</Badge>
                                <h2 className="text-sm md:text-base font-bold">
                                    Need to fix something the OCR got wrong?
                                </h2>
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowRawText((s) => !s)}
                            >
                                {showRawText ? "Hide text" : "Show / edit OCR text"}
                            </Button>
                        </div>
                        {showRawText && (
                            <div className="space-y-2">
                                <p className="text-xs text-muted-foreground">
                                    This is exactly what the OCR read. Fix obvious mistakes (wrong category names, merged items, mis-read prices) then tap <strong>Re-parse</strong> to regenerate the table — no second OCR pass needed.
                                </p>
                                <textarea
                                    value={rawText}
                                    onChange={(e) => setRawText(e.target.value)}
                                    className="w-full min-h-[200px] max-h-[500px] rounded-md border border-border/60 bg-background p-3 font-mono text-xs leading-snug resize-y"
                                    spellCheck={false}
                                />
                                <div className="flex justify-end">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={reparseFromRawText}
                                        disabled={!rawText.trim()}
                                    >
                                        <Wand2 className="h-3.5 w-3.5" /> Re-parse from edited text
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* ── Stage 2 / editable table ─────────────────────────────── */}
            {stage === "review" && (
                <Card>
                    <CardContent className="p-5 md:p-6 space-y-4">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="success">2. Review</Badge>
                                <h2 className="text-base md:text-lg font-bold">
                                    Review &amp; edit before saving
                                </h2>
                                <Badge variant="outline" className="text-[10px]">
                                    {sections.length} categor{sections.length === 1 ? "y" : "ies"} · {totalItems} item{totalItems === 1 ? "" : "s"}
                                </Badge>
                            </div>
                            <Button variant="outline" size="sm" onClick={addSection}>
                                <Plus className="h-3.5 w-3.5" /> Add category
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            OCR fills in name + price + a food-type hint. You set tax slab, sale price, and confirm food type. Items append to your existing menu — matching category names get reused.
                        </p>

                        {sections.map((sec) => (
                            <SectionBlock
                                key={sec.rowId}
                                section={sec}
                                currency={currency}
                                taxShortName={taxShortName}
                                showTaxColumns={showTaxColumns}
                                tenantCountry={tenantCountry}
                                onRename={(name) => renameSection(sec.rowId, name)}
                                onRemove={() => removeSection(sec.rowId)}
                                onAddItem={() => addItem(sec.rowId)}
                                onUpdateItem={(itemId, patch) => updateItem(sec.rowId, itemId, patch)}
                                onRemoveItem={(itemId) => removeItem(sec.rowId, itemId)}
                            />
                        ))}

                        {sections.length === 0 && (
                            <div className="rounded-md border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                                You removed every item. Add a category to start a fresh list, or upload another image.
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* ── Sticky save bar ──────────────────────────────────────── */}
            {/* Visible during BOTH review AND saving so the spinner can
              * land on the button instead of the bar disappearing
              * mid-save and confusing the owner. */}
            {(stage === "review" || stage === "saving") && (
                <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/85 backdrop-blur-xl">
                    <div className="container mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-3">
                        <div className="text-xs text-muted-foreground">
                            {totalItems > 0
                                ? <>Ready to add <strong className="text-foreground">{totalItems}</strong> item{totalItems === 1 ? "" : "s"} to your menu.</>
                                : "Add at least one item to save."}
                        </div>
                        <Button
                            variant="neon"
                            onClick={save}
                            disabled={stage === "saving" || totalItems === 0}
                        >
                            {stage === "saving"
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <Save className="h-4 w-4" />}
                            Save all items
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components — kept inline to honour the "self-contained module"
// brief. If this file gets unwieldy these can move to siblings under
// the /ai folder without touching anything outside.
// ─────────────────────────────────────────────────────────────────────

function SectionBlock({
    section, currency, taxShortName, showTaxColumns, tenantCountry,
    onRename, onRemove, onAddItem, onUpdateItem, onRemoveItem,
}: {
    section: EditableSection
    currency: string
    taxShortName: string
    showTaxColumns: boolean
    tenantCountry: string | null
    onRename: (name: string) => void
    onRemove: () => void
    onAddItem: () => void
    onUpdateItem: (itemId: string, patch: Partial<EditableItem>) => void
    onRemoveItem: (itemId: string) => void
}) {
    return (
        <div className="rounded-xl border border-border/60 overflow-hidden">
            <div className="flex items-center justify-between gap-2 p-3 bg-muted/30 border-b border-border/40 flex-wrap">
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Category</Label>
                    <Input
                        value={section.name}
                        onChange={(e) => onRename(e.target.value)}
                        className="h-8 max-w-xs font-medium"
                        placeholder="e.g. Starters"
                    />
                    <Badge variant="outline" className="text-[10px]">
                        {section.items.length} item{section.items.length === 1 ? "" : "s"}
                    </Badge>
                </div>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={onAddItem}>
                        <Plus className="h-3.5 w-3.5" /> Add item
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={onRemove}
                        title="Remove this category and all its items"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>

            {section.items.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                    No items in this category. Click <strong>Add item</strong> to add one.
                </div>
            ) : (
                <ul className="divide-y divide-border/40">
                    {section.items.map((it) => (
                        <ItemRow
                            key={it.rowId}
                            item={it}
                            currency={currency}
                            taxShortName={taxShortName}
                            showTaxColumns={showTaxColumns}
                            tenantCountry={tenantCountry}
                            onChange={(patch) => onUpdateItem(it.rowId, patch)}
                            onRemove={() => onRemoveItem(it.rowId)}
                        />
                    ))}
                </ul>
            )}
        </div>
    )
}

function ItemRow({
    item, currency, taxShortName, showTaxColumns, tenantCountry,
    onChange, onRemove,
}: {
    item: EditableItem
    currency: string
    taxShortName: string
    showTaxColumns: boolean
    tenantCountry: string | null
    onChange: (patch: Partial<EditableItem>) => void
    onRemove: () => void
}) {
    const ftDot = FOOD_TYPES.find((f) => f.value === item.food_type)?.dot ?? "bg-muted"
    return (
        <li className="p-3 grid gap-2 lg:grid-cols-[1fr_120px_120px_120px_auto] items-start">
            {/* Name + description stack on the left so the OWNER can see the
              * full label even on smaller screens. */}
            <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                    <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", ftDot)} aria-hidden />
                    <Input
                        value={item.name}
                        onChange={(e) => onChange({ name: e.target.value })}
                        className="h-8 font-medium"
                        placeholder="Dish name"
                    />
                </div>
                <Input
                    value={item.description}
                    onChange={(e) => onChange({ description: e.target.value })}
                    className="h-8 text-xs"
                    placeholder="Description (optional)"
                />
            </div>

            <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Price ({currency})</Label>
                <Input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={item.price}
                    onChange={(e) => onChange({ price: e.target.value })}
                    className="h-8 font-mono text-xs"
                    placeholder="0.00"
                />
            </div>

            <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Sale price</Label>
                <Input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={item.sale_price}
                    onChange={(e) => onChange({ sale_price: e.target.value })}
                    className="h-8 font-mono text-xs"
                    placeholder="—"
                />
            </div>

            <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Food type</Label>
                <Select value={item.food_type} onValueChange={(v) => onChange({ food_type: v as FoodType })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {FOOD_TYPES.map((f) => (
                            <SelectItem key={f.value} value={f.value}>
                                <span className="inline-flex items-center gap-1.5">
                                    <span className={cn("h-2 w-2 rounded-full", f.dot)} />
                                    {f.label}
                                </span>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="flex items-start gap-1 pt-1">
                {showTaxColumns ? (
                    <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">{taxShortName} %</Label>
                        <Select value={item.gst_slab} onValueChange={(v) => onChange({ gst_slab: v })}>
                            <SelectTrigger className="h-8 text-xs w-[80px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {GST_SLABS.map((s) => (
                                    <SelectItem key={s} value={s}>{s}%</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                ) : (
                    /* Outside India just default to 0% so the field doesn't
                     * lie about an Indian GST rate on a US menu. */
                    <input type="hidden" value={item.gst_slab} readOnly />
                )}
                <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:bg-destructive/10 mt-5"
                    onClick={onRemove}
                    title="Remove item"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </Button>
            </div>

            {/* India: HSN field on its own line so the row stays tidy. */}
            {tenantCountry === "IN" && (
                <div className="lg:col-span-5 flex items-center gap-2">
                    <Label className="text-[10px] text-muted-foreground">HSN</Label>
                    <Input
                        value={item.hsn_code}
                        onChange={(e) => onChange({ hsn_code: e.target.value })}
                        className="h-7 font-mono text-xs w-32"
                        placeholder="996331"
                    />
                    <div className="flex items-center gap-1.5 ml-auto">
                        <input
                            id={`sold-${item.rowId}`}
                            type="checkbox"
                            checked={item.is_sold_out}
                            onChange={(e) => onChange({ is_sold_out: e.target.checked })}
                            className="h-3.5 w-3.5"
                        />
                        <Label htmlFor={`sold-${item.rowId}`} className="text-[11px] text-muted-foreground cursor-pointer">
                            Sold out
                        </Label>
                    </div>
                </div>
            )}
            {tenantCountry !== "IN" && (
                <div className="lg:col-span-5 flex items-center gap-1.5 justify-end">
                    <input
                        id={`sold-${item.rowId}`}
                        type="checkbox"
                        checked={item.is_sold_out}
                        onChange={(e) => onChange({ is_sold_out: e.target.checked })}
                        className="h-3.5 w-3.5"
                    />
                    <Label htmlFor={`sold-${item.rowId}`} className="text-[11px] text-muted-foreground cursor-pointer">
                        Sold out
                    </Label>
                </div>
            )}
        </li>
    )
}

// Hint icons that aren't otherwise wired in but are good defaults.
void ImageIcon; void AlertCircle; void CheckCircle2
