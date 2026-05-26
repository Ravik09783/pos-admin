"use client"

/**
 * Tiny status banner that lives in the topbar. Shows the user:
 *   - whether the network is up
 *   - how many bills are queued waiting to sync
 *   - a one-click "sync now" when there's something to push
 *   - a dead-letter count when bills fail to sync after many retries
 *
 * It also owns the side effects that make offline-mode actually work:
 *   - keeps the invoice-reservation buffer topped up while online
 *   - drains the pending-bills queue on every online event and on mount
 *   - polls `/api/health` so it catches captive-portal Wi-Fi (where
 *     `navigator.onLine === true` but no real internet)
 *
 * Why a real health probe matters: `navigator.onLine` answers "do I have a
 * link layer connection?" — it lies on hotel/airport Wi-Fi, mobile data
 * with the carrier blocking traffic, ISP DNS hijacks, etc. By round-
 * tripping our own origin every 30s we know whether bills can actually
 * leave the building.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { AlertTriangle, CloudOff, RefreshCw, Wifi } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { dedupedFetch } from "@/lib/fetch/deduped"
import { refillIfLow } from "@/lib/offline/reservation-buffer"
import { deadLetterCount, listPending, pendingCount } from "@/lib/offline/pending-bills"
import { readLastSync, syncPendingBills, writeLastSync } from "@/lib/offline/sync"
import { cn } from "@/lib/utils"

const HEALTH_CHECK_INTERVAL_MS = 30_000
const HEALTH_CHECK_TIMEOUT_MS = 5_000

/** True if our origin responds OK within the timeout. Bypasses caches; respects
 *  navigator's "definitely offline" signal so we don't waste a fetch when the
 *  browser already knows the link is down. */
async function probeHealth(): Promise<boolean> {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return false
    if (typeof fetch === "undefined") return true
    try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), HEALTH_CHECK_TIMEOUT_MS)
        // dedupedFetch coalesces concurrent probes — if Strict Mode
        // remounts the banner mid-probe, the second probeHealth() reuses
        // the first one's in-flight request instead of opening another.
        const r = await dedupedFetch("/api/health", { cache: "no-store", signal: ctrl.signal })
        clearTimeout(timer)
        return r.ok
    } catch {
        return false
    }
}

// ── Shared health-probe singleton ────────────────────────────────────────
//
// OfflineBanner is rendered twice (desktop + mobile) in the topbar so the
// banner stays visible across breakpoints. A naive per-instance hook would
// run TWO health probes every 30s, fire TWO `syncPendingBills` calls on
// online-transitions, and open TWO interval timers. The module-level store
// below owns the network-touching work once per page and broadcasts the
// `online` flag to every subscriber.
let probeStarted = false
let onlineState = true
const onlineListeners = new Set<() => void>()
let probeInterval: ReturnType<typeof setInterval> | null = null
let syncMutex = false

function emitOnline() { onlineListeners.forEach((fn) => fn()) }

function setOnlineState(ok: boolean): boolean {
    const transitioned = onlineState !== ok
    onlineState = ok
    if (transitioned) emitOnline()
    return transitioned
}

async function recheckOnline(tenantId: string, onTransitionOnline: () => void) {
    const ok = await probeHealth()
    const transitioned = setOnlineState(ok)
    if (transitioned && ok) onTransitionOnline()
    return ok
}

/** Starts the health probe + browser-event listeners exactly once per
 *  page load. Subsequent callers (the second mounted OfflineBanner) are
 *  no-ops; they read the same `onlineState`. */
function startHealthProbe(tenantId: string, onTransitionOnline: () => void) {
    if (probeStarted || !tenantId) return
    probeStarted = true
    void recheckOnline(tenantId, onTransitionOnline)
    probeInterval = setInterval(() => {
        void recheckOnline(tenantId, onTransitionOnline)
    }, HEALTH_CHECK_INTERVAL_MS)
    const onOnline = () => { void recheckOnline(tenantId, onTransitionOnline) }
    const onOffline = () => { setOnlineState(false) }
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    // We don't bother tearing this down — it lives for the whole page
    // lifetime, and unmounting/remounting the topbar across navigations
    // would lose the probe state we want to preserve.
}

function subscribeOnline(fn: () => void): () => void {
    onlineListeners.add(fn)
    return () => { onlineListeners.delete(fn) }
}
function getOnlineSnapshot() { return onlineState }
function getOnlineServerSnapshot() { return true }

/** Module-level guard around `syncPendingBills` so the two mounted
 *  OfflineBanner instances don't fire concurrent sync requests on the
 *  same online-transition. */
async function singletonSync(
    supabase: ReturnType<typeof createClient>,
    tenantId: string,
): Promise<{ succeeded: number } | null> {
    if (syncMutex) return null
    syncMutex = true
    try {
        return await syncPendingBills(supabase, tenantId)
    } finally {
        syncMutex = false
    }
}

export function OfflineBanner({ tenantId }: { tenantId: string }) {
    const supabase = createClient()
    const online = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getOnlineServerSnapshot)
    const [pending, setPending] = useState(0)
    const [stuck, setStuck] = useState(0)
    const [busy, setBusy] = useState(false)
    const [lastSync, setLastSync] = useState<string | null>(null)
    const refreshCountRef = useRef<() => void>(() => {})

    function refreshCount() {
        setPending(pendingCount(tenantId))
        setStuck(deadLetterCount(tenantId))
    }
    refreshCountRef.current = refreshCount

    const trySync = useCallback(async () => {
        if (busy) return
        if (!online) return
        setBusy(true)
        try {
            const r = await singletonSync(supabase, tenantId)
            if (r && r.succeeded > 0) {
                const ts = new Date().toISOString()
                setLastSync(ts)
                writeLastSync(tenantId, ts)
            }
        } finally {
            refreshCount()
            setBusy(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [supabase, tenantId, busy, online])

    useEffect(() => {
        // Restore last-sync from a previous tab so the badge doesn't look
        // amnesiac after a refresh.
        setLastSync(readLastSync(tenantId))
        refreshCount()

        // Boot the singleton probe. Multiple OfflineBanner instances
        // share the same probe interval + transition handler; only the
        // first call here actually starts anything.
        startHealthProbe(tenantId, () => {
            refillIfLow(supabase, tenantId).catch(() => {})
            if (listPending(tenantId).some((p) => !p.synced_at)) {
                // fire-and-forget; singletonSync guards against concurrent runs
                void singletonSync(supabase, tenantId)
                    .then((r) => {
                        if (r && r.succeeded > 0) {
                            const ts = new Date().toISOString()
                            writeLastSync(tenantId, ts)
                            setLastSync(ts)
                        }
                        refreshCountRef.current()
                    })
                    .catch(() => { /* singletonSync swallows individually */ })
            }
        })

        function onStorage(e: StorageEvent) {
            if (e.key && e.key.startsWith("offline:pending-bills:")) refreshCount()
            if (e.key && e.key.startsWith("offline:last-sync:")) setLastSync(readLastSync(tenantId))
        }
        window.addEventListener("storage", onStorage)
        return () => {
            window.removeEventListener("storage", onStorage)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tenantId])

    // Nothing to show: online, nothing queued, nothing stuck, no recent sync — stay out of the way.
    if (online && pending === 0 && stuck === 0 && !lastSync) return null

    return (
        <div className="flex items-center gap-2 px-2 py-1 rounded-md border text-xs"
             style={{
                 borderColor: online ? "hsl(var(--success) / 0.4)" : "hsl(var(--warning) / 0.5)",
                 background: online ? "hsl(var(--success) / 0.1)" : "hsl(var(--warning) / 0.1)",
             }}
        >
            {online
                ? <Wifi className="h-3.5 w-3.5 text-success" />
                : <CloudOff className="h-3.5 w-3.5 text-warning" />}
            <span className={cn("font-medium", online ? "text-success" : "text-warning")}>
                {online ? "Online" : "Offline — bills queued locally"}
            </span>
            {pending > 0 && (
                <Badge variant="warning" className="text-[10px] py-0">
                    {pending} pending
                </Badge>
            )}
            {stuck > 0 && (
                <Badge variant="destructive" className="text-[10px] py-0" title="Bills that failed to sync after many retries. Open the bill detail to investigate.">
                    <AlertTriangle className="h-3 w-3 mr-0.5" />
                    {stuck} stuck
                </Badge>
            )}
            {online && pending > 0 && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={trySync} disabled={busy}>
                    {busy ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Sync now
                </Button>
            )}
        </div>
    )
}
