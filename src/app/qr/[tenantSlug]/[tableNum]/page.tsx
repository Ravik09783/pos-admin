"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "next/navigation"
import QRCode from "qrcode"
import { AnimatePresence, motion } from "framer-motion"
import {
    Ban, Camera, CheckCircle2, ChevronUp, Copy, Lightbulb, Loader2, Minus, Plus, Receipt, RefreshCw,
    Search, ShoppingBag, Smartphone, Sparkles, Tag, Trash2, Upload, Utensils, XCircle, Zap,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { FlyOverlay, useFlyToCart } from "@/components/qr/fly-to-cart"
import { SuccessScreen } from "@/components/qr/success-screen"
import { ItemAddDialog } from "@/components/pos/item-add-dialog"
import { ThemeToggle } from "@/components/app-shell/theme-toggle"
import { cn, formatCurrency } from "@/lib/utils"
import { getTaxConfig } from "@/lib/tax/locale-config"

interface MenuItemLite {
    id: string
    category_id: string | null
    name: string
    description: string | null
    base_price: number
    /** Active discounted price; when set + less than base_price, this is what
     *  the customer pays. The /api/public/qr/menu API includes it. */
    sale_price: number | null
    food_type: "VEG" | "NON_VEG" | "EGG" | "VEGAN"
    gst_slab: number
    image_url: string | null
    is_sold_out: boolean
    sort_order: number
    hsn_code: string | null
}

/** Active price for a customer-facing menu line. */
function qrPriceOf(it: MenuItemLite): number {
    if (it.sale_price != null && Number(it.sale_price) > 0 && Number(it.sale_price) < Number(it.base_price)) {
        return Number(it.sale_price)
    }
    return Number(it.base_price)
}
interface CategoryLite { id: string; name: string; sort_order: number }
interface TenantLite {
    id: string; name: string; slug: string;
    upi_id: string | null; upi_payee_name: string | null;
    qr_ordering_enabled: boolean; qr_require_payment: boolean;
    payment_gateway?: "manual" | "paytm" | "stripe";
    /** True when the restaurant can take online payment on the "paytm"
     *  gateway — Paytm is connected (per-tenant or the platform .env
     *  fallback) OR, since the flow downgrades gracefully, a plain UPI id
     *  is set. When false on a "paytm" gateway, the page shows a "payment
     *  not set up" message and blocks ordering. */
    paytm_ready?: boolean;
    /** Same idea for Stripe — true when platform Stripe key is set + the
     *  restaurant has a Stripe-connected account. Customer page redirects
     *  to Stripe Checkout when this is true; blocks with a "set up online
     *  payments" message when false. */
    stripe_ready?: boolean;
    address_line1: string | null; city: string | null; phone: string | null;
    country: string | null; currency: string | null;
    logo_url: string | null;
}

type Stage = "browse" | "pay_manual" | "uploading" | "awaiting_confirmation" | "confirmed" | "rejected"

interface CartLine { item: MenuItemLite; quantity: number; notes?: string }
interface OrderSummaryLine {
    item_name: string
    quantity: number
    unit_price: number
    gst_slab: number
    taxable_amount: number
    line_total: number
}
interface OrderSummary {
    items: OrderSummaryLine[]
    subtotal: number
    tax: number
    grand_total: number
    order_number: string | null
    customer_name: string | null
    customer_phone: string | null
    /** Public bill URL once the server has confirmed payment + generated
     *  the bill. The success screen turns this into a "Download bill" link. */
    bill_url: string | null
    invoice_number: string | null
}

const FOOD_TYPE_COLOR: Record<MenuItemLite["food_type"], string> = {
    VEG: "#22c55e",
    NON_VEG: "#ef4444",
    EGG: "#f59e0b",
    VEGAN: "#10b981",
}

// localStorage TTL — after this, a restored order is treated as stale and
// the customer starts fresh. 6 hours covers the longest realistic dine-in.
const ORDER_PERSIST_TTL_MS = 6 * 60 * 60 * 1000

function persistKey(tenantSlug: string, tableNum: string): string {
    return `qr_active_order:${tenantSlug}:${tableNum}`
}

function readPersistedOrder(tenantSlug: string, tableNum: string): { order_id: string; created_at: number } | null {
    if (typeof window === "undefined") return null
    try {
        const raw = localStorage.getItem(persistKey(tenantSlug, tableNum))
        if (!raw) return null
        const v = JSON.parse(raw) as { order_id?: string; created_at?: number }
        if (!v.order_id || !v.created_at) return null
        if (Date.now() - v.created_at > ORDER_PERSIST_TTL_MS) {
            localStorage.removeItem(persistKey(tenantSlug, tableNum))
            return null
        }
        return { order_id: v.order_id, created_at: v.created_at }
    } catch {
        return null
    }
}

function writePersistedOrder(tenantSlug: string, tableNum: string, orderId: string) {
    if (typeof window === "undefined") return
    try {
        localStorage.setItem(
            persistKey(tenantSlug, tableNum),
            JSON.stringify({ order_id: orderId, created_at: Date.now() }),
        )
    } catch {
        /* quota / private mode — non-fatal */
    }
}

function clearPersistedOrder(tenantSlug: string, tableNum: string) {
    if (typeof window === "undefined") return
    try { localStorage.removeItem(persistKey(tenantSlug, tableNum)) } catch {}
}

interface StatusResponse {
    stage: Stage
    order: {
        id: string
        order_number: string
        status: string
        payment_gateway: string | null
        subtotal: number
        taxable_amount: number
        cgst_amount: number
        sgst_amount: number
        grand_total: number
        rejected_reason: string | null
        confirmed_at: string | null
        paid_at: string | null
        created_at: string
        notes: string | null
    }
    items: OrderSummaryLine[]
    proof: { status: string; screenshot_url: string; created_at: string } | null
    tenant: {
        name: string; slug: string; upi_id: string | null;
        upi_payee_name: string | null; payment_gateway: string | null;
    } | null
    customer: { name: string | null; phone: string | null } | null
    /** Bill row created server-side after payment confirmation. The
     *  success screen's "Download bill" link uses /b/<slug>/<invoice>. */
    bill: { id: string; invoice_number: string; bill_status: string } | null
}

type MenuLoadStatus = "loading" | "ok" | "not_found" | "network_error"

export default function QRMenuPage() {
    const params = useParams<{ tenantSlug: string; tableNum: string }>()
    const [tenant, setTenant] = useState<TenantLite | null>(null)
    const [menuLoadStatus, setMenuLoadStatus] = useState<MenuLoadStatus>("loading")
    const [categories, setCategories] = useState<CategoryLite[]>([])
    const [items, setItems] = useState<MenuItemLite[]>([])
    /** item_id → ordered list of recommended item ids (upsell suggestions). */
    const [recs, setRecs] = useState<Record<string, string[]>>({})
    const [activeCat, setActiveCat] = useState<string | "ALL">("ALL")
    const [search, setSearch] = useState("")
    const [cart, setCart] = useState<CartLine[]>([])
    const [cartOpen, setCartOpen] = useState(false)
    const [customerName, setCustomerName] = useState("")
    const [customerPhone, setCustomerPhone] = useState("")
    const [orderNotes, setOrderNotes] = useState("")
    const [couponInput, setCouponInput] = useState("")
    const [coupon, setCoupon] = useState<{ code: string; discount: number; description: string | null } | null>(null)
    const [couponBusy, setCouponBusy] = useState(false)
    const [addingItem, setAddingItem] = useState<MenuItemLite | null>(null)

    const [stage, setStage] = useState<Stage>("browse")
    const [orderId, setOrderId] = useState<string | null>(null)
    const [orderNumber, setOrderNumber] = useState<string | null>(null)
    const [billAmount, setBillAmount] = useState(0)
    const [upiQrUrl, setUpiQrUrl] = useState("")
    // When set, the pay screen is a Paytm dynamic QR (auto-confirmed via
    // the webhook — no screenshot upload). Holds the UPI intent string so
    // we can also offer a one-tap "open UPI app" button.
    const [paytmIntent, setPaytmIntent] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [rejectReason, setRejectReason] = useState<string | null>(null)
    const [proofFile, setProofFile] = useState<File | null>(null)
    const [awaitingSeconds, setAwaitingSeconds] = useState(0)
    const [orderSummary, setOrderSummary] = useState<OrderSummary | null>(null)
    const [restoring, setRestoring] = useState(true)

    const cartButtonRef = useRef<HTMLButtonElement | null>(null)
    const fly = useFlyToCart()

    // Country-aware money + tax wording (so a non-Indian restaurant doesn't say "GST").
    const cfg = useMemo(() => getTaxConfig(tenant?.country), [tenant?.country])
    const money = useCallback((v: number) => formatCurrency(v, cfg.currency), [cfg.currency])
    const taxLabel = cfg.taxModel === "none"
        ? ""
        : cfg.taxModel === "split" ? cfg.taxShortName : (cfg.taxLabels.single ?? cfg.taxShortName)

    const buildUpiQr = useCallback(async (amount: number, t: TenantLite) => {
        if (!t.upi_id) return ""
        const payee = encodeURIComponent(t.upi_payee_name ?? t.name)
        const txnRef = `QR-${Date.now().toString().slice(-8)}`
        const note = encodeURIComponent(`${t.name} table ${params.tableNum}`)
        const upiUrl = `upi://pay?pa=${t.upi_id}&pn=${payee}&am=${amount}&cu=INR&tn=${note}&tr=${txnRef}`
        return QRCode.toDataURL(upiUrl, { margin: 1, width: 360, color: { dark: "#0a0e1a", light: "#ffffff" } })
    }, [params.tableNum])

    const summaryFromStatus = useCallback((data: StatusResponse): OrderSummary => {
        const taxAmt = Number(data.order.cgst_amount) + Number(data.order.sgst_amount)
        // If the order hasn't been confirmed yet the server-side cgst/sgst are
        // both 0 — recompute from line gst_slab so the customer still sees a
        // breakdown that adds up to grand_total.
        const computedTax = taxAmt > 0
            ? taxAmt
            : data.items.reduce((s, l) => s + Number(l.taxable_amount) * Number(l.gst_slab) / 100, 0)
        const subtotal = data.order.subtotal > 0
            ? Number(data.order.subtotal)
            : data.items.reduce((s, l) => s + Number(l.taxable_amount), 0)
        const grand = data.order.grand_total > 0
            ? Number(data.order.grand_total)
            : Math.round((subtotal + computedTax) * 100) / 100
        // Once the bill row exists (server creates it after the payment
        // webhook fires), the success screen can offer
        // a public "Download bill" link. The link is the same canonical
        // verified-bill URL: /b/<tenant_slug>/<invoice_number>.
        const billUrl = data.bill && data.tenant
            ? `/b/${data.tenant.slug}/${encodeURIComponent(data.bill.invoice_number)}`
            : null
        return {
            items: data.items,
            subtotal,
            tax: Math.round(computedTax * 100) / 100,
            grand_total: grand,
            order_number: data.order.order_number,
            customer_name: data.customer?.name ?? null,
            customer_phone: data.customer?.phone ?? null,
            bill_url: billUrl,
            invoice_number: data.bill?.invoice_number ?? null,
        }
    }, [])

    // Load menu — distinguish "this restaurant doesn't exist" (404) from
    // "we couldn't reach the server" (anything else) so the customer sees
    // a useful message instead of an infinite skeleton.
    const loadMenu = useCallback(async () => {
        setMenuLoadStatus("loading")
        try {
            const r = await fetch(`/api/public/qr/menu/${params.tenantSlug}?table=${encodeURIComponent(params.tableNum)}`)
            if (r.ok) {
                const data = await r.json() as {
                    tenant: TenantLite; categories: CategoryLite[]; items: MenuItemLite[];
                    recommendations?: Record<string, string[]>
                }
                setTenant(data.tenant)
                setCategories(data.categories)
                setItems(data.items)
                setRecs(data.recommendations ?? {})
                setMenuLoadStatus("ok")
                return
            }
            setMenuLoadStatus(r.status === 404 ? "not_found" : "network_error")
        } catch {
            setMenuLoadStatus("network_error")
        }
    }, [params.tenantSlug])

    useEffect(() => { loadMenu() }, [loadMenu])

    // ---- Reload-restore: check localStorage for an in-flight order ----
    useEffect(() => {
        if (!tenant) return
        let cancelled = false
        ;(async () => {
            const persisted = readPersistedOrder(params.tenantSlug, params.tableNum)
            if (!persisted) {
                setRestoring(false)
                return
            }
            try {
                const r = await fetch(`/api/public/qr/order-status/${persisted.order_id}`, { cache: "no-store" })
                if (!r.ok) {
                    clearPersistedOrder(params.tenantSlug, params.tableNum)
                    setRestoring(false)
                    return
                }
                const data = await r.json() as StatusResponse
                if (cancelled) return
                const summary = summaryFromStatus(data)
                setOrderId(persisted.order_id)
                setOrderNumber(data.order.order_number)
                setBillAmount(summary.grand_total)
                setOrderSummary(summary)
                if (data.customer?.name) setCustomerName(data.customer.name)
                if (data.customer?.phone) setCustomerPhone(data.customer.phone)
                if (data.order.rejected_reason) setRejectReason(data.order.rejected_reason)

                if (data.stage === "pay_manual") {
                    if (data.tenant?.upi_id) {
                        const qrPng = await buildUpiQr(summary.grand_total, {
                            ...tenant,
                            upi_id: data.tenant.upi_id,
                            upi_payee_name: data.tenant.upi_payee_name,
                        })
                        if (!cancelled) setUpiQrUrl(qrPng)
                    }
                    setStage("pay_manual")
                } else {
                    setStage(data.stage)
                }
            } catch {
                clearPersistedOrder(params.tenantSlug, params.tableNum)
            } finally {
                if (!cancelled) setRestoring(false)
            }
        })()
        return () => { cancelled = true }
    }, [tenant, params.tenantSlug, params.tableNum, buildUpiQr, summaryFromStatus])

    // Timer when awaiting confirmation
    useEffect(() => {
        if (stage !== "awaiting_confirmation") { setAwaitingSeconds(0); return }
        const id = setInterval(() => setAwaitingSeconds((s) => s + 1), 1000)
        return () => clearInterval(id)
    }, [stage])

    // Polling for terminal states (also re-syncs the summary if staff edits)
    useEffect(() => {
        if (!orderId) return
        if (!["awaiting_confirmation", "uploading", "pay_manual"].includes(stage)) return
        const id = setInterval(async () => {
            try {
                const r = await fetch(`/api/public/qr/order-status/${orderId}`, { cache: "no-store" })
                if (!r.ok) return
                const data = await r.json() as StatusResponse
                setOrderSummary(summaryFromStatus(data))
                if (data.order.order_number) setOrderNumber(data.order.order_number)
                if (data.stage === "confirmed") setStage("confirmed")
                else if (data.stage === "rejected") {
                    setStage("rejected")
                    setRejectReason(data.order.rejected_reason)
                }
            } catch { /* transient — keep polling */ }
        }, 4000)
        return () => clearInterval(id)
    }, [orderId, stage, summaryFromStatus])

    const visibleItems = useMemo(() => {
        let out = items
        if (activeCat !== "ALL") out = out.filter((i) => i.category_id === activeCat)
        if (search.trim()) {
            const s = search.toLowerCase()
            out = out.filter((i) => i.name.toLowerCase().includes(s))
        }
        return out
    }, [items, activeCat, search])

    /** Only show category chips that have at least one item in THIS
     *  branch's menu. The /api/public/qr/menu API returns all the
     *  tenant's active categories — but items are branch-scoped, so a
     *  multi-branch restaurant would otherwise show category chips that
     *  filter to an empty list (looks broken to the customer). */
    const usefulCategories = useMemo(() => {
        const usedIds = new Set(
            items.map((i) => i.category_id).filter((id): id is string => Boolean(id)),
        )
        return categories.filter((c) => usedIds.has(c.id))
    }, [categories, items])

    // If the user was viewing a category that no longer has items
    // (e.g. all items in that category just sold out), drop them back
    // to "All" so they're not stuck looking at an empty list.
    useEffect(() => {
        if (activeCat !== "ALL" && !usefulCategories.some((c) => c.id === activeCat)) {
            setActiveCat("ALL")
        }
    }, [activeCat, usefulCategories])

    const groupedItems = useMemo(() => {
        if (activeCat !== "ALL" || search.trim()) return null
        const groups = new Map<string, { name: string; items: MenuItemLite[] }>()
        for (const c of categories) groups.set(c.id, { name: c.name, items: [] })
        for (const it of items) {
            if (it.category_id && groups.has(it.category_id)) {
                groups.get(it.category_id)!.items.push(it)
            }
        }
        return Array.from(groups.values()).filter((g) => g.items.length > 0)
    }, [items, categories, activeCat, search])

    const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

    function flyTo(sourceEl: HTMLElement, it: MenuItemLite) {
        const sourceRect = sourceEl.getBoundingClientRect()
        const cartRect = cartButtonRef.current?.getBoundingClientRect()
        if (!cartRect) return
        fly.fly({
            fromX: sourceRect.left + sourceRect.width / 2,
            fromY: sourceRect.top + sourceRect.height / 2,
            toX: cartRect.left + cartRect.width / 2,
            toY: cartRect.top + cartRect.height / 2,
            label: it.name.charAt(0).toUpperCase(),
            color: FOOD_TYPE_COLOR[it.food_type],
        })
    }

    /** Add a line, merging only when the item AND notes match. */
    function addLine(it: MenuItemLite, quantity: number, notes: string) {
        const n = notes.trim()
        setCart((prev) => {
            const idx = prev.findIndex((c) => c.item.id === it.id && (c.notes ?? "") === n)
            if (idx >= 0) {
                const copy = [...prev]; copy[idx] = { ...copy[idx]!, quantity: copy[idx]!.quantity + quantity }; return copy
            }
            return [...prev, { item: it, quantity, notes: n || undefined }]
        })
    }

    /** Quick add (qty 1, no notes) — used by the "pairs well with" chips, with the fly animation. */
    function addToCart(it: MenuItemLite, sourceEl: HTMLElement) {
        if (it.is_sold_out) { toast.error(`${it.name} is sold out`); return }
        flyTo(sourceEl, it)
        addLine(it, 1, "")
    }

    /** Tap a menu card → open the McDonald's-style add sheet. */
    function openItem(it: MenuItemLite) {
        if (it.is_sold_out) { toast.error(`${it.name} is sold out`); return }
        setAddingItem(it)
    }

    /** This item's curated add-ons, resolved to available menu items. */
    function recommendedFor(it: MenuItemLite): MenuItemLite[] {
        return (recs[it.id] ?? [])
            .map((rid) => byId.get(rid))
            .filter((x): x is MenuItemLite => !!x && !x.is_sold_out && x.id !== it.id)
            .slice(0, 6)
    }

    function changeQty(idx: number, d: number) {
        setCart((prev) => {
            const cp = [...prev]; const cur = cp[idx]!; const next = cur.quantity + d
            if (next <= 0) return cp.filter((_, i) => i !== idx)
            cp[idx] = { ...cur, quantity: next }; return cp
        })
    }
    function removeItem(idx: number) {
        setCart((prev) => prev.filter((_, i) => i !== idx))
    }

    const subtotal = cart.reduce((s, c) => s + qrPriceOf(c.item) * c.quantity, 0)
    const tax = cart.reduce((s, c) => s + qrPriceOf(c.item) * c.quantity * Number(c.item.gst_slab) / 100, 0)
    // Coupon discount is clamped to the subtotal; GST stays on the supply value.
    const discount = coupon ? Math.min(coupon.discount, subtotal) : 0
    const grandTotal = Math.round(((subtotal - discount) + tax) * 100) / 100
    const totalQty = cart.reduce((s, c) => s + c.quantity, 0)

    // Upsell suggestions: recommended add-ons for whatever's in the cart, minus
    // anything already in the cart, deduped, capped at 5.
    const suggestions = useMemo<MenuItemLite[]>(() => {
        if (cart.length === 0) return []
        const byId = new Map(items.map((i) => [i.id, i]))
        const inCart = new Set(cart.map((c) => c.item.id))
        const seen = new Set<string>()
        const out: MenuItemLite[] = []
        for (const line of cart) {
            for (const rid of recs[line.item.id] ?? []) {
                if (inCart.has(rid) || seen.has(rid)) continue
                const it = byId.get(rid)
                if (!it || it.is_sold_out) continue
                seen.add(rid)
                out.push(it)
                if (out.length >= 5) return out
            }
        }
        return out
    }, [cart, recs, items])

    async function applyCoupon() {
        if (!tenant) return
        const code = couponInput.trim()
        if (!code) return
        if (subtotal <= 0) return toast.error("Add items first")
        setCouponBusy(true)
        try {
            const r = await fetch("/api/public/qr/validate-coupon", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tenant_slug: tenant.slug, code, subtotal }),
            })
            const d = await r.json() as { valid: boolean; error?: string; code?: string; description?: string | null; discount?: number }
            if (!d.valid) return toast.error(d.error ?? "Invalid coupon")
            setCoupon({ code: d.code ?? code, description: d.description ?? null, discount: Number(d.discount ?? 0) })
            toast.success(`Applied ${d.code ?? code} — ${money(Number(d.discount ?? 0))} off`)
        } catch {
            toast.error("Couldn't check that code — try again")
        } finally {
            setCouponBusy(false)
        }
    }
    function removeCoupon() { setCoupon(null); setCouponInput("") }

    // If the cart changes after a coupon is applied, re-validate it (the new
    // subtotal might no longer meet the minimum, or the discount changes for
    // percent coupons). Clears it with a toast if it no longer applies.
    useEffect(() => {
        if (!coupon || !tenant || subtotal <= 0) return
        let cancelled = false
        const t = setTimeout(async () => {
            try {
                const r = await fetch("/api/public/qr/validate-coupon", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tenant_slug: tenant.slug, code: coupon.code, subtotal }),
                })
                const d = await r.json() as { valid: boolean; error?: string; discount?: number }
                if (cancelled) return
                if (!d.valid) {
                    setCoupon(null)
                    toast.message(`Coupon removed — ${d.error ?? "no longer applies to this cart"}`)
                } else if (Number(d.discount ?? 0) !== coupon.discount) {
                    setCoupon((c) => c ? { ...c, discount: Number(d.discount ?? 0) } : c)
                }
            } catch { /* keep the current coupon; server re-validates at order time */ }
        }, 400)
        return () => { cancelled = true; clearTimeout(t) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subtotal])

    function startNewOrder() {
        clearPersistedOrder(params.tenantSlug, params.tableNum)
        setOrderId(null)
        setOrderNumber(null)
        setBillAmount(0)
        setOrderSummary(null)
        setRejectReason(null)
        setProofFile(null)
        setUpiQrUrl("")
        setPaytmIntent(null)
        setCart([])
        removeCoupon()
        setStage("browse")
    }

    async function placeOrder() {
        if (!tenant) return
        if (cart.length === 0) return toast.error("Cart is empty")
        setBusy(true)
        try {
            const r = await fetch("/api/public/qr/place-order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tenant_slug: tenant.slug,
                    table_number: params.tableNum,
                    customer_name: customerName || undefined,
                    customer_phone: customerPhone || undefined,
                    notes: orderNotes || undefined,
                    expected_total: grandTotal,
                    coupon_code: coupon?.code || undefined,
                    items: cart.map((c) => ({ menu_item_id: c.item.id, quantity: c.quantity, notes: c.notes })),
                }),
            })
            const data = await r.json()
            if (!r.ok) {
                if (data.error === "price_changed") {
                    toast.error(data.message ?? "Prices changed — please review and try again")
                    const m = await fetch(`/api/public/qr/menu/${params.tenantSlug}?table=${encodeURIComponent(params.tableNum)}`)
                    if (m.ok) { const md = await m.json(); setItems(md.items) }
                } else if (data.sold_out_items?.length) {
                    toast.error(`Sold out: ${data.sold_out_items.join(", ")}`)
                    const m = await fetch(`/api/public/qr/menu/${params.tenantSlug}?table=${encodeURIComponent(params.tableNum)}`)
                    if (m.ok) { const md = await m.json(); setItems(md.items) }
                } else if (r.status === 429) {
                    toast.error(data.error ?? "Too many requests — please wait a moment")
                } else {
                    toast.error(data.error ?? "Failed to place order")
                }
                setBusy(false); return
            }
            setOrderId(data.order_id)
            setOrderNumber(data.order_number ?? null)
            setBillAmount(Number(data.amount))
            // Snapshot the cart into an order summary so reload + awaiting screen
            // both have something to render before the next poll lands.
            setOrderSummary({
                items: cart.map((c) => {
                    const unit = qrPriceOf(c.item)
                    return {
                        item_name: c.item.name,
                        quantity: c.quantity,
                        unit_price: unit,
                        gst_slab: Number(c.item.gst_slab),
                        taxable_amount: unit * c.quantity,
                        line_total: unit * c.quantity,
                    }
                }),
                subtotal,
                tax: Math.round(tax * 100) / 100,
                grand_total: Number(data.amount),
                order_number: data.order_number ?? null,
                customer_name: customerName || null,
                customer_phone: customerPhone || null,
                // No bill yet — it's created after payment captures. The
                // poller's summaryFromStatus() fills these once the server
                // confirms the bill row exists.
                bill_url: null,
                invoice_number: null,
            })
            writePersistedOrder(params.tenantSlug, params.tableNum, data.order_id)

            // Paytm — show the dynamic UPI QR. The customer scans it from
            // any UPI app; the Paytm webhook auto-confirms (no screenshot).
            if (data.gateway === "paytm" && data.paytm?.qr_data) {
                const qrPng = data.paytm.qr_image
                    ? `data:image/png;base64,${data.paytm.qr_image}`
                    : await QRCode.toDataURL(data.paytm.qr_data, {
                        margin: 1, width: 360, color: { dark: "#0a0e1a", light: "#ffffff" },
                    })
                setUpiQrUrl(qrPng)
                setPaytmIntent(data.paytm.qr_data)
                setStage("pay_manual")
                setCartOpen(false)
                setBusy(false); return
            }

            // Stripe path — redirect the customer to Stripe's hosted Checkout.
            // After payment they bounce back to /qr/<slug>/<table>?paid=<orderId>;
            // the page's existing reload-restore picks the order back up from
            // localStorage and the polling loop confirms once the webhook fires.
            if (data.gateway === "stripe" && data.stripe?.checkout_url) {
                window.location.href = data.stripe.checkout_url
                return
            }

            const qrPng = await buildUpiQr(Number(data.amount), {
                ...tenant,
                upi_id: data.manual?.upi_id ?? tenant.upi_id,
                upi_payee_name: data.manual?.upi_payee_name ?? tenant.upi_payee_name,
            })
            setUpiQrUrl(qrPng)
            setStage("pay_manual")
            setCartOpen(false)
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to place order")
        } finally {
            setBusy(false)
        }
    }

    async function uploadProof() {
        if (!proofFile) return toast.error("Pick a screenshot")
        if (!orderId || !tenant) return
        setBusy(true)
        try {
            const fd = new FormData()
            fd.append("file", proofFile)
            fd.append("order_id", orderId)
            fd.append("amount", String(billAmount))
            fd.append("customer_name", customerName)
            fd.append("customer_phone", customerPhone)
            fd.append("upi_id_used", tenant.upi_id ?? "")
            const r = await fetch("/api/public/qr/upload-proof", { method: "POST", body: fd })
            const data = await r.json()
            if (!r.ok) throw new Error(data.error ?? "Upload failed")
            setStage("awaiting_confirmation")
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Upload failed")
        } finally {
            setBusy(false)
        }
    }

    function copyUpi() {
        if (!tenant?.upi_id) return
        navigator.clipboard.writeText(tenant.upi_id).catch(() => {})
        toast.success("UPI ID copied")
    }

    if (menuLoadStatus === "not_found") {
        return (
            <div className="min-h-screen grid place-items-center p-6">
                <div className="max-w-md w-full glass-strong rounded-3xl p-8 text-center">
                    <Utensils className="h-12 w-12 mx-auto text-muted-foreground" />
                    <h1 className="text-xl font-bold mt-4">Restaurant not found</h1>
                    <p className="text-muted-foreground mt-2 text-sm">
                        This QR code points to a restaurant we couldn&apos;t locate. Please ask staff for help or scan a different code.
                    </p>
                </div>
            </div>
        )
    }
    if (menuLoadStatus === "network_error") {
        return (
            <div className="min-h-screen grid place-items-center p-6">
                <div className="max-w-md w-full glass-strong rounded-3xl p-8 text-center">
                    <RefreshCw className="h-12 w-12 mx-auto text-muted-foreground" />
                    <h1 className="text-xl font-bold mt-4">Can&apos;t load the menu</h1>
                    <p className="text-muted-foreground mt-2 text-sm">
                        Check your connection and try again. The menu loads from the restaurant&apos;s server.
                    </p>
                    <Button variant="neon" className="mt-6" onClick={loadMenu}>
                        <RefreshCw className="h-4 w-4" /> Retry
                    </Button>
                </div>
            </div>
        )
    }
    if (!tenant || restoring) {
        return <div className="min-h-screen p-4 max-w-2xl mx-auto pt-10 space-y-3">
            <Skeleton className="h-12" /><Skeleton className="h-64" />
        </div>
    }
    // Menu loaded but has zero items — the restaurant hasn't published anything.
    if (menuLoadStatus === "ok" && items.length === 0 && stage === "browse") {
        return (
            <div className="min-h-screen grid place-items-center p-6">
                <div className="max-w-md w-full glass-strong rounded-3xl p-8 text-center">
                    <Utensils className="h-12 w-12 mx-auto text-muted-foreground" />
                    <h1 className="text-xl font-bold mt-4">{tenant.name}</h1>
                    <p className="text-muted-foreground mt-2 text-sm">
                        Menu isn&apos;t available right now. Please ask staff for help or check back in a few minutes.
                    </p>
                </div>
            </div>
        )
    }
    // Online-gateway required but the restaurant hasn't finished payment
    // setup. Block ordering entirely with a clear message — telling the
    // customer it's a config issue, not their fault. The menu API already
    // resolved the country-correct gateway (Paytm for India, Stripe
    // elsewhere); we just check the matching readiness flag.
    const gatewayUnready =
        (tenant.payment_gateway === "paytm"  && tenant.paytm_ready  === false) ||
        (tenant.payment_gateway === "stripe" && tenant.stripe_ready === false)
    if (menuLoadStatus === "ok" && stage === "browse" && gatewayUnready) {
        return (
            <div className="min-h-screen grid place-items-center p-6">
                <div className="max-w-md w-full glass-strong rounded-3xl p-8 text-center space-y-3">
                    <Receipt className="h-12 w-12 mx-auto text-muted-foreground" />
                    <h1 className="text-xl font-bold">{tenant.name}</h1>
                    <p className="text-muted-foreground text-sm">
                        Online ordering is being set up. Please ask a staff member to take your order in person.
                    </p>
                </div>
            </div>
        )
    }

    if (stage === "confirmed") {
        return (
            <SuccessScreen
                orderNumber={orderNumber}
                summary={orderSummary}
                onStartNew={startNewOrder}
                currency={cfg.currency}
                taxLabel={taxLabel || "Tax"}
            />
        )
    }

    if (stage === "rejected") {
        return (
            <div className="min-h-screen grid place-items-center p-6">
                <motion.div
                    initial={{ opacity: 0, scale: 0.85, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    className="max-w-md w-full glass-strong rounded-3xl p-8 text-center"
                >
                    <motion.div
                        initial={{ rotate: -90, scale: 0 }}
                        animate={{ rotate: 0, scale: 1 }}
                        transition={{ type: "spring", stiffness: 220 }}
                    >
                        <XCircle className="h-16 w-16 text-destructive mx-auto" />
                    </motion.div>
                    <h1 className="text-2xl font-bold mt-4">Payment couldn&apos;t be verified</h1>
                    <p className="text-muted-foreground mt-2 text-sm">{rejectReason ?? "Please ask a waiter for help."}</p>

                    {orderSummary && orderSummary.items.length > 0 && (
                        <div className="mt-5 text-left rounded-xl bg-card/60 border border-border/50 p-4 space-y-2">
                            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                                <Receipt className="h-3.5 w-3.5" />
                                Order {orderSummary.order_number ?? ""}
                            </div>
                            <OrderLines items={orderSummary.items} money={money} taxLabel={taxLabel} />
                            <div className="border-t border-border/40 pt-2 flex justify-between text-sm font-semibold">
                                <span>Total</span>
                                <span>{money(orderSummary.grand_total)}</span>
                            </div>
                        </div>
                    )}

                    <Button className="mt-6 w-full" variant="outline" onClick={startNewOrder}>
                        Try again
                    </Button>
                </motion.div>
            </div>
        )
    }

    if (stage === "awaiting_confirmation") {
        return (
            <div className="min-h-screen grid place-items-center p-6 relative overflow-hidden">
                <motion.div
                    aria-hidden
                    className="absolute inset-0 grid-bg"
                    animate={{ opacity: [0.3, 0.6, 0.3] }}
                    transition={{ duration: 3, repeat: Infinity }}
                />
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="max-w-md w-full glass-strong rounded-3xl p-8 text-center relative z-10 neon-border"
                >
                    <div className="mx-auto h-24 w-24 mb-6 relative">
                        <motion.div
                            className="absolute inset-0 rounded-full"
                            style={{
                                background: "conic-gradient(from 0deg, hsl(var(--neon-cyan)), hsl(var(--neon-magenta)), hsl(var(--neon-cyan)))",
                            }}
                            animate={{ rotate: 360 }}
                            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                        />
                        <motion.div
                            className="absolute inset-2 rounded-full bg-card grid place-items-center"
                            animate={{ scale: [1, 1.08, 1] }}
                            transition={{ duration: 1.6, repeat: Infinity }}
                        >
                            <Utensils className="h-8 w-8 text-primary" />
                        </motion.div>
                    </div>

                    <h1 className="text-2xl font-bold">Verifying with restaurant…</h1>
                    <p className="text-muted-foreground mt-2 text-sm text-balance">
                        We&apos;ve sent your payment to the kitchen. Hang tight — your food is moments away.
                    </p>

                    <div className="grid grid-cols-2 gap-3 mt-6 text-sm">
                        <div className="rounded-md bg-muted/40 p-3">
                            <div className="text-xs text-muted-foreground">Amount</div>
                            <div className="font-semibold">{money(billAmount || orderSummary?.grand_total || 0)}</div>
                        </div>
                        <div className="rounded-md bg-muted/40 p-3">
                            <div className="text-xs text-muted-foreground">Table</div>
                            <div className="font-mono font-semibold">{params.tableNum}</div>
                        </div>
                    </div>

                    {orderSummary && orderSummary.items.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                            className="mt-4 text-left rounded-xl bg-card/60 border border-border/50 p-4 space-y-2"
                        >
                            <div className="flex items-center justify-between">
                                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                                    <Receipt className="h-3.5 w-3.5" />
                                    Order {orderSummary.order_number ?? orderId?.slice(0, 8)}
                                </div>
                                <Badge variant="outline" className="text-[10px]">{orderSummary.items.reduce((s, i) => s + i.quantity, 0)} items</Badge>
                            </div>
                            <OrderLines items={orderSummary.items} money={money} taxLabel={taxLabel} />
                            <div className="border-t border-border/40 pt-2 space-y-1 text-sm">
                                <div className="flex justify-between text-muted-foreground">
                                    <span>Subtotal</span>
                                    <span>{money(orderSummary.subtotal)}</span>
                                </div>
                                {Number(orderSummary.tax) > 0 && (
                                    <div className="flex justify-between text-muted-foreground">
                                        <span>{taxLabel || "Tax"}</span>
                                        <span>{money(orderSummary.tax)}</span>
                                    </div>
                                )}
                                <div className="flex justify-between font-semibold">
                                    <span>Total</span>
                                    <span>{money(orderSummary.grand_total)}</span>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* Timeout fallback messages */}
                    {awaitingSeconds >= 30 && awaitingSeconds < 90 && (
                        <motion.div
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            className="mt-4 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-left"
                        >
                            Taking longer than usual ({awaitingSeconds}s). The restaurant should confirm any moment now.
                            If it doesn&apos;t, the waiter at your table can resolve it.
                        </motion.div>
                    )}
                    {awaitingSeconds >= 90 && (
                        <motion.div
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-left space-y-2"
                        >
                            <div className="font-semibold">Still waiting?</div>
                            <p className="text-xs text-muted-foreground">
                                Show this screen to a waiter — your payment {tenant.payment_gateway === "manual" ? "screenshot was uploaded" : "was received"} but the kitchen hasn&apos;t confirmed yet.
                                Order # <span className="font-mono">{orderNumber ?? orderId?.slice(0, 8)}</span>
                            </p>
                        </motion.div>
                    )}

                    <Button variant="ghost" size="sm" className="mt-6" onClick={async () => {
                        if (!orderId) return
                        const r = await fetch(`/api/public/qr/order-status/${orderId}`, { cache: "no-store" })
                        if (r.ok) {
                            const d = await r.json() as StatusResponse
                            setOrderSummary(summaryFromStatus(d))
                            if (d.stage === "confirmed") setStage("confirmed")
                            else if (d.stage === "rejected") {
                                setStage("rejected")
                                setRejectReason(d.order.rejected_reason)
                            }
                        }
                    }}>
                        <RefreshCw className="h-3.5 w-3.5" /> Refresh ({awaitingSeconds}s)
                    </Button>
                </motion.div>
            </div>
        )
    }

    if (stage === "pay_manual") {
        // Paytm flow: the QR is a Paytm dynamic QR — auto-confirmed by the
        // webhook, so no screenshot upload. A `upi:` intent also opens the
        // customer's own UPI app one-tap; anything else is QR-scan only.
        const isPaytmPay = paytmIntent !== null
        const upiDeepLink = isPaytmPay && /^upi:/i.test(paytmIntent ?? "") ? paytmIntent : null
        return (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="min-h-screen p-4 max-w-md mx-auto pt-6 space-y-4"
            >
                <div className="glass-strong rounded-2xl p-6 space-y-4 neon-border">
                    <div className="text-center space-y-1">
                        <Sparkles className="h-7 w-7 text-primary mx-auto" />
                        <h2 className="text-2xl font-bold">Pay <span className="text-gradient">{money(billAmount)}</span></h2>
                        <p className="text-xs text-muted-foreground">
                            {isPaytmPay
                                ? "Scan with any UPI app — Google Pay, PhonePe, Paytm, BHIM. We confirm your payment automatically."
                                : "Scan with any UPI app, then upload your payment screenshot."}
                        </p>
                    </div>
                    {upiQrUrl && (
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ delay: 0.2 }}
                            className="text-center bg-white p-4 rounded-xl"
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={upiQrUrl} alt="UPI QR code" className="mx-auto" />
                        </motion.div>
                    )}
                    {isPaytmPay ? (
                        <div className="rounded-md bg-muted/40 p-3 text-sm space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Table</span>
                                <span className="font-mono">{params.tableNum}</span>
                            </div>
                            {orderNumber && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Order</span>
                                    <span className="font-mono">{orderNumber}</span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="rounded-md bg-muted/40 p-3 text-sm space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="text-xs text-muted-foreground">Pay to</div>
                                    <div className="font-medium truncate">{tenant.upi_payee_name ?? tenant.name}</div>
                                    <div className="font-mono text-xs truncate">{tenant.upi_id}</div>
                                </div>
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={copyUpi}><Copy className="h-3.5 w-3.5" /></Button>
                            </div>
                            <div className="flex justify-between text-sm pt-2 border-t border-border/40">
                                <span className="text-muted-foreground">Table</span>
                                <span className="font-mono">{params.tableNum}</span>
                            </div>
                            {orderNumber && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Order</span>
                                    <span className="font-mono">{orderNumber}</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {orderSummary && orderSummary.items.length > 0 && (
                    <div className="glass-strong rounded-2xl p-4">
                        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
                            <Receipt className="h-3.5 w-3.5" /> Your order
                        </div>
                        <OrderLines items={orderSummary.items} money={money} taxLabel={taxLabel} />
                    </div>
                )}

                {isPaytmPay ? (
                    <div className="glass-strong rounded-2xl p-5 space-y-3">
                        {upiDeepLink && (
                            <Button asChild variant="neon" size="lg" className="w-full">
                                <a href={upiDeepLink}>
                                    <Smartphone className="h-4 w-4" /> Pay now with a UPI app
                                </a>
                            </Button>
                        )}
                        <p className="text-xs text-muted-foreground text-center">
                            {upiDeepLink
                                ? "Paying yourself? Tap the button. A friend paying for you? Let them scan the QR above."
                                : "Scan the QR with any UPI app to pay."}
                        </p>
                        <Button
                            variant="outline"
                            size="lg"
                            className="w-full"
                            onClick={() => { setStage("awaiting_confirmation"); setCartOpen(false) }}
                        >
                            <CheckCircle2 className="h-4 w-4" /> I&apos;ve paid
                        </Button>
                        <p className="text-[11px] text-muted-foreground text-center">
                            We confirm automatically the moment your payment lands — no screenshot needed.
                        </p>
                        <Button variant="ghost" size="sm" className="w-full" onClick={startNewOrder}>← Cancel and start over</Button>
                    </div>
                ) : (
                    <div className="glass-strong rounded-2xl p-5 space-y-3">
                        <div className="flex items-center gap-2">
                            <Camera className="h-4 w-4 text-primary" />
                            <h3 className="font-semibold">Upload payment screenshot</h3>
                        </div>
                        <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
                            className="block w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary/10 file:text-primary file:font-medium hover:file:bg-primary/20"
                        />
                        <AnimatePresence>
                            {proofFile && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="rounded-md bg-success/10 border border-success/30 p-2 text-xs flex items-center gap-2 overflow-hidden"
                                >
                                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                                    {proofFile.name} ({Math.round(proofFile.size / 1024)} KB)
                                </motion.div>
                            )}
                        </AnimatePresence>
                        <Button variant="neon" size="lg" className="w-full" onClick={uploadProof} disabled={!proofFile || busy}>
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                            Submit for verification
                        </Button>
                        <Button variant="ghost" size="sm" className="w-full" onClick={startNewOrder}>← Cancel and start over</Button>
                    </div>
                )}
            </motion.div>
        )
    }

    // ============ STAGE: BROWSE ============
    return (
        <div className="min-h-screen pb-32 relative">
            <div className="fixed inset-0 grid-bg pointer-events-none -z-10" />
            <motion.div
                aria-hidden
                className="fixed -top-32 -left-32 h-80 w-80 rounded-full bg-primary/10 blur-3xl pointer-events-none -z-10"
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
                aria-hidden
                className="fixed -bottom-32 -right-32 h-80 w-80 rounded-full bg-[hsl(var(--neon-magenta)/0.1)] blur-3xl pointer-events-none -z-10"
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }}
            />

            <FlyOverlay events={fly.events} onComplete={fly.complete} />

            {/* McDonald's-style "add item" sheet */}
            <ItemAddDialog<MenuItemLite>
                item={addingItem}
                recommended={addingItem ? recommendedFor(addingItem) : []}
                inCartIds={new Set(cart.map((c) => c.item.id))}
                currency={cfg.currency}
                taxLabel={taxLabel}
                onClose={() => setAddingItem(null)}
                onAdd={(it, qty, notes) => addLine(it, qty, notes)}
                onQuickAdd={(it) => addLine(it, 1, "")}
            />

            <header className="sticky top-0 z-20 glass-strong border-b border-border/40 px-4 py-3">
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3"
                >
                    {tenant.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={tenant.logo_url}
                            alt={tenant.name}
                            className="h-10 w-10 rounded-xl object-cover shadow-glow border border-border/60"
                        />
                    ) : (
                        // No restaurant logo on file — use the tenant's
                        // first letter as a brand-neutral mark instead of
                        // a Sparkles icon (which read as "RestoPOS" to a
                        // customer expecting the restaurant's identity).
                        <div className="grid place-items-center h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-[hsl(var(--neon-magenta))] shadow-glow text-primary-foreground font-bold text-lg">
                            {tenant.name.slice(0, 1).toUpperCase()}
                        </div>
                    )}
                    <div className="flex-1 min-w-0">
                        <div className="font-bold text-lg leading-tight truncate text-gradient">{tenant.name}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Badge variant="outline" className="text-[10px] py-0 px-1.5">Table {params.tableNum}</Badge>
                            {tenant.payment_gateway === "paytm" && (
                                <Badge variant="neon" className="text-[10px] py-0 px-1.5"><Zap className="h-2.5 w-2.5 mr-0.5" />Instant</Badge>
                            )}
                        </div>
                    </div>
                    <ThemeToggle />
                </motion.div>
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.1 }}
                    className="relative mt-3"
                >
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search the menu…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 bg-card/60" />
                </motion.div>
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="flex gap-2 mt-3 overflow-x-auto scrollbar-thin pb-1"
                >
                    <CatChip active={activeCat === "ALL"} onClick={() => setActiveCat("ALL")}>All</CatChip>
                    {usefulCategories.map((c) => (
                        <CatChip key={c.id} active={activeCat === c.id} onClick={() => setActiveCat(c.id)}>{c.name}</CatChip>
                    ))}
                </motion.div>
            </header>

            <main className="px-4 pt-5 max-w-2xl mx-auto">
                {visibleItems.length === 0 ? (
                    <div className="text-center py-20 text-muted-foreground">
                        <Utensils className="h-10 w-10 mx-auto mb-3 opacity-40" />
                        <p>No items found.</p>
                    </div>
                ) : groupedItems ? (
                    <div className="space-y-8">
                        {groupedItems.map((group) => (
                            <section key={group.name}>
                                <h2 className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-semibold mb-3 px-1 flex items-center gap-2">
                                    <span className="h-px flex-1 bg-gradient-to-r from-primary/40 to-transparent" />
                                    {group.name}
                                    <span className="h-px flex-1 bg-gradient-to-l from-primary/40 to-transparent" />
                                </h2>
                                <div className="space-y-3">
                                    {group.items.map((it) => <MenuCard key={it.id} item={it} onAdd={openItem} money={money} taxLabel={taxLabel} />)}
                                </div>
                            </section>
                        ))}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {visibleItems.map((it) => <MenuCard key={it.id} item={it} onAdd={openItem} money={money} taxLabel={taxLabel} />)}
                    </div>
                )}
            </main>

            <AnimatePresence>
                {totalQty > 0 && !cartOpen && (
                    <motion.button
                        ref={cartButtonRef}
                        initial={{ y: 100, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 100, opacity: 0 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => setCartOpen(true)}
                        className="fixed bottom-5 left-4 right-4 z-30 max-w-2xl mx-auto rounded-2xl bg-primary p-4 shadow-glow-lg flex items-center justify-between text-primary-foreground font-semibold"
                    >
                        <motion.span
                            key={fly.bumpKey}
                            animate={{ scale: [1, 1.4, 1] }}
                            transition={{ duration: 0.4 }}
                            className="grid place-items-center h-9 w-9 rounded-full bg-white/20 backdrop-blur"
                        >
                            <ShoppingBag className="h-4 w-4" />
                        </motion.span>
                        <div className="flex-1 mx-3 text-left">
                            <div className="text-xs opacity-80">{totalQty} item{totalQty > 1 ? "s" : ""} in cart</div>
                            <div className="text-base">View cart · {money(grandTotal)}</div>
                        </div>
                        <ChevronUp className="h-5 w-5 opacity-80" />
                    </motion.button>
                )}
            </AnimatePresence>

            {cartOpen && (
                <button ref={cartButtonRef} aria-hidden tabIndex={-1} className="fixed bottom-5 right-5 h-1 w-1 opacity-0 pointer-events-none" />
            )}

            <AnimatePresence>
                {cartOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setCartOpen(false)}
                            className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ y: "100%" }}
                            animate={{ y: 0 }}
                            exit={{ y: "100%" }}
                            transition={{ type: "spring", damping: 26, stiffness: 320 }}
                            className="fixed bottom-0 left-0 right-0 z-50 max-w-2xl mx-auto rounded-t-3xl glass-strong border-t border-border/60 p-5 max-h-[88vh] overflow-y-auto scrollbar-thin"
                        >
                            <div className="mx-auto h-1 w-12 rounded-full bg-muted mb-4" />
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    <ShoppingBag className="h-5 w-5 text-primary" /> Your order
                                </h2>
                                <Button variant="ghost" size="sm" onClick={() => setCart([])} disabled={cart.length === 0}>Clear</Button>
                            </div>

                            {cart.length === 0 ? (
                                <div className="text-center py-10 text-muted-foreground">
                                    <ShoppingBag className="h-10 w-10 mx-auto mb-2 opacity-40" />
                                    Your cart is empty.
                                </div>
                            ) : (
                                <ul className="space-y-2">
                                    <AnimatePresence>
                                        {cart.map((c, i) => (
                                            <motion.li
                                                key={`${c.item.id}-${c.notes ?? ""}`}
                                                layout
                                                initial={{ opacity: 0, x: -50, scale: 0.9 }}
                                                animate={{ opacity: 1, x: 0, scale: 1 }}
                                                exit={{
                                                    opacity: 0, x: 200, scale: 0.6, rotate: 15,
                                                    transition: { duration: 0.3 },
                                                }}
                                                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                                                className="flex items-center gap-3 rounded-xl bg-card/60 border border-border/50 p-3"
                                            >
                                                <span
                                                    className="h-2.5 w-2.5 rounded-full shrink-0 mt-0.5 self-start"
                                                    style={{ backgroundColor: FOOD_TYPE_COLOR[c.item.food_type] }}
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium truncate">{c.item.name}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {money(qrPriceOf(c.item))} × {c.quantity}
                                                        {c.item.sale_price != null && Number(c.item.sale_price) < Number(c.item.base_price) && (
                                                            <span className="ml-1 line-through opacity-60">{money(c.item.base_price)}</span>
                                                        )}
                                                    </div>
                                                    {c.notes && <div className="text-xs italic text-amber-400 truncate">⤷ {c.notes}</div>}
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <motion.button
                                                        whileTap={{ scale: 0.85 }}
                                                        onClick={() => changeQty(i, -1)}
                                                        className="h-8 w-8 rounded-md border border-border grid place-items-center hover:bg-accent"
                                                    >
                                                        <Minus className="h-3.5 w-3.5" />
                                                    </motion.button>
                                                    <span className="w-7 text-center font-semibold tabular-nums">{c.quantity}</span>
                                                    <motion.button
                                                        whileTap={{ scale: 0.85 }}
                                                        onClick={() => changeQty(i, 1)}
                                                        className="h-8 w-8 rounded-md border border-border grid place-items-center hover:bg-accent"
                                                    >
                                                        <Plus className="h-3.5 w-3.5" />
                                                    </motion.button>
                                                </div>
                                                <motion.button
                                                    whileTap={{ scale: 0.85, rotate: -10 }}
                                                    onClick={() => removeItem(i)}
                                                    className="h-8 w-8 rounded-md grid place-items-center text-destructive hover:bg-destructive/10"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </motion.button>
                                            </motion.li>
                                        ))}
                                    </AnimatePresence>
                                </ul>
                            )}

                            {/* Upsell chips — "pairs well with…" */}
                            {cart.length > 0 && suggestions.length > 0 && (
                                <div className="mt-4">
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                                        <Lightbulb className="h-3.5 w-3.5 text-primary" />
                                        <span className="font-semibold uppercase tracking-wider">Pairs well with</span>
                                    </div>
                                    <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
                                        {suggestions.map((s) => (
                                            <motion.button
                                                key={s.id}
                                                whileTap={{ scale: 0.94 }}
                                                onClick={(e) => addToCart(s, e.currentTarget)}
                                                className="shrink-0 flex items-center gap-2 rounded-full bg-primary/15 border border-primary/30 hover:bg-primary/25 transition-colors px-3 py-1.5 text-xs"
                                            >
                                                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: FOOD_TYPE_COLOR[s.food_type] }} />
                                                <span className="font-medium">{s.name}</span>
                                                <span className="text-muted-foreground">{money(qrPriceOf(s))}</span>
                                                <Plus className="h-3 w-3 text-primary" />
                                            </motion.button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {cart.length > 0 && (
                                <>
                                    <div className="mt-4 grid grid-cols-2 gap-2">
                                        <div className="space-y-1.5">
                                            <Label className="text-xs">Your name</Label>
                                            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Optional" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-xs">Phone</Label>
                                            <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="For loyalty" />
                                        </div>
                                    </div>
                                    <Textarea
                                        placeholder="Special requests (e.g. less spicy, no onion)"
                                        value={orderNotes}
                                        onChange={(e) => setOrderNotes(e.target.value)}
                                        className="mt-3 min-h-[60px]"
                                    />

                                    {/* Coupon code */}
                                    {coupon ? (
                                        <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-success/10 border border-success/30 px-3 py-2">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                                                <div className="min-w-0">
                                                    <div className="font-mono font-semibold text-success truncate">{coupon.code}</div>
                                                    {coupon.description && <div className="text-xs text-muted-foreground truncate">{coupon.description}</div>}
                                                </div>
                                            </div>
                                            <button onClick={removeCoupon} className="h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground">
                                                <XCircle className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="mt-3 flex gap-2">
                                            <div className="relative flex-1">
                                                <Tag className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                                <Input
                                                    value={couponInput}
                                                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                                                    placeholder="Coupon code"
                                                    className="pl-8 font-mono"
                                                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyCoupon())}
                                                />
                                            </div>
                                            <Button variant="outline" onClick={applyCoupon} disabled={!couponInput.trim() || couponBusy}>
                                                {couponBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                                            </Button>
                                        </div>
                                    )}

                                    <div className="mt-4 rounded-xl bg-card/60 p-4 space-y-1 border border-border/50">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">Subtotal</span>
                                            <span>{money(subtotal)}</span>
                                        </div>
                                        {discount > 0 && (
                                            <div className="flex justify-between text-sm text-success">
                                                <span>Coupon ({coupon?.code})</span>
                                                <span>− {money(discount)}</span>
                                            </div>
                                        )}
                                        {taxLabel && tax > 0 && (
                                            <div className="flex justify-between text-sm">
                                                <span className="text-muted-foreground">{taxLabel}</span>
                                                <span>{money(tax)}</span>
                                            </div>
                                        )}
                                        <div className="flex justify-between text-base font-bold pt-2 border-t border-border/40">
                                            <span>Total</span>
                                            <span className="text-gradient">{money(grandTotal)}</span>
                                        </div>
                                    </div>

                                    <Button
                                        variant="neon"
                                        size="lg"
                                        className="w-full mt-4 h-14 text-base"
                                        onClick={placeOrder}
                                        disabled={busy}
                                    >
                                        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
                                        Place order &amp; pay {money(grandTotal)}
                                    </Button>
                                    {tenant.payment_gateway === "paytm" && (
                                        <p className="text-[10px] text-center text-muted-foreground mt-2">
                                            ⚡ Instant confirmation · UPI via Paytm
                                        </p>
                                    )}
                                </>
                            )}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    )
}

function OrderLines({ items, money, taxLabel }: { items: OrderSummaryLine[]; money: (v: number) => string; taxLabel: string }) {
    return (
        <ul className="space-y-1.5">
            {items.map((it, idx) => (
                <li key={idx} className="flex justify-between gap-2 text-sm">
                    <div className="min-w-0 flex-1">
                        <div className="truncate"><span className="font-mono text-muted-foreground mr-2">{it.quantity}×</span>{it.item_name}</div>
                        <div className="text-[10px] text-muted-foreground/80">
                            {money(it.unit_price)} each{taxLabel ? ` · ${taxLabel} ${it.gst_slab}%` : ""}
                        </div>
                    </div>
                    <div className="font-medium tabular-nums shrink-0">{money(it.line_total)}</div>
                </li>
            ))}
        </ul>
    )
}

function CatChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={onClick}
            className={cn(
                "px-4 py-1.5 rounded-full text-sm whitespace-nowrap font-medium transition-all relative",
                active
                    ? "bg-primary text-primary-foreground shadow-glow"
                    : "bg-card/60 text-muted-foreground border border-border/60",
            )}
        >
            {children}
        </motion.button>
    )
}

function MenuCard({
    item,
    onAdd,
    money,
    taxLabel,
}: {
    item: MenuItemLite
    onAdd: (it: MenuItemLite) => void
    money: (v: number) => string
    taxLabel: string
}) {
    // Whole card opens the add-to-cart popup — tapping the small + on
    // mobile was too easy to miss. The + becomes a visual cue (it stays
    // there so people learn the affordance) but it's no longer a separate
    // click target; clicking it bubbles up to the card handler.
    const handleOpen = () => {
        if (item.is_sold_out) return
        onAdd(item)
    }
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 22 }}
            role="button"
            tabIndex={item.is_sold_out ? -1 : 0}
            aria-disabled={item.is_sold_out}
            onClick={handleOpen}
            onKeyDown={(e) => {
                if (item.is_sold_out) return
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    handleOpen()
                }
            }}
            className={cn(
                "group relative rounded-2xl glass border border-border/50 p-4 transition-all overflow-hidden select-none",
                item.is_sold_out
                    ? "opacity-60 cursor-not-allowed"
                    : "cursor-pointer hover:border-primary/40 hover:shadow-glow active:scale-[0.99]",
            )}
        >
            <div className="relative flex items-start gap-3">
                {item.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={item.image_url}
                        alt=""
                        className="h-20 w-20 rounded-lg object-cover shrink-0 border border-border/40"
                        loading="lazy"
                    />
                )}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span
                            className="h-3 w-3 rounded-sm border-2 grid place-items-center shrink-0"
                            style={{ borderColor: FOOD_TYPE_COLOR[item.food_type] }}
                            title={item.food_type}
                        >
                            <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: FOOD_TYPE_COLOR[item.food_type] }}
                            />
                        </span>
                        <h3 className="font-semibold text-base leading-tight">{item.name}</h3>
                        {item.is_sold_out && (
                            <Badge variant="destructive" className="text-[10px] py-0 px-1.5">
                                <Ban className="h-2.5 w-2.5 mr-0.5" /> SOLD OUT
                            </Badge>
                        )}
                    </div>
                    {item.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{item.description}</p>
                    )}
                    <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-xl font-bold text-gradient">{money(qrPriceOf(item))}</span>
                        {item.sale_price != null && Number(item.sale_price) < Number(item.base_price) && (
                            <>
                                <span className="text-sm text-muted-foreground line-through">{money(item.base_price)}</span>
                                <Badge variant="destructive" className="text-[10px] py-0">
                                    -{Math.round((1 - qrPriceOf(item) / Number(item.base_price)) * 100)}%
                                </Badge>
                            </>
                        )}
                        {taxLabel && <Badge variant="outline" className="text-[10px] py-0">{taxLabel} {item.gst_slab}%</Badge>}
                    </div>
                </div>

                {/* Visual affordance — NOT a separate click target. The whole
                  * card is the button; the + just signals "tap to add". No
                  * hover/tap scale animation: it was making the tap feel like
                  * something was being added on the spot, which confused the
                  * customer when the popup opened a beat later. */}
                <div
                    aria-hidden
                    className={cn(
                        "shrink-0 h-11 w-11 rounded-xl grid place-items-center font-bold pointer-events-none",
                        item.is_sold_out
                            ? "bg-muted text-muted-foreground"
                            : "bg-gradient-to-br from-primary to-[hsl(var(--neon-magenta))] text-primary-foreground shadow-glow",
                    )}
                >
                    <Plus className="h-5 w-5" />
                </div>
            </div>
        </motion.div>
    )
}
