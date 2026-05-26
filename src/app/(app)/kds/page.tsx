"use client"

/**
 * Kitchen Display Screen — KOT view.
 *
 * Each card is one KOT (the batch a waiter sent with "Send KOT" on the POS).
 * A table with multiple courses has multiple cards — one for starters, one
 * for mains, one for desserts — and the kitchen works each card through its
 * own PENDING → PREPARING → READY → SERVED flow. Status transitions go
 * through the `update_kot_status` RPC so the state machine + audit trail
 * stay in one place (see migration 06_staff_scope_and_kots.sql, `kots`
 * table).
 *
 * Backward compat: the previous order-based KDS that put `kds_status` on
 * order_items rows is gone. Tenants who never used the KOT flow (instant-
 * bill QSR / takeaway) will see an empty kitchen screen — those orders go
 * straight from cart to bill without queuing in the kitchen, which is the
 * correct behaviour.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
    Ban, Bell, BellOff, CheckCircle2, ChefHat, Clock, Eraser, Flame, Hand, Soup, Utensils, XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageTour } from "@/components/tours/page-tour"
import { TourReplayButton } from "@/components/tours/tour-replay-button"
import { createClient } from "@/lib/supabase/client"
import { useActiveBranch } from "@/lib/branch/active-branch"
import { uniqueChannelName } from "@/lib/supabase/realtime"
import {
    canTransition, nextStatuses, STATUS_LABEL, type KotStatus,
} from "@/lib/kot/state-machine"
import { cn } from "@/lib/utils"

interface KotItem {
    id: string
    item_name: string
    quantity: number | string
    notes: string | null
    is_void: boolean
    /** NULL while a voided line still shows as struck-through on the
     *  kitchen card waiting for the chef to tap Clear. Non-null once
     *  acknowledged — the line then drops off the card. See migration
     *  52 + the `clear_voided_item` RPC. Always NULL for non-voided
     *  items. */
    void_cleared_at: string | null
    /** Embedded from menu_items so the kitchen card can render a small
     *  thumbnail next to each line. PostgREST returns the embed as an
     *  array even for a single FK match — we unwrap in the renderer. */
    menu_item: { image_url: string | null } | { image_url: string | null }[] | null
}
interface KotRow {
    id: string
    kot_number: number
    seq_in_order: number
    status: KotStatus
    note: string | null
    sent_at: string
    /** PostgREST returns 1-to-many as an array even when there's only one. */
    order: { order_number: string; order_type: string; table: { number: string } | { number: string }[] | null }
        | { order_number: string; order_type: string; table: { number: string } | { number: string }[] | null }[]
        | null
    waiter: { full_name: string | null; email: string | null }
        | { full_name: string | null; email: string | null }[]
        | null
    order_items: KotItem[]
}

type Tab = KotStatus | "ALL"

function first<T>(v: T | T[] | null | undefined): T | null {
    if (v == null) return null
    return Array.isArray(v) ? (v[0] ?? null) : v
}

/** Chime — two-tone "ding" generated on the fly via Web Audio API so we
 *  don't need to ship an audio file (and the kitchen always gets the same
 *  sound regardless of system bell). Browsers block AudioContext on
 *  page load until the user has interacted — we lazily create it on the
 *  first user gesture (see `useEffect` below), so the first ding might
 *  be silent on a freshly-loaded screen but every one after lands. */
function makeChime(ctx: AudioContext) {
    const now = ctx.currentTime
    const play = (freq: number, start: number, dur: number, gain: number) => {
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = "sine"
        osc.frequency.value = freq
        g.gain.setValueAtTime(0, now + start)
        g.gain.linearRampToValueAtTime(gain, now + start + 0.03)
        g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur)
        osc.connect(g).connect(ctx.destination)
        osc.start(now + start)
        osc.stop(now + start + dur + 0.05)
    }
    // Two cheerful notes — a small rising interval.
    play(880, 0,    0.18, 0.18) // A5
    play(1175, 0.13, 0.22, 0.20) // D6
}

/** Distinct "uh-oh" tone for when the cashier voids a line on an
 *  already-printed KOT — descending interval, lower in the register so
 *  the chef can tell it apart from a fresh-ticket chime without looking
 *  up. */
function makeCancelChime(ctx: AudioContext) {
    const now = ctx.currentTime
    const play = (freq: number, start: number, dur: number, gain: number) => {
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = "triangle"
        osc.frequency.value = freq
        g.gain.setValueAtTime(0, now + start)
        g.gain.linearRampToValueAtTime(gain, now + start + 0.03)
        g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur)
        osc.connect(g).connect(ctx.destination)
        osc.start(now + start)
        osc.stop(now + start + dur + 0.05)
    }
    // Descending fourth — A4 → E4 — clearly "negative" vs the rising chime.
    play(440, 0,    0.22, 0.20)
    play(330, 0.18, 0.30, 0.22)
}

const KDS_SOUND_PREF_KEY = "restopos:kds-sound-enabled"

export default function KdsPage() {
    const supabase = createClient()
    const [kots, setKots] = useState<KotRow[]>([])
    const [filter, setFilter] = useState<Tab>("PENDING")
    const [busyId, setBusyId] = useState<string | null>(null)
    /** Kitchen sees only their branch's KOTs — filtered via the embedded
     *  order's branch_id. !inner makes it an INNER JOIN so the filter
     *  applies; without !inner Supabase would return all kots and the
     *  filter would silently no-op. */
    const { activeBranchId } = useActiveBranch()

    // ── Kitchen chime ────────────────────────────────────────────────
    /** Persisted on/off toggle so the kitchen lead can mute it after
     *  hours without losing the choice on refresh. */
    const [soundEnabled, setSoundEnabled] = useState<boolean>(true)
    /** AudioContext is constructed only after the user clicks anywhere
     *  on the page — browsers block AudioContext at page-load until a
     *  user gesture. Without this the first ding throws and no later
     *  one plays. */
    const audioCtxRef = useRef<AudioContext | null>(null)
    /** Set of KOT ids the screen has rendered so far. A new id arriving
     *  via realtime or polling means the kitchen just got a fresh
     *  ticket — that's when we ding. Initialised AFTER the first
     *  fetch so the existing tickets on screen don't all ding on
     *  page load. */
    const seenKotIdsRef = useRef<Set<string> | null>(null)
    /** Set of order_item ids that the screen has already seen as
     *  "voided-but-not-cleared". A new id appearing in this set means
     *  the cashier just struck a line off an existing KOT — play the
     *  cancel chime so the chef looks up. Seeded after the first fetch
     *  the same way as `seenKotIdsRef`. */
    const seenVoidedItemsRef = useRef<Set<string> | null>(null)

    // Read persisted sound preference once on mount.
    useEffect(() => {
        if (typeof window === "undefined") return
        const stored = window.localStorage.getItem(KDS_SOUND_PREF_KEY)
        if (stored === "0") setSoundEnabled(false)
    }, [])
    // Unlock the AudioContext on the first user gesture anywhere on
    // the page — clicking a status button, scrolling, anything counts.
    useEffect(() => {
        if (typeof window === "undefined") return
        const unlock = () => {
            if (audioCtxRef.current) return
            try {
                const Ctor = (window.AudioContext
                    || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
                if (Ctor) audioCtxRef.current = new Ctor()
            } catch { /* AudioContext unavailable — sound just stays silent. */ }
        }
        // pointerdown fires for both mouse + touch, doesn't need bubble.
        window.addEventListener("pointerdown", unlock, { once: true, passive: true })
        window.addEventListener("keydown", unlock, { once: true })
        return () => {
            window.removeEventListener("pointerdown", unlock)
            window.removeEventListener("keydown", unlock)
        }
    }, [])

    const playChime = useCallback(() => {
        if (!soundEnabled) return
        const ctx = audioCtxRef.current
        if (!ctx) return
        try {
            // Some browsers suspend the context when the tab is
            // backgrounded — resume() is a no-op if already running.
            if (ctx.state === "suspended") void ctx.resume()
            makeChime(ctx)
        } catch { /* silent failure — the screen update is the real signal */ }
    }, [soundEnabled])

    const playCancelChime = useCallback(() => {
        if (!soundEnabled) return
        const ctx = audioCtxRef.current
        if (!ctx) return
        try {
            if (ctx.state === "suspended") void ctx.resume()
            makeCancelChime(ctx)
        } catch { /* see playChime */ }
    }, [soundEnabled])

    function toggleSound() {
        setSoundEnabled((v) => {
            const next = !v
            if (typeof window !== "undefined") {
                window.localStorage.setItem(KDS_SOUND_PREF_KEY, next ? "1" : "0")
            }
            // Test-fire so the kitchen lead hears the ding the moment
            // they re-enable it (assuming the audio context is unlocked).
            if (next && audioCtxRef.current) makeChime(audioCtxRef.current)
            return next
        })
    }

    // useCallback so the same function identity feeds the realtime handler
    // AND the polling interval below.
    const fetchKots = useCallback(async () => {
        // Only the live statuses — once a KOT is SERVED / CANCELLED it
        // drops off the kitchen screen.
        let q = supabase
            .from("kots")
            .select(`
                id, kot_number, seq_in_order, status, note, sent_at,
                order:orders!inner(order_number, order_type, branch_id, table:dining_tables(number)),
                waiter:users!kots_created_by_fkey(full_name, email),
                order_items(id, item_name, quantity, notes, is_void, void_cleared_at, menu_item:menu_items(image_url))
            `)
            .in("status", ["PENDING", "PREPARING", "READY"])
            .order("sent_at", { ascending: true })
        if (activeBranchId !== null) {
            q = q.eq("order.branch_id", activeBranchId)
        }
        const { data, error } = await q
        if (error) { toast.error(error.message); return }
        const rows = (data ?? []) as unknown as KotRow[]
        // Ding when a NEW KOT id appears on the screen. On the very
        // first fetch we just seed the set so the existing tickets
        // already on display don't all chime at once.
        const ids = new Set(rows.map((r) => r.id))
        if (seenKotIdsRef.current === null) {
            seenKotIdsRef.current = ids
        } else {
            let hasNew = false
            for (const id of ids) {
                if (!seenKotIdsRef.current.has(id)) { hasNew = true; break }
            }
            seenKotIdsRef.current = ids
            if (hasNew) playChime()
        }
        // Separate "uh-oh" chime when a line on an existing KOT just
        // got voided. Detect by tracking the set of order_item ids
        // that are currently in the "voided, not yet cleared" state.
        // A fresh id in that set since the last fetch = the cashier
        // pulled a line off the kitchen's plate.
        const voidedIds = new Set<string>()
        for (const r of rows) {
            for (const it of r.order_items) {
                if (it.is_void && it.void_cleared_at === null) voidedIds.add(it.id)
            }
        }
        if (seenVoidedItemsRef.current === null) {
            seenVoidedItemsRef.current = voidedIds
        } else {
            let hasNewVoid = false
            for (const id of voidedIds) {
                if (!seenVoidedItemsRef.current.has(id)) { hasNewVoid = true; break }
            }
            seenVoidedItemsRef.current = voidedIds
            if (hasNewVoid) playCancelChime()
        }
        setKots(rows)
    }, [supabase, activeBranchId, playChime, playCancelChime])

    useEffect(() => {
        fetchKots()

        // TWO sync mechanisms run together (same pattern as the customer
        // display):
        //   • Realtime postgres_changes — instant pushes when they arrive.
        //   • A 5-second polling fallback — guarantees the kitchen screen
        //     converges even when realtime is unavailable (the table not
        //     being in supabase_realtime publication, a dropped websocket,
        //     a connection upgrade, etc.). 5 seconds is fast enough for a
        //     kitchen yet light on DB traffic; both paths call the same
        //     fetchKots so they're trivially idempotent.
        const channel = supabase
            .channel(uniqueChannelName("kds-kots"))
            .on("postgres_changes", { event: "*", schema: "public", table: "kots" }, fetchKots)
            .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, fetchKots)
            .subscribe()
        const poll = window.setInterval(fetchKots, 5_000)

        return () => {
            window.clearInterval(poll)
            supabase.removeChannel(channel)
        }
    }, [supabase, fetchKots])

    async function moveTo(kot: KotRow, next: KotStatus) {
        if (!canTransition(kot.status, next)) return
        setBusyId(kot.id)
        const { error } = await supabase.rpc("update_kot_status" as never, {
            p_kot_id: kot.id,
            p_status: next,
        } as never)
        setBusyId(null)
        if (error) return toast.error(error.message)
        // Realtime will refetch; toast for immediate feedback.
        toast.success(`KOT #${kot.kot_number} → ${STATUS_LABEL[next]}`)
    }

    async function cancel(kot: KotRow) {
        const reason = window.prompt(`Cancel KOT #${kot.kot_number}? Reason:`)
        if (!reason || reason.trim().length < 3) return
        setBusyId(kot.id)
        const { error } = await supabase.rpc("cancel_kot" as never, {
            p_kot_id: kot.id,
            p_reason: reason.trim(),
        } as never)
        setBusyId(null)
        if (error) return toast.error(error.message)
        toast.success(`KOT #${kot.kot_number} cancelled`)
    }

    /** Chef-side ack of a voided line. Drops it off the card. The RPC
     *  is idempotent + scoped — see migration 52. */
    async function clearVoid(item: KotItem) {
        const { error } = await supabase.rpc("clear_voided_item" as never, {
            p_item_id: item.id,
        } as never)
        if (error) return toast.error(error.message)
        // Optimistic — realtime will refetch and confirm.
        setKots((prev) => prev.map((k) => ({
            ...k,
            order_items: k.order_items.map((it) =>
                it.id === item.id ? { ...it, void_cleared_at: new Date().toISOString() } : it,
            ),
        })))
    }

    const visible = useMemo(
        () => (filter === "ALL" ? kots : kots.filter((k) => k.status === filter)),
        [kots, filter],
    )

    const counts = useMemo(() => {
        const c: Record<Tab, number> = { PENDING: 0, PREPARING: 0, READY: 0, SERVED: 0, CANCELLED: 0, ALL: kots.length }
        for (const k of kots) c[k.status] = (c[k.status] ?? 0) + 1
        return c
    }, [kots])

    return (
        <div className="container mx-auto py-6 max-w-[1600px] space-y-4">
            <PageTour tourKey="kds" />
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                    <ChefHat className="h-7 w-7 text-primary" />
                    <h1 className="text-3xl font-bold tracking-tight">Kitchen Display</h1>
                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 ml-1"
                        onClick={toggleSound}
                        title={soundEnabled ? "Mute new-order chime" : "Unmute new-order chime"}
                        aria-label={soundEnabled ? "Mute chime" : "Unmute chime"}
                        data-tour="kds-sound"
                    >
                        {soundEnabled ? <Bell className="h-4 w-4 text-primary" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                    <TourReplayButton tourKey="kds" />
                </div>
                <Tabs value={filter} onValueChange={(v) => setFilter(v as Tab)}>
                    <TabsList data-tour="kds-tabs">
                        <TabsTrigger value="PENDING">Pending {counts.PENDING > 0 && <Badge variant="warning" className="ml-1.5 text-[10px]">{counts.PENDING}</Badge>}</TabsTrigger>
                        <TabsTrigger value="PREPARING">Preparing {counts.PREPARING > 0 && <Badge variant="warning" className="ml-1.5 text-[10px]">{counts.PREPARING}</Badge>}</TabsTrigger>
                        <TabsTrigger value="READY">Ready {counts.READY > 0 && <Badge variant="success" className="ml-1.5 text-[10px]">{counts.READY}</Badge>}</TabsTrigger>
                        <TabsTrigger value="ALL">All {counts.ALL > 0 && <Badge variant="outline" className="ml-1.5 text-[10px]">{counts.ALL}</Badge>}</TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {visible.length === 0 ? (
                <Card><CardContent className="text-center py-20 text-muted-foreground">
                    <Utensils className="h-10 w-10 mx-auto mb-3 opacity-50" />
                    All caught up. No {filter === "ALL" ? "live" : filter.toLowerCase()} KOTs.
                </CardContent></Card>
            ) : (
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {visible.map((k) => <KotCard key={k.id} kot={k} busy={busyId === k.id} onMove={moveTo} onCancel={cancel} onClearVoid={clearVoid} />)}
                </div>
            )}
        </div>
    )
}

function KotCard({
    kot, busy, onMove, onCancel, onClearVoid,
}: {
    kot: KotRow
    busy: boolean
    onMove: (k: KotRow, next: KotStatus) => void
    onCancel: (k: KotRow) => void
    onClearVoid: (item: KotItem) => void
}) {
    const order = first(kot.order)
    const table = order ? first(order.table) : null
    const waiter = first(kot.waiter)
    // Keep live items AND voided-but-not-yet-acknowledged items so the
    // chef sees the strike-through before tapping Clear. Voided lines
    // that the chef has already acknowledged (void_cleared_at non-null)
    // drop off the card.
    const items = kot.order_items.filter((it) => !it.is_void || it.void_cleared_at === null)
    const ageMin = Math.floor((Date.now() - new Date(kot.sent_at).getTime()) / 60_000)
    const urgency = ageMin > 10 ? "red" : ageMin > 5 ? "amber" : "green"

    const nexts = nextStatuses(kot.status)

    return (
        <Card
            className={cn(
                "border-2 transition-all",
                urgency === "red"   && "border-destructive/60 animate-pulse-glow",
                urgency === "amber" && "border-warning/60",
                urgency === "green" && "border-success/40",
                kot.status === "READY" && "bg-success/5",
                kot.status === "PREPARING" && "bg-warning/5",
            )}
        >
            <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <div className="font-bold font-mono">
                            KOT #{kot.kot_number}
                            <span className="text-[10px] text-muted-foreground ml-1">batch {kot.seq_in_order}</span>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                            {table?.number
                                ? <span className="flex items-center gap-1"><Hand className="h-3 w-3" /> Table {table.number}</span>
                                : order?.order_type
                                ? <span>{order.order_type}</span>
                                : null}
                            {order?.order_number && <span className="font-mono opacity-70">· {order.order_number}</span>}
                        </div>
                        {waiter && (
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                                by {waiter.full_name ?? waiter.email ?? "—"}
                            </div>
                        )}
                    </div>
                    <Badge variant={urgency === "red" ? "destructive" : urgency === "amber" ? "warning" : "success"}>
                        <Clock className="h-3 w-3 mr-1" /> {ageMin}m
                    </Badge>
                </div>

                {kot.note && (
                    <div className="text-xs rounded-md bg-amber-500/10 border border-amber-500/30 px-2 py-1 text-amber-200">
                        ⚠ {kot.note}
                    </div>
                )}

                <ul className="space-y-1.5">
                    {items.map((it) => {
                        // PostgREST returns the embed as either a single
                        // object or an array depending on the relationship
                        // cardinality the planner picks; we accept both.
                        const mi = Array.isArray(it.menu_item) ? it.menu_item[0] : it.menu_item
                        const img = mi?.image_url ?? null
                        const voided = it.is_void && it.void_cleared_at === null
                        return (
                            <li
                                key={it.id}
                                className={cn(
                                    "rounded-md p-2 text-sm border flex items-center gap-2.5",
                                    voided
                                        ? "border-destructive/60 bg-destructive/10"
                                        : "border-border/60",
                                )}
                            >
                                {img ? (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img
                                        src={img}
                                        alt=""
                                        className={cn(
                                            "h-10 w-10 rounded-md object-cover border shrink-0",
                                            voided ? "border-destructive/40 opacity-60 grayscale" : "border-border/40",
                                        )}
                                    />
                                ) : (
                                    <div className={cn(
                                        "h-10 w-10 rounded-md grid place-items-center shrink-0 border",
                                        voided ? "bg-destructive/10 border-destructive/30" : "bg-muted/40 border-border/30",
                                    )}>
                                        <Utensils className={cn("h-4 w-4", voided ? "text-destructive/70" : "text-muted-foreground")} />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className={cn("font-medium flex items-center gap-1.5 flex-wrap", voided && "line-through text-destructive")}>
                                        <span className={cn("mr-1", voided ? "text-destructive" : "text-primary")}>×{Number(it.quantity)}</span>
                                        <span>{it.item_name}</span>
                                        {voided && (
                                            <Badge variant="destructive" className="text-[10px] no-underline">
                                                <XCircle className="h-3 w-3 mr-0.5" /> Cancelled
                                            </Badge>
                                        )}
                                    </div>
                                    {it.notes && (
                                        <div className={cn("text-xs mt-0.5", voided ? "text-destructive/70 line-through" : "text-amber-400")}>
                                            ⤷ {it.notes}
                                        </div>
                                    )}
                                </div>
                                {voided && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="shrink-0 border-destructive/50 text-destructive hover:bg-destructive/10"
                                        onClick={() => onClearVoid(it)}
                                        title="Acknowledge — remove from this card"
                                    >
                                        <Eraser className="h-3.5 w-3.5" /> Clear
                                    </Button>
                                )}
                            </li>
                        )
                    })}
                </ul>

                <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/40">
                    {kot.status === "PENDING" && nexts.includes("PREPARING") && (
                        <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={() => onMove(kot, "PREPARING")}>
                            <Flame className="h-3.5 w-3.5" /> Start
                        </Button>
                    )}
                    {kot.status === "PREPARING" && nexts.includes("READY") && (
                        <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={() => onMove(kot, "READY")}>
                            <Soup className="h-3.5 w-3.5" /> Ready
                        </Button>
                    )}
                    {kot.status === "READY" && nexts.includes("SERVED") && (
                        <Button size="sm" variant="neon" className="flex-1" disabled={busy} onClick={() => onMove(kot, "SERVED")}>
                            <CheckCircle2 className="h-3.5 w-3.5" /> Served
                        </Button>
                    )}
                    {(kot.status === "PENDING" || kot.status === "PREPARING") && (
                        <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" disabled={busy} onClick={() => onCancel(kot)}>
                            <Ban className="h-3.5 w-3.5" /> Cancel
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
