"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, FileText, Grid3x3, HelpCircle, Lightbulb, Loader2, LogOut, Minus, MonitorSmartphone, Plus, Receipt, RefreshCw, Search, Settings as SettingsIcon, Tag, Trash2, Utensils, UtensilsCrossed, X } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ItemAddDialog } from "@/components/pos/item-add-dialog"
import { PageTour } from "@/components/tours/page-tour"
import { TourReplayButton } from "@/components/tours/tour-replay-button"
import { findCustomerByPhone as findCustomerByPhoneShared, isPhoneShaped as isPhoneShapedShared } from "@/lib/customers/lookup"
import {
    CheckoutPreviewDialog,
    type CheckoutCustomerDetails,
    type CheckoutPayment,
    type CheckoutPaymentMethod,
} from "@/components/pos/checkout-preview-dialog"
import { uniqueChannelName } from "@/lib/supabase/realtime"
import { createClient } from "@/lib/supabase/client"
import { logError } from "@/lib/errors"
import { computeOrder } from "@/lib/gst/calculator"
import { getTaxConfig } from "@/lib/tax/locale-config"
import { useActiveBranch } from "@/lib/branch/active-branch"
import { refillIfLow, remainingCount, returnReservation, takeReservation } from "@/lib/offline/reservation-buffer"
import { enqueue as enqueuePending } from "@/lib/offline/pending-bills"
import { readPosCache, savePosCache, type PosCache } from "@/lib/offline/menu-cache"
import { cn, formatCurrency } from "@/lib/utils"
import type { MenuCategory, MenuItem, OrderType, UserRole } from "@/types/database"

interface CartLine {
    item: MenuItem
    quantity: number
    notes?: string
}

export default function POSPage() {
    // Memoized — createClient() returns a fresh instance per call; a
    // stable reference keeps effects/callbacks from churning.
    const supabase = useMemo(() => createClient(), [])
    const router = useRouter()
    const urlParams = useSearchParams()

    const [loading, setLoading] = useState(true)
    const [tenantId, setTenantId] = useState<string>("")
    // The signed-in cashier's user id. This is the STABLE key for the
    // customer-display row: pos_display_sessions has one row per
    // `created_by`, that row's `id` can churn (delete + re-insert), but
    // `created_by` never changes — so every write targets it by user id.
    const [userId, setUserId] = useState<string>("")
    // The signed-in cashier's role — only OWNER / MANAGER can fix the
    // payment setup, so only they get the "set it up" link if it's missing.
    const [userRole, setUserRole] = useState<UserRole | null>(null)
    const [tenantCountry, setTenantCountry] = useState<string | null>(null)
    const [tenantName, setTenantName] = useState<string>("")
    const [tenantUpiId, setTenantUpiId] = useState<string | null>(null)
    const [tenantUpiPayeeName, setTenantUpiPayeeName] = useState<string | null>(null)
    const [rawServiceChargePct, setRawServiceChargePct] = useState(0)
    /** Tenant default for charging tax on bills (Settings → Tax). Drives the
     *  initial state of the checkout "without tax" toggle; default true. */
    const [taxEnabled, setTaxEnabled] = useState(true)
    const [categories, setCategories] = useState<MenuCategory[]>([])
    const [items, setItems] = useState<MenuItem[]>([])
    /** item_id → ordered list of recommended item ids (upsell suggestions). */
    const [recs, setRecs] = useState<Record<string, string[]>>({})
    const [activeCat, setActiveCat] = useState<string | "ALL">("ALL")
    const [search, setSearch] = useState("")
    const [orderType, setOrderType] = useState<OrderType>("DINE_IN")
    const [tableNo, setTableNo] = useState("")
    /** Active tables in the cashier's branch — drives the dine-in table
     *  dropdown. Fetched once on mount + refreshed whenever a KOT is
     *  sent (so a freshly-occupied table flips status without a manual
     *  reload). Keep the row light: only the fields we render. */
    const [tables, setTables] = useState<Array<{
        id: string
        number: string
        section: string | null
        status: string
        capacity: number | null
    }>>([])
    // Aggregator / channel tag for manual entry (Swiggy / Zomato / phone /
    // walk-in / etc.). NULL = direct / unspecified. Will auto-populate once
    // partner-API integrations are live.
    const [orderSource, setOrderSource] = useState<string | null>(null)

    /** Pay-first dine-in handoff. When `sendKotThenBill()` runs it
     *  creates the order + KOT + items server-side first, then drops
     *  the resulting order id here and opens the checkout dialog.
     *  `generateBill()` reads this on confirm and bills THIS order
     *  instead of creating a fresh one (which would orphan the KOT
     *  the kitchen already received). Cleared on success / dialog
     *  close so the next checkout starts clean. */
    const [prepaidOrderId, setPrepaidOrderId] = useState<string | null>(null)

    // Deep-link from the tables drill-in: /pos?table=T7 pre-selects the
    // table so a waiter coming from "Add more items" lands ready to KOT.
    useEffect(() => {
        const t = urlParams?.get("table")
        if (t) setTableNo(t)
    }, [urlParams])

    const [cart, setCart] = useState<CartLine[]>([])
    // The index of the most-recently-touched cart line. Used to flash a
    // highlight + scroll the line into view so the staffer instantly sees
    // their add land, even if the cart is offscreen on a narrow display.
    const [highlightIdx, setHighlightIdx] = useState<number | null>(null)
    const cartListRef = useRef<HTMLDivElement>(null)
    const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [addingItem, setAddingItem] = useState<MenuItem | null>(null)
    const [checkoutOpen, setCheckoutOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    /** Staged status while the bill is being generated — drives the cashier-
     *  side processing UI and is broadcast to the customer display via
     *  pos_display_sessions.status. "idle" = button shows "Generate". */
    const [generationStage, setGenerationStage] = useState<"idle" | "verifying" | "generating" | "done">("idle")
    /** Live session that mirrors the checkout to the customer-facing display
     *  device at /display/<tenant_slug>. Null when no checkout is open.
     *  Created on dialog-open, updated as cart/totals change, marked
     *  PROCESSING/PAID through bill generation, closed on dialog-close.
     *
     *  Held in BOTH a ref and state:
     *   - the ref is read from async closures inside the bill-generation
     *     handler (state there would race with the insert that
     *     establishes it);
     *   - the STATE is what the cart-sync effect depends on. The session
     *     insert is async — if the cashier adds items FASTER than the
     *     insert resolves, those early cart-change pushes are skipped
     *     (no session id yet) and the display freezes on the first
     *     item. Adding the id as a state dep makes the cart-sync effect
     *     re-fire the moment the id lands, pushing the full current
     *     cart. */
    const displaySessionIdRef = useRef<string | null>(null)
    const [displaySessionId, setDisplaySessionId] = useState<string | null>(null)
    function syncDisplaySession(id: string | null) {
        displaySessionIdRef.current = id
        setDisplaySessionId(id)
    }
    // True once a PhonePe scan-to-pay QR is live on the customer display
    // (India). The checkout dialog then shows "Waiting for payment"
    // instead of the manual Generate button — the webhook owns billing
    // on this path, so the same sale can't be billed twice.
    const [phonepeAutoConfirm, setPhonePeAutoConfirm] = useState(false)
    // The resolved scan-to-pay QR payload for the current UPI checkout —
    // a PhonePe dynamic QR if PhonePe is connected, else a plain merchant-UPI
    // QR. This is the EXACT string the customer screen renders, so the
    // checkout dialog can show an identical QR to the staff.
    const [checkoutQr, setCheckoutQr] = useState<string | null>(null)
    // Non-null once we've determined UPI can't produce a QR — carries the
    // reason (UPI gateway rejected it, nothing configured, …) so the dialog can
    // tell the cashier plainly instead of spinning on "Preparing…".
    const [checkoutQrError, setCheckoutQrError] = useState<string | null>(null)
    // Why the QR is the MANUAL-UPI fallback rather than the PhonePe
    // dynamic QR (which auto-confirms via webhook). Null when PhonePe
    // was the path taken or no PhonePe was configured. Surfaced on the
    // checkout dialog so the cashier knows it'll be a UTR-paste flow
    // and why — not a generic "no info, just enter the ref".
    const [phonepeFallbackReason, setPhonePeFallbackReason] = useState<string | null>(null)
    // Guards the PhonePe display-checkout route from double-firing for the
    // same checkout session (React strict-mode / re-renders).
    const phonepeCheckoutFiredRef = useRef<string | null>(null)
    // Live ref to phonepeAutoConfirm so the once-registered pagehide /
    // unmount handlers read the freshest value (see the Teardown effect).
    const phonepeAutoConfirmRef = useRef(false)
    phonepeAutoConfirmRef.current = phonepeAutoConfirm
    // The payment method the cashier has picked in the checkout dialog.
    // Drives whether the customer display shows a scan-to-pay QR (UPI)
    // or none at all (Cash / Card). `…Ref` mirror for the async route
    // callback, which must check the *current* method, not the captured one.
    const [checkoutMethod, setCheckoutMethod] = useState<CheckoutPaymentMethod>("CASH")
    const checkoutMethodRef = useRef<CheckoutPaymentMethod>("CASH")
    checkoutMethodRef.current = checkoutMethod
    // ── In-flight checkout recovery ─────────────────────────────────────
    // A POS refresh loses the in-memory cart. When a scan-to-pay QR was
    // already live, we recover the sale from pos_display_sessions so the
    // cashier isn't stranded — and the payment still lands + shows here.
    const [recoveredSale, setRecoveredSale] = useState<{
        sessionId: string
        items: Array<{ name: string; quantity: number; unit_price: number }>
        grandTotal: number
        currency: string
    } | null>(null)
    const recoveryDoneRef = useRef(false)
    /** Set once we've warned the cashier that customer-display sync is
     *  failing — so the toast fires ONCE, not on every cart change. */
    const displaySyncWarnedRef = useRef(false)
    const [couponCode, setCouponCode] = useState("")
    const [appliedCoupon, setAppliedCoupon] = useState<{ id: string; code: string; discount: number; description: string | null } | null>(null)
    /** Applied gift card. `amount` is the amount that will be debited
     *  against this checkout — computed as min(balance, grand_total -
     *  coupon_discount) at apply time. `balance` is the gift card's
     *  current balance BEFORE this checkout, so the UI can show
     *  "₹X left after this bill." Atomic redemption + balance
     *  decrement happens server-side inside generate_bill when it sees
     *  a GIFT_CARD entry in p_payments. */
    const [appliedGiftCard, setAppliedGiftCard] = useState<{ code: string; balance: number; amount: number } | null>(null)
    const [giftCardBusy, setGiftCardBusy] = useState(false)
    const [couponBusy, setCouponBusy] = useState(false)
    const [customerPhone, setCustomerPhone] = useState("")
    const [customer, setCustomer] = useState<{ id: string; name: string | null; loyalty_points: number; loyalty_tier: string } | null>(null)
    // Customer details typed into the checkout dialog, mirrored here so the
    // customer-facing display can show the guest's name + phone as they're
    // entered. Empty whenever the checkout dialog is closed.
    const [checkoutDetails, setCheckoutDetails] = useState<CheckoutCustomerDetails>({ name: "", phone: "", email: "" })

    // Active branch context. For OWNER/MANAGER who switch branches via
    // the topbar this drives which menu the POS shows. For everyone else
    // it's locked to their assigned branch_id (set by the OWNER on the
    // Staff page).
    const { activeBranchId, loading: branchLoading } = useActiveBranch()
    const previousBranchRef = useRef<string | null | undefined>(undefined)

    useEffect(() => {
        if (branchLoading) return
        if (previousBranchRef.current === undefined) {
            previousBranchRef.current = activeBranchId
            return
        }
        if (previousBranchRef.current === activeBranchId) return

        previousBranchRef.current = activeBranchId
        setCart([])
        setTableNo("")
        setOrderSource(null)
        setCustomer(null)
        setCustomerPhone("")
        setCouponCode("")
        setAppliedCoupon(null)
        setAppliedGiftCard(null)
        setActiveCat("ALL")
        setCheckoutOpen(false)
        toast.message("Started a clean POS session for this branch.")
    }, [activeBranchId, branchLoading])

    useEffect(() => {
        // Wait for the branch context to resolve so we don't fire the
        // menu query with a stale-null branch then refetch a tick later.
        if (branchLoading) return
        ;(async () => {
            // Restore a cached POS snapshot — the offline fallback when the
            // live load below can't reach Supabase.
            const applyCache = (c: PosCache) => {
                setTenantId(c.tenantId)
                setUserId(c.userId)
                setUserRole(c.userRole)
                setTenantName(c.tenant?.name ?? "")
                setTenantCountry(c.tenant?.country ?? null)
                setTenantUpiId(c.tenant?.upi_id ?? null)
                setTenantUpiPayeeName(c.tenant?.upi_payee_name ?? null)
                setRawServiceChargePct(Number(c.tenant?.service_charge_percent ?? 0))
                setTaxEnabled(c.tenant?.tax_enabled ?? true)
                setCategories(c.categories)
                setItems(c.items)
                setRecs(c.recs)
                setLoading(false)
            }

            // Identity. getUser() makes a network call; getSession() is
            // local-only, so it still resolves the cashier when offline.
            let authUser = (await supabase.auth.getUser()).data.user
            if (!authUser) {
                authUser = (await supabase.auth.getSession()).data.session?.user ?? null
            }
            const { data: row } = authUser
                ? await supabase.from("users").select("tenant_id, role").eq("id", authUser.id).maybeSingle()
                : { data: null }
            const resolvedTenantId = (row as { tenant_id?: string } | null)?.tenant_id ?? null

            if (!authUser || !resolvedTenantId) {
                // No live session/tenant — almost always offline. Fall back
                // to the last saved menu so the till still works.
                const cached = readPosCache()
                if (cached) {
                    applyCache(cached)
                    toast.message("Offline — using your saved menu. Bills sync when you reconnect.", {
                        id: "pos-offline-menu",
                    })
                } else {
                    setLoading(false)
                }
                return
            }

            const resolvedRole = ((row as { role?: UserRole } | null)?.role) ?? null
            setTenantId(resolvedTenantId)
            setUserId(authUser.id)
            setUserRole(resolvedRole)

            // Keep the offline reservation buffer warm so the till can keep
            // billing if the network drops mid-shift. Fire-and-forget — a
            // failure here just leaves whatever buffer we already had.
            refillIfLow(supabase, resolvedTenantId).catch(() => { /* logged in lib */ })

            // Menu query: show items at the active branch + shared items
            // (branch_id null). "All branches" view (activeBranchId null)
            // shows the full catalog — meaningful for owners doing
            // cross-branch reviews.
            let menuQ = supabase
                .from("menu_items")
                .select("*")
                .is("deleted_at", null)
                .eq("is_active", true)
                .order("sort_order")
            if (activeBranchId) {
                menuQ = menuQ.or(`branch_id.eq.${activeBranchId},branch_id.is.null`)
            }
            const [tenantRes, catsRes, itemsRes, recsRes] = await Promise.all([
                supabase.from("tenants").select("name, country, service_charge_percent, upi_id, upi_payee_name, tax_enabled").eq("id", resolvedTenantId).maybeSingle(),
                supabase.from("menu_categories").select("*").is("deleted_at", null).order("sort_order"),
                menuQ,
                supabase
                    .from("menu_item_recommendations")
                    .select("item_id, recommended_item_id, sort_order")
                    .order("sort_order"),
            ])

            // A failed catalog query mid-load means the network dropped —
            // restore the saved menu instead of blanking the till.
            if (catsRes.error || itemsRes.error) {
                const cached = readPosCache()
                if (cached) {
                    applyCache(cached)
                    toast.message("Network issue — using your saved menu.", { id: "pos-offline-menu" })
                } else {
                    setLoading(false)
                }
                return
            }

            const tenant = tenantRes.data as {
                name?: string; country?: string | null; service_charge_percent?: number
                upi_id?: string | null; upi_payee_name?: string | null
                tax_enabled?: boolean | null
            } | null
            const cats = (catsRes.data ?? []) as MenuCategory[]
            const its = (itemsRes.data ?? []) as MenuItem[]
            const recMap: Record<string, string[]> = {}
            for (const r of (recsRes.data ?? []) as { item_id: string; recommended_item_id: string }[]) {
                ;(recMap[r.item_id] ??= []).push(r.recommended_item_id)
            }

            setTenantName(tenant?.name ?? "")
            setTenantCountry(tenant?.country ?? null)
            setTenantUpiId(tenant?.upi_id ?? null)
            setTenantUpiPayeeName(tenant?.upi_payee_name ?? null)
            setRawServiceChargePct(Number(tenant?.service_charge_percent ?? 0))
            setTaxEnabled(tenant?.tax_enabled ?? true)
            setCategories(cats)
            setItems(its)
            setRecs(recMap)
            // Active tables for the dine-in dropdown. Scoped to the
            // active branch — single-branch tenants pass branch_id null
            // so this returns every active table. A POS_DISPLAY filter
            // isn't needed here; we WANT to see OCCUPIED tables too so
            // the waiter can pick "T1" to add a new KOT to an existing
            // running order.
            const tablesQ = supabase
                .from("dining_tables")
                .select("id, number, section, status, capacity")
                .eq("is_active", true)
                .order("section", { ascending: true })
                .order("number", { ascending: true })
            const tablesRes = await (activeBranchId !== null
                ? tablesQ.eq("branch_id", activeBranchId)
                : tablesQ)
            setTables((tablesRes.data ?? []) as Array<{ id: string; number: string; section: string | null; status: string; capacity: number | null }>)
            setLoading(false)

            // Snapshot this good load so the till survives a later outage.
            savePosCache({
                branchId: activeBranchId,
                tenantId: resolvedTenantId,
                userId: authUser.id,
                userRole: resolvedRole,
                tenant: {
                    name: tenant?.name ?? "",
                    country: tenant?.country ?? null,
                    service_charge_percent: Number(tenant?.service_charge_percent ?? 0),
                    upi_id: tenant?.upi_id ?? null,
                    upi_payee_name: tenant?.upi_payee_name ?? null,
                    tax_enabled: tenant?.tax_enabled ?? true,
                },
                categories: cats,
                items: its,
                recs: recMap,
            })
        })()
    }, [supabase, activeBranchId, branchLoading])

    // Clear pending highlight timer when the POS page unmounts so we
    // don't try to setState on a torn-down component.
    useEffect(() => () => {
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    }, [])

    // ── Recover an in-flight checkout after a POS refresh ───────────────
    // If a scan-to-pay QR was live when the screen reloaded, the in-memory
    // cart is gone — but the sale lives on in pos_display_sessions (+ the
    // orders row + phonepe_payment_events). Re-adopt it:
    //   PAID            → the customer already paid; acknowledge + reset.
    //   AWAITING/PROC.  → resume; the customer can still pay (the bill is
    //                     generated against the SAME order, no duplicate).
    //   anything else   → clear it, so the POS + customer screen both
    //                     start from a clean slate.
    // Runs once, after the menu has loaded.
    useEffect(() => {
        if (recoveryDoneRef.current || loading || !tenantId) return
        recoveryDoneRef.current = true
        ;(async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const { data: rowRaw } = await supabase
                .from("pos_display_sessions")
                .select("id, status, cart_payload, grand_total, currency, checkout_url, checkout_session_id, invoice_number, customer_phone, order_type, table_no, updated_at")
                .eq("created_by", user.id)
                .maybeSingle()
            if (!rowRaw) return
            const row = rowRaw as {
                id: string
                status: string
                cart_payload: Array<{ name: string; quantity: number; unit_price: number; notes?: string | null; menu_item_id?: string | null }>
                grand_total: number
                currency: string
                checkout_url: string | null
                checkout_session_id: string | null
                invoice_number: string | null
                customer_phone: string | null
                order_type: string | null
                table_no: string | null
                updated_at: string
            }

            // The customer paid while this screen was away — the bill is
            // already generated. Acknowledge it and reset to a clean POS.
            if (row.status === "PAID") {
                toast.success(
                    row.invoice_number
                        ? `Your last sale completed — invoice ${row.invoice_number}`
                        : "Your last sale completed",
                    { duration: 7000 },
                )
                void supabase.rpc("clear_pos_display" as never).then(() => {}, () => {})
                return
            }

            // Older than 20 minutes → treat as abandoned, clean slate.
            if (Date.now() - new Date(row.updated_at).getTime() > 20 * 60_000) {
                void supabase.rpc("clear_pos_display" as never).then(() => {}, () => {})
                return
            }

            // A PhonePe scan-to-pay QR is live — the customer may be
            // mid-payment and the webhook will bill it server-side. Resume
            // with the overlay; the PAID realtime subscription (it also
            // watches recoveredSale.sessionId) catches the confirmation.
            // `checkout_session_id` set ⇒ it's the auto-confirm QR (vs a
            // plain manual UPI intent, which falls through to a cart
            // restore so the cashier finishes it themselves).
            if ((row.status === "AWAITING_PAYMENT" || row.status === "PROCESSING")
                && row.checkout_url && /^upi:/i.test(row.checkout_url)
                && row.checkout_session_id) {
                setRecoveredSale({
                    sessionId: row.id,
                    items: (row.cart_payload ?? []).map((l) => ({
                        name: String(l.name ?? "Item"),
                        quantity: Number(l.quantity) || 0,
                        unit_price: Number(l.unit_price) || 0,
                    })),
                    grandTotal: Number(row.grand_total) || 0,
                    currency: row.currency || "INR",
                })
                return
            }

            // ── Restore the in-progress cart ────────────────────────────
            // The cashier was still ringing the sale up (BUILDING_CART) or
            // had the checkout open but unpaid (AWAITING_PAYMENT) when the
            // screen reloaded. Rebuild the cart from the synced snapshot so
            // NOTHING they entered is lost. BUILDING_CART can never have a
            // bill behind it; an unpaid AWAITING cart was never billed
            // either — and a successful bill flips the row to PAID, caught
            // above. So restoring here can't double-bill.
            if (row.status === "BUILDING_CART" || row.status === "AWAITING_PAYMENT") {
                const byId = new Map(items.map((it) => [it.id, it]))
                const restored: CartLine[] = []
                for (const line of row.cart_payload ?? []) {
                    const item = line.menu_item_id ? byId.get(line.menu_item_id) : undefined
                    if (!item) continue
                    restored.push({
                        item,
                        quantity: Math.max(1, Math.round(Number(line.quantity) || 1)),
                        notes: line.notes ?? "",
                    })
                }
                if (restored.length > 0) {
                    setCart(restored)
                    if (row.order_type) setOrderType(row.order_type as OrderType)
                    if (row.table_no) setTableNo(row.table_no)
                    // Re-adopt the existing display row so the customer
                    // screen stays in lock-step — no orphan, no duplicate.
                    syncDisplaySession(row.id)
                    toast.success("Recovered your in-progress sale — nothing was lost.", { duration: 5000 })
                } else {
                    // The snapshot held nothing we could rebuild (items
                    // since deleted, or an empty cart) — clear so the POS
                    // and the customer screen both start from a clean slate.
                    void supabase.rpc("clear_pos_display" as never).then(() => {}, () => {})
                }
                return
            }

            // Anything else (a CLOSED leftover, etc.) — clear it so the POS
            // and the customer screen both start from a clean slate.
            void supabase.rpc("clear_pos_display" as never).then(() => {}, () => {})
        })()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, tenantId])

    // While a recovered sale is on screen, keep the customer display's
    // session fresh (it goes idle ~45s after the last heartbeat).
    useEffect(() => {
        if (!recoveredSale) return
        const id = recoveredSale.sessionId
        const beat = () => {
            void supabase
                .from("pos_display_sessions")
                .update({ updated_at: new Date().toISOString() } as never)
                .eq("id", id)
                .then(() => {}, () => {})
        }
        beat()
        const t = window.setInterval(beat, 15_000)
        return () => window.clearInterval(t)
    }, [recoveredSale, supabase])

    /** category_id → category object lookup. Used by:
     *   - search (so typing a category name surfaces its items)
     *   - category-grouped render (titles + ordering) */
    const categoryById = useMemo(() => {
        return new Map(categories.map((c) => [c.id, c]))
    }, [categories])

    /** Categories sorted alphabetically by name. Used everywhere the
     *  POS surfaces them to the cashier — the top-bar filter chips and
     *  the section headers in the All-grouped view. We intentionally
     *  override the admin's `sort_order` here because cashiers find
     *  items faster when categories are in predictable A→Z order.
     *  Sort uses `localeCompare` for locale-aware ordering (e.g. "É"
     *  sorts after "E", not after "Z"). */
    const sortedCategories = useMemo(() => {
        return [...categories].sort((a, b) =>
            (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }),
        )
    }, [categories])

    /** `category_id → live item count` used to (a) show the count on
     *  each category card and (b) hide categories with zero items
     *  entirely from the strip. Driven by the same `items` source the
     *  grid renders from, so a sold-out / branch-filtered menu auto-
     *  hides categories that would have rendered an empty section. */
    const itemCountByCategory = useMemo(() => {
        const map = new Map<string, number>()
        for (const it of items) {
            if (!it.category_id) continue
            map.set(it.category_id, (map.get(it.category_id) ?? 0) + 1)
        }
        return map
    }, [items])

    /** Categories that actually have items right now. The strip
     *  renders these only — an empty category stays in the admin's
     *  catalog but doesn't waste tile-space on the POS. */
    const categoriesWithItems = useMemo(() => {
        return sortedCategories.filter((c) => (itemCountByCategory.get(c.id) ?? 0) > 0)
    }, [sortedCategories, itemCountByCategory])

    const visibleItems = useMemo(() => {
        let out = items
        if (activeCat !== "ALL") out = out.filter((i) => i.category_id === activeCat)
        if (search.trim()) {
            const s = search.toLowerCase()
            // Search now matches item names AND category names. Typing
            // "drinks" (or "soft", "piz", etc.) surfaces every item in
            // matching categories so a cashier can pull up a whole
            // section without scrolling. Item-name matches still work
            // independently — we OR the two predicates.
            out = out.filter((i) => {
                if (i.name.toLowerCase().includes(s)) return true
                const cat = i.category_id ? categoryById.get(i.category_id) : null
                if (cat?.name && cat.name.toLowerCase().includes(s)) return true
                return false
            })
        }
        return out
    }, [items, activeCat, search, categoryById])

    /** Group items by category for the "All + no search" view. Returns
     *  an ordered array of { category, items[] } following A→Z order
     *  on category name (`sortedCategories`). Items without a category
     *  fall into a synthesised "Other" bucket at the end regardless of
     *  alphabetical position — it's always last because "Other" reads
     *  as a catch-all, not a real section. */
    const groupedByCategory = useMemo(() => {
        if (activeCat !== "ALL" || search.trim()) return null

        const byCat = new Map<string | null, MenuItem[]>()
        for (const it of items) {
            const key = it.category_id ?? null
            if (!byCat.has(key)) byCat.set(key, [])
            byCat.get(key)!.push(it)
        }
        const groups: { id: string | null; name: string; items: MenuItem[] }[] = []
        for (const cat of sortedCategories) {
            const list = byCat.get(cat.id)
            if (list && list.length > 0) {
                groups.push({ id: cat.id, name: cat.name, items: list })
            }
        }
        const orphan = byCat.get(null) ?? []
        if (orphan.length > 0) {
            groups.push({ id: null, name: "Other", items: orphan })
        }
        return groups
    }, [items, sortedCategories, activeCat, search])

    /** Cart lines grouped by category, in the same A→Z order as the
     *  category strip. Keeps the original cart-array index on each line
     *  so the existing qty/remove handlers (`changeQty(idx, delta)`)
     *  still target the correct row when buttons live under a section
     *  header. Lines whose item has no category fall into a synthesised
     *  "Other" bucket at the end. */
    const groupedCart = useMemo(() => {
        type Group = { id: string | null; name: string; lines: { line: typeof cart[number]; idx: number }[] }
        const byCat = new Map<string | null, Group>()
        cart.forEach((line, idx) => {
            const key = line.item.category_id ?? null
            if (!byCat.has(key)) {
                const name = key ? (categoryById.get(key)?.name ?? "Other") : "Other"
                byCat.set(key, { id: key, name, lines: [] })
            }
            byCat.get(key)!.lines.push({ line, idx })
        })
        const out: Group[] = []
        for (const c of sortedCategories) {
            const g = byCat.get(c.id)
            if (g) out.push(g)
        }
        const orphan = byCat.get(null)
        if (orphan) out.push(orphan)
        return out
    }, [cart, sortedCategories, categoryById])

    /** Per-item total quantity in the cart. Drives the small "× N" badge
     *  on each menu tile so the cashier knows what's already added at a
     *  glance. Multiple cart lines for the same item (e.g. one plain +
     *  one with notes) are summed. */
    const cartQtyById = useMemo(() => {
        const map = new Map<string, number>()
        for (const c of cart) {
            map.set(c.item.id, (map.get(c.item.id) ?? 0) + c.quantity)
        }
        return map
    }, [cart])

    // Country tax & locale config (currency, tax model, service-charge policy…)
    const cfg = useMemo(() => getTaxConfig(tenantCountry), [tenantCountry])
    /** Effective service-charge % — forced to 0 in countries that don't allow it (e.g. India). */
    const serviceChargePct = cfg.serviceChargeAllowed ? rawServiceChargePct : 0
    const money = (v: number | string | null | undefined) => formatCurrency(v, cfg.currency)

    const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

    /** Shared grid class for the menu tiles. Tuned so a cashier sees
     *  ~5-6 items per row on typical lg/xl POS screens. Mobile still
     *  fits 2 cards comfortably (touch targets stay tappable). The
     *  paired aspect-ratio change inside `renderItemCard` (image now
     *  3:2 instead of 4:3) shortens each card by ~12% vertically so
     *  the denser grid doesn't trade horizontal density for too-tall
     *  rows. */
    // Reference-image grid: 4 columns at desktop width with comfortable
    // gutters so each card has room for the image + name + ADD button.
    const ITEM_GRID_CLS = "grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"

    /** Renders one menu-tile card. Extracted so both the flat layout
     *  and the category-grouped layout reuse the exact same card
     *  markup. All handlers/state come from the surrounding component
     *  closure (no prop drilling needed). */
    function renderItemCard(it: MenuItem) {
        const inCartQty = cartQtyById.get(it.id) ?? 0
        const sale = it.sale_price != null && it.sale_price < it.base_price
            ? Number(it.sale_price)
            : null
        const pctOff = sale != null
            ? Math.round((1 - sale / Number(it.base_price)) * 100)
            : 0
        return (
            <div
                key={it.id}
                role="button"
                tabIndex={it.is_sold_out ? -1 : 0}
                aria-disabled={it.is_sold_out}
                onClick={() => !it.is_sold_out && openItem(it)}
                onKeyDown={(e) => {
                    if (it.is_sold_out) return
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        openItem(it)
                    }
                }}
                className={cn(
                    "group relative rounded-xl border bg-card overflow-hidden select-none flex flex-col transition-all duration-150",
                    inCartQty > 0 && !it.is_sold_out
                        ? "border-primary/60 ring-1 ring-primary/30 shadow-[0_0_14px_-6px_hsl(var(--primary)/0.45)]"
                        : "border-border/60 shadow-sm",
                    it.is_sold_out
                        ? "opacity-50 cursor-not-allowed"
                        : "cursor-pointer hover:-translate-y-0.5 hover:shadow-lg hover:border-primary/40 active:scale-[0.99]",
                )}
            >
                {/* Image area — 3:2 aspect (was 4:3). At the denser
                 *  grid each card is narrower, so a shorter image
                 *  ratio keeps cards from feeling lanky. */}
                <div className="relative aspect-[3/2] w-full bg-muted/30 overflow-hidden">
                    {it.image_url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                            src={it.image_url}
                            alt=""
                            className={cn(
                                "absolute inset-0 h-full w-full object-cover transition-transform duration-300",
                                it.is_sold_out ? "grayscale" : "group-hover:scale-105",
                            )}
                            loading="lazy"
                        />
                    ) : (
                        <div className={cn(
                            "absolute inset-0 grid place-items-center bg-primary/10",
                            it.is_sold_out && "grayscale",
                        )}>
                            <Utensils className="h-7 w-7 text-muted-foreground/40" />
                        </div>
                    )}
                    {sale != null && !it.is_sold_out && (
                        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-destructive text-destructive-foreground shadow-md">
                            −{pctOff}%
                        </div>
                    )}
                    {inCartQty > 0 && !it.is_sold_out && (
                        <div className="absolute top-1.5 right-1.5 min-w-[22px] h-6 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold tabular-nums grid place-items-center shadow-[0_0_10px_-2px_hsl(var(--primary)/0.6)] border border-primary-foreground/20">
                            × {inCartQty}
                        </div>
                    )}
                    {it.is_sold_out && (
                        <div className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-[1px]">
                            <Badge variant="destructive" className="text-[9px] px-1.5">SOLD OUT</Badge>
                        </div>
                    )}
                </div>

                {/* Body — name + price stacked, then a full-width ADD
                 *  button pinned to the bottom (matches the reference
                 *  design). When the item is already in the cart, the
                 *  ADD button morphs into a stepper so cashiers can
                 *  bump qty without re-opening the dialog. */}
                <div className="flex-1 flex flex-col p-3 gap-2">
                    <div className="flex items-start gap-1.5">
                        <span
                            aria-label={it.food_type}
                            className={cn(
                                "mt-1 h-2 w-2 rounded-sm shrink-0 border",
                                it.food_type === "VEG" && "bg-success/80 border-success",
                                it.food_type === "NON_VEG" && "bg-destructive/80 border-destructive",
                                it.food_type === "EGG" && "bg-warning/80 border-warning",
                                it.food_type === "VEGAN" && "bg-success border-success",
                            )}
                        />
                        <span className={cn(
                            "font-semibold text-sm leading-tight line-clamp-2 flex-1",
                            it.is_sold_out && "line-through opacity-60",
                        )}>
                            {it.name}
                        </span>
                    </div>

                    <div className="leading-tight">
                        {sale != null ? (
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-sm font-bold text-primary tabular-nums">{money(sale)}</span>
                                <span className="text-[11px] text-muted-foreground line-through tabular-nums">{money(it.base_price)}</span>
                            </div>
                        ) : (
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-sm font-bold text-primary tabular-nums">{money(it.base_price)}</span>
                                {it.gst_slab > 0 && (
                                    <span className="text-[10px] text-muted-foreground">+ {cfg.taxShortName} {it.gst_slab}%</span>
                                )}
                            </div>
                        )}
                    </div>

                    {!it.is_sold_out && (
                        inCartQty > 0 ? (
                            // In-cart: stepper bar pinned to the bottom
                            // edge of the card. Touch-friendly height +
                            // tabular qty so rapid tapping feels stable.
                            <div
                                className="mt-auto flex items-center justify-between gap-1 rounded-full bg-primary text-primary-foreground shadow-sm overflow-hidden"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); decreaseFromCard(it) }}
                                    aria-label={`Decrease ${it.name} quantity`}
                                    title={inCartQty === 1 ? "Remove" : "Decrease by 1"}
                                    className="h-9 w-9 grid place-items-center hover:bg-primary-foreground/15 active:scale-95 transition-all"
                                >
                                    {inCartQty === 1
                                        ? <Trash2 className="h-4 w-4" strokeWidth={2.5} />
                                        : <Minus className="h-4 w-4" strokeWidth={2.5} />}
                                </button>
                                <span
                                    className="flex-1 text-center text-sm font-bold tabular-nums"
                                    aria-live="polite"
                                >
                                    {inCartQty} in cart
                                </span>
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); addToCart(it) }}
                                    aria-label={`Increase ${it.name} quantity`}
                                    title="Add 1 more"
                                    className="h-9 w-9 grid place-items-center hover:bg-primary-foreground/15 active:scale-95 transition-all"
                                >
                                    <Plus className="h-4 w-4" strokeWidth={2.5} />
                                </button>
                            </div>
                        ) : (
                            // First add: full-width pill button so the
                            // affordance reads as the card's primary CTA
                            // — matches the reference image's "+  ADD".
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); addToCart(it) }}
                                aria-label={`Add ${it.name}`}
                                title="Tap to add 1 · Tap card to customise"
                                className={cn(
                                    "mt-auto h-9 w-full rounded-full flex items-center justify-center gap-1.5 transition-all",
                                    "bg-primary text-primary-foreground font-semibold text-xs uppercase tracking-wider",
                                    "shadow-sm hover:brightness-110 active:scale-[0.98]",
                                )}
                            >
                                <Plus className="h-4 w-4" strokeWidth={2.5} />
                                Add
                            </button>
                        )
                    )}
                </div>
            </div>
        )
    }

    /** Single source of truth for "what does this item actually sell for right
     *  now?". When sale_price is set AND lower than base_price, we charge the
     *  sale price; otherwise the regular base_price. Used by every code path
     *  that builds a line item — totals, online bill, offline queue, KOT. */
    function effectivePrice(it: MenuItem): number {
        if (it.sale_price != null && Number(it.sale_price) > 0 && Number(it.sale_price) < Number(it.base_price)) {
            return Number(it.sale_price)
        }
        return Number(it.base_price)
    }

    /** Net (pre-tax) unit price the server expects in `order_items.taxable_amount`.
     *  `generate_bill` adds tax on top of `taxable_amount`, so for tax-inclusive
     *  items we have to back the tax out client-side. If we don't, the server
     *  re-adds it and the bill's grand_total ends up higher than what the
     *  cashier collected — the bill then lands in BILLED instead of PAID
     *  because v_total_paid < v_grand inside the RPC. */
    function netUnitPrice(it: MenuItem): number {
        const gross = effectivePrice(it)
        const slab = Number(it.gst_slab) || 0
        if (!it.is_tax_inclusive || slab <= 0) return gross
        return gross / (1 + slab / 100)
    }

    /** Add a line, merging into an existing line only when the item AND notes match. */
    function addLine(it: MenuItem, quantity: number, notes: string) {
        const n = notes.trim()
        let landedIdx = 0
        setCart((prev) => {
            const idx = prev.findIndex((c) => c.item.id === it.id && (c.notes ?? "") === n)
            if (idx >= 0) {
                landedIdx = idx
                const copy = [...prev]
                copy[idx] = { ...copy[idx]!, quantity: copy[idx]!.quantity + quantity }
                return copy
            }
            landedIdx = prev.length
            return [...prev, { item: it, quantity, notes: n || undefined }]
        })
        flashCartLine(landedIdx)
    }

    /** Highlight + scroll the line at `idx` into view. Clears any previous
     *  highlight so rapid adds don't pile up timers. Defers the scroll
     *  call one tick so the DOM reflects the new line before we measure. */
    function flashCartLine(idx: number) {
        setHighlightIdx(idx)
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = setTimeout(() => setHighlightIdx(null), 1400)
        requestAnimationFrame(() => {
            // Cart lines are now nested inside per-category sections,
            // so children[idx] no longer maps 1:1 to row idx. Look up
            // the row by its data-cart-idx attribute instead — same
            // scroll-into-view behaviour, robust to the grouping.
            const container = cartListRef.current
            const li = container?.querySelector<HTMLElement>(`[data-cart-idx="${idx}"]`)
            li?.scrollIntoView({ behavior: "smooth", block: "nearest" })
        })
    }

    /** Quick add (qty 1, no notes) — used by the "customers often add" chips. */
    function addToCart(it: MenuItem) {
        if (it.is_sold_out) { toast.error(`${it.name} is sold out`); return }
        addLine(it, 1, "")
    }

    /** Decrement qty by 1 for this item from the MENU CARD's "-" button.
     *  A single menu item can sit on multiple cart lines (e.g. one plain
     *  + one with "extra cheese" note). We decrement the most-recently-
     *  touched line first — the cashier's intuition for "minus" is "undo
     *  the last thing I did". When a line drops to qty 0 we splice it
     *  out. To remove a specific line directly, the cart panel's per-line
     *  controls already do that. */
    function decreaseFromCard(it: MenuItem) {
        setCart((prev) => {
            let lastIdx = -1
            for (let i = prev.length - 1; i >= 0; i--) {
                if (prev[i]!.item.id === it.id) { lastIdx = i; break }
            }
            if (lastIdx === -1) return prev
            const copy = [...prev]
            const cur = copy[lastIdx]!
            const next = cur.quantity - 1
            if (next <= 0) return copy.filter((_, i) => i !== lastIdx)
            copy[lastIdx] = { ...cur, quantity: next }
            return copy
        })
    }

    /** Tap a menu tile → open the McDonald's-style add sheet. */
    function openItem(it: MenuItem) {
        if (it.is_sold_out) { toast.error(`${it.name} is sold out`); return }
        setAddingItem(it)
    }

    /** This item's curated add-ons, resolved to available menu items. */
    function recommendedFor(it: MenuItem): MenuItem[] {
        return (recs[it.id] ?? [])
            .map((rid) => byId.get(rid))
            .filter((x): x is MenuItem => !!x && !x.is_sold_out && x.id !== it.id)
            .slice(0, 6)
    }

    function changeQty(idx: number, delta: number) {
        setCart((prev) => {
            const copy = [...prev]
            const cur = copy[idx]
            if (!cur) return prev
            const next = cur.quantity + delta
            if (next <= 0) return copy.filter((_, i) => i !== idx)
            copy[idx] = { ...cur, quantity: next }
            return copy
        })
    }

    const computeCartTotals = useMemo(() => (noGst: boolean) => {
        if (cart.length === 0) return null
        return computeOrder({
            lines: cart.map((c, i) => ({
                line_id: i,
                quantity: c.quantity,
                unit_price: effectivePrice(c.item),
                gst_slab: Number(c.item.gst_slab),
                tax_inclusive: c.item.is_tax_inclusive,
            })),
            isInterState: false, // POS-side preview; the RPC does cross-state detection from the customer
            taxModel: cfg.taxModel,
            serviceChargePercent: serviceChargePct,
            orderDiscount: appliedCoupon?.discount ?? 0,
            roundToNearestRupee: true,
            noGst,
        })
    }, [cart, serviceChargePct, appliedCoupon, cfg.taxModel])
    const totals = useMemo(() => computeCartTotals(false), [computeCartTotals])
    const totalsNoGst = useMemo(() => computeCartTotals(true), [computeCartTotals])

    /** Mirror the LIVE cart to the customer-facing display in real time.
     *
     *  Everything goes through ONE atomic RPC — `sync_pos_display` —
     *  which UPSERTs the cashier's single display row (unique on
     *  created_by). No matter how often this fires, or how it races
     *  with itself, the customer screen is backed by exactly ONE row,
     *  always carrying the current cart, quantities and price. This is
     *  what makes the customer experience trustworthy: what the cashier
     *  sees IS what the customer sees, within a couple of seconds.
     *
     *  Best-effort — a display hiccup never blocks the cashier. */
    async function pushDisplay(): Promise<void> {
        if (!tenantId || cart.length === 0) return
        // While a bill is being generated the bill-gen handler owns the
        // session status (PROCESSING → PAID); don't fight it here.
        if (generationStage !== "idle") return
        const tot = totals
        const { data, error } = await supabase.rpc("sync_pos_display" as never, {
            p_branch_id: activeBranchId,
            p_status: checkoutOpen ? "AWAITING_PAYMENT" : "BUILDING_CART",
            p_cart_payload: cart.map((c) => ({
                name: c.item.name,
                quantity: c.quantity,
                unit_price: effectivePrice(c.item),
                notes: c.notes ?? null,
                image_url: c.item.image_url ?? null,
                // Net (pre-tax) line total + GST slab — carried so the
                // PhonePe display-checkout route can build GST-correct
                // order_items. Extra fields; the display chrome ignores them.
                gst_slab: Number(c.item.gst_slab) || 0,
                taxable_amount: Number((netUnitPrice(c.item) * c.quantity).toFixed(2)),
                // Carried so the customer display can look up curated
                // "perfect with your order" upsell suggestions.
                menu_item_id: c.item.id,
            })),
            p_subtotal: tot?.subtotal ?? 0,
            p_tax_total: tot
                ? Number(tot.cgst_amount) + Number(tot.sgst_amount) + Number(tot.igst_amount)
                : 0,
            p_discount_total: tot?.order_discount ?? 0,
            p_coupon_code: appliedCoupon?.code ?? null,
            p_grand_total: tot?.grand_total ?? 0,
            p_currency: cfg.currency,
            p_upi_id: tenantUpiId,
            p_upi_payee_name: tenantUpiPayeeName,
            p_order_type: orderType,
            // "__waiting__" is an internal UI sentinel for "no table
            // yet" — never let it reach the DB / customer display.
            p_table_no: (tableNo && tableNo !== "__waiting__") ? tableNo : null,
            // Prefer what the cashier is typing into the checkout dialog
            // right now; fall back to the looked-up customer record.
            p_customer_name: checkoutDetails.name || customer?.name || null,
            p_customer_phone: checkoutDetails.phone || customerPhone || null,
        } as never)
        if (error) {
            logError(error, { scope: "pos:sync_pos_display", tenantId })
            // Make the failure VISIBLE — a silent failure here is exactly
            // what made this look like a flaky feature. The usual cause
            // is the database missing the sync_pos_display RPC. Warn the
            // cashier once so they (or their admin) can fix the DB.
            if (!displaySyncWarnedRef.current) {
                displaySyncWarnedRef.current = true
                const missingFn = /sync_pos_display|function|does not exist|schema cache/i.test(error.message)
                toast.error(
                    missingFn
                        ? "Customer screen can't sync — the database needs the latest update (re-run combined_schema.sql)."
                        : "Customer screen sync failed. Tap “Sync screen” to retry.",
                    { duration: 8000 },
                )
            }
            return
        }
        displaySyncWarnedRef.current = false
        if (typeof data === "string") syncDisplaySession(data)
    }

    /** Tear down THIS cashier's display session. `clear_pos_display`
     *  hard-deletes their pos_display_sessions row, so the customer
     *  screen reverts to its idle "welcome" state with nothing stale
     *  left behind. */
    async function clearDisplay(): Promise<void> {
        syncDisplaySession(null)
        await supabase.rpc("clear_pos_display" as never).then(() => {}, () => {})
    }

    // ── Main sync ───────────────────────────────────────────────────────
    // Debounced mirror of the cart to the customer display. Empty cart
    // tears the session down; any items (re)sync the single row. Fires
    // on every change to items, quantity, price/totals, coupon, customer,
    // table or the checkout phase — so the customer always sees current
    // data.
    useEffect(() => {
        if (!tenantId) return
        if (cart.length === 0) {
            if (displaySessionIdRef.current) void clearDisplay()
            return
        }
        const handle = window.setTimeout(() => { void pushDisplay() }, 200)
        return () => window.clearTimeout(handle)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tenantId, cart, totals, checkoutOpen, orderType, tableNo, customer, customerPhone, checkoutDetails, appliedCoupon, generationStage])

    // ── Heartbeat ───────────────────────────────────────────────────────
    // Keep the customer display's session marked LIVE — WITHOUT re-running
    // the full sync_pos_display upsert (the whole cart payload + 15 args)
    // every 15s just to prove the POS is still here. The main sync effect
    // above already pushes every real change; the heartbeat's only job is
    // to advance the row's `updated_at` so the customer screen's staleness
    // check keeps passing. So this is a single-column touch on the row
    // that already exists — far lighter than the RPC, and it never
    // disturbs `status` / `checkout_url` (a stray sync_pos_display here
    // could even stomp a webhook's PAID flip back to AWAITING_PAYMENT).
    //
    // `displaySessionIdRef` is non-null exactly while a live session row
    // exists (cleared the moment the cart empties), so it gates whether to
    // beat — but the write is keyed on `created_by` (the cashier's user
    // id), NOT the row id, because that id churns (delete + re-insert) and
    // a stale id would silently update zero rows.
    useEffect(() => {
        if (!userId) return
        const beat = () => {
            if (!displaySessionIdRef.current) return
            // NOTE: the `.then()` is REQUIRED — a Supabase query builder
            // only sends its HTTP request when then-ed/awaited; a bare
            // `void builder` is silently discarded and never runs.
            void supabase
                .from("pos_display_sessions")
                .update({ updated_at: new Date().toISOString() } as never)
                .eq("created_by", userId)
                .then(() => {}, () => {})
        }
        const t = window.setInterval(beat, 15_000)
        return () => window.clearInterval(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId])

    // ── Teardown ────────────────────────────────────────────────────────
    // On unmount (navigate away) and on pagehide (tab close / app switch)
    // delete the session so the customer screen never freezes on a cart
    // that's no longer being rung up.
    useEffect(() => {
        const onHide = () => {
            // Don't tear the session down while a PhonePe scan-to-pay QR is
            // live: the customer may have scanned it and could still pay
            // (a stray refresh / tab-switch must not orphan that). The
            // webhook needs the display-session row to survive so the
            // customer's screen can flip to "Thank you" when they pay.
            // (The payment + bill are guaranteed safe regardless — this
            // only preserves the live screen feedback.)
            if (phonepeAutoConfirmRef.current) return
            void supabase.rpc("clear_pos_display" as never).then(() => {}, () => {})
        }
        window.addEventListener("pagehide", onHide)
        return () => {
            window.removeEventListener("pagehide", onHide)
            if (displaySessionIdRef.current && !phonepeAutoConfirmRef.current) {
                void supabase.rpc("clear_pos_display" as never).then(() => {}, () => {})
                syncDisplaySession(null)
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ── International: mint a Stripe Checkout URL on Review & checkout ──
    // For non-India tenants with Stripe Connect ready, mint a
    // Stripe-hosted Checkout URL and stash it on the display session so
    // the tablet renders it as a scan-to-pay QR (Apple Pay / Google Pay
    // / Card / Link / Klarna). Idempotent server-side.
    useEffect(() => {
        const sid = displaySessionIdRef.current
        if (!sid || !checkoutOpen || generationStage !== "idle") return
        if (cfg.code === "IN") return
        if (!totals || totals.grand_total <= 0) return
        void fetch("/api/payments/stripe/display-checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ display_session_id: sid }),
        }).catch(() => { /* best-effort — falls back to "pay at counter" */ })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [checkoutOpen, generationStage, displaySessionId])

    // ── India: the customer-screen QR mirrors the cashier's method ─────
    // The customer display reads `checkout_url`:
    //   • a `upi:` intent / PhonePe QR → renders a scan-to-pay QR
    //   • `counter:card`             → "hand your card to staff to swipe"
    //   • null                        → "pay with cash at the counter"
    // For UPI, ONE server route resolves the QR (PhonePe dynamic QR if the
    // owner connected PhonePe → otherwise a plain merchant-UPI QR) and
    // writes it to checkout_url. The customer screen AND the staff dialog
    // render that exact same value — there is no second QR-building path.
    useEffect(() => {
        const sid = displaySessionIdRef.current
        if (!sid || !userId || !checkoutOpen || generationStage !== "idle") return
        if (cfg.code !== "IN") return

        // NOTE: every checkout_url write below is keyed on `created_by`
        // (userId), NEVER the row id. The pos_display_sessions row id
        // churns (delete + re-insert); `created_by` is stable, so the
        // write always lands on the cashier's live row and the customer
        // screen actually sees the payment-method change.
        if (checkoutMethod !== "UPI") {
            // Cash / Card — no scan QR. Stamp the sentinel so the customer
            // screen shows the right prompt; clears any earlier UPI QR.
            setPhonePeAutoConfirm(false)
            setPhonePeFallbackReason(null)
            setCheckoutQr(null)
            setCheckoutQrError(null)
            phonepeCheckoutFiredRef.current = null
            void supabase
                .from("pos_display_sessions")
                .update({
                    checkout_url: checkoutMethod === "CARD" ? "counter:card" : null,
                    checkout_session_id: null,
                } as never)
                .eq("created_by", userId)
                .then(() => {}, () => {})
            return
        }

        // checkoutMethod === "UPI" — resolve the QR via the route, once per
        // checkout session. The route runs the whole preference chain
        // server-side and writes checkout_url; we mirror its result onto
        // the staff dialog (`checkoutQr` / `checkoutQrError`).
        if (!totals || totals.grand_total <= 0) return
        if (phonepeCheckoutFiredRef.current === sid) return
        phonepeCheckoutFiredRef.current = sid
        setCheckoutQrError(null)
        // Flip the customer screen to a UPI "preparing" state RIGHT NOW —
        // the instant the cashier picks UPI, before the PhonePe round-trip —
        // so the customer never sits on the previous (e.g. "pay cash")
        // panel while the real QR is being minted. The async block below
        // swaps this sentinel for the actual QR a beat later.
        void supabase
            .from("pos_display_sessions")
            .update({ checkout_url: "counter:upi-pending", checkout_session_id: null } as never)
            .eq("created_by", userId)
            .then(() => {}, () => {})
        ;(async () => {
            // Resolve the dynamic UPI QR via the PhonePe display-checkout
            // route. The route mints a `phonepe_payment_events` row +
            // calls PhonePe with instrument=UPI_INTENT and returns either:
            //   { ok: true, qr_data, auto_confirm, checkout_session_id }
            //   { ok: false, reason: "not_configured" }   ← owner hasn't set up PhonePe
            //   { ok: false, phonepe_error: "..." }       ← PhonePe rejected the mint
            // The cashier UI maps each case to either the QR panel or
            // the right "couldn't prepare" notice.
            let qrData: string | null = null
            let autoConfirm = false
            let sessionRef: string | null = null
            let notConfigured = false
            let transportErr: string | null = null
            let fallbackReason: string | null = null
            try {
                const r = await fetch("/api/payments/phonepe/display-checkout", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ display_session_id: sid }),
                })
                const data = await r.json().catch(() => null) as {
                    ok?: boolean
                    qr_data?: string | null
                    auto_confirm?: boolean
                    checkout_session_id?: string | null
                    reason?: string | null
                    phonepe_error?: string | null
                    error?: string | null
                } | null
                if (data?.ok && data.qr_data) {
                    qrData = data.qr_data
                    autoConfirm = !!data.auto_confirm
                    sessionRef = data.checkout_session_id ?? null
                } else if (data?.reason === "not_configured") {
                    notConfigured = true
                } else {
                    transportErr = data?.phonepe_error ?? data?.error ?? `HTTP ${r.status}`
                    fallbackReason = transportErr
                }
            } catch (e) {
                transportErr = e instanceof Error ? e.message : "Network error"
                fallbackReason = transportErr
            }
            // The cashier switched away from UPI while the route resolved.
            // The Cash/Card branch has already stamped the right value on
            // checkout_url — do NOT write the QR now, or it would jump
            // back onto the customer screen (the "stuck on QR" bug).
            if (checkoutMethodRef.current !== "UPI") return
            if (qrData) {
                setCheckoutQr(qrData)
                setPhonePeAutoConfirm(autoConfirm)
                setPhonePeFallbackReason(fallbackReason)
                // The POS owns the checkout_url write — gated on the live
                // method above — so the customer screen shows exactly this
                // QR. AWAITED (a bare `void builder` never sends the
                // request) + error-logged: this write is what puts the QR
                // on the customer screen, so a silent failure is fatal.
                const { error: urlErr } = await supabase
                    .from("pos_display_sessions")
                    .update({ checkout_url: qrData, checkout_session_id: sessionRef } as never)
                    .eq("created_by", userId)
                if (urlErr) logError(urlErr, { scope: "pos:checkout_url_write", userId })
            } else {
                setCheckoutQr(null)
                setPhonePeAutoConfirm(false)
                setPhonePeFallbackReason(null)
                setCheckoutQrError(
                    notConfigured
                        ? "The owner hasn't set up a payment method yet — add PhonePe or a UPI ID to accept UPI."
                        : `Couldn't prepare the UPI QR — ${transportErr}.`,
                )
                // No QR — show the customer a neutral "staff will help"
                // panel rather than a misleading "pay cash" one (the
                // cashier explicitly picked UPI, not Cash).
                void supabase
                    .from("pos_display_sessions")
                    .update({ checkout_url: "counter:upi-error", checkout_session_id: null } as never)
                    .eq("created_by", userId)
                    .then(() => {}, () => {})
            }
        })()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [checkoutOpen, generationStage, displaySessionId, checkoutMethod, userId])

    // Reset the scan-to-pay flags whenever checkout closes, so a fresh
    // sale starts clean and the route can fire again.
    useEffect(() => {
        if (!checkoutOpen) {
            phonepeCheckoutFiredRef.current = null
            setPhonePeAutoConfirm(false)
            setPhonePeFallbackReason(null)
            setCheckoutQr(null)
            setCheckoutQrError(null)
            setCheckoutMethod("CASH")
        }
    }, [checkoutOpen])

    // ── Auto-confirm: react when the webhook flips OUR display session
    //    to PAID (the customer paid the PhonePe QR). Close the checkout
    //    dialog, tell the cashier, and reset for the next sale — the
    //    cashier verifies nothing.
    // Watch the live checkout session OR a recovered one (after a refresh)
    // — either way we catch the webhook's PAID flip.
    const watchedSessionId = displaySessionId ?? recoveredSale?.sessionId ?? null
    useEffect(() => {
        if (!watchedSessionId) return
        const channel = supabase
            .channel(uniqueChannelName("pos-display-paid"))
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "pos_display_sessions",
                    filter: `id=eq.${watchedSessionId}`,
                },
                (payload) => {
                    const row = payload.new as {
                        status?: string
                        invoice_number?: string | null
                        checkout_url?: string | null
                    }
                    // Mirror the customer screen's QR payload onto the staff
                    // dialog. Both now read the SAME
                    // pos_display_sessions.checkout_url row — whatever the
                    // POS (plain UPI) or the PhonePe route (dynamic QR) wrote
                    // — so the staff and customer QR can never differ. A
                    // `counter:` sentinel (cash / card) or null is not a
                    // scannable QR.
                    const url = typeof row?.checkout_url === "string" ? row.checkout_url : null
                    setCheckoutQr(url && !/^counter:/i.test(url) ? url : null)
                    if (row?.status !== "PAID") return
                    // The bill is generated server-side by the PhonePe
                    // webhook (confirm_phonepe_payment) — by the time
                    // status=PAID lands here, invoice_number is already set
                    // and the bill row exists. We just clean up the UI.
                    toast.success(
                        row.invoice_number
                            ? `Payment received — invoice ${row.invoice_number}`
                            : "Payment received",
                        { duration: 6000 },
                    )
                    setCheckoutOpen(false)
                    setCart([])
                    removeCoupon()
                    setCustomer(null)
                    setCustomerPhone("")
                    setCheckoutDetails({ name: "", phone: "", email: "" })
                    setPhonePeAutoConfirm(false)
                    setPhonePeFallbackReason(null)
                    setRecoveredSale(null)
                    phonepeCheckoutFiredRef.current = null
                    syncDisplaySession(null)
                    // Let the customer see the "Thank you" screen, then
                    // tear the display session down.
                    window.setTimeout(() => {
                        void supabase.rpc("clear_pos_display" as never).then(() => {}, () => {})
                    }, 5000)
                },
            )
            .subscribe()
        return () => { supabase.removeChannel(channel) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [watchedSessionId])

    /** Manual "Sync screen" action for the cashier — when the customer
     *  display looks wrong, one tap wipes the saved display data and
     *  re-pushes exactly what's in the cart right now. The POS cart is
     *  the source of truth; this forces the customer screen to match. */
    const [resyncing, setResyncing] = useState(false)
    async function resyncDisplay() {
        setResyncing(true)
        try {
            await supabase.rpc("clear_pos_display" as never).then(() => {}, () => {})
            syncDisplaySession(null)
            displaySyncWarnedRef.current = false
            if (cart.length > 0) await pushDisplay()
            toast.success("Customer screen re-synced")
        } finally {
            setResyncing(false)
        }
    }

    /** Open THIS cashier's own customer-display URL in a new tab.
     *  `/api/customer-display/me` returns the URL for whoever is logged
     *  in — so the screen that opens always belongs to the current
     *  cashier. This is what removes the "I opened the wrong staff
     *  member's display URL" mismatch: the cashier never types or
     *  picks a URL, they just click. */
    const [openingScreen, setOpeningScreen] = useState(false)
    async function openCustomerScreen() {
        setOpeningScreen(true)
        try {
            const r = await fetch("/api/customer-display/me")
            const data = await r.json() as { url?: string; error?: string }
            if (!r.ok || !data.url) {
                throw new Error(data.error ?? "Couldn't get your customer-screen URL")
            }
            window.open(data.url, "_blank", "noopener")
            toast.success("Customer screen opened in a new tab — move it to the customer-facing display.")
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't open the customer screen")
        } finally {
            setOpeningScreen(false)
        }
    }

    // Upsell suggestions: for every item in the cart, gather its recommended
    // add-ons (in curated order), drop anything already in the cart, dedupe,
    // and keep the menu_item objects so we can one-tap-add them.
    const suggestions = useMemo<MenuItem[]>(() => {
        if (cart.length === 0) return []
        const byId = new Map(items.map((i) => [i.id, i]))
        const inCart = new Set(cart.map((c) => c.item.id))
        const seen = new Set<string>()
        const out: MenuItem[] = []
        for (const line of cart) {
            for (const rid of recs[line.item.id] ?? []) {
                if (inCart.has(rid) || seen.has(rid)) continue
                const it = byId.get(rid)
                if (!it || it.is_sold_out) continue
                seen.add(rid)
                out.push(it)
                if (out.length >= 6) return out
            }
        }
        return out
    }, [cart, recs, items])

    // Accepts an explicit code so the checkout dialog can apply a coupon
    // typed inside it without going through the top-of-page input.
    async function applyCoupon(code?: string) {
        const raw = (code ?? couponCode).trim()
        if (!raw) return
        if (!totals) return toast.error("Add items to cart first")
        setCouponBusy(true)
        const { data, error } = await supabase.rpc("validate_coupon" as never, {
            p_code: raw,
            p_subtotal: totals.taxable_amount,
            p_customer_id: null,
        } as never)
        setCouponBusy(false)
        if (error) return toast.error(error.message)
        const r = data as { valid: boolean; error?: string; coupon_id?: string; code?: string; description?: string | null; discount?: number }
        if (!r.valid) return toast.error(r.error ?? "Invalid coupon")
        setAppliedCoupon({ id: r.coupon_id!, code: r.code!, description: r.description ?? null, discount: Number(r.discount ?? 0) })
        // Mirror back into the top-of-page input so both UIs stay in sync.
        setCouponCode(r.code!)
        toast.success(`Applied ${r.code} — ${money(Number(r.discount ?? 0))} off`)
    }
    function removeCoupon() { setAppliedCoupon(null); setCouponCode("") }

    /** Apply a gift card. Pre-flight `validate_gift_card_for_tenant`
     *  RPC to get current balance, then stage in `appliedGiftCard`.
     *  Actual balance decrement happens server-side inside generate_bill
     *  (atomic with bill insert) when it sees the GIFT_CARD payment row. */
    async function applyGiftCard(code: string) {
        const raw = code.trim()
        if (!raw) return
        if (!totals) return toast.error("Add items to cart first")
        if (!tenantId) return
        setGiftCardBusy(true)
        const { data, error } = await supabase.rpc("validate_gift_card_for_tenant" as never, {
            p_tenant_id: tenantId,
            p_code: raw,
        } as never)
        setGiftCardBusy(false)
        if (error) return toast.error(error.message)
        const r = data as { valid: boolean; error?: string; code?: string; balance?: number }
        if (!r.valid) return toast.error(r.error ?? "Gift card couldn't be applied")

        // Apply min(balance, what's still owed after the coupon discount).
        // We compute against the GRAND_TOTAL of the current cart so the
        // applied amount auto-caps even when bill total < gift balance.
        const grand = (totals.grand_total ?? 0) - (appliedCoupon?.discount ?? 0)
        const balance = Number(r.balance ?? 0)
        const amount = Math.min(balance, Math.max(0, grand))
        if (amount <= 0) {
            return toast.warning("Gift card has no usable balance against this bill.")
        }
        setAppliedGiftCard({ code: r.code ?? raw.toUpperCase(), balance, amount })
        toast.success(`${r.code ?? raw.toUpperCase()} covers ${money(amount)}`)
    }
    function removeGiftCard() { setAppliedGiftCard(null) }

    // Phone-shape + lookup helpers live in src/lib/customers/lookup.ts
    // now that the checkout dialog also needs them. Local aliases keep
    // the existing call-sites in this file untouched.
    const isPhoneShaped = isPhoneShapedShared
    const findCustomerByPhone = (phone: string) =>
        findCustomerByPhoneShared(supabase, phone)

    // ── Debounced auto-lookup ────────────────────────────────────────
    // Cashier types a phone → wait 400ms after they stop → fire the
    // read-only lookup. Loader shows while the request is in flight.
    //
    // Auto-lookup is READ-ONLY on purpose: every transient digit
    // ("987" → "9876" → "98765" → …) would otherwise create a
    // customer row at the DB. Creation happens either via the explicit
    // "Add" button below, or implicitly at checkout via
    // `upsertMarketingCustomer`.
    const [customerLookupBusy, setCustomerLookupBusy] = useState(false)
    const [customerLookupMissed, setCustomerLookupMissed] = useState(false)
    useEffect(() => {
        // Clear stale "no match" hint immediately on any edit, and wipe
        // any previously-attached customer when the cashier starts
        // editing the field again. The customer object only re-attaches
        // when the lookup below resolves successfully.
        setCustomerLookupMissed(false)
        const trimmed = customerPhone.trim()
        if (!trimmed) {
            setCustomer(null)
            setCustomerLookupBusy(false)
            return
        }
        if (!isPhoneShaped(trimmed)) {
            setCustomerLookupBusy(false)
            return
        }
        // Don't re-lookup if the currently-attached customer's phone
        // already matches what's typed (e.g. cashier pasted a number,
        // we found them, then the input still has the same digits).
        if (customer && customerPhone.trim().length > 0) return

        // `cancelled` flag rather than AbortSignal: Supabase JS query
        // builders don't accept an abort signal directly on this code
        // path. We let the network call resolve normally but discard
        // the result when a newer keystroke supersedes it. The Promise
        // is then unreferenced and GC'd.
        let cancelled = false
        setCustomerLookupBusy(true)
        const t = window.setTimeout(async () => {
            try {
                const found = await findCustomerByPhone(trimmed)
                if (cancelled) return
                if (found) {
                    setCustomer(found)
                    setCustomerLookupMissed(false)
                } else {
                    setCustomer(null)
                    setCustomerLookupMissed(true)
                }
            } catch {
                /* network/RLS error — silent; user can still tap Find/Add */
            } finally {
                if (!cancelled) setCustomerLookupBusy(false)
            }
        }, 400)
        return () => {
            cancelled = true
            window.clearTimeout(t)
            setCustomerLookupBusy(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [customerPhone])

    /** Manual click on "Find / Add". Lookup first; if not found, create
     *  the placeholder customer (existing behaviour preserved). The
     *  auto-lookup above already covers the "found" path silently — this
     *  button is most useful for the create-on-miss case. */
    async function lookupCustomer() {
        if (!customerPhone.trim()) { setCustomer(null); return }
        const found = await findCustomerByPhone(customerPhone)
        if (found) {
            setCustomer(found)
            setCustomerLookupMissed(false)
            toast.success(`${found.name ?? "Customer"} found`)
            return
        }
        // create customer placeholder
        const { data: created, error } = await supabase
            .from("customers")
            .insert({ tenant_id: tenantId, phone: customerPhone.trim() } as never)
            .select("id, name, loyalty_points, loyalty_tier")
            .maybeSingle()
        if (error) return toast.error(error.message)
        setCustomer(created as { id: string; name: string | null; loyalty_points: number; loyalty_tier: string })
        setCustomerLookupMissed(false)
        toast.success("New customer created")
    }

    /** True if the cashier filled at least one of name/phone/email at checkout. */
    function hasAnyDetail(d: CheckoutCustomerDetails | undefined): d is CheckoutCustomerDetails {
        return !!d && Boolean(d.name || d.phone || d.email)
    }

    /** Upsert the customers row with whatever the cashier captured at checkout.
     *  Strategy: identify the customer by phone (existing convention used by
     *  lookupCustomer + loyalty), otherwise create a fresh row. Returns the
     *  customer_id to pass to generate_bill, or null if upsert fails — we
     *  swallow errors here because billing must succeed even if marketing
     *  capture doesn't (e.g. unique-violation race, RLS hiccup). */
    async function upsertMarketingCustomer(d: CheckoutCustomerDetails): Promise<string | null> {
        if (!tenantId) return null
        try {
            // 1. Match by phone if we have one — keeps loyalty + history attached.
            if (d.phone) {
                const { data: existing } = await supabase
                    .from("customers")
                    .select("id, name, email")
                    .eq("tenant_id", tenantId)
                    .eq("phone", d.phone)
                    .is("deleted_at", null)
                    .maybeSingle()
                if (existing) {
                    const row = existing as { id: string; name: string | null; email: string | null }
                    // Only fill missing fields — never overwrite a name/email the
                    // customer already gave us with an empty value from this bill.
                    const patch: Record<string, string> = {}
                    if (d.name && !row.name) patch.name = d.name
                    if (d.email && !row.email) patch.email = d.email
                    if (Object.keys(patch).length > 0) {
                        await supabase.from("customers").update(patch as never).eq("id", row.id)
                    }
                    return row.id
                }
            }
            // 2. Otherwise create — but only if we have at least one identifier.
            //    A blank phone + blank email row is useless for marketing.
            if (!d.phone && !d.email) return null
            const { data: created, error } = await supabase
                .from("customers")
                .insert({
                    tenant_id: tenantId,
                    name: d.name || null,
                    phone: d.phone || null,
                    email: d.email || null,
                } as never)
                .select("id")
                .maybeSingle()
            if (error || !created) return null
            return (created as { id: string }).id
        } catch {
            return null
        }
    }

    /** Build a tenant-unique order number. The 4-char random suffix prevents
     *  two terminals from colliding at the same millisecond — without it,
     *  the offline sync's order_number dedup could attach one cashier's items
     *  to another cashier's order in the (rare) same-ms case. */
    function newOrderNumber(): string {
        const ts = Date.now().toString().slice(-8)
        const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
        return `POS-${ts}-${rand}`
    }

    /** Generate a UUID (or a Date.now()-derived fallback for ancient browsers). */
    function newClientRequestId(): string {
        return (typeof crypto !== "undefined" && crypto.randomUUID)
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    }

    // ── Offline path ────────────────────────────────────────────────────
    // When the browser reports we're offline, we route bill generation
    // through the local reservation buffer + pending-bills queue instead
    // of the server. Sync happens automatically when the network returns.
    //
    // The caller may pass `clientRequestId` and `orderNumber` so that an
    // online attempt that timed out can fall back to offline with the SAME
    // identity — the bill's DB UNIQUE constraint on (tenant, client_request_id)
    // then guarantees only one bill row even if the original online request
    // eventually landed server-side.
    async function generateBillOffline(
        noGst: boolean,
        details?: CheckoutCustomerDetails,
        identity?: { clientRequestId: string; orderNumber: string },
        payments?: CheckoutPayment[],
    ): Promise<{ ok: true; invoice: string } | { ok: false; reason: string }> {
        const t = noGst ? totalsNoGst : totals
        if (!t) return { ok: false, reason: "totals not ready" }
        const reservation = takeReservation(tenantId)
        if (!reservation) {
            return { ok: false, reason: "no_reservations" }
        }
        const orderNumber = identity?.orderNumber ?? newOrderNumber()
        const clientRequestId = identity?.clientRequestId ?? newClientRequestId()

        const items = cart.map((c) => {
            const unit = effectivePrice(c.item)
            const netUnit = netUnitPrice(c.item)
            return {
                menu_item_id: c.item.id,
                item_name: c.item.name,
                hsn_code: c.item.hsn_code,
                gst_slab: Number(c.item.gst_slab),
                quantity: c.quantity,
                unit_price: unit,
                taxable_amount: Number((netUnit * c.quantity).toFixed(2)),
                notes: c.notes ?? null,
            }
        })

        const ok = enqueuePending(tenantId, {
            client_request_id: clientRequestId,
            created_at: new Date().toISOString(),
            reserved_invoice: reservation.invoice_number,
            order_number: orderNumber,
            order_type: orderType,
            order_source: orderSource,
            // Strip the "__waiting__" UI sentinel — offline-queued bills
            // must never persist that string to the bills table.
            table_no: (tableNo && tableNo !== "__waiting__") ? tableNo : null,
            customer_id: customer?.id ?? null,
            // Capture the active branch at billing time so the sync
            // worker can stamp it onto the order/bill rows on reconnect.
            // Without this, offline bills land branch-less.
            branch_id: activeBranchId,
            // The sync worker will upsert the customers row on reconnect
            // when no customer_id is set yet — see lib/offline/sync.ts.
            customer_capture: hasAnyDetail(details) ? details : null,
            items,
            service_charge: t.service_charge ?? 0,
            order_discount: appliedCoupon?.discount ?? 0,
            round_off: t.round_off ?? 0,
            no_gst: noGst,
            tax_model: cfg.taxModel,
            coupon_id: appliedCoupon?.id ?? null,
            coupon_discount: appliedCoupon?.discount ?? 0,
            // Payments captured at checkout time. Split-pay = multiple
            // entries; sync worker will call record_payment once per entry
            // after generate_bill, so the bill comes back already PAID
            // rather than orphaned-and-unpaid. The singular `payment` field
            // is kept on the type for backwards-compat with older queued
            // payloads (sync.ts wraps it into an array if `payments` is
            // missing).
            payments: (payments ?? [])
                .filter((p) => Number.isFinite(p.amount) && p.amount > 0)
                .map((p) => ({ method: p.method, amount: p.amount, reference: p.reference || null })),
            snapshot: {
                grand_total: t.grand_total,
                subtotal: t.subtotal,
                items_count: items.reduce((s, i) => s + i.quantity, 0),
            },
        })
        if (!ok) {
            // localStorage write failed — return the reservation so we don't lose it.
            returnReservation(tenantId, reservation)
            return { ok: false, reason: "storage_failed" }
        }

        // Warn the cashier if the offline buffer is running low — once it
        // hits zero they can't bill until the network is back. The toast is
        // ID'd so a flurry of bills doesn't stack duplicate warnings.
        const left = remainingCount(tenantId)
        if (left <= 5) {
            const msg = left === 0
                ? "Used your last reserved invoice. Reconnect briefly to reserve more."
                : `Only ${left} reserved invoice${left === 1 ? "" : "s"} left for offline use. Reconnect briefly to top up.`
            toast.warning(msg, { id: "offline-buffer-low" })
        }

        return { ok: true, invoice: reservation.invoice_number }
    }

    async function generateBill(
        noGst = false,
        details?: CheckoutCustomerDetails,
        payments?: CheckoutPayment[],
    ) {
        if (cart.length === 0) return toast.error("Cart is empty")
        // Payment(s) are mandatory at checkout — no bill without payment.
        // The dialog blocks the confirm button until the sum of rows covers
        // grand_total, but we re-check here as a hard guard.
        //
        // Exception: a zero-grand-total bill (100% coupon, gift card fully
        // covering, etc.) doesn't require any payment row — the customer
        // owes nothing. The RPC handles this fine: v_total_paid (0)
        // >= v_grand (0) flips the bill straight to PAID.
        const validPayments = (payments ?? []).filter((p) => Number.isFinite(p.amount) && p.amount > 0)
        const t = noGst ? totalsNoGst : totals
        const isZeroBill = !!t && t.grand_total <= 0.005
        if (validPayments.length === 0 && !isZeroBill) {
            return toast.error("Capture payment before generating the invoice")
        }
        const totalPaid = validPayments.reduce((s, p) => s + p.amount, 0)
        if (t && totalPaid < t.grand_total - 0.005) {
            return toast.error(`Payment must cover the full bill (${totalPaid.toFixed(2)} < ${t.grand_total.toFixed(2)})`)
        }
        setBusy(true)
        // Stage 1: the click was accepted. From here the customer display
        // already flipped to PROCESSING (see the PROCESSING update below);
        // the cashier sees the same wording above the button.
        setGenerationStage("verifying")

        // Identity is created ONCE per click. Both the online attempt and
        // any offline fallback use the same client_request_id, so even if
        // the online generate_bill reached the server but the response
        // timed out, the offline retry collides on the bills UNIQUE
        // (tenant_id, client_request_id) and the DB returns the existing
        // bill — never a duplicate.
        const clientRequestId = newClientRequestId()
        const orderNumber = newOrderNumber()

        // Browser says offline → go straight to the local path. (We still
        // attempt online on `navigator.onLine === true` and only fall back
        // if the network call itself errors — captive-portal / flaky DNS.)
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
            // Pay-first guard: send_kot already committed an online order
            // + KOT a moment ago, so an offline bill would create a
            // separate orphan order on sync. Refuse and ask the cashier
            // to retry when the network is back — the kitchen ticket is
            // safely on the server already.
            if (prepaidOrderId) {
                setBusy(false)
                setGenerationStage("idle")
                return toast.error("Lost connection between sending KOT and billing — retry in a moment, the kitchen ticket is safe.")
            }
            const r = await generateBillOffline(noGst, details, { clientRequestId, orderNumber }, validPayments)
            setBusy(false)
            if (!r.ok) {
                if (r.reason === "no_reservations") {
                    return toast.error("Offline and no reserved invoice numbers left. Connect briefly to reserve more.")
                }
                return toast.error("Couldn't save bill offline — local storage full?")
            }
            toast.success(`Bill ${r.invoice} saved offline — will sync when online`)
            setCart([]); setTableNo(""); setCheckoutOpen(false); setOrderSource(null); removeCoupon()
            return
        }

        try {
            // 0. Upsert customer with captured marketing details (best-effort).
            //    If the cashier filled anything in the optional fields, this
            //    either matches an existing record by phone or creates one —
            //    so the generate_bill RPC can snapshot name/phone/email onto
            //    the bill row for marketing exports later.
            const billingCustomerId = hasAnyDetail(details)
                ? (await upsertMarketingCustomer(details)) ?? customer?.id ?? null
                : customer?.id ?? null

            // 1. Resolve the order id. In the normal takeaway/QSR flow
            //    we create a fresh order + items right here. In the
            //    PAY-FIRST DINE-IN flow `sendKotThenBill()` already
            //    created the order + a KOT + the items on the server
            //    (so the kitchen can start cooking) — we just reuse
            //    that id. Without this branch we'd create a second
            //    order with the same cart, the bill would attach to it,
            //    and the kitchen would be working on an uninvoiced
            //    duplicate.
            //
            //    branch_id is stamped from the active branch context so
            //    the order — and the bill that generate_bill spawns
            //    from it — both land in the correct branch view.
            //    activeBranchId is null in "All branches" view; that
            //    case only happens for owners, and we leave branch_id
            //    null (the bill stays cross-branch in their view).
            let resolvedOrderId: string
            if (prepaidOrderId) {
                resolvedOrderId = prepaidOrderId
            } else {
                const { data: { user } } = await supabase.auth.getUser()
                const { data: order, error: oe } = await supabase
                    .from("orders")
                    .insert({
                        tenant_id: tenantId,
                        order_number: orderNumber,
                        status: "OPEN",
                        order_type: orderType,
                        order_source: orderSource,
                        customer_id: billingCustomerId,
                        // "__waiting__" is a UI-only sentinel — convert
                        // to a human note instead of writing the raw
                        // sentinel into the order row.
                        notes: tableNo === "__waiting__"
                            ? "Waiting — no table assigned"
                            : tableNo ? `Table: ${tableNo}` : null,
                        created_by: user?.id ?? null,
                        branch_id: activeBranchId,
                    } as never)
                    .select("id")
                    .single()
                if (oe) throw oe
                resolvedOrderId = (order as { id: string }).id

                // 2. insert order_items with taxable amount precomputed
                //    (RPC will recompute tax based on inter-state).
                //    Skipped in pay-first mode — send_kot already
                //    inserted these via the KOT push.
                const lines = cart.map((c) => {
                    const unit = effectivePrice(c.item)
                    const netUnit = netUnitPrice(c.item)
                    const taxable = Number((netUnit * c.quantity).toFixed(2))
                    return {
                        tenant_id: tenantId,
                        order_id: resolvedOrderId,
                        menu_item_id: c.item.id,
                        item_name: c.item.name,
                        hsn_code: c.item.hsn_code,
                        gst_slab: Number(c.item.gst_slab),
                        quantity: c.quantity,
                        unit_price: unit,
                        taxable_amount: taxable,
                        line_total: taxable, // recomputed by RPC
                        notes: c.notes ?? null,
                    }
                })
                const { error: ie } = await supabase.from("order_items").insert(lines as never)
                if (ie) throw ie
            }

            // 3. call generate_bill RPC. p_client_request_id makes the call
            //    idempotent — if a transient retry reaches the server twice,
            //    or if a timed-out request silently succeeded server-side,
            //    we'll get the same bill back instead of creating a duplicate.
            //
            //    p_payments is the truly atomic part: the bill row and
            //    the payments rows land in the SAME Postgres transaction.
            //    Previously these were two separate RPCs; a network blip
            //    between them could leave a bill GENERATED with no
            //    payments — exactly the fraud loophole we said we'd
            //    closed. Closed for real now.
            setGenerationStage("generating")
            // Flip the customer screen to "Processing" — keyed on
            // created_by (stable), not the churning row id.
            if (displaySessionIdRef.current && userId) {
                void supabase
                    .from("pos_display_sessions")
                    .update({ status: "PROCESSING" } as never)
                    .eq("created_by", userId)
                    .then(() => {}, () => {})
            }
            // payments[] already carries the cashier's collected
            // CASH/UPI/CARD rows. If a gift card was applied earlier in
            // the dialog, prepend it as a GIFT_CARD entry so the server
            // RPC validates + decrements the balance + writes the
            // gift_card_transactions row atomically with the bill insert.
            const rpcPayments = [
                ...(appliedGiftCard && appliedGiftCard.amount > 0
                    ? [{ method: "GIFT_CARD", amount: appliedGiftCard.amount, reference: appliedGiftCard.code }]
                    : []),
                ...validPayments.map((p) => ({
                    method: p.method,
                    amount: p.amount,
                    reference: p.reference || null,
                })),
            ]
            const { data: bill, error: be } = await supabase.rpc("generate_bill", {
                p_order_id: resolvedOrderId,
                p_customer_id: billingCustomerId,
                p_service_charge: t?.service_charge ?? 0,
                p_order_discount: appliedCoupon?.discount ?? 0,
                p_round_off: t?.round_off ?? 0,
                p_no_gst: noGst,
                p_tax_model: cfg.taxModel,
                p_client_request_id: clientRequestId,
                p_payments: rpcPayments,
                // p_coupon_id makes coupon redemption + usage_count
                // increment atomic with the bill insert. Previously
                // a separate record_coupon_redemption call could fail
                // after the bill committed, leaking the coupon cap.
                p_coupon_id: appliedCoupon?.id ?? null,
            })
            if (be) throw be
            const billResult = bill as {
                bill_id: string
                invoice_number: string
                payments_recorded?: number
                fully_paid?: boolean
                coupon_applied?: boolean
            }

            // Sanity check — under the atomic flow this should always
            // match. If a webhook-paid bill somehow comes through this
            // path with 0 payments, surface a clear message instead of
            // pretending everything's fine.
            if ((billResult.payments_recorded ?? 0) === 0 && rpcPayments.length > 0) {
                toast.warning(
                    `Bill ${billResult.invoice_number} generated but the server reports no payments recorded. Open the bill to verify.`,
                )
            }

            // Stage 3: bill is real. Flip the customer display to PAID
            // so the second screen shows the "Thank you, INV-…" panel,
            // then DELETE the cashier's display entry — once the invoice
            // exists the session has served its purpose and must not
            // linger. The 5s window lets the customer see the thank-you
            // before the screen reverts to idle.
            setGenerationStage("done")
            if (displaySessionIdRef.current && userId) {
                void supabase
                    .from("pos_display_sessions")
                    .update({
                        status: "PAID",
                        invoice_number: billResult.invoice_number,
                    } as never)
                    .eq("created_by", userId)
                    .then(() => {}, () => {})
                // Invoice generated → delete this staff member's display
                // entry (after the brief thank-you). clear_pos_display
                // removes the row entirely, not just marks it closed.
                window.setTimeout(() => {
                    void supabase.rpc("clear_pos_display" as never).then(() => {}, () => {})
                }, 5000)
                syncDisplaySession(null)
            }

            // Stay on /pos so the cashier can ring up the next order without
            // exiting kiosk mode. The receipt is one tap away via the toast
            // action — opens /bills/<id>?autoprint=1 in a new tab so the
            // print dialog fires immediately and the POS screen stays put.
            toast.success(`Bill ${billResult.invoice_number} generated`, {
                description: `Ready for the next order.`,
                action: {
                    label: "Print receipt",
                    onClick: () => window.open(`/bills/${billResult.bill_id}?autoprint=1`, "_blank", "noopener"),
                },
                duration: 8000,
            })
            setCart([])
            setTableNo("")
            setCheckoutOpen(false)
            setOrderSource(null)
            setPrepaidOrderId(null)
            removeCoupon()
        } catch (e: unknown) {
            // If the failure looks like a network/DNS/captive-portal issue,
            // fall back to the offline path with the SAME identity. If the
            // online request actually succeeded server-side (subcase: server
            // got the bill but response timed out), sync will find the
            // existing bill via the same client_request_id and not
            // double-bill. The orphan reservation expires + recycles.
            const isNetworkLike =
                e instanceof TypeError ||                       // fetch failed
                (typeof navigator !== "undefined" && navigator.onLine === false) ||
                (e instanceof Error && /network|fetch|failed to fetch/i.test(e.message))
            if (isNetworkLike) {
                const r = await generateBillOffline(noGst, details, { clientRequestId, orderNumber }, validPayments)
                if (r.ok) {
                    toast.success(`Network was unreachable — bill ${r.invoice} saved offline, will sync later`)
                    setCart([]); setTableNo(""); setCheckoutOpen(false); setOrderSource(null); removeCoupon()
                    return
                }
                if (r.reason === "no_reservations") {
                    return toast.error("Network down and no reserved invoice numbers left. Try again once online.")
                }
            }
            // Subscription gate from generate_bill — surface the specific
            // call-to-action ("Open Billing") instead of the raw RPC text.
            const msg = e instanceof Error ? e.message : "Failed to generate bill"
            if (/subscription_inactive/.test(msg)) {
                toast.error("Your RestoPOS subscription is inactive. Bill generation is paused until a payment method is added.", {
                    action: {
                        label: "Open Billing",
                        onClick: () => router.push("/settings/billing"),
                    },
                    duration: 10000,
                })
                return
            }
            toast.error(msg)
        } finally {
            setBusy(false)
            // Reset back to idle in a moment so the cashier's "Done" flash
            // is visible briefly, then the button returns to normal copy
            // for the next bill.
            window.setTimeout(() => setGenerationStage("idle"), 250)
        }
    }

    /** Dine-in flow: send the current cart to the kitchen as a KOT, keep
     *  the table open so the waiter can add more items later. Finds (or
     *  creates) the table's running OPEN/IN_PROGRESS order, then calls
     *  the send_kot RPC which atomically allocates a KOT number, inserts
     *  the line items pointing at the KOT, marks the table OCCUPIED,
     *  and bumps the order status.
     *
     *  Also handles the "Waiting" pseudo-table — when all real tables
     *  are full but the kitchen can still start cooking, the cashier
     *  picks Waiting and we create a tableless order. The waiter
     *  reassigns a real table later via the orders page. */
    async function sendKot({ keepCart = false }: { keepCart?: boolean } = {}): Promise<string | null> {
        if (cart.length === 0) { toast.error("Cart is empty"); return null }
        if (!tableNo) { toast.error("Pick a table — or Waiting if every table is full"); return null }
        const isWaiting = tableNo === "__waiting__"
        setBusy(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()

            // Resolve table id. "Waiting" stays null on the order; real
            // table numbers are looked up + lock to that seating.
            let tableId: string | null = null
            if (!isWaiting) {
                const { data: table } = await supabase
                    .from("dining_tables")
                    .select("id")
                    .eq("tenant_id", tenantId)
                    .eq("number", tableNo)
                    .maybeSingle()
                tableId = (table as { id?: string } | null)?.id ?? null
            }

            // Look up the running order for this table — if one is
            // already open we add to it; otherwise create a fresh one.
            // Waiting orders ALWAYS get a fresh row (the previous batch
            // belonged to a different customer at the door).
            let orderId: string | null = null
            if (tableId) {
                const { data: open } = await supabase
                    .from("orders")
                    .select("id, status")
                    .eq("tenant_id", tenantId)
                    .eq("table_id", tableId)
                    .in("status", ["OPEN", "IN_PROGRESS", "ON_HOLD"])
                    .order("created_at", { ascending: false })
                    .limit(1)
                    .maybeSingle()
                orderId = (open as { id?: string } | null)?.id ?? null
            }
            if (!orderId) {
                const orderNumber = `POS-${Date.now().toString().slice(-8)}`
                const { data: created, error: oe } = await supabase.from("orders").insert({
                    tenant_id: tenantId,
                    order_number: orderNumber,
                    status: "OPEN",
                    order_type: "DINE_IN",
                    order_source: orderSource,
                    table_id: tableId,
                    customer_id: customer?.id ?? null,
                    notes: isWaiting ? "Waiting — no table assigned" : tableNo ? `Table: ${tableNo}` : null,
                    created_by: user?.id ?? null,
                    branch_id: activeBranchId,
                } as never).select("id").single()
                if (oe) throw oe
                orderId = (created as { id: string }).id
            }

            const items = cart.map((c) => ({
                menu_item_id: c.item.id,
                item_name: c.item.name,
                hsn_code: c.item.hsn_code,
                gst_slab: Number(c.item.gst_slab),
                quantity: c.quantity,
                unit_price: effectivePrice(c.item),
                notes: c.notes ?? null,
            }))

            const { data: res, error: ke } = await supabase.rpc("send_kot" as never, {
                p_order_id: orderId,
                p_items: items,
            } as never)
            if (ke) throw ke
            const kot = res as { kot_number?: number; seq_in_order?: number } | null

            toast.success(
                `KOT #${kot?.kot_number ?? "?"} sent to kitchen${kot?.seq_in_order ? ` (batch ${kot.seq_in_order})` : ""}`
                + (isWaiting ? " · Waiting customer — assign a table when one opens." : ""),
            )
            // Keep tableNo + orderType — waiter is still working this
            // table (or this waiting customer). Reset waiting picks to
            // blank so the cashier picks fresh for the next walk-in.
            if (!keepCart) {
                setCart([])
                if (isWaiting) setTableNo("")
            }
            return orderId
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to send KOT")
            return null
        } finally {
            setBusy(false)
        }
    }

    /** Pay-first dine-in flow. Sends the cart to the kitchen as a KOT
     *  (keeping the cart on screen for the checkout preview), then
     *  opens the existing checkout dialog. Picking a payment method
     *  in the dialog calls generate_bill against the order we just
     *  created — the same atomic bill+payment contract the regular
     *  takeaway/QSR checkout uses. Use this whenever the customer
     *  wants to pay BEFORE the food arrives. */
    async function sendKotThenBill() {
        const orderId = await sendKot({ keepCart: true })
        if (!orderId) return
        // Hand the just-created order id to generateBill so it bills
        // THIS order instead of creating a duplicate. Without this,
        // confirming the dialog would create a second order, leaving
        // the kitchen working on the first (uninvoiced) one.
        setPrepaidOrderId(orderId)
        setCheckoutOpen(true)
    }

    return (
        <div className="grid grid-cols-[72px_1fr_360px] lg:grid-cols-[80px_1fr_420px] gap-0 h-dvh bg-background">
            <PageTour tourKey="pos" />

            {/* ── LEFT NAV RAIL ──────────────────────────────────────
              * Vertical icon+label column anchored to the kiosk view.
              * Each entry is a quick-jump into another POS surface;
              * "Menu" is the active item (current view). The bottom
              * action exits kiosk mode the same way the floating
              * "Exit POS" pill does — kept for parity with the
              * reference design's "Logout" slot but routed to the
              * dashboard instead of signing out. */}
            <nav className="flex flex-col items-stretch border-r border-border/40 bg-card/40 py-4">
                <div className="flex flex-col items-stretch gap-1 px-2">
                    <NavRailItem href="/pos"     icon={UtensilsCrossed} label="Menu"   active />
                    <NavRailItem href="/tables"  icon={Grid3x3}         label="Tables"        />
                    <NavRailItem href="/orders"  icon={Receipt}         label="Sales"         />
                    <NavRailItem href="/bills"   icon={FileText}        label="Bills"         />
                    <NavRailItem href="/settings" icon={SettingsIcon}   label="Settings"      />
                    <NavRailItem href="/menu"    icon={HelpCircle}      label="Help"          />
                </div>
                <div className="mt-auto px-2">
                    <button
                        type="button"
                        onClick={() => router.push("/dashboard")}
                        className="w-full flex flex-col items-center gap-1 px-2 py-2.5 rounded-md text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                    >
                        <LogOut className="h-4 w-4" />
                        <span>Exit</span>
                    </button>
                </div>
            </nav>

            <section className="flex flex-col border-r border-border/40 min-w-0 min-h-0">
                {/* ── TOP BAR — prominent search + compact context selectors
                  * The reference image dedicates the top of the main column
                  * to a big search input. Order type / table / source still
                  * live here (they're essential for every sale) but get
                  * pushed under the search as a thin secondary row so the
                  * search itself reads as the primary affordance. */}
                <div className="border-b border-border/40 p-4 space-y-3">
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1 max-w-xl">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search menu"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-9 h-10 rounded-full bg-muted/40 border-border/60 focus-visible:bg-background"
                            />
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                            <TourReplayButton tourKey="pos" />
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <Tabs value={orderType} onValueChange={(v) => setOrderType(v as OrderType)}>
                            <TabsList className="h-9">
                                <TabsTrigger value="DINE_IN">Dine-in</TabsTrigger>
                                <TabsTrigger value="TAKEAWAY">Takeaway</TabsTrigger>
                                <TabsTrigger value="DELIVERY">Delivery</TabsTrigger>
                                <TabsTrigger value="QSR">QSR</TabsTrigger>
                            </TabsList>
                        </Tabs>
                        {orderType === "DINE_IN" && (
                            <Select value={tableNo || "__none__"} onValueChange={(v) => setTableNo(v === "__none__" ? "" : v)}>
                                <SelectTrigger className="h-9 text-xs w-44" data-tour="pos-table-picker">
                                    <SelectValue placeholder="Pick table" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">
                                        <span className="text-muted-foreground">— Pick table —</span>
                                    </SelectItem>
                                    {/* Waiting — for customers ringing up an order
                                      * when every table is full. Treated as dine-in
                                      * with no table assigned; can be billed
                                      * pay-first or seated + billed later. */}
                                    <SelectItem value="__waiting__">
                                        <span className="inline-flex items-center gap-1.5">
                                            <span className="font-mono text-warning">Waiting</span>
                                            <span className="text-[10px] text-muted-foreground">· no table yet</span>
                                        </span>
                                    </SelectItem>
                                    {tables.length === 0 ? (
                                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                            No tables yet. Add some in Settings → Tables.
                                        </div>
                                    ) : (
                                        tables.map((t) => (
                                            <SelectItem key={t.id} value={t.number}>
                                                <span className="inline-flex items-center gap-2">
                                                    <span className="font-mono">{t.number}</span>
                                                    {t.section && <span className="text-[10px] text-muted-foreground">· {t.section}</span>}
                                                    {t.capacity && <span className="text-[10px] text-muted-foreground">· {t.capacity}p</span>}
                                                    {t.status === "OCCUPIED" && <span className="text-[10px] text-warning">· occupied</span>}
                                                    {t.status === "RESERVED" && <span className="text-[10px] text-primary">· reserved</span>}
                                                    {t.status === "DIRTY" && <span className="text-[10px] text-destructive">· needs cleaning</span>}
                                                </span>
                                            </SelectItem>
                                        ))
                                    )}
                                </SelectContent>
                            </Select>
                        )}
                        {/* Channel / source tag — Swiggy/Zomato options only render for
                         *  Indian tenants (those aggregators don't operate elsewhere). */}
                        <Select value={orderSource ?? "__none__"} onValueChange={(v) => setOrderSource(v === "__none__" ? null : v)}>
                            <SelectTrigger className="h-9 text-xs w-32"><SelectValue placeholder="Direct" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">Direct</SelectItem>
                                {cfg.code === "IN" && (
                                    <>
                                        <SelectItem value="SWIGGY">Swiggy (manual)</SelectItem>
                                        <SelectItem value="ZOMATO">Zomato (manual)</SelectItem>
                                    </>
                                )}
                                <SelectItem value="PHONE">Phone</SelectItem>
                                <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                                <SelectItem value="OTHER">Other</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* ── CATEGORY STRIP — square cards with optional image + label
                  * The reference dedicates a horizontal scroll-row of square
                  * category tiles up here. We honour that: a horizontally-
                  * scrolling row of `<CategoryTile>` cards. The "All" tile
                  * is always first; remaining tiles come from the tenant's
                  * `menu_categories`, each rendering its uploaded
                  * `image_url` when set or a generic Utensils icon otherwise. */}
                <div className="border-b border-border/40 px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-bold tracking-tight">Category</h3>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => {
                                    const el = document.getElementById("pos-cat-strip")
                                    el?.scrollBy({ left: -220, behavior: "smooth" })
                                }}
                                className="h-7 w-7 grid place-items-center rounded-full border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                                aria-label="Scroll categories left"
                            >
                                <ChevronLeft className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    const el = document.getElementById("pos-cat-strip")
                                    el?.scrollBy({ left: 220, behavior: "smooth" })
                                }}
                                className="h-7 w-7 grid place-items-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                                aria-label="Scroll categories right"
                            >
                                <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                    <div id="pos-cat-strip" className="flex gap-2 overflow-x-auto scrollbar-thin pb-1 -mx-1 px-1">
                        <button
                            onClick={() => setActiveCat("ALL")}
                            className={cn(
                                "relative shrink-0 w-[88px] h-[88px] rounded-xl border flex flex-col items-center justify-center gap-1.5 transition-colors",
                                activeCat === "ALL"
                                    ? "border-primary ring-2 ring-primary/30 bg-primary/[0.06]"
                                    : "border-border/60 bg-card hover:border-primary/40 hover:bg-muted/30",
                            )}
                            title={`All items · ${items.length}`}
                        >
                            <span
                                aria-hidden
                                className={cn(
                                    "absolute top-1.5 right-1.5 min-w-[20px] h-5 px-1.5 rounded-full grid place-items-center text-[10px] font-bold tabular-nums border",
                                    activeCat === "ALL"
                                        ? "bg-primary text-primary-foreground border-primary"
                                        : "bg-muted/70 text-muted-foreground border-border/60",
                                )}
                            >
                                {items.length}
                            </span>
                            <div className="h-9 w-9 rounded-lg grid place-items-center bg-muted/50">
                                <Utensils className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <span className="text-[11px] font-semibold">All</span>
                        </button>
                        {categoriesWithItems.map((c) => {
                            const img = (c as { image_url?: string | null }).image_url ?? null
                            const isActive = activeCat === c.id
                            const count = itemCountByCategory.get(c.id) ?? 0
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => setActiveCat(c.id)}
                                    className={cn(
                                        "relative shrink-0 w-[88px] h-[88px] rounded-xl border flex flex-col items-center justify-center gap-1.5 px-2 transition-colors",
                                        isActive
                                            ? "border-primary ring-2 ring-primary/30 bg-primary/[0.06]"
                                            : "border-border/60 bg-card hover:border-primary/40 hover:bg-muted/30",
                                    )}
                                    title={`${c.name} · ${count} item${count === 1 ? "" : "s"}`}
                                >
                                    {/* Count pip — top-right corner. Primary tint
                                      * when the category is the active filter so it
                                      * reads as "you have N of these", neutral grey
                                      * otherwise. */}
                                    <span
                                        aria-hidden
                                        className={cn(
                                            "absolute top-1.5 right-1.5 min-w-[20px] h-5 px-1.5 rounded-full grid place-items-center text-[10px] font-bold tabular-nums border",
                                            isActive
                                                ? "bg-primary text-primary-foreground border-primary"
                                                : "bg-muted/70 text-muted-foreground border-border/60",
                                        )}
                                    >
                                        {count}
                                    </span>
                                    {img ? (
                                        /* eslint-disable-next-line @next/next/no-img-element */
                                        <img src={img} alt="" className="h-9 w-9 rounded-lg object-cover" />
                                    ) : (
                                        <div className="h-9 w-9 rounded-lg grid place-items-center bg-muted/50">
                                            <Utensils className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                    )}
                                    <span className="text-[11px] font-semibold leading-tight text-center line-clamp-2 break-words">
                                        {c.name}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                </div>

                <div className="flex-1 overflow-auto scrollbar-thin p-4" data-tour="pos-menu">
                    {loading ? (
                        // Skeleton tiles tracking the live card geometry
                        // (same grid breakpoints, 3:2 image, p-2 body,
                        // rounded-xl border). Card sizes won't reflow
                        // once the menu data lands.
                        <div className={ITEM_GRID_CLS}>
                            {Array.from({ length: 18 }).map((_, i) => (
                                <div key={i} className="rounded-xl border border-border/60 bg-card/40 overflow-hidden animate-pulse">
                                    <div className="aspect-[3/2] w-full bg-muted/40" />
                                    <div className="p-2 space-y-1.5">
                                        <div className="h-3 w-3/4 rounded bg-muted/50" />
                                        <div className="flex items-end justify-between gap-2 pt-0.5">
                                            <div className="space-y-1">
                                                <div className="h-3.5 w-12 rounded bg-muted/60" />
                                                <div className="h-2 w-8 rounded bg-muted/30" />
                                            </div>
                                            <div className="h-8 w-8 rounded-lg bg-muted/50" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : items.length === 0 ? (
                        <div className="text-center py-20 text-muted-foreground space-y-3">
                            <Utensils className="h-10 w-10 mx-auto opacity-50" />
                            <div>
                                <div className="font-medium text-foreground">No menu items yet</div>
                                <p className="text-sm mt-1">Add categories and items before you can take orders.</p>
                            </div>
                            <Button variant="outline" size="sm" asChild>
                                <a href="/menu-admin">Set up menu →</a>
                            </Button>
                        </div>
                    ) : visibleItems.length === 0 ? (
                        <div className="text-center py-20 text-muted-foreground">
                            <Utensils className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            {search.trim()
                                ? `No items match "${search.trim()}".`
                                : `No items ${activeCat !== "ALL" ? "in this category" : ""}.`}
                        </div>
                    ) : groupedByCategory ? (
                        // ── "All" with no search → category-grouped layout.
                        // Section header pinned on scroll so the cashier
                        // always knows which group they're scrolling
                        // through. Header design mirrors the square
                        // category-strip tiles up top (image / icon +
                        // bold name + count badge) so the two surfaces
                        // read as one consistent visual system.
                        <div className="space-y-6">
                            {groupedByCategory.map((group) => {
                                const groupCat = group.id ? categoryById.get(group.id) : null
                                const groupImg = (groupCat as { image_url?: string | null } | null)?.image_url ?? null
                                return (
                                    <section key={group.id ?? "_orphan"}>
                                        <header className="sticky top-0 z-10 -mx-4 px-4 py-2.5 mb-3 bg-background/95 backdrop-blur-md border-b border-border/60 flex items-center gap-3 shadow-sm">
                                            {groupImg ? (
                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                <img
                                                    src={groupImg}
                                                    alt=""
                                                    className="h-9 w-9 rounded-lg object-cover shrink-0 ring-1 ring-border/60"
                                                />
                                            ) : (
                                                <div className="h-9 w-9 rounded-lg grid place-items-center shrink-0 bg-primary/10 ring-1 ring-primary/20">
                                                    <Utensils className="h-4 w-4 text-primary" />
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <h3 className="text-base font-bold tracking-tight truncate leading-tight">
                                                    {group.name}
                                                </h3>
                                                <p className="text-[11px] text-muted-foreground tabular-nums">
                                                    {group.items.length} {group.items.length === 1 ? "item" : "items"}
                                                </p>
                                            </div>
                                            <Badge variant="outline" className="text-[10px] shrink-0 uppercase tracking-wider">
                                                {group.items.length}
                                            </Badge>
                                        </header>
                                        <div className={ITEM_GRID_CLS}>
                                            {group.items.map(renderItemCard)}
                                        </div>
                                    </section>
                                )
                            })}
                        </div>
                    ) : (
                        // Filtered (by category chip) or searching → flat
                        // unified grid so the cashier scans top-to-bottom
                        // without "where am I" friction.
                        <div className={ITEM_GRID_CLS}>
                            {visibleItems.map(renderItemCard)}
                        </div>
                    )}
                </div>
            </section>

            {/* `min-h-0` is the magic flex-bug fix: without it the
              * inner `flex-1 overflow-auto` cart list expands to fit
              * every line and pushes the totals + Charge button below
              * the viewport on long orders. With it, the cart scrolls
              * cleanly and the action bar stays pinned at the bottom. */}
            <aside className="flex flex-col bg-card min-h-0" data-tour="pos-cart">
                {/* ── Order Details header ────────────────────────────
                  * The reference dedicates a generous heading area to
                  * the order context: title + customer block + a small
                  * action-icon row. We keep the customer phone-lookup
                  * affordance and the customer-screen controls but
                  * present them as a compact set of icon buttons that
                  * sit beside the customer card rather than dominating
                  * the panel like the old "Cart" header did. */}
                <div className="border-b border-border/40 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <h2 className="text-lg font-bold tracking-tight">Order Details</h2>
                            <p className="text-xs text-muted-foreground">
                                {cart.length} item{cart.length === 1 ? "" : "s"}
                                {tableNo && tableNo !== "__waiting__" && <> · Table <span className="font-mono">{tableNo}</span></>}
                            </p>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setCart([]); removeCoupon(); setCustomer(null); setCustomerPhone("") }}
                            disabled={cart.length === 0 && !customer}
                        >
                            Clear
                        </Button>
                    </div>

                    {customer ? (
                        // Resolved customer: avatar (two-letter initial),
                        // name, loyalty info, dismiss-X. Matches the
                        // reference's customer-block header where the
                        // person is the most prominent thing on the
                        // panel after the title.
                        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/[0.06] px-3 py-2.5">
                            <span
                                aria-hidden
                                className="h-10 w-10 rounded-full grid place-items-center shrink-0 text-sm font-bold bg-primary text-primary-foreground"
                            >
                                {((customer.name ?? customerPhone) || "?")
                                    .split(/\s+/).filter(Boolean).slice(0, 2)
                                    .map((w) => w[0]?.toUpperCase() ?? "")
                                    .join("") || "?"}
                            </span>
                            <div className="flex-1 min-w-0">
                                <div className="font-semibold truncate">{customer.name ?? customerPhone}</div>
                                <div className="text-[11px] text-muted-foreground truncate">
                                    {customer.loyalty_tier} · {customer.loyalty_points} pts
                                    {customerPhone && <> · {customerPhone}</>}
                                </div>
                            </div>
                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 shrink-0"
                                onClick={() => { setCustomer(null); setCustomerPhone("") }}
                                aria-label="Remove customer"
                            >
                                <X className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Input
                                        placeholder="Customer phone (optional)"
                                        value={customerPhone}
                                        onChange={(e) => setCustomerPhone(e.target.value)}
                                        className="h-9 pr-8"
                                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), lookupCustomer())}
                                    />
                                    {customerLookupBusy && (
                                        <Loader2
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground"
                                            aria-label="Looking up customer"
                                        />
                                    )}
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={lookupCustomer}
                                    disabled={!customerPhone.trim() || customerLookupBusy}
                                >
                                    {customerLookupMissed ? "Add" : "Find"}
                                </Button>
                            </div>
                            {customerLookupMissed && (
                                <p className="text-[11px] text-muted-foreground pl-1">
                                    No customer with this number — tap <span className="font-medium text-foreground">Add</span> to create one, or continue without.
                                </p>
                            )}
                        </div>
                    )}

                    {/* Action-icon row — small affordances for the
                      * customer-facing screen + a coupon entry trigger.
                      * Compact so they don't compete with the customer
                      * block above. Each icon has a clear title. */}
                    <div className="flex items-center gap-1">
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={openCustomerScreen}
                            disabled={openingScreen}
                            title="Open customer-facing display in a new tab"
                            aria-label="Open customer screen"
                        >
                            {openingScreen
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <MonitorSmartphone className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={resyncDisplay}
                            disabled={resyncing}
                            title="Re-sync customer screen"
                            aria-label="Re-sync customer screen"
                        >
                            {resyncing
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <RefreshCw className="h-3.5 w-3.5" />}
                        </Button>
                        <span className="ml-auto text-[10px] text-muted-foreground uppercase tracking-wider">
                            {orderType.replace("_", " ")}
                        </span>
                    </div>
                </div>

                <div ref={cartListRef} className="flex-1 overflow-auto scrollbar-thin">
                    {cart.length === 0 ? (
                        <div className="text-center text-sm text-muted-foreground py-20 px-4">
                            Tap menu items to add them to the cart.
                        </div>
                    ) : (
                        // Cart lines grouped by category, with a small
                        // pill-style section label per group — matches the
                        // reference's "Appetizer / Main Course / Dessert"
                        // banners. The section header is `sticky` inside
                        // the scroll container so on long orders the
                        // cashier always knows which group they're
                        // scanning through as they scroll.
                        <div className="divide-y divide-border/40">
                            {groupedCart.map((group) => (
                                <section key={group.id ?? "_other"} className="py-2">
                                    <div className="sticky top-0 z-10 px-4 pt-1.5 pb-1 bg-card/95 backdrop-blur-sm">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold uppercase tracking-wider">
                                            {group.name}
                                        </span>
                                    </div>
                                    <ul>
                                        {group.lines.map(({ line: c, idx: i }) => {
                                            const isOnSale = c.item.sale_price != null && Number(c.item.sale_price) < Number(c.item.base_price)
                                            return (
                                                <li
                                                    key={i}
                                                    data-cart-idx={i}
                                                    className={cn(
                                                        "px-4 py-2 flex items-start gap-3 transition-colors duration-500",
                                                        highlightIdx === i && "bg-primary/15 ring-1 ring-primary/40",
                                                    )}
                                                >
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-baseline gap-2">
                                                            <span className="font-semibold text-sm truncate flex-1">{c.item.name}</span>
                                                            <span className="text-sm font-bold tabular-nums shrink-0">
                                                                {money(effectivePrice(c.item) * c.quantity)}
                                                            </span>
                                                        </div>
                                                        <div className="text-[11px] text-muted-foreground">
                                                            {money(effectivePrice(c.item))} × {c.quantity}
                                                            {isOnSale && (
                                                                <span className="line-through text-muted-foreground/60 ml-1">
                                                                    {money(c.item.base_price)}
                                                                </span>
                                                            )}
                                                            {c.item.gst_slab > 0 && (
                                                                <span className="ml-1.5">· {cfg.taxShortName} {c.item.gst_slab}%</span>
                                                            )}
                                                        </div>
                                                        {/* Modifier note pill — reference design uses
                                                          * coloured capsules ("No Shrimp" red, "Extra
                                                          * Chicken" green, etc.). We render notes as
                                                          * neutral pills since they're user-typed
                                                          * free text, not structured negative/positive. */}
                                                        {c.notes && (
                                                            <div className="mt-1 flex flex-wrap gap-1">
                                                                {c.notes.split(/[,;\n]+/).map((tag, k) => {
                                                                    const t = tag.trim()
                                                                    if (!t) return null
                                                                    const isNegative = /^no\s|without\s|less\s|skip\s/i.test(t)
                                                                    return (
                                                                        <span
                                                                            key={k}
                                                                            className={cn(
                                                                                "inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border",
                                                                                isNegative
                                                                                    ? "bg-destructive/10 text-destructive border-destructive/30"
                                                                                    : "bg-success/10 text-success border-success/30",
                                                                            )}
                                                                        >
                                                                            {t}
                                                                        </span>
                                                                    )
                                                                })}
                                                            </div>
                                                        )}
                                                        <div className="mt-1.5 inline-flex items-center gap-1">
                                                            <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => changeQty(i, -1)}>
                                                                <Minus className="h-3 w-3" />
                                                            </Button>
                                                            <span className="w-6 text-center text-xs font-bold tabular-nums">{c.quantity}</span>
                                                            <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => changeQty(i, 1)}>
                                                                <Plus className="h-3 w-3" />
                                                            </Button>
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-6 w-6 ml-1 text-destructive"
                                                                onClick={() => changeQty(i, -c.quantity)}
                                                                title="Remove"
                                                            >
                                                                <Trash2 className="h-3 w-3" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </li>
                                            )
                                        })}
                                    </ul>
                                </section>
                            ))}
                        </div>
                    )}
                </div>

                {suggestions.length > 0 && (
                    <div className="border-t border-border/40 px-4 py-3">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                            <Lightbulb className="h-3.5 w-3.5 text-primary" />
                            <span className="font-medium uppercase tracking-wider">Customers often add</span>
                        </div>
                        <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
                            {suggestions.map((s) => (
                                <button
                                    key={s.id}
                                    onClick={() => addToCart(s)}
                                    className="shrink-0 flex items-center gap-2 rounded-full bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-colors px-3 py-1.5 text-xs"
                                >
                                    <Plus className="h-3 w-3 text-primary" />
                                    <span className="font-medium">{s.name}</span>
                                    <span className="text-muted-foreground">{money(effectivePrice(s))}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {totals && (
                    <div className="border-t border-border/40 p-4 space-y-2.5 text-sm">
                        {appliedCoupon ? (
                            <div className="flex items-center justify-between gap-2 rounded-md bg-success/10 border border-success/30 px-3 py-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                                    <div className="min-w-0">
                                        <div className="font-mono font-semibold text-success truncate">{appliedCoupon.code}</div>
                                        {appliedCoupon.description && <div className="text-xs text-muted-foreground truncate">{appliedCoupon.description}</div>}
                                    </div>
                                </div>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={removeCoupon}>
                                    <X className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Tag className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        value={couponCode}
                                        onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                                        placeholder="Coupon code"
                                        className="pl-8 h-9 font-mono"
                                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyCoupon())}
                                    />
                                </div>
                                <Button size="sm" variant="outline" onClick={() => applyCoupon()} disabled={!couponCode.trim() || couponBusy}>
                                    {couponBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
                                </Button>
                            </div>
                        )}
                        {/* Totals — reference design uses tight rows with
                          * dimmed labels, bold values. Tax lines roll into a
                          * single "Tax" label when the cashier doesn't need
                          * a CGST/SGST/IGST breakdown (i.e. non-India
                          * tenants). */}
                        <Row label="Sub Total" value={money(totals.subtotal)} />
                        <Row
                            label="Discount"
                            value={totals.order_discount > 0 ? `- ${money(totals.order_discount)}` : money(0)}
                            className={totals.order_discount > 0 ? "text-success" : ""}
                        />
                        {cfg.serviceChargeAllowed && (
                            <Row label="Service Charge" value={money(totals.service_charge)} />
                        )}
                        {cfg.taxModel === "split" ? (
                            <>
                                {totals.cgst_amount > 0 && <Row label={cfg.taxLabels.cgst ?? "CGST"} value={money(totals.cgst_amount)} />}
                                {totals.sgst_amount > 0 && <Row label={cfg.taxLabels.sgst ?? "SGST"} value={money(totals.sgst_amount)} />}
                                {totals.igst_amount > 0 && <Row label={cfg.taxLabels.igst ?? "IGST"} value={money(totals.igst_amount)} />}
                            </>
                        ) : (
                            <Row label="Tax" value={money(totals.igst_amount ?? 0)} />
                        )}
                        {totals.round_off !== 0 && <Row label="Round off" value={money(totals.round_off)} />}
                        {!cfg.serviceChargeAllowed && rawServiceChargePct > 0 && (
                            <div className="text-[10px] text-warning">Service charge isn&apos;t allowed in {cfg.name} — it&apos;s been left off this bill.</div>
                        )}
                        <div className="border-t border-border/60 pt-2 mt-1 flex items-baseline justify-between">
                            <span className="text-base font-bold">Total</span>
                            <span className="text-xl font-bold tabular-nums">{money(totals.grand_total)}</span>
                        </div>
                    </div>
                )}

                {/* ── Action buttons — Print / Fire / Charge ──
                  * The reference layout: two outline-style buttons on the
                  * top row (Print + the kitchen "Fire"), then a full-
                  * width primary "Charge $XX.XX" CTA below. We map them:
                  *   Print   → window.print() (basic, for now)
                  *   Fire    → Send KOT (dine-in + table only) OR Send-to-
                  *             kitchen-and-bill for pay-first dine-in
                  *   Charge  → Review & checkout dialog (existing path) */}
                <div className="border-t border-border/40 p-4 space-y-2">
                    {orderType === "DINE_IN" && tableNo && (
                        <div className="grid grid-cols-2 gap-2">
                            <Button
                                variant="outline"
                                size="lg"
                                onClick={() => window.print()}
                                disabled={cart.length === 0}
                                title="Print the current cart as a paper docket"
                            >
                                <Receipt className="h-4 w-4" />
                                Print
                            </Button>
                            <Button
                                variant="warning"
                                size="lg"
                                disabled={cart.length === 0 || busy}
                                onClick={() => sendKot()}
                                data-tour="pos-send-kot"
                                title="Send the current cart to the kitchen (KOT)"
                            >
                                <Utensils className="h-4 w-4" />
                                Fire
                            </Button>
                        </div>
                    )}
                    {orderType === "DINE_IN" && tableNo && (
                        <Button
                            variant="outline"
                            className="w-full"
                            size="lg"
                            disabled={cart.length === 0 || busy}
                            onClick={sendKotThenBill}
                            title="Send the KOT to the kitchen AND open checkout (pay-first dine-in)"
                        >
                            <Receipt className="h-4 w-4" />
                            Fire + Bill now
                        </Button>
                    )}
                    <Button
                        variant="neon"
                        className="w-full"
                        size="lg"
                        disabled={cart.length === 0 || busy}
                        onClick={() => setCheckoutOpen(true)}
                        data-tour="pos-checkout"
                    >
                        <Receipt className="h-4 w-4" />
                        Charge{totals ? ` ${money(totals.grand_total)}` : ""}
                    </Button>
                </div>
            </aside>

            {/* McDonald's-style "add item" sheet */}
            <ItemAddDialog<MenuItem>
                item={addingItem}
                recommended={addingItem ? recommendedFor(addingItem) : []}
                inCartIds={new Set(cart.map((c) => c.item.id))}
                currency={cfg.currency}
                taxLabel={cfg.taxModel === "none" ? "" : (cfg.taxModel === "split" ? cfg.taxShortName : (cfg.taxLabels.single ?? cfg.taxShortName))}
                onClose={() => setAddingItem(null)}
                onAdd={(it, qty, notes) => addLine(it, qty, notes)}
                onQuickAdd={(it) => addLine(it, 1, "")}
            />

            {/* Bill preview — shown to both the staff and the customer before printing */}
            <CheckoutPreviewDialog
                open={checkoutOpen}
                cart={cart}
                totals={totals}
                totalsNoGst={totalsNoGst}
                coupon={appliedCoupon ? { code: appliedCoupon.code, description: appliedCoupon.description } : null}
                giftCard={appliedGiftCard}
                customer={customer ? { name: customer.name, phone: customerPhone } : null}
                orderType={orderType}
                tableNo={tableNo === "__waiting__" ? "Waiting" : tableNo}
                currency={cfg.currency}
                countryCode={cfg.code}
                singleTaxLabel={cfg.taxModel === "split" ? undefined : (cfg.taxLabels.single ?? cfg.taxShortName)}
                defaultNoTax={!taxEnabled}
                busy={busy}
                generationStage={generationStage}
                qrPayload={checkoutQr}
                qrError={checkoutQrError}
                phonepeFallbackReason={phonepeFallbackReason}
                canSetupPayments={userRole === "OWNER" || userRole === "MANAGER"}
                couponBusy={couponBusy}
                giftCardBusy={giftCardBusy}
                onClose={() => { setCheckoutOpen(false); setPrepaidOrderId(null) }}
                onConfirm={(noGst, details, payments) => generateBill(noGst, details, payments)}
                onApplyCoupon={(code) => applyCoupon(code)}
                onRemoveCoupon={removeCoupon}
                onApplyGiftCard={(code) => applyGiftCard(code)}
                onRemoveGiftCard={removeGiftCard}
                onCustomerDetailsChange={setCheckoutDetails}
                onPaymentMethodChange={setCheckoutMethod}
                phonepeAutoConfirm={phonepeAutoConfirm}
            />

            {recoveredSale && (
                <RecoveredSaleOverlay
                    sale={recoveredSale}
                    onCancel={() => {
                        setRecoveredSale(null)
                        void supabase.rpc("clear_pos_display" as never).then(() => {}, () => {})
                    }}
                />
            )}
        </div>
    )
}

/**
 * Shown when the POS reloads while a scan-to-pay QR was live. The sale
 * was recovered from pos_display_sessions — the cashier sees what's being
 * paid for, and the screen completes itself the moment the webhook
 * confirms the payment (or the cashier cancels).
 */
function RecoveredSaleOverlay({
    sale, onCancel,
}: {
    sale: { items: Array<{ name: string; quantity: number; unit_price: number }>; grandTotal: number; currency: string }
    onCancel: () => void
}) {
    return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 space-y-4 shadow-2xl">
                <div>
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <Receipt className="h-5 w-5 text-primary" />
                        Payment in progress
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        This sale was waiting for payment when the screen reloaded.
                        The customer can still pay — it completes here automatically.
                    </p>
                </div>
                <div className="rounded-lg border border-border/60 divide-y divide-border/60 max-h-52 overflow-y-auto">
                    {sale.items.map((it, i) => (
                        <div key={i} className="flex justify-between gap-3 px-3 py-2 text-sm">
                            <span className="truncate">
                                <span className="text-muted-foreground">{it.quantity}× </span>
                                {it.name}
                            </span>
                            <span className="tabular-nums shrink-0">
                                {formatCurrency(it.unit_price * it.quantity, sale.currency)}
                            </span>
                        </div>
                    ))}
                </div>
                <div className="flex items-center justify-between text-base font-bold">
                    <span>Total</span>
                    <span className="tabular-nums">{formatCurrency(sale.grandTotal, sale.currency)}</span>
                </div>
                <div className="flex items-center gap-2.5 rounded-md border border-primary/30 bg-primary/[0.06] px-3 py-2.5 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                    Waiting for the customer to pay…
                </div>
                <Button variant="outline" className="w-full" onClick={onCancel}>
                    Cancel this sale
                </Button>
            </div>
        </div>
    )
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
    return (
        <div className={cn("flex items-center justify-between", className)}>
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium">{value}</span>
        </div>
    )
}

/** Single entry in the POS left navigation rail. Icon stacked over a
 *  small label, active entry tinted with the primary accent so the
 *  cashier instantly sees where they are. */
function NavRailItem({
    href, icon: Icon, label, active = false,
}: {
    href: string
    icon: React.ComponentType<{ className?: string }>
    label: string
    active?: boolean
}) {
    return (
        <Link
            href={href}
            className={cn(
                "flex flex-col items-center gap-1 px-2 py-2.5 rounded-md text-[10px] uppercase tracking-wider transition-colors",
                active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
            )}
            title={label}
        >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
        </Link>
    )
}
