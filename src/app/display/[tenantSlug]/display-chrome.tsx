"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { Inter } from "next/font/google"
import QRCode from "qrcode"
import { AnimatePresence, animate, motion } from "framer-motion"
import {
    CheckCircle2, CreditCard, Loader2, ShoppingBag,
    Sparkles, Tag, User, UtensilsCrossed, Wallet,
} from "lucide-react"

import { cn, formatCurrency } from "@/lib/utils"
import type { PosDisplaySession } from "@/types/database"
import { RecommendationTreasure } from "./recommendation-treasure"
import { RecommendationWinToast, type RecommendationWin } from "./recommendation-win-toast"

/**
 * Customer-facing display — "clean & minimal" design.
 *
 * Flat surfaces, solid colours, Inter throughout, restrained type sizes,
 * almost no glow / gradient / motion — closer to a Square / Apple
 * checkout screen than the app's neon admin theme.
 *
 * Two routes render this:
 *   - `/display/<slug>`          — branch / tenant aggregator view
 *   - `/display/<slug>/<token>`  — per-cashier view
 * Both load + filter the session themselves, then hand it in here.
 */
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap" })

export type DisplayTenant = {
    id: string
    name: string
    logo_url: string | null
    slug?: string
    country?: string | null
}

/**
 * Decide whether a freshly-arrived `pos_display_sessions` row should be
 * shown on the customer screen — WITHOUT trusting the device clock.
 *
 * The POS heartbeats its session row every ~15s; a session is "live"
 * while that heartbeat keeps landing. The naive check that used to live
 * here — `Date.now() - updated_at < 45s` — compared the SERVER's
 * `updated_at` against the customer tablet's wall clock. If that tablet
 * was even ~a minute off (cheap displays drift), a perfectly live
 * checkout was judged "stale": the panel — payment QR included — blanked
 * out, and a realtime update carrying the cashier's payment-method
 * switch got silently discarded. That is the "QR stops showing / won't
 * switch" bug.
 *
 * Instead we watch the server `updated_at` stamp ADVANCE and time the
 * gap with this device's OWN clock only (`Date.now()` minus `Date.now()`
 * — any skew cancels out). Every realtime event / poll that carries a
 * newer stamp restarts the 45s window; a frozen stamp (POS gone) lets it
 * expire. Returns the row when it should be shown, else null.
 *
 * It's a hook because it needs one bit of per-screen memory (the last
 * stamp + when we first saw it).
 */
export function useSessionLiveness() {
    const ref = useRef<{ stamp: string | null; at: number }>({ stamp: null, at: 0 })
    return useCallback((row: PosDisplaySession | null): PosDisplaySession | null => {
        // No row, a delete event (`{}` — no id), or an explicit CLOSED → idle.
        if (!row || !row.id || row.status === "CLOSED") return null
        if (row.updated_at !== ref.current.stamp) {
            // The POS just wrote the row — restart the liveness window.
            ref.current = { stamp: row.updated_at, at: Date.now() }
        }
        // PROCESSING / PAID are terminal states — always shown.
        if (row.status === "PROCESSING" || row.status === "PAID") return row
        return Date.now() - ref.current.at < 45_000 ? row : null
    }, [])
}

type DisplayPhase = "idle" | "building" | "awaiting"

/** A menu item the customer might want to add — from the restaurant's
 *  curated `menu_item_recommendations`. */
interface Suggestion {
    id: string
    name: string
    price: number
    image_url: string | null
}

/** The lightweight menu feed used to build upsell suggestions. */
interface DisplayMenuFeed {
    items: Array<{
        id: string
        name: string
        base_price: number
        sale_price: number | null
        image_url: string | null
        is_sold_out: boolean
    }>
    recommendations: Record<string, string[]>
}

/** Derive up to 3 "you might also like" picks from the live cart. */
function computeSuggestions(
    feed: DisplayMenuFeed | null,
    session: PosDisplaySession | null,
): Suggestion[] {
    if (!feed || !session) return []
    const cart = (session.cart_payload ?? []) as Array<{ menu_item_id?: string | null }>
    const cartIds = new Set(cart.map((l) => l.menu_item_id).filter((x): x is string => !!x))
    if (cartIds.size === 0) return []
    const byId = new Map(feed.items.map((it) => [it.id, it]))
    const seen = new Set<string>()
    const out: Suggestion[] = []
    for (const cid of cartIds) {
        for (const rid of feed.recommendations[cid] ?? []) {
            if (cartIds.has(rid) || seen.has(rid)) continue
            const it = byId.get(rid)
            if (!it || it.is_sold_out) continue
            seen.add(rid)
            const sale = Number(it.sale_price)
            const base = Number(it.base_price)
            const price = it.sale_price != null && sale > 0 && sale < base ? sale : base
            out.push({ id: it.id, name: it.name, price, image_url: it.image_url })
            if (out.length >= 3) return out
        }
    }
    return out
}

/* ── Copy pools — rotate gently so nothing reads stale ─────────────────── */
const RAIL_LINES: Record<DisplayPhase, string[]> = {
    idle: [
        "We're glad you're here",
        "Welcome — make yourself at home",
        "Good things are on the way",
    ],
    building: [
        "Putting your order together",
        "Ringing up your picks",
        "Your order is taking shape",
    ],
    awaiting: [
        "Almost done — just pay to finish",
        "One last step to wrap up",
    ],
}
const SUGGEST_HEADERS = [
    "You might also like",
    "Perfect with your order",
    "Popular with this",
]
const SUGGEST_SUBLINES = [
    "Just ask our staff to add one",
    "Say the word and we'll add it",
]
const ITEM_TAGS = [
    "Popular add-on", "Crowd favourite", "Chef's pick",
    "Pairs well", "Fan favourite",
]

/** A phrase that cycles through a pool — slowly, so it stays calm. */
function useRotatingPhrase(phrases: string[], intervalMs: number): string {
    const key = phrases.join("|")
    const [idx, setIdx] = useState(0)
    useEffect(() => {
        setIdx(Math.floor(Math.random() * phrases.length))
        if (phrases.length < 2) return
        const t = window.setInterval(
            () => setIdx((i) => (i + 1) % phrases.length),
            intervalMs,
        )
        return () => window.clearInterval(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, intervalMs])
    return phrases[idx % phrases.length] ?? phrases[0] ?? ""
}

/** A stable, varied tag per suggestion item. */
function tagForItem(id: string): string {
    let h = 0
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
    return ITEM_TAGS[Math.abs(h) % ITEM_TAGS.length] ?? ITEM_TAGS[0]!
}

export function CustomerDisplayChrome({
    tenant,
    branchName,
    stafferName,
    session,
    lastSyncAt = 0,
}: {
    tenant: DisplayTenant
    branchName: string | null
    stafferName?: string | null
    session: PosDisplaySession | null
    lastSyncAt?: number
}) {
    // Upsell feed — fetched once (refreshed every 5 min). Best-effort.
    const params = useParams<{ tenantSlug?: string }>()
    const slug = tenant.slug ?? params?.tenantSlug ?? null
    const [menuFeed, setMenuFeed] = useState<DisplayMenuFeed | null>(null)
    useEffect(() => {
        if (!slug) return
        let cancelled = false
        const load = async () => {
            try {
                const r = await fetch(`/api/public/display/menu/${slug}`, { cache: "no-store" })
                if (!r.ok) return
                const d = await r.json() as DisplayMenuFeed
                if (!cancelled) setMenuFeed(d)
            } catch { /* best-effort */ }
        }
        load()
        const iv = window.setInterval(load, 5 * 60_000)
        return () => { cancelled = true; window.clearInterval(iv) }
    }, [slug])
    const suggestions = useMemo<Suggestion[]>(
        () => computeSuggestions(menuFeed, session),
        [menuFeed, session],
    )

    // PAID → a full-screen confirmation.
    if (session?.status === "PAID") {
        return (
            <div className={cn(inter.className, "customer-display min-h-screen flex flex-col bg-background")}>
                <PaidScreen session={session} />
            </div>
        )
    }

    const phase: DisplayPhase = !session
        ? "idle"
        : session.status === "BUILDING_CART"
            ? "building"
            : "awaiting"

    return (
        <div className={cn(inter.className, "customer-display min-h-screen flex flex-col md:flex-row bg-background")}>
            <BrandRail
                tenant={tenant}
                branchName={branchName}
                stafferName={stafferName ?? null}
                phase={phase}
            />
            <div className="relative flex-1 flex flex-col min-h-0">
                <div className="absolute top-4 right-5 z-20">
                    <LiveDot lastSyncAt={lastSyncAt} />
                </div>
                {phase === "idle" ? (
                    <IdleStage />
                ) : (
                    <CheckoutStage session={session!} suggestions={suggestions} />
                )}
            </div>
        </div>
    )
}

/* ────────────────────────────────────────────────────────────────────────
 *  Brand rail — a vivid, living restaurant-branding panel
 * ──────────────────────────────────────────────────────────────────────── */
function BrandRail({
    tenant, branchName, stafferName, phase,
}: {
    tenant: DisplayTenant
    branchName: string | null
    stafferName: string | null
    phase: DisplayPhase
}) {
    const subline = useRotatingPhrase(RAIL_LINES[phase], 12_000)
    const context = stafferName
        ? `${stafferName}'s counter${branchName ? ` · ${branchName}` : ""}`
        : branchName ?? "Customer counter"

    return (
        <aside className="relative shrink-0 overflow-hidden flex flex-col justify-between px-8 py-10 md:py-12 md:w-[30%] md:max-w-[400px] border-b md:border-b-0 md:border-r border-border">
            {/* Vivid base wash */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#7c3aed] via-[#c026d3] to-[#0891b2]" />
            {/* Drifting colour blobs — slow, organic, never still */}
            <motion.div
                aria-hidden
                className="absolute -top-20 -left-12 h-60 w-60 rounded-full bg-cyan-300/45 blur-3xl"
                animate={{ x: [0, 34, 0], y: [0, 26, 0] }}
                transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
                aria-hidden
                className="absolute top-1/3 -right-14 h-56 w-56 rounded-full bg-fuchsia-400/45 blur-3xl"
                animate={{ x: [0, -28, 0], y: [0, 32, 0] }}
                transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
                aria-hidden
                className="absolute -bottom-20 left-1/4 h-60 w-60 rounded-full bg-amber-300/40 blur-3xl"
                animate={{ x: [0, 26, 0], y: [0, -22, 0] }}
                transition={{ duration: 21, repeat: Infinity, ease: "easeInOut" }}
            />
            {/* Depth sheen */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-white/10" />

            <div className="relative z-10">
                {tenant.logo_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                        src={tenant.logo_url}
                        alt={tenant.name}
                        className="h-16 w-16 rounded-2xl object-cover border border-white/30 shadow-lg"
                    />
                ) : (
                    // No restaurant logo on file — show the tenant's
                    // initial instead of a generic ShoppingBag icon so
                    // the customer screen never reads as RestoPOS branding.
                    <span className="grid place-items-center h-16 w-16 rounded-2xl bg-white/15 text-white ring-1 ring-white/30 backdrop-blur-sm text-2xl font-bold">
                        {tenant.name.slice(0, 1).toUpperCase()}
                    </span>
                )}
            </div>

            <div className="relative z-10 py-8">
                <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-white drop-shadow-sm">
                    {tenant.name}
                </h1>
                <AnimatePresence mode="wait">
                    <motion.p
                        key={subline}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.4 }}
                        className="mt-2 text-sm md:text-base text-white/85"
                    >
                        {subline}
                    </motion.p>
                </AnimatePresence>
            </div>

            <div className="relative z-10 text-[11px] uppercase tracking-[0.14em] text-white/70">
                {context}
            </div>
        </aside>
    )
}

/** Small "screen is connected" indicator. */
function LiveDot({ lastSyncAt }: { lastSyncAt: number }) {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const t = window.setInterval(() => setNow(Date.now()), 2000)
        return () => window.clearInterval(t)
    }, [])
    const stale = lastSyncAt === 0 || now - lastSyncAt > 10_000
    return (
        <div className={cn(
            "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
            stale
                ? "border-border bg-card text-muted-foreground"
                : "border-success/30 bg-success/10 text-success",
        )}>
            <span className={cn("h-1.5 w-1.5 rounded-full", stale ? "bg-muted-foreground" : "bg-success")} />
            {stale ? "Reconnecting" : "Live"}
        </div>
    )
}

/* ────────────────────────────────────────────────────────────────────────
 *  Idle
 * ──────────────────────────────────────────────────────────────────────── */
function IdleStage() {
    return (
        <main className="flex-1 grid place-items-center px-10 py-16 text-center">
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="max-w-sm"
            >
                <div className="grid place-items-center h-20 w-20 mx-auto rounded-2xl bg-card border border-border">
                    <ShoppingBag className="h-9 w-9 text-muted-foreground" />
                </div>
                <h2 className="mt-8 text-xl md:text-2xl font-semibold tracking-tight">
                    Your order will appear here
                </h2>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    As the cashier rings up each item, you&apos;ll see it here with the running total.
                </p>
            </motion.div>
        </main>
    )
}

/* ────────────────────────────────────────────────────────────────────────
 *  Checkout — order + side panel
 * ──────────────────────────────────────────────────────────────────────── */
function CheckoutStage({
    session, suggestions,
}: {
    session: PosDisplaySession
    suggestions: Suggestion[]
}) {
    const processing = session.status === "PROCESSING"
    const building = session.status === "BUILDING_CART"

    // Celebrate when the cashier rings up an item the customer was just
    // being shown as a recommendation — turns a quiet upsell into a
    // little "good pick!" moment on the customer's screen.
    const [win, setWin] = useState<RecommendationWin | null>(null)
    const prevCartIds = useRef<Set<string>>(new Set())
    const prevSuggIds = useRef<Set<string>>(new Set())
    const winSeq = useRef(0)
    useEffect(() => {
        const cart = (session.cart_payload ?? []) as Array<{
            menu_item_id?: string | null; name?: string; image_url?: string | null
        }>
        const cartIds = new Set(
            cart.map((l) => l.menu_item_id).filter((x): x is string => !!x),
        )
        // A genuinely new menu item (not just a quantity bump) that was on
        // the recommendation list at its last shown state.
        const addedFromRec = [...cartIds].find(
            (id) => !prevCartIds.current.has(id) && prevSuggIds.current.has(id),
        )
        if (addedFromRec) {
            const line = cart.find((l) => l.menu_item_id === addedFromRec)
            winSeq.current += 1
            setWin({
                id: winSeq.current,
                name: line?.name ?? "that",
                image: line?.image_url ?? null,
            })
        }
        prevCartIds.current = cartIds
        prevSuggIds.current = new Set(suggestions.map((s) => s.id))
    }, [session, suggestions])

    return (
        <main className="relative flex-1 grid lg:grid-cols-[1.05fr_0.95fr] gap-5 px-5 py-6 md:px-9 md:py-9 min-h-0">
            <AnimatePresence>
                {win && (
                    <RecommendationWinToast
                        key={win.id}
                        win={win}
                        onDone={() => setWin(null)}
                    />
                )}
            </AnimatePresence>
            <OrderCard session={session} />
            <section className="relative flex flex-col rounded-2xl border border-border bg-card min-h-0">
                {processing ? (
                    <div className="flex-1 grid place-items-center p-8 text-center">
                        <ProcessingBlock />
                    </div>
                ) : building ? (
                    suggestions.length > 0
                        ? <SuggestionsPanel suggestions={suggestions} currency={session.currency} />
                        : <BuildingHintPanel />
                ) : (
                    <div className="flex-1 grid place-items-center p-6 lg:p-8 text-center">
                        {/* The POS owns `checkout_url`; the customer screen
                            just renders whatever it says. Sentinels —
                            `counter:card`   → hand card to staff
                            `counter:upi-pending` → UPI picked, QR minting
                            `counter:upi-error`   → UPI picked but unavailable
                            `https://…`      → Stripe Checkout QR
                            null / empty     → pay cash at the counter
                            anything else    → a scannable UPI / Paytm QR */}
                        {session.checkout_url === "counter:card" ? (
                            <CardSwipePanel session={session} />
                        ) : session.checkout_url === "counter:upi-pending" ? (
                            <UpiPreparingPanel session={session} />
                        ) : session.checkout_url === "counter:upi-error" ? (
                            <UpiUnavailablePanel />
                        ) : session.checkout_url && /^https?:/i.test(session.checkout_url) ? (
                            <StripeCheckoutPanel session={session} />
                        ) : session.checkout_url && !/^counter:/i.test(session.checkout_url) ? (
                            // Any non-sentinel, non-Stripe payload is a
                            // scannable payment QR — a plain `upi:` intent
                            // or a Paytm dynamic QR, whatever its format.
                            <UpiScanPanel session={session} />
                        ) : (
                            <CounterPayPanel session={session} />
                        )}
                    </div>
                )}
            </section>
        </main>
    )
}

/** The live order — item list + totals. */
function OrderCard({ session }: { session: PosDisplaySession }) {
    const money = (v: number) => formatCurrency(v, session.currency)
    const itemCount = session.cart_payload.reduce((s, l) => s + (Number(l.quantity) || 0), 0)
    const discount = Number(session.discount_total) || 0

    return (
        <section className="flex flex-col flex-1 rounded-2xl border border-border bg-card overflow-hidden min-h-0">
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
                <div className="min-w-0">
                    <h2 className="text-lg font-semibold leading-tight">Your order</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {itemCount} item{itemCount === 1 ? "" : "s"}
                        {session.table_no ? ` · Table ${session.table_no}` : ""}
                    </p>
                </div>
                {(session.customer_name || session.customer_phone) && (
                    <div className="ml-auto flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 max-w-[55%]">
                        <User className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0 leading-tight text-left">
                            <div className="text-sm font-medium truncate">{session.customer_name || "Guest"}</div>
                            {session.customer_phone && (
                                <div className="text-[11px] text-muted-foreground truncate">{session.customer_phone}</div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Item list */}
            <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
                {session.cart_payload.length === 0 ? (
                    <div className="grid place-items-center py-16 text-center">
                        <UtensilsCrossed className="h-9 w-9 text-muted-foreground/40" />
                        <p className="mt-3 text-sm text-muted-foreground">Your items will appear here</p>
                    </div>
                ) : (
                    <ul className="divide-y divide-border">
                        <AnimatePresence initial={false}>
                            {session.cart_payload.map((line, idx) => {
                                const qty = Number(line.quantity) || 0
                                const lineTotal = (Number(line.unit_price) || 0) * qty
                                return (
                                    <motion.li
                                        key={`${line.name}-${idx}`}
                                        layout
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                                        className="flex items-center gap-3.5 py-3"
                                    >
                                        <ItemTile name={line.name} imageUrl={line.image_url ?? null} />
                                        <span className="grid place-items-center h-6 min-w-6 px-1.5 rounded-md bg-primary/15 text-primary text-xs font-semibold tabular-nums shrink-0">
                                            {qty}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[15px] font-medium leading-tight truncate">{line.name}</div>
                                            <div className="text-xs text-muted-foreground mt-0.5">
                                                {money(Number(line.unit_price) || 0)} each
                                            </div>
                                            {line.notes && (
                                                <div className="text-[11px] text-muted-foreground/80 italic mt-0.5">{line.notes}</div>
                                            )}
                                        </div>
                                        <div className="text-base font-semibold tabular-nums shrink-0">
                                            {money(lineTotal)}
                                        </div>
                                    </motion.li>
                                )
                            })}
                        </AnimatePresence>
                    </ul>
                )}
            </div>

            {/* Totals */}
            <div className="px-6 py-4 border-t border-border space-y-1.5">
                <Row label="Subtotal" value={money(session.subtotal)} />
                {discount > 0 && (
                    <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                            <Tag className="h-3.5 w-3.5" />
                            Discount
                            {session.coupon_code && (
                                <span className="font-mono uppercase text-[11px]">{session.coupon_code}</span>
                            )}
                        </span>
                        <span className="tabular-nums">− {money(discount)}</span>
                    </div>
                )}
                {session.tax_total > 0 && <Row label="Tax" value={money(session.tax_total)} />}
                <div className="flex items-baseline justify-between pt-2.5 mt-1 border-t border-border">
                    <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Total</span>
                    <AnimatedAmount
                        value={session.grand_total}
                        currency={session.currency}
                        className="text-3xl lg:text-4xl font-semibold tabular-nums"
                    />
                </div>
            </div>
        </section>
    )
}

/** A menu-item thumbnail — photo, or a flat fallback tile. */
function ItemTile({ name, imageUrl }: { name: string; imageUrl: string | null }) {
    if (imageUrl) {
        return (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
                src={imageUrl}
                alt={name}
                className="h-14 w-14 rounded-lg object-cover border border-border shrink-0"
            />
        )
    }
    return (
        <div className="h-14 w-14 rounded-lg grid place-items-center bg-background border border-border shrink-0">
            <UtensilsCrossed className="h-5 w-5 text-muted-foreground/50" />
        </div>
    )
}

/**
 * The total — count-up animated (a clean, smooth roll; no glow, no pop).
 */
function AnimatedAmount({
    value, currency, className,
}: {
    value: number
    currency: string
    className?: string
}) {
    const [shown, setShown] = useState(value)
    const prevRef = useRef(value)
    useEffect(() => {
        const from = prevRef.current
        prevRef.current = value
        if (from === value) { setShown(value); return }
        const controls = animate(from, value, {
            duration: 0.5,
            ease: [0.16, 1, 0.3, 1],
            onUpdate: (v) => setShown(v),
        })
        return () => controls.stop()
    }, [value])
    return <span className={className}>{formatCurrency(shown, currency)}</span>
}

function ProcessingBlock() {
    return (
        <div>
            <Loader2 className="h-9 w-9 text-muted-foreground animate-spin mx-auto" />
            <h2 className="mt-5 text-xl font-semibold">Processing payment</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">Generating your invoice…</p>
        </div>
    )
}

/**
 * "You might also like" — the upsell panel. From the curated pairings
 * for what's in the cart, ONE is staged at a time as a 3:4 "treasure"
 * card: a sparkling, glowing centrepiece the guest shouldn't miss. The
 * customer can't tap it, so it's framed as a prompt to ask staff.
 *
 * The card cycles on a calm cadence — each suggestion gets its turn as
 * the centrepiece, with a soft reveal between them.
 */
function SuggestionsPanel({ suggestions, currency }: { suggestions: Suggestion[]; currency: string }) {
    const header = useRotatingPhrase(SUGGEST_HEADERS, 13_000)
    const subline = useRotatingPhrase(SUGGEST_SUBLINES, 15_000)

    // One card on stage at a time; cycle so each suggestion takes a turn.
    const [idx, setIdx] = useState(0)
    useEffect(() => {
        if (suggestions.length < 2) return
        const t = window.setInterval(() => setIdx((n) => n + 1), 5200)
        return () => window.clearInterval(t)
    }, [suggestions.length])

    if (suggestions.length === 0) return null
    const activeIndex = idx % suggestions.length
    const active = suggestions[activeIndex]!

    return (
        <>
            <div className="px-6 py-4 border-b border-border">
                <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white">
                        <Sparkles className="h-3.5 w-3.5" />
                    </span>
                    <AnimatePresence mode="wait">
                        <motion.h2
                            key={header}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.4 }}
                            className="text-base font-semibold"
                        >
                            {header}
                        </motion.h2>
                    </AnimatePresence>
                </div>
                <AnimatePresence mode="wait">
                    <motion.p
                        key={subline}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4 }}
                        className="text-xs text-muted-foreground mt-1 pl-8"
                    >
                        {subline}
                    </motion.p>
                </AnimatePresence>
            </div>
            <div className="relative flex flex-1 flex-col items-center justify-center gap-5 px-6 py-6">
                <div className="flex w-full flex-1 items-center justify-center">
                    <div className="w-[min(272px,78%)]">
                        <AnimatePresence mode="wait">
                            <RecommendationTreasure
                                key={active.id}
                                suggestion={{
                                    id: active.id,
                                    name: active.name,
                                    price: active.price,
                                    image_url: active.image_url,
                                    tag: tagForItem(active.id),
                                }}
                                currency={currency}
                            />
                        </AnimatePresence>
                    </div>
                </div>
                {/* Which-of-N dots — only when there's more than one pick. */}
                {suggestions.length > 1 && (
                    <div className="flex items-center gap-1.5">
                        {suggestions.map((s, i) => (
                            <span
                                key={s.id}
                                className={cn(
                                    "h-1.5 rounded-full transition-all duration-500",
                                    i === activeIndex ? "w-5 bg-amber-400" : "w-1.5 bg-border",
                                )}
                            />
                        ))}
                    </div>
                )}
            </div>
        </>
    )
}

/** Building phase with nothing to suggest yet. */
function BuildingHintPanel() {
    return (
        <div className="flex-1 grid place-items-center p-8 text-center">
            <div className="max-w-xs">
                <div className="grid place-items-center h-16 w-16 mx-auto rounded-2xl bg-background border border-border">
                    <UtensilsCrossed className="h-7 w-7 text-muted-foreground" />
                </div>
                <h2 className="mt-5 text-lg font-semibold">Your order is being rung up</h2>
                <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    The payment details will appear here once the cashier finalises the bill.
                </p>
            </div>
        </div>
    )
}

/**
 * UPI scan-to-pay panel. The POS puts a `upi:` intent on `checkout_url`
 * whenever the cashier picks UPI. `checkout_session_id` set → a Paytm
 * dynamic QR (webhook auto-confirms); null → a plain UPI QR (cashier
 * confirms manually).
 */
/** Pull the payee UPI ID (the `pa` parameter) out of a `upi://pay?…`
 *  string — works for a plain UPI intent and a Paytm dynamic QR alike. */
function upiIdFromIntent(value: string): string | null {
    const m = /[?&]pa=([^&]+)/i.exec(value)
    if (!m || !m[1]) return null
    try { return decodeURIComponent(m[1]) } catch { return m[1] }
}

function UpiScanPanel({ session }: { session: PosDisplaySession }) {
    const [qr, setQr] = useState("")
    const intent = session.checkout_url ?? ""
    const upiId = upiIdFromIntent(intent)
    const isAuto = !!(session as { checkout_session_id?: string | null }).checkout_session_id
    useEffect(() => {
        if (!intent) { setQr(""); return }
        QRCode.toDataURL(intent, {
            margin: 1,
            width: 440,
            errorCorrectionLevel: "H",
            color: { dark: "#0a0e1a", light: "#ffffff" },
        }).then(setQr).catch(() => setQr(""))
    }, [intent])

    return (
        <div className="flex flex-col items-center">
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">
                Scan to pay
            </div>
            <div className="text-2xl font-semibold tabular-nums mb-4">
                {formatCurrency(session.grand_total, session.currency)}
            </div>
            <div className="rounded-2xl bg-white p-3.5 border border-border">
                {qr ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={qr} alt="UPI QR" className="w-[300px] h-[300px]" />
                ) : (
                    <div className="w-[300px] h-[300px] grid place-items-center text-muted-foreground">
                        <Loader2 className="h-7 w-7 animate-spin" />
                    </div>
                )}
            </div>
            {upiId && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2">
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">UPI ID</span>
                    <span className="text-sm font-medium">{upiId}</span>
                </div>
            )}
            <div className="mt-3 text-xs text-muted-foreground">Google Pay · PhonePe · Paytm · BHIM</div>
            <p className="mt-1.5 text-xs text-muted-foreground">
                {isAuto
                    ? "Confirms automatically once you pay"
                    : "After paying, show the confirmation to our staff"}
            </p>
        </div>
    )
}

/**
 * UPI just picked on the POS, the QR still being minted (the
 * `counter:upi-pending` sentinel). Shows the customer the switch happened
 * INSTANTLY — a UPI frame with a spinner — instead of leaving them on the
 * previous panel while the Paytm round-trip completes.
 */
function UpiPreparingPanel({ session }: { session: PosDisplaySession }) {
    return (
        <div className="flex flex-col items-center">
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">
                Scan to pay
            </div>
            <div className="text-2xl font-semibold tabular-nums mb-4">
                {formatCurrency(session.grand_total, session.currency)}
            </div>
            <div className="rounded-2xl bg-white p-3.5 border border-border">
                <div className="grid h-[300px] w-[300px] place-items-center text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin" />
                </div>
            </div>
            <p className="mt-4 text-sm font-medium">Preparing your UPI QR…</p>
            <p className="mt-1 text-xs text-muted-foreground">This takes just a moment.</p>
        </div>
    )
}

/**
 * UPI was picked but no QR could be issued (`counter:upi-error`) — Paytm
 * unreachable, or no payment method configured. A neutral prompt — staff
 * will sort the payment out — rather than a misleading "pay cash".
 */
function UpiUnavailablePanel() {
    return (
        <div className="flex flex-col items-center">
            <div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-border bg-background">
                <Wallet className="h-7 w-7 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold">One moment, please</h2>
            <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
                Our staff will help you complete the payment.
            </p>
        </div>
    )
}

/** International payment — a Stripe Checkout URL rendered as a QR. */
function StripeCheckoutPanel({ session }: { session: PosDisplaySession }) {
    const [qr, setQr] = useState("")
    useEffect(() => {
        if (!session.checkout_url) { setQr(""); return }
        QRCode.toDataURL(session.checkout_url, {
            margin: 1,
            width: 440,
            errorCorrectionLevel: "H",
            color: { dark: "#0a0e1a", light: "#ffffff" },
        }).then(setQr).catch(() => setQr(""))
    }, [session.checkout_url])

    if (!session.checkout_url) {
        return (
            <div>
                <CreditCard className="h-12 w-12 text-muted-foreground mx-auto" />
                <h2 className="mt-4 text-xl font-semibold">Pay at the counter</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">The cashier will take your payment.</p>
            </div>
        )
    }

    return (
        <div className="flex flex-col items-center">
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">
                Scan to pay
            </div>
            <div className="text-2xl font-semibold tabular-nums mb-4">
                {formatCurrency(session.grand_total, session.currency)}
            </div>
            <div className="rounded-2xl bg-white p-3.5 border border-border">
                {qr ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={qr} alt="Stripe Checkout QR" className="w-[300px] h-[300px]" />
                ) : (
                    <div className="w-[300px] h-[300px] grid place-items-center text-muted-foreground">
                        <Loader2 className="h-7 w-7 animate-spin" />
                    </div>
                )}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Apple Pay · Google Pay · Card · Link</p>
        </div>
    )
}

/**
 * Shown during AWAITING_PAYMENT when the cashier picked Cash or Card —
 * no QR, just the amount and a pointer to the counter.
 */
function CounterPayPanel({ session }: { session: PosDisplaySession }) {
    return (
        <div className="flex flex-col items-center">
            <div className="grid place-items-center h-16 w-16 rounded-2xl bg-background border border-border mb-5">
                <Wallet className="h-7 w-7 text-muted-foreground" />
            </div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                Amount due
            </div>
            <div className="text-3xl font-semibold tabular-nums mt-1 mb-3">
                {formatCurrency(session.grand_total, session.currency)}
            </div>
            <p className="text-sm text-muted-foreground max-w-xs">
                Please pay with cash at the counter — we&apos;ll take it from here.
            </p>
        </div>
    )
}

/**
 * Card selected on the POS — no QR. A clear, friendly prompt for the
 * customer to hand their card to the staff for the swipe.
 */
function CardSwipePanel({ session }: { session: PosDisplaySession }) {
    return (
        <div className="flex flex-col items-center">
            <div className="grid place-items-center h-16 w-16 rounded-2xl bg-primary/10 border border-primary/30 mb-5">
                <CreditCard className="h-7 w-7 text-primary" />
            </div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                Amount due
            </div>
            <div className="text-3xl font-semibold tabular-nums mt-1 mb-3">
                {formatCurrency(session.grand_total, session.currency)}
            </div>
            <p className="text-sm text-muted-foreground max-w-xs">
                Please hand your card to our staff to swipe — we&apos;ll take care of the rest.
            </p>
        </div>
    )
}

/* ────────────────────────────────────────────────────────────────────────
 *  Paid — a clean confirmation
 * ──────────────────────────────────────────────────────────────────────── */
function PaidScreen({ session }: { session: PosDisplaySession }) {
    const customerLabel = session.customer_name?.trim()
    return (
        <main className="flex-1 grid place-items-center px-8 py-16 text-center">
            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
                <motion.div
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.45, ease: [0.34, 1.4, 0.64, 1] }}
                    className="grid place-items-center h-24 w-24 mx-auto rounded-full bg-success/15"
                >
                    <CheckCircle2 className="h-12 w-12 text-success" strokeWidth={2} />
                </motion.div>
                <h1 className="mt-8 text-3xl md:text-4xl font-semibold tracking-tight">
                    Thank you{customerLabel ? `, ${customerLabel}` : ""}
                </h1>
                <p className="mt-2 text-muted-foreground">Payment received</p>
                <p className="mt-6 text-2xl font-semibold tabular-nums">
                    {formatCurrency(session.grand_total, session.currency)}
                </p>
                {session.invoice_number && (
                    <p className="mt-3 text-xs text-muted-foreground font-mono">
                        Invoice {session.invoice_number}
                    </p>
                )}
            </motion.div>
        </main>
    )
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="tabular-nums">{value}</span>
        </div>
    )
}
