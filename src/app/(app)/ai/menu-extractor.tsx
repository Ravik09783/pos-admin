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
    ChevronRight,
    ImageIcon,
    Loader2,
    Plus,
    Save,
    SkipForward,
    Trash2,
    Upload,
    Wand2,
    X,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ImageUploader } from "@/components/ui/image-uploader"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { tenantImagePath } from "@/lib/storage/image-upload"
import { getTaxConfig, mergedTaxRates, type CountryTaxConfig } from "@/lib/tax/locale-config"
import { cn } from "@/lib/utils"
import type { HsnCode } from "@/types/database"

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

/** Snapshot row in the Review-and-Save queue. Captured once when
 *  the OWNER clicks "Review & Save" so the index stays stable as
 *  saved items get pruned out of `sections`. */
interface ReviewQueueEntry {
    sectionId: string
    sectionName: string
    itemId: string
    base: EditableItem
}

/** Form state inside the per-item Review dialog. Mirrors the
 *  field set of the menu-admin "New menu item" dialog so the
 *  OWNER gets a familiar shape during bulk review. Recommendations
 *  and branch scope stay out — recommendations need other items
 *  to already exist, and branch scope can be set later in /menu-admin. */
interface ReviewForm {
    sectionId: string
    itemId: string
    name: string
    description: string
    category_name: string
    image_url: string | null
    base_price: string
    sale_price: string
    food_type: FoodType
    gst_slab: string
    hsn_code: string
    is_tax_inclusive: boolean
    is_active: boolean
    is_sold_out: boolean
    prep_time_minutes: string
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
     *  Always defaults to Local — it's offline, has no quota, and the
     *  OWNER can opt into Enhanced explicitly when they want the
     *  higher-accuracy Gemini pass. */
    const [mode, setMode] = useState<"local" | "enhanced">("local")
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
    /** First-time users see the "ideal menu format" sample expanded so
     *  they understand what gets the highest accuracy. They can collapse
     *  it once they've internalised the format. */
    const [showSampleFormat, setShowSampleFormat] = useState(true)
    /** Default tax slab pulled from the tenant's settings on mount — used
     *  as the per-row starting value. Owner can change row-by-row. */
    const [defaultGstSlab, setDefaultGstSlab] = useState<string>("5")
    const [defaultHsn] = useState<string>("996331")
    /** Look-ups the polished review dialog needs to mirror the
     *  menu-admin "New menu item" form: HSN/SAC list, the tenant's
     *  custom tax rates (Settings → Tax), inclusive-pricing default,
     *  and the existing category list so the OWNER can drop an
     *  extracted item into a category that already exists. */
    const [hsnCodes, setHsnCodes] = useState<HsnCode[]>([])
    const [tenantCustomRates, setTenantCustomRates] = useState<number[]>([])
    const [tenantPricesIncludeTax, setTenantPricesIncludeTax] = useState(false)
    const [existingCategories, setExistingCategories] = useState<{ id: string; name: string }[]>([])
    const taxCfg: CountryTaxConfig = useMemo(() => getTaxConfig(tenantCountry), [tenantCountry])

    // ── Review-and-save flow ──────────────────────────────────────
    // The "Review & Save" button walks the OWNER through each
    // extracted item one at a time, opening a pre-filled form they
    // can tweak before committing. Behaves like the menu-admin
    // "New item" dialog, but driven by a stable snapshot queue so the
    // index stays valid even as saved items get pruned from sections.
    const [reviewOpen, setReviewOpen] = useState(false)
    const [reviewQueue, setReviewQueue] = useState<ReviewQueueEntry[]>([])
    const [reviewIndex, setReviewIndex] = useState(0)
    const [reviewForm, setReviewForm] = useState<ReviewForm | null>(null)
    const [savingOne, setSavingOne] = useState(false)
    // Tenant-category lookup cache, populated lazily so we don't
    // re-fetch + re-insert the same category between items.
    const categoryCacheRef = useRef<Map<string, string>>(new Map())

    // Pull the tenant's default tax slab + custom rates + inclusive
    // flag once, alongside the HSN list and existing category list.
    // All four feed the polished Review dialog so the OWNER sees the
    // same dropdowns they get on the menu-admin "New menu item" form.
    useEffect(() => {
        let alive = true
        ;(async () => {
            const [{ data: tenant }, { data: hsn }, { data: cats }] = await Promise.all([
                supabase
                    .from("tenants")
                    .select("default_gst_rate, default_tax_rate, custom_tax_rates, prices_include_tax")
                    .eq("id", tenantId)
                    .maybeSingle(),
                supabase
                    .from("hsn_codes")
                    .select("*")
                    .order("code"),
                supabase
                    .from("menu_categories")
                    .select("id, name")
                    .eq("tenant_id", tenantId)
                    .is("deleted_at", null)
                    .order("sort_order"),
            ])
            if (!alive) return
            const tx = tenant as {
                default_gst_rate?: number | null
                default_tax_rate?: number | null
                custom_tax_rates?: number[] | null
                prices_include_tax?: boolean | null
            } | null
            const slab = tx?.default_tax_rate ?? tx?.default_gst_rate ?? null
            if (slab != null) setDefaultGstSlab(String(slab))
            setTenantCustomRates(tx?.custom_tax_rates ?? [])
            setTenantPricesIncludeTax(tx?.prices_include_tax ?? false)
            setHsnCodes((hsn ?? []) as HsnCode[])
            const existing = (cats ?? []) as { id: string; name: string }[]
            setExistingCategories(existing)
            // Pre-warm the category cache with what's already in the
            // DB so saveOne() doesn't refetch per item.
            const cache = new Map<string, string>()
            for (const c of existing) cache.set(c.name.trim().toLowerCase(), c.id)
            categoryCacheRef.current = cache
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
            // Client-side abort at 65 s — slightly longer than the
            // route's maxDuration=60 + the gemini-menu helper's 55 s
            // AbortController so the server-side error reaches us
            // before the browser gives up. Without this, a hung
            // request leaves the user staring at the spinner forever.
            const clientAc = new AbortController()
            const clientTimer = setTimeout(() => clientAc.abort(), 65_000)
            try {
                const fd = new FormData()
                fd.append("image", image.file)
                // Indeterminate progress — Gemini doesn't stream so we
                // don't have a real percentage. Bump it visibly so the
                // bar doesn't look frozen.
                setProgress(15)
                const r = await fetch("/api/ai/extract-menu", {
                    method: "POST",
                    body: fd,
                    signal: clientAc.signal,
                })
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
                if (e instanceof Error && e.name === "AbortError") {
                    toast.error("Enhanced extraction timed out (>65 s). Try a smaller / clearer image, or switch to Local mode.")
                } else {
                    toast.error(e instanceof Error ? e.message : "Couldn't reach the extraction service.")
                }
                setStage("idle")
            } finally {
                clearTimeout(clientTimer)
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

    /** Returns the id of a category with this (case-insensitive) name,
     *  creating it on the fly if no match exists. Uses an in-memory
     *  cache so the per-item Review flow doesn't refetch + reinsert
     *  the same category across consecutive saves.
     *
     *  IMPORTANT: as well as updating the ref-cache, every successful
     *  resolution also nudges `existingCategories` state so the
     *  Category Select dropdown re-renders with the newly-known
     *  option. Without this, the second item from a freshly-created
     *  section would seed its form with the new UUID but the
     *  dropdown wouldn't have the matching `<SelectItem>` — the
     *  trigger would render empty and the OWNER couldn't even
     *  re-pick the category they just made. */
    async function resolveCategoryId(rawName: string): Promise<string> {
        const name = rawName.trim()
        const lookup = name.toLowerCase()
        const cached = categoryCacheRef.current.get(lookup)
        if (cached) return cached
        const { data: existing } = await supabase
            .from("menu_categories")
            .select("id, name")
            .eq("tenant_id", tenantId)
            .ilike("name", name)
            .is("deleted_at", null)
            .maybeSingle() as { data: { id: string; name: string } | null }
        if (existing) {
            categoryCacheRef.current.set(lookup, existing.id)
            setExistingCategories((prev) =>
                prev.some((c) => c.id === existing.id) ? prev : [...prev, { id: existing.id, name: existing.name }],
            )
            return existing.id
        }
        const { data: created, error: catErr } = await supabase
            .from("menu_categories")
            .insert({ tenant_id: tenantId, name } as never)
            .select("id")
            .single()
        if (catErr || !created) {
            throw new Error(`Couldn't create category "${name}": ${catErr?.message ?? "unknown"}`)
        }
        const id = (created as { id: string }).id
        categoryCacheRef.current.set(lookup, id)
        setExistingCategories((prev) =>
            prev.some((c) => c.id === id) ? prev : [...prev, { id, name }],
        )
        return id
    }

    // ── Review & Save: open a pre-filled form per item, one at a time,
    //    so the OWNER can sanity-check + tweak before the row hits
    //    the DB. Items that get saved are pruned from `sections` so
    //    the bottom-bar counter + table reflect what's actually left.
    function seedReviewFormFrom(queue: ReviewQueueEntry[], idx: number) {
        const entry = queue[idx]
        if (!entry) {
            setReviewForm(null)
            return
        }
        // Resolve the category name to an existing id when we have a
        // match, otherwise pass the literal extracted name through —
        // the dialog's Category select treats `__new:<name>` as a
        // create-on-save sentinel.
        const lookup = entry.sectionName.trim().toLowerCase()
        const existingId = categoryCacheRef.current.get(lookup) ?? null
        setReviewForm({
            sectionId: entry.sectionId,
            itemId: entry.itemId,
            name: entry.base.name,
            description: entry.base.description,
            category_name: existingId ?? `__new:${entry.sectionName.trim()}`,
            image_url: null,
            base_price: entry.base.price,
            sale_price: entry.base.sale_price,
            food_type: entry.base.food_type,
            gst_slab: entry.base.gst_slab,
            hsn_code: entry.base.hsn_code || defaultHsn,
            is_tax_inclusive: tenantPricesIncludeTax,
            is_active: true,
            is_sold_out: entry.base.is_sold_out,
            prep_time_minutes: "10",
        })
    }

    function startReview() {
        const queue: ReviewQueueEntry[] = []
        for (const sec of sections) {
            for (const it of sec.items) {
                queue.push({ sectionId: sec.rowId, sectionName: sec.name, itemId: it.rowId, base: it })
            }
        }
        if (queue.length === 0) {
            toast.error("Nothing to review — add at least one item.")
            return
        }
        // Note: don't wipe categoryCacheRef here — it's been pre-warmed
        // with the tenant's existing categories so the Select can show
        // an extracted category as already-matched on first open.
        setReviewQueue(queue)
        setReviewIndex(0)
        seedReviewFormFrom(queue, 0)
        setReviewOpen(true)
    }

    function advanceReview() {
        const next = reviewIndex + 1
        if (next >= reviewQueue.length) {
            setReviewOpen(false)
            setReviewForm(null)
            toast.success("All items reviewed — heading to your menu.")
            router.push("/menu-admin")
            router.refresh()
            return
        }
        setReviewIndex(next)
        seedReviewFormFrom(reviewQueue, next)
    }

    function skipReview() {
        advanceReview()
    }

    async function saveOne() {
        if (!reviewForm) return
        if (!reviewForm.name.trim()) {
            toast.error("Name required.")
            return
        }
        if (!reviewForm.category_name.trim()) {
            toast.error("Category required.")
            return
        }
        const basePrice = Number.parseFloat(reviewForm.base_price)
        if (!Number.isFinite(basePrice) || basePrice <= 0) {
            toast.error("Enter a valid price.")
            return
        }
        let salePrice: number | null = null
        if (reviewForm.sale_price.trim() !== "") {
            const sp = Number.parseFloat(reviewForm.sale_price)
            if (!Number.isFinite(sp) || sp <= 0 || sp >= basePrice) {
                toast.error("Sale price must be lower than the regular price.")
                return
            }
            salePrice = Number(sp.toFixed(2))
        }
        setSavingOne(true)
        try {
            // The Category select stores either a real category id
            // (existing tenant category) or `__new:<name>` for the
            // extracted-but-not-yet-created case. Both paths converge
            // on resolveCategoryId which does match-or-create.
            const rawCategory = reviewForm.category_name
            let categoryId: string
            if (rawCategory.startsWith("__new:")) {
                categoryId = await resolveCategoryId(rawCategory.slice("__new:".length))
            } else if (existingCategories.some((c) => c.id === rawCategory)) {
                categoryId = rawCategory
            } else {
                categoryId = await resolveCategoryId(rawCategory)
            }
            const payload = {
                tenant_id: tenantId,
                category_id: categoryId,
                name: reviewForm.name.trim(),
                description: reviewForm.description.trim() || null,
                base_price: basePrice,
                sale_price: salePrice,
                food_type: reviewForm.food_type,
                hsn_code: reviewForm.hsn_code.trim() || null,
                gst_slab: Number(reviewForm.gst_slab) || 0,
                is_tax_inclusive: reviewForm.is_tax_inclusive,
                is_active: reviewForm.is_active,
                is_sold_out: reviewForm.is_sold_out,
                prep_time_minutes: Number(reviewForm.prep_time_minutes) || 10,
                image_url: reviewForm.image_url,
            }
            const { error: itemErr } = await supabase.from("menu_items").insert(payload as never)
            if (itemErr) throw new Error(itemErr.message)
            // Prune the saved row from `sections` so the counter and
            // table stay truthful about what's still pending.
            setSections((prev) => prev.map((s) =>
                s.rowId === reviewForm.sectionId
                    ? { ...s, items: s.items.filter((it) => it.rowId !== reviewForm.itemId) }
                    : s,
            ))
            toast.success(`Saved "${reviewForm.name.trim()}"`)
            advanceReview()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Save failed")
        } finally {
            setSavingOne(false)
        }
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

                    {/* ── Sample format guide ──────────────────────────
                      * Shows new owners what an "ideal" menu image
                      * looks like (clear category headers + one item
                      * per line + price at the end) and reassures
                      * them that messier menus still work — they'll
                      * just need a quick review pass before saving. */}
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                                    Sample
                                </Badge>
                                <h3 className="text-sm font-semibold">
                                    Best results from menus that look like this
                                </h3>
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowSampleFormat((s) => !s)}
                            >
                                {showSampleFormat ? "Hide sample" : "Show sample"}
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground leading-snug">
                            Don&apos;t worry — we can still pull items from differently-formatted menus, fancy banners, or photos taken at an angle. Those just need a quick review and a few corrections before saving.
                        </p>
                        {showSampleFormat && (
                            <div className="grid md:grid-cols-[1fr_auto] gap-3 pt-1">
                                <pre className="rounded-md border border-border/60 bg-background p-3 font-mono text-[11px] leading-relaxed whitespace-pre overflow-x-auto">{`────────────────────────────
        STARTERS
────────────────────────────
Paneer Tikka              250
   Grilled cottage cheese
   in tandoori spices

Veg Spring Rolls          180
Chicken 65                220

────────────────────────────
        MAINS
────────────────────────────
Butter Chicken            380
Dal Makhani               220
Paneer Butter Masala      260
Veg Biryani               240`}</pre>
                                <ul className="text-[11px] text-muted-foreground space-y-1.5 leading-snug max-w-[260px]">
                                    <li className="flex gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" /><span>One clear <strong>category heading</strong> per section (e.g. <em>Starters</em>, <em>Mains</em>).</span></li>
                                    <li className="flex gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" /><span>One item per line — <strong>name on the left, price at the end</strong>.</span></li>
                                    <li className="flex gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" /><span>Description indented or wrapped under the item name (optional).</span></li>
                                    <li className="flex gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" /><span>Plain dark text on a light background, photo taken straight-on.</span></li>
                                    <li className="flex gap-1.5"><AlertCircle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" /><span>Stylised fonts, watermarks behind text, or steep angles still work — just expect to fix a few rows.</span></li>
                                </ul>
                            </div>
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
              * mid-save and confusing the owner. Two actions:
              *   - Save all      → bulk-insert every item as-is.
              *   - Review & Save → walk through each item in a pre-filled
              *                     dialog so the OWNER can tweak first. */}
            {(stage === "review" || stage === "saving") && (
                <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/85 backdrop-blur-xl">
                    <div className="container mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                        <div className="text-xs text-muted-foreground">
                            {totalItems > 0
                                ? <>Ready to add <strong className="text-foreground">{totalItems}</strong> item{totalItems === 1 ? "" : "s"} to your menu.</>
                                : "Add at least one item to save."}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                onClick={startReview}
                                disabled={stage === "saving" || totalItems === 0}
                                title="Open each item in a pre-filled form to review before saving"
                            >
                                <Wand2 className="h-4 w-4" />
                                Review &amp; Save
                            </Button>
                            <Button
                                variant="neon"
                                onClick={save}
                                disabled={stage === "saving" || totalItems === 0}
                                title="Save every item as-is without reviewing"
                            >
                                {stage === "saving"
                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                    : <Save className="h-4 w-4" />}
                                Save all
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Review & Save dialog ─────────────────────────────────── */}
            <ReviewDialog
                open={reviewOpen}
                form={reviewForm}
                index={reviewIndex}
                total={reviewQueue.length}
                saving={savingOne}
                tenantId={tenantId}
                tenantCountry={tenantCountry}
                taxCfg={taxCfg}
                tenantCustomRates={tenantCustomRates}
                hsnCodes={hsnCodes}
                existingCategories={existingCategories}
                onClose={() => {
                    if (savingOne) return
                    setReviewOpen(false)
                    setReviewForm(null)
                }}
                onChange={(patch) => setReviewForm((prev) => prev ? { ...prev, ...patch } : prev)}
                onSkip={skipReview}
                onSave={saveOne}
            />
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
    // Reactive food-type strip — recomputed each render from the
    // current items, so the moment the OWNER flips an item's
    // food_type (or removes the last veg row) the corresponding
    // dot appears or disappears from the header.
    const presentFoodTypes = FOOD_TYPES.filter((f) =>
        section.items.some((it) => it.food_type === f.value),
    )
    return (
        <div className="rounded-xl border border-border/60 overflow-hidden shadow-sm">
            {/* Header bar — stronger contrast + bigger title field so
              * category boundaries are unmistakable in a long list of
              * sections. A primary-tinted left edge gives each card a
              * clear vertical anchor. */}
            <div className="relative flex items-center justify-between gap-3 p-4 bg-gradient-to-r from-primary/[0.06] via-muted/40 to-transparent border-b border-border/50 flex-wrap">
                <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-primary to-[hsl(var(--neon-magenta))]" />
                <div className="flex items-center gap-2 flex-1 min-w-[200px] pl-1">
                    <Input
                        value={section.name}
                        onChange={(e) => onRename(e.target.value)}
                        className="h-10 max-w-sm text-base font-semibold border-transparent bg-background/60 focus-visible:border-border focus-visible:bg-background"
                        placeholder="Category name"
                    />
                    <Badge variant="outline" className="text-[10px] shrink-0">
                        {section.items.length} item{section.items.length === 1 ? "" : "s"}
                    </Badge>
                    {/* Food-type presence dots. Hover/title spells out
                      * which type each dot stands for. Hidden when the
                      * section is empty — nothing to indicate yet. */}
                    {presentFoodTypes.length > 0 && (
                        <div
                            className="flex items-center gap-1 px-2 py-1 rounded-full bg-background/70 border border-border/60 shrink-0"
                            title={`Contains: ${presentFoodTypes.map((f) => f.label).join(", ")}`}
                            aria-label={`Food types in this category: ${presentFoodTypes.map((f) => f.label).join(", ")}`}
                        >
                            {presentFoodTypes.map((f) => (
                                <span
                                    key={f.value}
                                    className={cn("h-2.5 w-2.5 rounded-full", f.dot)}
                                    title={f.label}
                                    aria-hidden
                                />
                            ))}
                        </div>
                    )}
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
    const ft = FOOD_TYPES.find((f) => f.value === item.food_type)
    const ftDot = ft?.dot ?? "bg-muted"
    const ftLabel = ft?.label ?? "—"
    // Borderless-by-default styling shared across the inline-editable
    // text inputs. The border + background reveal on hover/focus so
    // the row reads like a polished menu listing at rest, and like a
    // form only when the OWNER actually clicks in to edit.
    const inlineInput = "border-transparent bg-transparent transition-colors hover:bg-background hover:border-border focus-visible:bg-background focus-visible:border-border"
    return (
        <li className={cn(
            "group relative px-4 py-3 transition-colors",
            "hover:bg-muted/20",
            item.is_sold_out && "opacity-70",
        )}>
            {/* ── Top row: Name on the left, Price on the right ──
              * The hero of each card. Big, bold, instantly scannable. */}
            <div className="flex items-start gap-3">
                <span
                    className={cn("h-3 w-3 rounded-full shrink-0 mt-3 ring-2 ring-background shadow-sm", ftDot)}
                    aria-hidden
                />
                <div className="flex-1 min-w-0">
                    <Input
                        value={item.name}
                        onChange={(e) => onChange({ name: e.target.value })}
                        className={cn("h-9 font-semibold text-base px-2 -mx-2", inlineInput)}
                        placeholder="Dish name"
                    />
                    <Input
                        value={item.description}
                        onChange={(e) => onChange({ description: e.target.value })}
                        className={cn("h-7 text-xs text-muted-foreground px-2 -mx-2 mt-0.5", inlineInput)}
                        placeholder="Short description (optional)"
                    />
                </div>
                {/* Price block — currency on the left, big mono number
                  * on the right. Sale-price preview slips in under it
                  * when set, with a live "% off" callout. */}
                <div className="shrink-0 text-right">
                    <div className="inline-flex items-baseline gap-0.5">
                        <span className="text-xs text-muted-foreground font-medium pb-1">{currency}</span>
                        <Input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            value={item.price}
                            onChange={(e) => onChange({ price: e.target.value })}
                            className={cn("h-9 w-24 text-right text-lg font-bold font-mono tabular-nums px-1", inlineInput)}
                            placeholder="0.00"
                        />
                    </div>
                    {(() => {
                        const base = Number.parseFloat(item.price)
                        const sale = Number.parseFloat(item.sale_price)
                        if (!item.sale_price.trim()) return null
                        if (!Number.isFinite(base) || base <= 0) return null
                        if (!Number.isFinite(sale) || sale <= 0 || sale >= base) return null
                        const pct = Math.round((1 - sale / base) * 100)
                        return (
                            <div className="text-[10px] text-success font-semibold mt-0.5">
                                Sale · {currency} {sale.toFixed(2)} · {pct}% off
                            </div>
                        )
                    })()}
                    {item.is_sold_out && (
                        <Badge variant="destructive" className="text-[10px] mt-0.5">Sold out</Badge>
                    )}
                </div>
            </div>

            {/* ── Bottom chip strip ──
              * All the metadata fields, compacted into a pill row so
              * they read as tags rather than form fields. flex-wrap
              * + ml-6 lines them up under the name (past the dot
              * gutter) so it feels like one connected block. */}
            <div className="flex items-center gap-1.5 flex-wrap mt-2 ml-6">
                {/* Food type — chip-shaped Select with the colour dot.
                  * The visible dot here is the live one driving the
                  * presence-summary up on the category header. */}
                <Select value={item.food_type} onValueChange={(v) => onChange({ food_type: v as FoodType })}>
                    <SelectTrigger className="h-7 w-auto text-xs rounded-full bg-card border-border/60 gap-1.5 px-2.5 hover:bg-muted/40 transition-colors">
                        <span className={cn("h-2 w-2 rounded-full shrink-0", ftDot)} aria-hidden />
                        <span>{ftLabel}</span>
                    </SelectTrigger>
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

                {/* Sale price — labelled chip with an inline input.
                  * The strikethrough/% preview happens up top under the
                  * main price; here we just expose the input. */}
                <div className="inline-flex items-center gap-1.5 h-7 rounded-full bg-card border border-border/60 px-2.5 text-xs hover:bg-muted/40 transition-colors">
                    <span className="text-muted-foreground font-medium">Sale</span>
                    <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={item.sale_price}
                        onChange={(e) => onChange({ sale_price: e.target.value })}
                        className="h-5 w-14 border-0 bg-transparent p-0 text-xs font-mono tabular-nums shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                        placeholder="—"
                    />
                </div>

                {/* Tax slab — India only. Outside India the field still
                  * exists in state (defaulted to 0) but isn't rendered
                  * so a US menu doesn't lie about a GST rate. */}
                {showTaxColumns && (
                    <Select value={item.gst_slab} onValueChange={(v) => onChange({ gst_slab: v })}>
                        <SelectTrigger className="h-7 w-auto text-xs rounded-full bg-card border-border/60 gap-1 px-2.5 hover:bg-muted/40 transition-colors">
                            <span className="text-muted-foreground font-medium">{taxShortName}</span>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {GST_SLABS.map((s) => (
                                <SelectItem key={s} value={s}>{s}%</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}

                {/* HSN code — India only. Chip with inline mono input. */}
                {tenantCountry === "IN" && (
                    <div className="inline-flex items-center gap-1.5 h-7 rounded-full bg-card border border-border/60 px-2.5 text-xs hover:bg-muted/40 transition-colors">
                        <span className="text-muted-foreground font-medium">HSN</span>
                        <Input
                            value={item.hsn_code}
                            onChange={(e) => onChange({ hsn_code: e.target.value })}
                            className="h-5 w-20 border-0 bg-transparent p-0 text-xs font-mono tabular-nums shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                            placeholder="996331"
                        />
                    </div>
                )}

                {/* Sold-out toggle — pill with destructive accent when
                  * on, neutral when off. Makes the active "off-menu"
                  * state immediately legible without a separate badge. */}
                <label
                    className={cn(
                        "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs cursor-pointer transition-colors select-none",
                        item.is_sold_out
                            ? "bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/15"
                            : "bg-card border-border/60 hover:bg-muted/40",
                    )}
                >
                    <input
                        type="checkbox"
                        checked={item.is_sold_out}
                        onChange={(e) => onChange({ is_sold_out: e.target.checked })}
                        className="h-3 w-3 accent-destructive cursor-pointer"
                    />
                    Sold out
                </label>

                {/* Delete — push to the far right; only visible on
                  * row hover / focus so the chip strip looks calm at
                  * rest and pops a clear destructive affordance the
                  * moment the OWNER mouses in. */}
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onRemove}
                    className="ml-auto h-7 px-2 text-destructive opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity hover:bg-destructive/10"
                    title="Remove item"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </Button>
            </div>
        </li>
    )
}

// ─────────────────────────────────────────────────────────────────────
// Section divider with label — same look as the menu-admin dialog so
// the OWNER feels at home during bulk review.
// ─────────────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 whitespace-nowrap">
                {children}
            </span>
            <div className="flex-1 h-px bg-border/50" />
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────
// Bordered toggle row — used for tax-inclusive / active / sold-out
// in the dialog. Same component as menu-admin's ToggleRow.
// ─────────────────────────────────────────────────────────────────────
function ToggleRow({
    label, hint, checked, onCheckedChange,
}: {
    label: string; hint: string; checked: boolean; onCheckedChange: (v: boolean) => void
}) {
    return (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
            <div className="min-w-0">
                <p className="text-sm font-medium leading-none">{label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
            </div>
            <Switch checked={checked} onCheckedChange={onCheckedChange} />
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────
// Per-item Review dialog. Visually identical to the menu-admin
// "New menu item" dialog (two-column layout, sectioned, pinned
// header + footer, scrollable body) so the OWNER sees a familiar
// shape during bulk review. The recommendations panel is omitted
// because newly-extracted items don't exist in the DB yet — the
// OWNER can add upsells back in /menu-admin once everything is in.
// The dialog itself is stateless — the parent drives `form` + emits
// patches on change so the index/queue logic stays in one place.
// ─────────────────────────────────────────────────────────────────────
function ReviewDialog({
    open, form, index, total, saving,
    tenantId, tenantCountry, taxCfg, tenantCustomRates, hsnCodes, existingCategories,
    onClose, onChange, onSkip, onSave,
}: {
    open: boolean
    form: ReviewForm | null
    index: number
    total: number
    saving: boolean
    tenantId: string
    tenantCountry: string | null
    taxCfg: CountryTaxConfig
    tenantCustomRates: number[]
    hsnCodes: HsnCode[]
    existingCategories: { id: string; name: string }[]
    onClose: () => void
    onChange: (patch: Partial<ReviewForm>) => void
    onSkip: () => void
    onSave: () => void
}) {
    if (!form) return null
    const basePrice = Number.parseFloat(form.base_price)
    const salePrice = Number.parseFloat(form.sale_price)
    const salePriceFeedback = (() => {
        if (!Number.isFinite(basePrice) || basePrice <= 0) return null
        if (!form.sale_price.trim()) return null
        if (!Number.isFinite(salePrice) || salePrice <= 0 || salePrice >= basePrice) {
            return <p className="mt-1 text-[11px] text-destructive">Must be lower than the regular price</p>
        }
        const pct = Math.round((1 - salePrice / basePrice) * 100)
        return <p className="mt-1 text-[11px] text-success">{pct}% off · saves {taxCfg.currency} {(basePrice - salePrice).toFixed(2)}</p>
    })()

    // Synthetic "Create new: <name>" entry for an extracted category
    // that hasn't been saved to the DB yet. Stored as `__new:<name>`
    // — the parent's saveOne detects the prefix.
    const newCategorySentinel = form.category_name.startsWith("__new:") ? form.category_name : null
    const newCategoryLabel = newCategorySentinel?.slice("__new:".length).trim() ?? ""

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
            <DialogContent className="flex flex-col w-full max-w-3xl max-h-[95dvh] overflow-hidden p-0 gap-0">

                {/* ── Header ── */}
                <DialogHeader className="shrink-0 px-6 pt-5 pb-4 border-b border-border/40">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <DialogTitle className="text-lg font-semibold">Review menu item</DialogTitle>
                        <Badge variant="outline" className="text-[10px]">
                            Item {index + 1} of {total}
                        </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                        Tweak the fields below and tap <strong>Save &amp; Next</strong>. Use <strong>Skip</strong> to leave this one for later — skipped items stay in the table.
                    </p>
                </DialogHeader>

                {/* ── Scrollable body (vertical only) ── */}
                <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-5 space-y-6">

                    {/* ══ ROW 1: Two-column grid ══ */}
                    <div className="grid grid-cols-1 md:grid-cols-2 md:gap-x-8">

                        {/* ── LEFT: Identity ── */}
                        <div className="space-y-4">
                            <SectionLabel>Identity</SectionLabel>

                            {/* Photo — centred, clearly its own block */}
                            <div className="flex flex-col items-center gap-1">
                                <ImageUploader
                                    label="Photo"
                                    hint="Auto-compressed · ~250 KB max"
                                    value={form.image_url}
                                    onChange={(url) => onChange({ image_url: url })}
                                    bucket="menu-images"
                                    path={tenantImagePath(tenantId, "menu-item", `ai-${form.itemId}`)}
                                    aspect="square" size={112} disabled={!tenantId}
                                />
                            </div>

                            {/* Name */}
                            <div className="space-y-1.5">
                                <Label>
                                    Name <span className="text-destructive text-xs">*</span>
                                </Label>
                                <Input
                                    value={form.name}
                                    onChange={(e) => onChange({ name: e.target.value })}
                                    placeholder="e.g. Paneer Butter Masala"
                                />
                            </div>

                            {/* Description */}
                            <div className="space-y-1.5">
                                <Label>Description</Label>
                                <Textarea
                                    value={form.description}
                                    onChange={(e) => onChange({ description: e.target.value })}
                                    placeholder="Short description shown on the QR menu…"
                                    rows={3}
                                    className="resize-none"
                                />
                            </div>
                        </div>

                        {/* ── RIGHT: Details ── */}
                        <div className="space-y-4 mt-6 md:mt-0">
                            <SectionLabel>Details</SectionLabel>

                            {/* Category + Food type */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5 min-w-0">
                                    <Label>
                                        Category <span className="text-destructive text-xs">*</span>
                                    </Label>
                                    <Select value={form.category_name} onValueChange={(v) => onChange({ category_name: v })}>
                                        <SelectTrigger className="w-full truncate">
                                            <SelectValue placeholder="Pick category" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {/* The "Create new" entry only appears when the
                                              * extracted section name doesn't already match
                                              * an existing tenant category. */}
                                            {newCategorySentinel && (
                                                <SelectItem value={newCategorySentinel}>
                                                    <span className="inline-flex items-center gap-1.5">
                                                        <Plus className="h-3 w-3 text-primary" />
                                                        Create &ldquo;{newCategoryLabel}&rdquo;
                                                    </span>
                                                </SelectItem>
                                            )}
                                            {existingCategories.map((c) => (
                                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5 min-w-0">
                                    <Label>Food type</Label>
                                    <Select value={form.food_type} onValueChange={(v) => onChange({ food_type: v as FoodType })}>
                                        <SelectTrigger className="w-full">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {FOOD_TYPES.map((f) => (
                                                <SelectItem key={f.value} value={f.value}>
                                                    <span className="flex items-center gap-2">
                                                        <span className={cn("h-2 w-2 rounded-full shrink-0", f.dot)} />
                                                        {f.label}
                                                    </span>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {/* Price + Sale price */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5 min-w-0">
                                    <Label>
                                        Price <span className="text-destructive text-xs">*</span>
                                    </Label>
                                    <Input
                                        type="number" step="0.01" min="0"
                                        value={form.base_price}
                                        onChange={(e) => onChange({ base_price: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-1.5 min-w-0">
                                    <Label className="flex items-baseline gap-1">
                                        Sale price
                                        <span className="text-[10px] text-muted-foreground/60 font-normal">(opt.)</span>
                                    </Label>
                                    <Input
                                        type="number" step="0.01" min="0" placeholder="—"
                                        value={form.sale_price}
                                        onChange={(e) => onChange({ sale_price: e.target.value })}
                                    />
                                    {salePriceFeedback}
                                </div>
                            </div>

                            {/* Tax rate + Prep time */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5 min-w-0">
                                    <Label>{taxCfg.taxShortName} rate</Label>
                                    <Select value={form.gst_slab} onValueChange={(v) => onChange({ gst_slab: v })}>
                                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {mergedTaxRates(taxCfg, {
                                                customRates: tenantCustomRates,
                                                include: [Number(form.gst_slab)],
                                            }).map((s) => (
                                                <SelectItem key={s} value={String(s)}>{s}%</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5 min-w-0">
                                    <Label>Prep time (min)</Label>
                                    <Input
                                        type="number" min="1"
                                        value={form.prep_time_minutes}
                                        onChange={(e) => onChange({ prep_time_minutes: e.target.value })}
                                    />
                                </div>
                            </div>

                            {/* HSN code — India only, full width so long descriptions don't overflow */}
                            {tenantCountry === "IN" && (
                                <div className="space-y-1.5">
                                    <Label>HSN / SAC code</Label>
                                    <Select value={form.hsn_code} onValueChange={(v) => onChange({ hsn_code: v })}>
                                        <SelectTrigger className="w-full truncate">
                                            <SelectValue placeholder="Pick HSN" />
                                        </SelectTrigger>
                                        <SelectContent position="popper" sideOffset={4}>
                                            {hsnCodes.map((h) => (
                                                <SelectItem key={h.code} value={h.code}>
                                                    <span className="font-mono text-xs mr-2">{h.code}</span>
                                                    <span className="text-muted-foreground">{h.description}</span>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            {/* Toggles */}
                            <div className="space-y-2">
                                <ToggleRow
                                    label="Tax inclusive"
                                    hint={`Price already includes ${taxCfg.taxShortName}.`}
                                    checked={form.is_tax_inclusive}
                                    onCheckedChange={(v) => onChange({ is_tax_inclusive: v })}
                                />
                                <ToggleRow
                                    label="Active"
                                    hint="Show on POS & QR menu."
                                    checked={form.is_active}
                                    onCheckedChange={(v) => onChange({ is_active: v })}
                                />
                                <ToggleRow
                                    label="Sold out"
                                    hint="Greyed out on the POS until you flip this off."
                                    checked={form.is_sold_out}
                                    onCheckedChange={(v) => onChange({ is_sold_out: v })}
                                />
                            </div>
                        </div>
                    </div>

                </div>{/* end scrollable body */}

                {/* ── Footer — always pinned at bottom ── */}
                <DialogFooter className="shrink-0 px-6 py-4 border-t border-border/40 bg-muted/5 flex-row justify-between sm:justify-between gap-2">
                    <Button type="button" variant="ghost" onClick={onSkip} disabled={saving}>
                        <SkipForward className="h-4 w-4" /> Skip
                    </Button>
                    <Button type="button" variant="neon" onClick={onSave} disabled={saving} className="min-w-36">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
                        {index + 1 === total ? "Save & Finish" : "Save & Next"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ImageIcon is imported as a fallback for future use (empty-state
// thumbnails etc.). The reference below stops the linter complaining.
void ImageIcon
