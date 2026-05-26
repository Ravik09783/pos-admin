"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import {
    AlertTriangle,
    ArrowDownToLine,
    ArrowUpFromLine,
    Boxes,
    Check,
    ChevronDown,
    ChevronRight,
    Clock,
    FileDown,
    History,
    Loader2,
    Pause,
    Pencil,
    Play,
    Plus,
    Scan,
    Search,
    ShieldCheck,
    Trash2,
    X,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { scopeQueryToBranch, useActiveBranch } from "@/lib/branch/active-branch"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import type { StockItem, StockMovement, StockMovementBatch, UserRole } from "@/types/database"

const UNITS = ["pcs", "kg", "g", "lt", "ml", "dozen", "pack", "box"]

const STATUS_VARIANT: Record<StockMovementBatch["status"], "warning" | "success" | "destructive"> = {
    PENDING: "warning",
    VERIFIED: "success",
    REJECTED: "destructive",
}

/** The three directions a single line can record. ADJUSTMENT is excluded
 *  from per-line toggle because it's rarely used in the mixed-batch flow;
 *  admins still record adjustments through the per-item history sheet. */
type LineDirection = "IN" | "OUT" | "WASTAGE"

const DIRECTIONS: { value: LineDirection; label: string; short: string; tone: "success" | "warning" | "destructive"; icon: typeof ArrowDownToLine }[] = [
    { value: "IN",      label: "Stock in",  short: "In",    tone: "success",     icon: ArrowDownToLine },
    { value: "OUT",     label: "Stock out", short: "Out",   tone: "warning",     icon: ArrowUpFromLine },
    { value: "WASTAGE", label: "Wastage",   short: "Waste", tone: "destructive", icon: Trash2 },
]

/** Empty draft line. New lines default to "IN" because ~80% of inventory
 *  entries on any given day are receipts; storekeepers receiving stock
 *  shouldn't have to click anything to confirm direction. */
const EMPTY_LINE: BatchLine = {
    stock_item_id: "", quantity: "1", unit_cost: "", reason: "", direction: "IN",
}

/** Page size for the per-item history drawer. Small enough that the
 *  storekeeper can scan the first page in one glance; "Load more"
 *  pages in another 10 at a time. */
const HISTORY_PAGE_SIZE = 10

interface BatchLine {
    stock_item_id: string
    quantity: string
    unit_cost: string
    reason: string
    /** Per-line movement direction. The submit handler groups lines by
     *  this and fires one `record_stock_batch` RPC per non-empty
     *  direction — so a single dialog submit can produce up to three
     *  batch rows (one IN, one OUT, one WASTAGE) without the user ever
     *  thinking about it. */
    direction: LineDirection
}

/** One row in the per-item history drawer — a stock_movement joined with
 *  its batch (for context: who recorded it, supplier, ref number) and the
 *  performed_by user (avatar + name). */
type HistoryRow = StockMovement & {
    batch?:
        | { id: string; type: string; reference_no: string | null; supplier: string | null; status: string }
        | { id: string; type: string; reference_no: string | null; supplier: string | null; status: string }[]
        | null
    performer?:
        | { id: string; full_name: string | null; email: string | null; avatar_url: string | null }
        | { id: string; full_name: string | null; email: string | null; avatar_url: string | null }[]
        | null
}

/** A batch row joined with biller + verifier user details so the audit
 *  log can show avatars + names without a second round-trip. */
type BatchRow = StockMovementBatch & {
    creator?: { id: string; full_name: string | null; email: string | null; avatar_url: string | null } | { id: string; full_name: string | null; email: string | null; avatar_url: string | null }[] | null
    verifier?: { id: string; full_name: string | null; email: string | null; avatar_url: string | null } | { id: string; full_name: string | null; email: string | null; avatar_url: string | null }[] | null
}

function pickOne<T>(v: T | T[] | null | undefined): T | null {
    if (Array.isArray(v)) return v[0] ?? null
    return v ?? null
}

export default function InventoryPage() {
    const supabase = createClient()
    const [tenantId, setTenantId] = useState("")
    const [currentUserId, setCurrentUserId] = useState("")
    const [currentUserRole, setCurrentUserRole] = useState<UserRole | null>(null)
    const isAdmin = currentUserRole === "OWNER" || currentUserRole === "MANAGER"
    const [items, setItems] = useState<StockItem[]>([])
    const [batches, setBatches] = useState<BatchRow[]>([])
    /** Map batch_id → child movement rows so the expander can render
     *  line-items without a per-row fetch. */
    const [batchLines, setBatchLines] = useState<Map<string, (StockMovement & { stock_items?: { name: string; unit: string } | null })[]>>(new Map())

    const [itemOpen, setItemOpen] = useState(false)
    const [itemForm, setItemForm] = useState({
        name: "", sku: "", barcode: "", unit: "kg", current_stock: "0", reorder_level: "0", cost_price: "0",
        hsn_code: "", notes: "",
    })
    /** When set, the item dialog is in EDIT mode for that id. */
    const [editingItemId, setEditingItemId] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const { activeBranchId } = useActiveBranch()

    /** Free-text filter across name / sku / barcode for the items table. */
    const [itemSearch, setItemSearch] = useState("")
    /** When false (the default), paused items are hidden from the items
     *  table. Toggling on lets the owner see the full catalogue including
     *  items the restaurant is no longer using. */
    const [showPaused, setShowPaused] = useState(false)
    /** Item being paused/resumed via the confirmation dialog. */
    const [pauseTarget, setPauseTarget] = useState<StockItem | null>(null)
    /** Negative-stock warnings collected during batch submit (item names). */
    const [negativeWarnings, setNegativeWarnings] = useState<string[]>([])
    /** Item the storekeeper scanned that's currently paused — they get a
     *  one-tap "Resume and add" prompt instead of failing silently. */
    const [resumePromptItem, setResumePromptItem] = useState<StockItem | null>(null)

    // Multi-line batch dialog state. Direction was previously a single
    // value for the whole batch (top-of-dialog "Type" select); now each
    // line carries its own direction, which lets one dialog submit mix
    // IN + OUT + WASTAGE in a single user action. See submitBatch().
    const [batchOpen, setBatchOpen] = useState(false)
    const [batchSupplier, setBatchSupplier] = useState("")
    const [batchRefNo, setBatchRefNo] = useState("")
    const [batchNotes, setBatchNotes] = useState("")
    const [batchLinesDraft, setBatchLinesDraft] = useState<BatchLine[]>([])
    /** Text in the scan/search input at the top of the batch dialog.
     *  When a barcode scanner is used, this fills + fires Enter on its
     *  own (HID-keyboard behavior). When the storekeeper types manually,
     *  same input doubles as a fuzzy name search. */
    const [scanInput, setScanInput] = useState("")
    /** "Unknown barcode" prompt — when set, the inline mini-dialog opens
     *  with this code pre-filled so the storekeeper can register the new
     *  item in one tap and have it auto-added to the current batch. */
    const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null)

    // Drill-down state for the batches table.
    const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null)
    const [rejectOpen, setRejectOpen] = useState<BatchRow | null>(null)
    const [rejectReason, setRejectReason] = useState("")

    // Per-item history drawer state. Holds the selected item + its
    // movement page; pages of 10 are fetched on demand.
    const [historyItem, setHistoryItem] = useState<StockItem | null>(null)
    const [historyRows, setHistoryRows] = useState<HistoryRow[]>([])
    const [historyHasMore, setHistoryHasMore] = useState(false)
    const [historyLoading, setHistoryLoading] = useState(false)

    async function refresh() {
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) return
        const { data: row } = await supabase.from("users").select("tenant_id, role").eq("id", u.user.id).maybeSingle()
        if (!row?.tenant_id) return
        setTenantId(row.tenant_id)
        setCurrentUserId(u.user.id)
        setCurrentUserRole((row as { role?: UserRole } | null)?.role ?? null)

        let itemsQ = supabase.from("stock_items").select("*").is("deleted_at", null).order("name")
        itemsQ = scopeQueryToBranch(itemsQ, activeBranchId)

        // Last 50 batches, joined with creator + verifier user rows so
        // the audit panel can render avatars without N+1 fetches.
        let batchesQ = supabase
            .from("stock_movement_batches")
            .select(`
                *,
                creator:users!stock_movement_batches_created_by_fkey(id, full_name, email, avatar_url),
                verifier:users!stock_movement_batches_verified_by_fkey(id, full_name, email, avatar_url)
            `)
            .order("created_at", { ascending: false })
            .limit(50)
        batchesQ = scopeQueryToBranch(batchesQ, activeBranchId)

        const [{ data: its }, { data: bs }] = await Promise.all([itemsQ, batchesQ])
        setItems((its ?? []) as StockItem[])
        setBatches((bs ?? []) as unknown as BatchRow[])
    }
    useEffect(() => { refresh() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeBranchId])

    /** Lazy-load a batch's line items when the user expands it. Cached
     *  so re-expanding doesn't re-fetch. */
    async function ensureBatchLines(batchId: string) {
        if (batchLines.has(batchId)) return
        const { data } = await supabase
            .from("stock_movements")
            .select("*, stock_items:stock_item_id(name, unit)")
            .eq("batch_id", batchId)
            .order("created_at")
        const next = new Map(batchLines)
        next.set(batchId, (data ?? []) as (StockMovement & { stock_items?: { name: string; unit: string } | null })[])
        setBatchLines(next)
    }

    function toggleExpand(batchId: string) {
        if (expandedBatchId === batchId) {
            setExpandedBatchId(null)
        } else {
            setExpandedBatchId(batchId)
            void ensureBatchLines(batchId)
        }
    }

    function openAddItem() {
        setEditingItemId(null)
        setItemForm({
            name: "", sku: "", barcode: "", unit: "kg", current_stock: "0",
            reorder_level: "0", cost_price: "0", hsn_code: "", notes: "",
        })
        setItemOpen(true)
    }
    function openEditItem(it: StockItem) {
        setEditingItemId(it.id)
        setItemForm({
            name: it.name,
            sku: it.sku ?? "",
            barcode: it.barcode ?? "",
            unit: it.unit,
            current_stock: String(Number(it.current_stock) || 0),
            reorder_level: String(Number(it.reorder_level) || 0),
            cost_price: String(Number(it.cost_price) || 0),
            hsn_code: it.hsn_code ?? "",
            notes: it.notes ?? "",
        })
        setItemOpen(true)
    }
    async function saveItem(e: React.FormEvent) {
        e.preventDefault()
        if (!itemForm.name.trim()) return toast.error("Name required")
        setBusy(true)
        const payload = {
            name: itemForm.name.trim(),
            sku: itemForm.sku.trim() || null,
            barcode: itemForm.barcode.trim() || null,
            unit: itemForm.unit,
            reorder_level: Number(itemForm.reorder_level) || 0,
            cost_price: Number(itemForm.cost_price) || 0,
            hsn_code: itemForm.hsn_code.trim() || null,
            notes: itemForm.notes.trim() || null,
        }
        const { error } = editingItemId
            ? await supabase.from("stock_items").update(payload as never).eq("id", editingItemId)
            : await supabase
                .from("stock_items")
                .insert({
                    ...payload,
                    tenant_id: tenantId,
                    current_stock: Number(itemForm.current_stock) || 0,
                    branch_id: activeBranchId,
                } as never)
        setBusy(false)
        if (error) {
            // Surface the per-tenant barcode uniqueness violation in plain English.
            if (/uniq_stock_items_barcode|duplicate key/i.test(error.message)) {
                return toast.error("That barcode is already linked to another item.")
            }
            return toast.error(error.message)
        }
        toast.success(editingItemId ? "Stock item updated" : "Stock item added")
        setItemOpen(false)
        setEditingItemId(null)
        refresh()
    }

    function openBatch() {
        setBatchSupplier("")
        setBatchRefNo("")
        setBatchNotes("")
        setBatchLinesDraft([])
        setScanInput("")
        setNegativeWarnings([])
        setBatchOpen(true)
    }

    function addLineRow() {
        setBatchLinesDraft((prev) => [...prev, { ...EMPTY_LINE }])
        setNegativeWarnings([])
    }
    function removeLineRow(idx: number) {
        setBatchLinesDraft((prev) => prev.filter((_, i) => i !== idx))
        setNegativeWarnings([])
    }
    function updateLine(idx: number, patch: Partial<BatchLine>) {
        setBatchLinesDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
        // Any line edit could invalidate the previously-staged negative
        // warnings; clear them so the next submit re-checks fresh.
        if (negativeWarnings.length > 0) setNegativeWarnings([])
    }

    /** Scanner-driven add. Used by the "Scan or search" input at the top
     *  of the batch dialog. Looks up the typed/scanned value against
     *  barcode first, then by case-insensitive name match. On hit, the
     *  existing line for that item is incremented (so re-scanning the
     *  same barcode bumps the quantity — the POS-style flow). On miss,
     *  prompts the storekeeper to register a new item with the scanned
     *  code pre-filled. */
    async function onScanSubmit() {
        const raw = scanInput.trim()
        if (!raw) return
        // Look up by barcode first (exact match), then by name (case-insensitive).
        // Both queries are tenant-scoped via RLS.
        const { data: byBarcode } = await supabase
            .from("stock_items")
            .select("*")
            .eq("barcode", raw)
            .is("deleted_at", null)
            .maybeSingle()
        let match = byBarcode as StockItem | null
        if (!match) {
            const { data: byName } = await supabase
                .from("stock_items")
                .select("*")
                .ilike("name", raw)
                .is("deleted_at", null)
                .limit(1)
            match = ((byName ?? []) as StockItem[])[0] ?? null
        }
        if (!match) {
            // Unknown — open the "register new item" inline dialog with
            // the barcode pre-filled. Most scanners produce all-digit
            // barcodes, so heuristically: if it's all digits, treat it
            // as a barcode; otherwise leave the SKU blank.
            const looksLikeBarcode = /^\d{6,}$/.test(raw)
            setUnknownBarcode(looksLikeBarcode ? raw : "")
            if (!looksLikeBarcode) {
                // Pre-fill the new item's name with whatever was typed,
                // so the storekeeper just confirms qty/unit and saves.
                setItemForm({
                    name: raw,
                    sku: "",
                    barcode: "",
                    unit: "kg",
                    current_stock: "0",
                    reorder_level: "0",
                    cost_price: "0",
                    hsn_code: "",
                    notes: "",
                })
            } else {
                setItemForm({
                    name: "",
                    sku: "",
                    barcode: raw,
                    unit: "kg",
                    current_stock: "0",
                    reorder_level: "0",
                    cost_price: "0",
                    hsn_code: "",
                    notes: "",
                })
            }
            setScanInput("")
            return
        }
        // Paused (is_active=false)? Don't silently add to the batch — that
        // would defeat the point of pausing. Ask the storekeeper to resume
        // it first; one tap brings it back and adds the line.
        if (match.is_active === false) {
            setResumePromptItem(match)
            setScanInput("")
            return
        }
        // Hit — bump qty if this item is already in the batch, else add.
        const itemId = match.id
        setBatchLinesDraft((prev) => {
            const idx = prev.findIndex((l) => l.stock_item_id === itemId)
            if (idx >= 0) {
                const copy = [...prev]
                const cur = copy[idx]!
                const nextQty = (Number(cur.quantity) || 0) + 1
                copy[idx] = { ...cur, quantity: String(nextQty) }
                return copy
            }
            return [...prev, {
                stock_item_id: itemId,
                quantity: "1",
                unit_cost: String(Number(match!.cost_price) || ""),
                reason: "",
                direction: "IN",
            }]
        })
        setScanInput("")
        toast.success(`Added: ${match.name}`)
    }

    /** Save the "new item from scan" inline dialog, then add a line to
     *  the active batch for that newly-created item. One round-trip
     *  (insert returning *), no refresh needed for the items dropdown
     *  state because the next refresh() call after batch submit will
     *  re-pull the table anyway. */
    async function saveItemFromScan(e: React.FormEvent) {
        e.preventDefault()
        if (!itemForm.name.trim()) return toast.error("Name required")
        setBusy(true)
        const { data, error } = await supabase
            .from("stock_items")
            .insert({
                tenant_id: tenantId,
                name: itemForm.name.trim(),
                sku: itemForm.sku.trim() || null,
                barcode: itemForm.barcode.trim() || null,
                unit: itemForm.unit,
                current_stock: 0,
                reorder_level: Number(itemForm.reorder_level) || 0,
                cost_price: Number(itemForm.cost_price) || 0,
                branch_id: activeBranchId,
            } as never)
            .select("*")
            .single()
        setBusy(false)
        if (error || !data) {
            if (/uniq_stock_items_barcode|duplicate key/i.test(error?.message ?? "")) {
                return toast.error("That barcode is already in use for this restaurant.")
            }
            return toast.error(error?.message ?? "Couldn't create item")
        }
        const created = data as StockItem
        // Add it as a line in the batch with qty 1, cost from the form.
        setBatchLinesDraft((prev) => [
            ...prev,
            {
                stock_item_id: created.id,
                quantity: "1",
                unit_cost: String(Number(created.cost_price) || ""),
                reason: "",
                direction: "IN",
            },
        ])
        setItems((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
        setUnknownBarcode(null)
        toast.success(`Created ${created.name} — added to batch`)
    }

    /** Toggle pause/resume on a stock item. "Paused" means the restaurant
     *  isn't currently using it — the row stays put with full history but
     *  is hidden from the low-stock alert, dimmed in the items table, and
     *  removed from the new-batch dropdown so nobody adds movements to a
     *  thing they don't sell. One tap resumes it. */
    async function togglePause(it: StockItem) {
        const nextActive = !it.is_active
        const { error } = await supabase
            .from("stock_items")
            .update({ is_active: nextActive } as never)
            .eq("id", it.id)
        if (error) return toast.error(error.message)
        toast.success(nextActive ? `${it.name} resumed` : `${it.name} paused — no longer counted toward low stock`)
        setPauseTarget(null)
        refresh()
    }

    /** Storekeeper scanned a paused item — confirm one-tap resume + add
     *  to the active batch. Returns when the item is back to is_active=true. */
    async function resumeAndAddToBatch(it: StockItem) {
        const { error } = await supabase
            .from("stock_items")
            .update({ is_active: true } as never)
            .eq("id", it.id)
        if (error) return toast.error(error.message)
        // Add to the batch as if it were a fresh scan hit.
        setBatchLinesDraft((prev) => {
            const idx = prev.findIndex((l) => l.stock_item_id === it.id)
            if (idx >= 0) {
                const copy = [...prev]
                const cur = copy[idx]!
                copy[idx] = { ...cur, quantity: String((Number(cur.quantity) || 0) + 1) }
                return copy
            }
            return [...prev, {
                stock_item_id: it.id,
                quantity: "1",
                unit_cost: String(Number(it.cost_price) || ""),
                reason: "",
                direction: "IN",
            }]
        })
        setResumePromptItem(null)
        toast.success(`Resumed ${it.name} and added to batch`)
        refresh()
    }

    /** CSV export of the visible items list. Includes all useful columns
     *  the accountant typically asks for — name, SKU, barcode, current
     *  stock, reorder level, cost, status. Respects the current search +
     *  show-paused filter so the export matches what's on screen. */
    function exportItemsCsv() {
        const rows = filteredItems
        if (rows.length === 0) return toast.error("Nothing to export")
        const header = ["Name", "SKU", "Barcode", "Unit", "Current stock", "Reorder level", "Cost / unit", "HSN", "Status", "Notes"]
        const csvCell = (v: string | number | null | undefined) => {
            const s = String(v ?? "")
            if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
            return s
        }
        const lines = [
            header.join(","),
            ...rows.map((it) => [
                it.name,
                it.sku ?? "",
                it.barcode ?? "",
                it.unit,
                Number(it.current_stock),
                Number(it.reorder_level),
                Number(it.cost_price),
                it.hsn_code ?? "",
                it.is_active ? "Active" : "Paused",
                it.notes ?? "",
            ].map(csvCell).join(",")),
        ]
        const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `stock-items_${new Date().toISOString().slice(0, 10)}.csv`
        document.body.appendChild(a); a.click(); a.remove()
        URL.revokeObjectURL(url)
        toast.success(`Exported ${rows.length} item${rows.length === 1 ? "" : "s"}`)
    }

    /** Opens the per-item history drawer and fetches the first page. */
    async function openHistory(it: StockItem) {
        setHistoryItem(it)
        setHistoryRows([])
        setHistoryHasMore(false)
        setHistoryLoading(true)
        await fetchHistoryPage(it.id, 0)
    }
    async function fetchHistoryPage(itemId: string, offset: number) {
        setHistoryLoading(true)
        const { data } = await supabase
            .from("stock_movements")
            .select(`
                *,
                batch:stock_movement_batches(id, type, reference_no, supplier, status),
                performer:users!stock_movements_performed_by_fkey(id, full_name, email, avatar_url)
            `)
            .eq("stock_item_id", itemId)
            .order("created_at", { ascending: false })
            .range(offset, offset + HISTORY_PAGE_SIZE)
        // We over-fetch by 1 to know if there's a next page without a
        // second count query — peel that extra row off if present.
        const rows = (data ?? []) as unknown as HistoryRow[]
        const hasMore = rows.length > HISTORY_PAGE_SIZE
        setHistoryRows((prev) => [...prev, ...(hasMore ? rows.slice(0, HISTORY_PAGE_SIZE) : rows)])
        setHistoryHasMore(hasMore)
        setHistoryLoading(false)
    }
    function loadMoreHistory() {
        if (!historyItem || historyLoading) return
        void fetchHistoryPage(historyItem.id, historyRows.length)
    }
    function closeHistory() {
        setHistoryItem(null)
        setHistoryRows([])
        setHistoryHasMore(false)
    }

    /** Running total for the batch — line.quantity × line.unit_cost summed.
     *  Useful for IN (purchase total) and for the cashier to sanity-check
     *  before submitting against the supplier's invoice. */
    const batchTotal = useMemo(() => {
        return batchLinesDraft.reduce((s, l) => {
            const q = Number(l.quantity)
            const u = Number(l.unit_cost)
            if (Number.isFinite(q) && Number.isFinite(u)) return s + q * u
            return s
        }, 0)
    }, [batchLinesDraft])

    async function submitBatch(e: React.FormEvent) {
        e.preventDefault()
        // Build the valid line set, carrying direction through. Lines
        // with missing item or zero qty get filtered (most common cause
        // of a "nothing happened" silent failure on first build).
        const validLines = batchLinesDraft
            .map((l) => ({
                stock_item_id: l.stock_item_id,
                quantity: Number(l.quantity),
                unit_cost: Number(l.unit_cost) || 0,
                reason: l.reason.trim() || null,
                direction: l.direction,
            }))
            .filter((l) => l.stock_item_id && Number.isFinite(l.quantity) && l.quantity > 0)

        if (validLines.length === 0) {
            return toast.error("Add at least one valid line (item + quantity)")
        }

        // Reject duplicate stock_item_ids WITHIN THE SAME DIRECTION.
        // Different directions for the same item are fine — that's a
        // legit "receive 10, immediately mark 1 spoiled" workflow.
        const seenPerDirection = new Map<LineDirection, Set<string>>()
        for (const l of validLines) {
            const set = seenPerDirection.get(l.direction) ?? new Set<string>()
            if (set.has(l.stock_item_id)) {
                const dirLabel = DIRECTIONS.find((d) => d.value === l.direction)?.label ?? l.direction
                return toast.error(`Same item appears twice in "${dirLabel}" — combine the rows`)
            }
            set.add(l.stock_item_id)
            seenPerDirection.set(l.direction, set)
        }

        // Negative-stock pre-flight across every OUT + WASTAGE line.
        // Surfacing this once on the first submit, then clearing on
        // confirm, is the "second click required" pattern that lets
        // a storekeeper proceed when the negative is legitimate (e.g.
        // physical-count adjustment after a long-running undercount).
        const outLines = validLines.filter((l) => l.direction === "OUT" || l.direction === "WASTAGE")
        const negatives: string[] = []
        const projectedDeduction = new Map<string, number>()
        for (const l of outLines) {
            projectedDeduction.set(l.stock_item_id, (projectedDeduction.get(l.stock_item_id) ?? 0) + l.quantity)
        }
        for (const [itemId, qty] of projectedDeduction) {
            const item = items.find((i) => i.id === itemId)
            if (!item) continue
            const projected = Number(item.current_stock) - qty
            if (projected < 0) {
                negatives.push(`${item.name} (have ${Number(item.current_stock)} ${item.unit}, removing ${qty})`)
            }
        }
        if (negatives.length > 0 && negativeWarnings.length === 0) {
            setNegativeWarnings(negatives)
            return toast.warning(
                `${negatives.length} item${negatives.length === 1 ? " would go" : "s would go"} below zero — review and click Record again to confirm.`,
            )
        }

        // ── Dispatch one RPC per direction with lines ──────────────────
        // Each direction becomes its own `stock_movement_batches` row,
        // each requiring verification separately. That's intentional:
        // a manager OK-ing today's receipts is a different decision
        // than OK-ing today's wastage; keeping them as separate batches
        // makes the audit trail cleaner and lets either be rejected
        // without blocking the other.
        setBusy(true)
        const byDirection = new Map<LineDirection, typeof validLines>()
        for (const l of validLines) {
            const arr = byDirection.get(l.direction) ?? []
            arr.push(l)
            byDirection.set(l.direction, arr)
        }

        const results: { direction: LineDirection; ok: boolean; lines: number; error?: string }[] = []
        for (const [direction, lines] of byDirection) {
            // Strip the direction field — the RPC takes lines without it
            // (the p_type arg above the array is the direction signal).
            const payload = lines.map(({ direction: _d, ...rest }) => rest)
            const { data, error } = await supabase.rpc("record_stock_batch" as never, {
                p_type: direction,
                p_branch_id: activeBranchId,
                p_reference_no: batchRefNo.trim() || null,
                p_supplier: direction === "IN" ? (batchSupplier.trim() || null) : null,
                p_notes: batchNotes.trim() || null,
                p_lines: payload,
            } as never)
            if (error) {
                results.push({ direction, ok: false, lines: lines.length, error: error.message })
                continue
            }
            const r = data as { ok?: boolean; lines?: number } | null
            results.push({ direction, ok: true, lines: r?.lines ?? lines.length })
        }
        setBusy(false)

        const failed = results.filter((r) => !r.ok)
        const succeeded = results.filter((r) => r.ok)
        if (failed.length > 0 && succeeded.length === 0) {
            return toast.error(`Couldn't record any batch — ${failed[0]?.error ?? "unknown error"}`)
        }
        if (failed.length > 0) {
            toast.warning(
                `Recorded ${succeeded.length} of ${results.length} batches. Failures: ${failed.map((f) => f.direction).join(", ")}. Check console.`,
            )
            // eslint-disable-next-line no-console
            console.error("Partial batch failure", failed)
        } else {
            const totalLines = succeeded.reduce((s, r) => s + r.lines, 0)
            const parts = succeeded.map((r) => `${r.lines} ${r.direction.toLowerCase()}`).join(" · ")
            toast.success(`Recorded ${totalLines} line${totalLines === 1 ? "" : "s"} (${parts}) — awaiting verification.`)
        }
        setBatchOpen(false)
        setNegativeWarnings([])
        refresh()
    }

    async function verifyBatch(b: BatchRow) {
        if (!confirm(`Verify this ${b.type} batch? Stock has already been updated; this records your sign-off.`)) return
        setBusy(true)
        const { error } = await supabase.rpc("verify_stock_batch" as never, { p_batch_id: b.id } as never)
        setBusy(false)
        if (error) {
            // Surface the segregation-of-duties message clearly.
            if (/creator_cannot_verify/i.test(error.message)) {
                return toast.error("You created this batch — a different manager must verify it.")
            }
            return toast.error(error.message)
        }
        toast.success("Batch verified")
        refresh()
    }

    function openReject(b: BatchRow) {
        setRejectOpen(b)
        setRejectReason("")
    }
    async function confirmReject(e: React.FormEvent) {
        e.preventDefault()
        if (!rejectOpen) return
        if (rejectReason.trim().length < 3) return toast.error("Reason required (min 3 chars)")
        setBusy(true)
        const { error } = await supabase.rpc("reject_stock_batch" as never, {
            p_batch_id: rejectOpen.id,
            p_reason: rejectReason.trim(),
        } as never)
        setBusy(false)
        if (error) {
            if (/creator_cannot_reject/i.test(error.message)) {
                return toast.error("You created this batch — a different manager must reject it.")
            }
            return toast.error(error.message)
        }
        toast.success("Batch rejected — stock changes reversed")
        setRejectOpen(null)
        refresh()
    }

    async function archive(it: StockItem) {
        if (!confirm(`Archive ${it.name}?`)) return
        const { error } = await supabase.from("stock_items").update({ deleted_at: new Date().toISOString() } as never).eq("id", it.id)
        if (error) return toast.error(error.message)
        refresh()
    }

    // Low-stock alert excludes paused items — the whole point of pausing
    // ketchup is that we don't want a daily "ketchup is low" nag for an
    // item we're not currently using.
    const lowStock = items.filter((i) =>
        i.is_active &&
        Number(i.current_stock) <= Number(i.reorder_level) &&
        Number(i.reorder_level) > 0,
    )

    /** Active (non-paused) items only — used by the batch dropdown and
     *  the scan-fallback search inside the batch dialog so paused items
     *  don't sneak back in as new movements without an explicit resume. */
    const activeItems = useMemo(() => items.filter((i) => i.is_active), [items])

    /** Case-insensitive filter across name / sku / barcode. Empty search
     *  passes everything through. Used to render the items table — keeps
     *  the storekeeper sane when the inventory grows past one screen.
     *  Paused items are hidden by default; flip the toggle in the header
     *  to include them. */
    const filteredItems = useMemo(() => {
        const q = itemSearch.trim().toLowerCase()
        return items.filter((it) => {
            if (!showPaused && !it.is_active) return false
            if (!q) return true
            return (
                it.name.toLowerCase().includes(q) ||
                (it.sku ?? "").toLowerCase().includes(q) ||
                (it.barcode ?? "").toLowerCase().includes(q)
            )
        })
    }, [items, itemSearch, showPaused])

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-6">
            <PageHeader
                kicker="Catalog"
                title="Inventory"
                highlight="stock"
                description="Stock items with audited batch movements."
                actions={
                    <>
                        <Button variant="outline" onClick={openBatch} disabled={items.length === 0}>
                            <ArrowDownToLine className="h-4 w-4" /> New batch
                        </Button>
                        <Button variant="neon" onClick={openAddItem}><Plus className="h-4 w-4" /> Add stock item</Button>
                    </>
                }
            />

            {lowStock.length > 0 && (
                <Card className="border-warning/40 bg-warning/5">
                    <CardContent className="py-3 flex items-center gap-3">
                        <AlertTriangle className="h-5 w-5 text-warning" />
                        <div className="flex-1 text-sm">
                            <span className="font-semibold">{lowStock.length} item{lowStock.length > 1 ? "s" : ""} below reorder level:</span>{" "}
                            {lowStock.map((i) => i.name).join(", ")}
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader className="flex-row items-center justify-between py-3 space-y-0 gap-3 flex-wrap">
                    <CardTitle className="text-base shrink-0">Stock items</CardTitle>
                    <div className="relative flex-1 min-w-[180px] max-w-xs">
                        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            value={itemSearch}
                            onChange={(e) => setItemSearch(e.target.value)}
                            placeholder="Filter by name, SKU, barcode…"
                            className="pl-8 h-9"
                        />
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-muted-foreground hover:text-foreground transition-colors">
                            <input
                                type="checkbox"
                                checked={showPaused}
                                onChange={(e) => setShowPaused(e.target.checked)}
                                className="h-3.5 w-3.5 accent-primary"
                            />
                            Show paused
                        </label>
                        <Button variant="outline" size="sm" onClick={exportItemsCsv} disabled={filteredItems.length === 0}>
                            <FileDown className="h-3.5 w-3.5" /> Export CSV
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="px-0">
                    {filteredItems.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <Boxes className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            {items.length === 0 ? "No items yet." : "No items match the filter."}
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>SKU / Barcode</TableHead>
                                    <TableHead className="text-right">Current</TableHead>
                                    <TableHead className="text-right">Reorder at</TableHead>
                                    <TableHead className="text-right">Cost</TableHead>
                                    <TableHead className="text-right w-[110px]">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredItems.map((it) => {
                                    const paused = !it.is_active
                                    // Low-stock styling only when the item is actually active —
                                    // a paused item below reorder is fine, we don't care.
                                    const low = it.is_active && Number(it.current_stock) <= Number(it.reorder_level) && Number(it.reorder_level) > 0
                                    return (
                                        <TableRow
                                            key={it.id}
                                            className={cn(
                                                low && "bg-warning/5",
                                                paused && "opacity-60",
                                            )}
                                        >
                                            <TableCell className="font-medium">
                                                <button
                                                    type="button"
                                                    onClick={() => openHistory(it)}
                                                    className="text-left hover:text-primary hover:underline underline-offset-4 transition-colors inline-flex items-center gap-1.5"
                                                    title="See movement history"
                                                >
                                                    {it.name}
                                                    <History className="h-3 w-3 opacity-40" />
                                                </button>
                                                {paused && (
                                                    <Badge variant="secondary" className="ml-2 text-[10px] gap-1 align-middle">
                                                        <Pause className="h-2.5 w-2.5" /> Paused
                                                    </Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">
                                                <div>{it.sku ?? "—"}</div>
                                                {it.barcode && (
                                                    <div className="text-[10px] text-muted-foreground">⌷ {it.barcode}</div>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <span className={low ? "text-warning font-semibold" : ""}>{Number(it.current_stock)} {it.unit}</span>
                                            </TableCell>
                                            <TableCell className="text-right text-sm text-muted-foreground">{Number(it.reorder_level)} {it.unit}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(it.cost_price)}</TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1 justify-end">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className={cn("h-7 w-7", paused ? "text-success" : "text-muted-foreground")}
                                                        onClick={() => setPauseTarget(it)}
                                                        aria-label={paused ? "Resume" : "Pause"}
                                                        title={paused ? "Resume — restaurant is using this again" : "Pause — restaurant has stopped using this"}
                                                    >
                                                        {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                                                    </Button>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditItem(it)} aria-label="Edit" title="Edit">
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => archive(it)} aria-label="Archive" title="Archive">
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* ── Audit-tracked stock batches ──────────────────────────── */}
            <Card>
                <CardHeader className="flex-row items-center justify-between py-3 space-y-0">
                    <CardTitle className="text-base">Stock batches</CardTitle>
                    <span className="text-xs text-muted-foreground">
                        Click a row to see line items. Verify or reject from the row actions.
                    </span>
                </CardHeader>
                <CardContent className="px-0">
                    {batches.length === 0 ? (
                        <p className="text-center py-8 text-sm text-muted-foreground">No batches yet — hit &ldquo;New batch&rdquo; to record one.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-8" />
                                    <TableHead>Date</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Reference</TableHead>
                                    <TableHead>Supplier</TableHead>
                                    <TableHead>Created by</TableHead>
                                    <TableHead>Verified by</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right w-[180px]">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {batches.map((b) => {
                                    const creator = pickOne(b.creator)
                                    const verifier = pickOne(b.verifier)
                                    const isCreator = creator?.id === currentUserId
                                    const canAct = b.status === "PENDING" && isAdmin && !isCreator
                                    const expanded = expandedBatchId === b.id
                                    const lines = batchLines.get(b.id) ?? []
                                    return (
                                        <Fragment key={b.id}>
                                            <TableRow
                                                className="cursor-pointer hover:bg-muted/30"
                                                onClick={() => toggleExpand(b.id)}
                                            >
                                                <TableCell>
                                                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                                </TableCell>
                                                <TableCell className="text-sm">{formatDate(b.created_at, { dateStyle: "short", timeStyle: "short" })}</TableCell>
                                                <TableCell><Badge variant="outline">{b.type}</Badge></TableCell>
                                                <TableCell className="font-mono text-xs">{b.reference_no ?? "—"}</TableCell>
                                                <TableCell className="text-sm">{b.supplier ?? "—"}</TableCell>
                                                <TableCell>
                                                    <UserChip user={creator} />
                                                </TableCell>
                                                <TableCell>
                                                    {verifier ? (
                                                        <UserChip user={verifier} />
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground italic">Awaiting</span>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={STATUS_VARIANT[b.status]} className="gap-1">
                                                        {b.status === "PENDING" && <Clock className="h-3 w-3" />}
                                                        {b.status === "VERIFIED" && <Check className="h-3 w-3" />}
                                                        {b.status === "REJECTED" && <X className="h-3 w-3" />}
                                                        {b.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {canAct ? (
                                                        <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => verifyBatch(b)}
                                                                disabled={busy}
                                                                title="Sign off this batch"
                                                            >
                                                                <ShieldCheck className="h-3.5 w-3.5" /> Verify
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className="text-destructive"
                                                                onClick={() => openReject(b)}
                                                                disabled={busy}
                                                                title="Reject and reverse the stock changes"
                                                            >
                                                                Reject
                                                            </Button>
                                                        </div>
                                                    ) : b.status === "PENDING" && isCreator ? (
                                                        <span className="text-[11px] text-muted-foreground italic" title="Segregation of duties: a different manager must verify">
                                                            Awaiting other manager
                                                        </span>
                                                    ) : b.status === "REJECTED" && b.rejection_reason ? (
                                                        <span className="text-[11px] text-destructive truncate" title={b.rejection_reason}>
                                                            {b.rejection_reason}
                                                        </span>
                                                    ) : null}
                                                </TableCell>
                                            </TableRow>
                                            {expanded && (
                                                <TableRow className="bg-muted/20 hover:bg-muted/20">
                                                    <TableCell colSpan={9} className="p-0">
                                                        <div className="px-6 py-4 space-y-2">
                                                            {b.notes && (
                                                                <p className="text-xs text-muted-foreground">
                                                                    <span className="font-semibold">Notes:</span> {b.notes}
                                                                </p>
                                                            )}
                                                            {lines.length === 0 ? (
                                                                <p className="text-xs text-muted-foreground italic">Loading…</p>
                                                            ) : (
                                                                <Table>
                                                                    <TableHeader>
                                                                        <TableRow>
                                                                            <TableHead>Item</TableHead>
                                                                            <TableHead className="text-right">Quantity</TableHead>
                                                                            <TableHead className="text-right">Unit cost</TableHead>
                                                                            <TableHead className="text-right">Line total</TableHead>
                                                                            <TableHead>Reason</TableHead>
                                                                        </TableRow>
                                                                    </TableHeader>
                                                                    <TableBody>
                                                                        {lines.map((l) => {
                                                                            const qty = Math.abs(Number(l.quantity))
                                                                            const unit = Number(l.unit_cost) || 0
                                                                            return (
                                                                                <TableRow key={l.id}>
                                                                                    <TableCell className="text-sm">{l.stock_items?.name ?? "—"}</TableCell>
                                                                                    <TableCell className="text-right">
                                                                                        <span className={Number(l.quantity) < 0 ? "text-destructive" : "text-success"}>
                                                                                            {Number(l.quantity) > 0 ? "+" : ""}{Number(l.quantity)} {l.stock_items?.unit ?? ""}
                                                                                        </span>
                                                                                    </TableCell>
                                                                                    <TableCell className="text-right">{formatCurrency(unit)}</TableCell>
                                                                                    <TableCell className="text-right font-medium">{formatCurrency(qty * unit)}</TableCell>
                                                                                    <TableCell className="text-sm text-muted-foreground">{l.reason ?? "—"}</TableCell>
                                                                                </TableRow>
                                                                            )
                                                                        })}
                                                                    </TableBody>
                                                                </Table>
                                                            )}
                                                            {b.verified_at && (
                                                                <p className="text-[11px] text-muted-foreground">
                                                                    {b.status === "VERIFIED" ? "Verified" : "Rejected"} on {formatDate(b.verified_at, { dateStyle: "short", timeStyle: "short" })}
                                                                    {verifier ? ` by ${verifier.full_name ?? verifier.email ?? "—"}` : ""}.
                                                                </p>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </Fragment>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* ── Add / edit stock-item dialog ─────────────────────────── */}
            <Dialog open={itemOpen} onOpenChange={(o) => { setItemOpen(o); if (!o) setEditingItemId(null) }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingItemId ? "Edit stock item" : "Add stock item"}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={saveItem} className="space-y-3">
                        <div className="space-y-1.5">
                            <Label>Name *</Label>
                            <Input value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>SKU</Label>
                                <Input value={itemForm.sku} onChange={(e) => setItemForm({ ...itemForm, sku: e.target.value })} placeholder="Internal code (optional)" />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="flex items-center gap-1">
                                    <Scan className="h-3.5 w-3.5" /> Barcode
                                </Label>
                                <Input
                                    value={itemForm.barcode}
                                    onChange={(e) => setItemForm({ ...itemForm, barcode: e.target.value })}
                                    placeholder="Scan or type UPC/EAN"
                                    className="font-mono"
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Unit</Label>
                            <Select value={itemForm.unit} onValueChange={(v) => setItemForm({ ...itemForm, unit: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-1.5">
                                <Label>{editingItemId ? "Current (read-only)" : "Opening stock"}</Label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    value={itemForm.current_stock}
                                    onChange={(e) => setItemForm({ ...itemForm, current_stock: e.target.value })}
                                    disabled={!!editingItemId}
                                    title={editingItemId ? "Adjust stock by recording a batch — direct edits would skip the audit trail" : undefined}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Reorder level</Label>
                                <Input type="number" step="0.01" value={itemForm.reorder_level} onChange={(e) => setItemForm({ ...itemForm, reorder_level: e.target.value })} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Cost / unit</Label>
                                <Input type="number" step="0.01" value={itemForm.cost_price} onChange={(e) => setItemForm({ ...itemForm, cost_price: e.target.value })} />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label>HSN code</Label>
                            <Input
                                value={itemForm.hsn_code}
                                onChange={(e) => setItemForm({ ...itemForm, hsn_code: e.target.value })}
                                placeholder="For GST reports (e.g. 1006 for rice)"
                                className="font-mono"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Notes</Label>
                            <Textarea
                                value={itemForm.notes}
                                onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })}
                                placeholder="Storage location, supplier preference, anything useful"
                                rows={2}
                            />
                        </div>
                        <DialogFooter>
                            <Button type="submit" variant="neon" disabled={busy}>
                                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                                {editingItemId ? "Save changes" : "Add item"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* ── Batch entry dialog ──────────────────────────────────── */}
            <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
                <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Record stock movement</DialogTitle>
                        <p className="text-xs text-muted-foreground pt-1">
                            Scan or search to add items. Each line can be a <span className="text-success font-medium">receipt</span>, <span className="text-warning font-medium">issue</span>, or <span className="text-destructive font-medium">wastage</span> — flip the pill on the line. One submit records all three at once.
                        </p>
                    </DialogHeader>
                    <form onSubmit={submitBatch} className="space-y-4">
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Reference no (optional)</Label>
                                <Input
                                    value={batchRefNo}
                                    onChange={(e) => setBatchRefNo(e.target.value)}
                                    placeholder="PO-1024 / Invoice 4421 / reason ref"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Supplier (optional — receipts only)</Label>
                                <Input
                                    value={batchSupplier}
                                    onChange={(e) => setBatchSupplier(e.target.value)}
                                    placeholder="Vendor name"
                                />
                            </div>
                        </div>

                        {/* SCAN / SEARCH BAR — primary entry path. Barcode
                          * scanners (HID-keyboard) type into this input
                          * and press Enter on each scan; the storekeeper
                          * can also type a name/SKU to search. Either way,
                          * onScanSubmit() looks up the item and adds /
                          * increments a line. Unknown codes trigger the
                          * inline "Create new item" mini-dialog. */}
                        <div className="rounded-lg border border-primary/40 bg-primary/[0.04] p-3 space-y-2">
                            <Label className="text-xs uppercase tracking-wider font-semibold flex items-center gap-1.5">
                                <Scan className="h-3.5 w-3.5 text-primary" /> Scan or search to add
                            </Label>
                            <div className="flex gap-2">
                                <Input
                                    value={scanInput}
                                    onChange={(e) => setScanInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") { e.preventDefault(); void onScanSubmit() }
                                    }}
                                    placeholder="Scan a barcode, or type item name / SKU…"
                                    className="flex-1 font-mono"
                                    autoFocus
                                />
                                <Button type="button" variant="outline" onClick={() => void onScanSubmit()} disabled={!scanInput.trim()}>
                                    <Plus className="h-3.5 w-3.5" /> Add
                                </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground leading-snug">
                                Scanner auto-presses Enter. Re-scanning the same item bumps its quantity. Unknown barcodes open a quick &ldquo;register new item&rdquo; popup.
                            </p>
                        </div>

                        {/* LINE LIST — like a POS cart. Each added item gets
                          * a compact row with qty + unit cost inline. The
                          * old multi-column table is still here as a
                          * fallback when the scanner isn't available — the
                          * "Add empty row" button at the bottom opens a
                          * blank row with a dropdown picker. */}
                        <div className="rounded-lg border border-border/60">
                            <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 bg-muted/20">
                                <span className="text-xs uppercase tracking-wider font-semibold">
                                    Items in batch ({batchLinesDraft.length})
                                </span>
                                <Button type="button" variant="ghost" size="sm" onClick={addLineRow} title="Add a blank row to pick from the dropdown">
                                    <Plus className="h-3.5 w-3.5" /> Manual row
                                </Button>
                            </div>
                            {batchLinesDraft.length === 0 ? (
                                <div className="text-center py-10 text-sm text-muted-foreground">
                                    <Scan className="h-7 w-7 mx-auto mb-2 opacity-40" />
                                    Scan a barcode or search above to add the first item.
                                </div>
                            ) : (
                                <ul className="divide-y divide-border/40">
                                    {batchLinesDraft.map((line, idx) => {
                                        const item = items.find((i) => i.id === line.stock_item_id)
                                        const qty = Number(line.quantity)
                                        const unit = Number(line.unit_cost)
                                        const lineTotal = Number.isFinite(qty) && Number.isFinite(unit) ? qty * unit : 0
                                        return (
                                            <li
                                                key={idx}
                                                className={cn(
                                                    "px-3 py-2.5 space-y-2 border-l-4",
                                                    line.direction === "IN" && "border-l-success/60",
                                                    line.direction === "OUT" && "border-l-warning/60",
                                                    line.direction === "WASTAGE" && "border-l-destructive/60",
                                                )}
                                            >
                                                {/* Top row: item identity + direction pill + remove */}
                                                <div className="flex items-start gap-2">
                                                    {item ? (
                                                        <div className="flex-1 min-w-0">
                                                            <div className="font-medium leading-tight truncate">{item.name}</div>
                                                            <div className="text-[10px] text-muted-foreground font-mono">
                                                                {item.sku ?? "—"}
                                                                {item.barcode && <span className="ml-2">⌷ {item.barcode}</span>}
                                                                <span className="ml-2">· in stock: {Number(item.current_stock)} {item.unit}</span>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex-1 min-w-0">
                                                            <Select value={line.stock_item_id} onValueChange={(v) => updateLine(idx, { stock_item_id: v })}>
                                                                <SelectTrigger><SelectValue placeholder="Pick item" /></SelectTrigger>
                                                                <SelectContent>
                                                                    {activeItems.map((i) => (
                                                                        <SelectItem key={i.id} value={i.id}>
                                                                            {i.name} <span className="text-muted-foreground">({i.unit})</span>
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    )}
                                                    {/* Direction pill — three exclusive buttons, color-coded.
                                                      * Defaults to IN. Click any other to flip; the left
                                                      * border on the <li> picks up the tone so the running
                                                      * list is scannable at a glance. */}
                                                    <div className="inline-flex rounded-md border border-border/60 overflow-hidden shrink-0" role="group" aria-label="Direction">
                                                        {DIRECTIONS.map((d) => {
                                                            const active = line.direction === d.value
                                                            return (
                                                                <button
                                                                    key={d.value}
                                                                    type="button"
                                                                    onClick={() => updateLine(idx, { direction: d.value })}
                                                                    className={cn(
                                                                        "px-2 py-1 text-[11px] font-medium transition-colors flex items-center gap-1",
                                                                        active && d.tone === "success" && "bg-success/15 text-success",
                                                                        active && d.tone === "warning" && "bg-warning/15 text-warning",
                                                                        active && d.tone === "destructive" && "bg-destructive/15 text-destructive",
                                                                        !active && "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                                                                    )}
                                                                    aria-pressed={active}
                                                                >
                                                                    <d.icon className="h-3 w-3" />
                                                                    {d.short}
                                                                </button>
                                                            )
                                                        })}
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 text-destructive shrink-0"
                                                        onClick={() => removeLineRow(idx)}
                                                        aria-label="Remove"
                                                    >
                                                        <X className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                                {/* Bottom row: qty + unit cost + line total */}
                                                <div className="grid grid-cols-[1fr_1fr_auto] sm:grid-cols-[120px_140px_1fr_auto] gap-2 items-end">
                                                    <div className="space-y-0.5">
                                                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Qty {item ? `(${item.unit})` : ""}</Label>
                                                        <Input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            value={line.quantity}
                                                            onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                                                            className="h-8"
                                                        />
                                                    </div>
                                                    <div className="space-y-0.5">
                                                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Unit cost</Label>
                                                        <Input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            value={line.unit_cost}
                                                            onChange={(e) => updateLine(idx, { unit_cost: e.target.value })}
                                                            placeholder={item ? String(Number(item.cost_price) || 0) : "0.00"}
                                                            className="h-8"
                                                        />
                                                    </div>
                                                    <div className="hidden sm:block space-y-0.5">
                                                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Reason</Label>
                                                        <Input
                                                            value={line.reason}
                                                            onChange={(e) => updateLine(idx, { reason: e.target.value })}
                                                            placeholder={line.direction === "WASTAGE" ? "Spoilage…" : "Optional"}
                                                            className="h-8"
                                                        />
                                                    </div>
                                                    <div className="text-right tabular-nums shrink-0 text-sm font-semibold pb-1.5">
                                                        {lineTotal > 0 ? formatCurrency(lineTotal) : "—"}
                                                    </div>
                                                </div>
                                            </li>
                                        )
                                    })}
                                </ul>
                            )}
                            {batchLinesDraft.length > 0 && (
                                <div className="px-3 py-2 border-t border-border/40 bg-muted/10 space-y-1.5">
                                    {/* Per-direction line + qty breakdown so the storekeeper
                                      * can sanity-check what's about to be recorded across
                                      * receipts, issues, and wastage at a glance. Each
                                      * direction echoes the tone of its left-border on the
                                      * lines above. */}
                                    <div className="grid grid-cols-3 gap-2 text-xs">
                                        {DIRECTIONS.map((d) => {
                                            const dirLines = batchLinesDraft.filter((l) => l.direction === d.value && l.stock_item_id && Number(l.quantity) > 0)
                                            const lineCount = dirLines.length
                                            return (
                                                <div
                                                    key={d.value}
                                                    className={cn(
                                                        "rounded-md px-2 py-1.5 flex items-center justify-between",
                                                        lineCount === 0 && "opacity-40",
                                                        d.tone === "success" && "bg-success/[0.06]",
                                                        d.tone === "warning" && "bg-warning/[0.06]",
                                                        d.tone === "destructive" && "bg-destructive/[0.06]",
                                                    )}
                                                >
                                                    <span className={cn(
                                                        "font-medium flex items-center gap-1",
                                                        d.tone === "success" && "text-success",
                                                        d.tone === "warning" && "text-warning",
                                                        d.tone === "destructive" && "text-destructive",
                                                    )}>
                                                        <d.icon className="h-3 w-3" /> {d.label}
                                                    </span>
                                                    <span className="font-bold tabular-nums">
                                                        {lineCount} {lineCount === 1 ? "line" : "lines"}
                                                    </span>
                                                </div>
                                            )
                                        })}
                                    </div>
                                    {batchTotal > 0 && (
                                        <div className="flex items-center justify-end gap-3 pt-1 border-t border-border/30">
                                            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                                                Receipt cost total
                                            </span>
                                            <span className="text-base font-bold tabular-nums">{formatCurrency(batchTotal)}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <Label>Notes</Label>
                            <Textarea
                                value={batchNotes}
                                onChange={(e) => setBatchNotes(e.target.value)}
                                placeholder="Anything the verifying manager should know — e.g. partial delivery, damaged crate, etc."
                                rows={2}
                            />
                        </div>

                        {negativeWarnings.length > 0 && (
                            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs space-y-1 leading-relaxed">
                                <div className="flex items-center gap-1.5 font-semibold text-warning">
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                    Stock would go below zero
                                </div>
                                <ul className="list-disc pl-5 space-y-0.5">
                                    {negativeWarnings.map((w, i) => <li key={i}>{w}</li>)}
                                </ul>
                                <p className="text-muted-foreground pt-1">
                                    Click <span className="font-semibold">Record batch</span> again to confirm. Adjustment batches often do this on purpose — but if it was a typo, fix it now.
                                </p>
                            </div>
                        )}

                        <div className="rounded-md border border-primary/30 bg-primary/[0.04] px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
                            Submitting records the batch in <span className="font-semibold">PENDING</span> status under your name.
                            Inventory updates immediately; a different manager must sign off to mark it <span className="font-semibold">VERIFIED</span>.
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setBatchOpen(false)} disabled={busy}>Cancel</Button>
                            <Button
                                type="submit"
                                variant={negativeWarnings.length > 0 ? "destructive" : "neon"}
                                disabled={busy}
                            >
                                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                                {negativeWarnings.length > 0 ? "Confirm anyway" : "Record batch"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* ── Inline "new item from scan" mini-dialog ──────────────
              * Opens when onScanSubmit() hits an unknown barcode. Pre-
              * fills barcode/name so the storekeeper just confirms
              * unit + cost and saves. On save, the new item is auto-
              * added as a line to the active batch. */}
            <Dialog open={unknownBarcode !== null} onOpenChange={(o) => { if (!o) setUnknownBarcode(null) }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>New item — register & add to batch</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={saveItemFromScan} className="space-y-3">
                        {unknownBarcode && (
                            <div className="rounded-md border border-primary/30 bg-primary/[0.04] px-3 py-2 text-xs">
                                Scanned barcode: <span className="font-mono font-semibold ml-1">{unknownBarcode}</span>
                            </div>
                        )}
                        <div className="space-y-1.5">
                            <Label>Name *</Label>
                            <Input
                                value={itemForm.name}
                                onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                                placeholder="e.g. Maggi 70g pack"
                                autoFocus
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Barcode</Label>
                                <Input
                                    value={itemForm.barcode}
                                    onChange={(e) => setItemForm({ ...itemForm, barcode: e.target.value })}
                                    className="font-mono"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Unit</Label>
                                <Select value={itemForm.unit} onValueChange={(v) => setItemForm({ ...itemForm, unit: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>SKU</Label>
                                <Input value={itemForm.sku} onChange={(e) => setItemForm({ ...itemForm, sku: e.target.value })} placeholder="Internal code" />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Cost / unit</Label>
                                <Input type="number" step="0.01" value={itemForm.cost_price} onChange={(e) => setItemForm({ ...itemForm, cost_price: e.target.value })} />
                            </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            Opening stock stays at 0 — the batch you&apos;re creating now is what fills it.
                        </p>
                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setUnknownBarcode(null)} disabled={busy}>Cancel</Button>
                            <Button type="submit" variant="neon" disabled={busy}>
                                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                                Save & add to batch
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* ── Per-item movement history drawer ─────────────────────
              * Clicking an item name in the stock items table opens this.
              * Pages of 10 are loaded on demand via fetchHistoryPage(),
              * over-fetching by 1 row to know whether to show the
              * "Load more" button or the "no more history" end message. */}
            <Dialog open={!!historyItem} onOpenChange={(o) => { if (!o) closeHistory() }}>
                <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <History className="h-4 w-4 text-primary" />
                            Movement history{historyItem ? ` · ${historyItem.name}` : ""}
                        </DialogTitle>
                    </DialogHeader>
                    {historyItem && (
                        <div className="space-y-3">
                            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 flex items-center gap-4 text-sm">
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Current</div>
                                    <div className="font-semibold tabular-nums">{Number(historyItem.current_stock)} {historyItem.unit}</div>
                                </div>
                                <div className="border-l border-border/60 pl-4">
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Reorder at</div>
                                    <div className="font-semibold tabular-nums">{Number(historyItem.reorder_level)} {historyItem.unit}</div>
                                </div>
                                <div className="border-l border-border/60 pl-4">
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Cost / unit</div>
                                    <div className="font-semibold tabular-nums">{formatCurrency(historyItem.cost_price)}</div>
                                </div>
                                {historyItem.barcode && (
                                    <div className="border-l border-border/60 pl-4 ml-auto">
                                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Barcode</div>
                                        <div className="font-mono text-xs">{historyItem.barcode}</div>
                                    </div>
                                )}
                            </div>

                            {historyRows.length === 0 && !historyLoading ? (
                                <div className="text-center py-10 text-sm text-muted-foreground">
                                    <Boxes className="h-7 w-7 mx-auto mb-2 opacity-40" />
                                    No movements yet. Record a batch to see history here.
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>When</TableHead>
                                            <TableHead>Type</TableHead>
                                            <TableHead className="text-right">Quantity</TableHead>
                                            <TableHead className="text-right">Unit cost</TableHead>
                                            <TableHead>Batch</TableHead>
                                            <TableHead>Performed by</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {historyRows.map((m) => {
                                            const batch = pickOne(m.batch)
                                            const performer = pickOne(m.performer)
                                            return (
                                                <TableRow key={m.id}>
                                                    <TableCell className="text-sm">{formatDate(m.created_at, { dateStyle: "short", timeStyle: "short" })}</TableCell>
                                                    <TableCell><Badge variant="outline">{m.type}</Badge></TableCell>
                                                    <TableCell className="text-right">
                                                        <span className={Number(m.quantity) < 0 ? "text-destructive" : "text-success"}>
                                                            {Number(m.quantity) > 0 ? "+" : ""}{Number(m.quantity)} {historyItem.unit}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-right text-sm">{Number(m.unit_cost) > 0 ? formatCurrency(m.unit_cost) : "—"}</TableCell>
                                                    <TableCell className="text-xs">
                                                        {batch ? (
                                                            <div className="space-y-0.5">
                                                                <div className="font-mono">{batch.reference_no ?? "—"}</div>
                                                                {batch.supplier && <div className="text-muted-foreground">{batch.supplier}</div>}
                                                                <Badge variant={batch.status === "VERIFIED" ? "success" : batch.status === "REJECTED" ? "destructive" : "warning"} className="text-[10px]">
                                                                    {batch.status}
                                                                </Badge>
                                                            </div>
                                                        ) : (
                                                            <span className="text-muted-foreground">Legacy</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell><UserChip user={performer} /></TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            )}

                            <div className="flex flex-col items-center gap-2 pt-2">
                                {historyHasMore ? (
                                    <Button variant="outline" size="sm" onClick={loadMoreHistory} disabled={historyLoading}>
                                        {historyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                                        Load more ({HISTORY_PAGE_SIZE})
                                    </Button>
                                ) : historyRows.length > 0 ? (
                                    <p className="text-xs text-muted-foreground italic flex items-center gap-1.5">
                                        <Check className="h-3.5 w-3.5 text-success" />
                                        That&apos;s the complete history — nothing more to load.
                                    </p>
                                ) : null}
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* ── Pause / Resume confirmation ──────────────────────────
              * Soft confirm before flipping is_active so the storekeeper
              * doesn't accidentally hide a heavily-used item from the
              * low-stock alert. Resume is one-click (no risk). */}
            <Dialog open={!!pauseTarget} onOpenChange={(o) => { if (!o) setPauseTarget(null) }}>
                <DialogContent className="sm:max-w-md">
                    {pauseTarget && (pauseTarget.is_active ? (
                        <>
                            <DialogHeader>
                                <DialogTitle>Pause {pauseTarget.name}?</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-3">
                                <p className="text-sm text-muted-foreground">
                                    Paused items keep their history but stop appearing in the low-stock
                                    alert and the new-batch dropdown. Use this when the restaurant has
                                    stopped using an item — e.g. seasonal ingredients or a sauce you&apos;ve
                                    discontinued.
                                </p>
                                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs space-y-0.5">
                                    <div><span className="text-muted-foreground">Current stock: </span><span className="font-semibold">{Number(pauseTarget.current_stock)} {pauseTarget.unit}</span></div>
                                    <div><span className="text-muted-foreground">Cost: </span><span className="font-semibold">{formatCurrency(pauseTarget.cost_price)}</span></div>
                                </div>
                                <p className="text-[11px] text-muted-foreground">You can resume it any time — one click brings it back.</p>
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="ghost" onClick={() => setPauseTarget(null)}>Cancel</Button>
                                <Button type="button" variant="neon" onClick={() => togglePause(pauseTarget)}>
                                    <Pause className="h-3.5 w-3.5" /> Pause
                                </Button>
                            </DialogFooter>
                        </>
                    ) : (
                        <>
                            <DialogHeader>
                                <DialogTitle>Resume {pauseTarget.name}?</DialogTitle>
                            </DialogHeader>
                            <p className="text-sm text-muted-foreground">
                                It will go back to counting toward low-stock alerts and show up in the
                                batch dropdown again. Stock + history are untouched.
                            </p>
                            <DialogFooter>
                                <Button type="button" variant="ghost" onClick={() => setPauseTarget(null)}>Cancel</Button>
                                <Button type="button" variant="neon" onClick={() => togglePause(pauseTarget)}>
                                    <Play className="h-3.5 w-3.5" /> Resume
                                </Button>
                            </DialogFooter>
                        </>
                    ))}
                </DialogContent>
            </Dialog>

            {/* ── Scanned-a-paused-item prompt ────────────────────────
              * Storekeeper scanned a barcode that belongs to a paused
              * item. Surface it explicitly so they know what happened
              * (vs. silently ignoring or silently re-activating). */}
            <Dialog open={!!resumePromptItem} onOpenChange={(o) => { if (!o) setResumePromptItem(null) }}>
                <DialogContent className="sm:max-w-md">
                    {resumePromptItem && (
                        <>
                            <DialogHeader>
                                <DialogTitle>Resume {resumePromptItem.name}?</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-3">
                                <p className="text-sm text-muted-foreground">
                                    This item is currently <span className="font-semibold">paused</span> — the restaurant marked it as not currently in use.
                                    Scanning it suggests you&apos;re using it again. Resume and add to the batch?
                                </p>
                                {resumePromptItem.barcode && (
                                    <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs font-mono">
                                        ⌷ {resumePromptItem.barcode}
                                    </div>
                                )}
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="ghost" onClick={() => setResumePromptItem(null)}>Skip</Button>
                                <Button type="button" variant="neon" onClick={() => resumeAndAddToBatch(resumePromptItem)}>
                                    <Play className="h-3.5 w-3.5" /> Resume & add
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* ── Reject batch dialog ─────────────────────────────────── */}
            <Dialog open={!!rejectOpen} onOpenChange={(o) => { if (!o) setRejectOpen(null) }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Reject batch</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={confirmReject} className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                            Rejecting this batch <span className="font-semibold text-destructive">reverses every stock change</span> it applied.
                            The audit trail is preserved.
                        </p>
                        <div className="space-y-1.5">
                            <Label>Reason *</Label>
                            <Textarea
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                placeholder="What's wrong with the entry?"
                                rows={3}
                            />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setRejectOpen(null)} disabled={busy}>Cancel</Button>
                            <Button type="submit" variant="destructive" disabled={busy}>
                                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                                Reject batch
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}

/** Small reusable chip rendering a user as avatar + name. The audit log
 *  rows show two of these (creator + verifier) so the eye can spot at a
 *  glance "different people signed off" — the whole point of the workflow. */
function UserChip({ user }: { user: { id: string; full_name: string | null; email: string | null; avatar_url: string | null } | null }) {
    if (!user) return <span className="text-xs text-muted-foreground">—</span>
    const label = user.full_name ?? user.email ?? "Unknown"
    return (
        <span className="inline-flex items-center gap-1.5">
            {user.avatar_url
                /* eslint-disable-next-line @next/next/no-img-element */
                ? <img src={user.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover border border-border/60" />
                : <span className="h-5 w-5 rounded-full bg-muted grid place-items-center text-[10px] font-semibold">
                    {label.slice(0, 1).toUpperCase()}
                </span>}
            <span className="text-xs truncate max-w-[120px]">{label}</span>
        </span>
    )
}
