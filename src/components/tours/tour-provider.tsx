"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import { logWarn } from "@/lib/errors"
import { createClient } from "@/lib/supabase/client"
import { TOURS, type TourDef, type TourKey, tourVisibleToRole } from "@/lib/tours/registry"
import type { UserRole } from "@/types/database"

/**
 * Lightweight context that owns:
 *   • which tours the current user has already completed (loaded once
 *     from `users.completed_tours` on mount), AND
 *   • which tour, if any, is currently running on the page.
 *
 * Page-level `<PageTour tourKey="…">` reads from here to decide whether
 * to auto-fire. The Replay button calls `runTour(key)` to force a re-run
 * even if the user has already completed it.
 *
 * Persistence model — DB primary, localStorage as a backup:
 *   - The DB column `users.completed_tours` is the source of truth so
 *     a staffer gets the same experience on every device.
 *   - But we ALSO mirror completions into `localStorage` keyed by the
 *     auth user id. Why: if migration 53 hasn't been applied to a
 *     given Supabase yet (so the column/RPC don't exist), the DB
 *     write fails silently and the tour would re-fire on every
 *     refresh. The localStorage shadow makes the "first-time only"
 *     promise robust even when the DB layer is incomplete.
 *   - On mount we read BOTH and take the union — a key marked
 *     complete in either source counts as complete.
 */

const LOCAL_KEY_PREFIX = "restopos:tours:completed:"
function localKeyFor(userId: string): string {
    return `${LOCAL_KEY_PREFIX}${userId}`
}
function readLocalCompleted(userId: string): Record<string, true> {
    if (typeof window === "undefined") return {}
    try {
        const raw = window.localStorage.getItem(localKeyFor(userId))
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== "object") return {}
        const out: Record<string, true> = {}
        for (const k of Object.keys(parsed)) out[k] = true
        return out
    } catch {
        return {}
    }
}
function writeLocalCompleted(userId: string, map: Record<string, true>): void {
    if (typeof window === "undefined") return
    try {
        window.localStorage.setItem(localKeyFor(userId), JSON.stringify(map))
    } catch {
        /* quota exceeded / private browsing — best-effort */
    }
}

interface TourCtx {
    role: UserRole | null
    completed: Record<string, true>
    /** True once the initial completed-tours fetch has finished
     *  (success OR failure). PageTour must wait for this before
     *  auto-starting, otherwise it races the fetch and re-fires a
     *  tour the user already completed. */
    loaded: boolean
    /** The tour key the page is currently running, or null. Pages
     *  observe this to render the <Joyride> only when their key
     *  matches. */
    activeTour: TourKey | null
    /** Force-start a tour (used by the Replay button). Ignores
     *  completion state but still honours role visibility. */
    runTour: (key: TourKey) => void
    /** Called by PageTour on first-visit auto-start. Returns false if
     *  the tour is already completed, already running, OR the
     *  initial completed-tours fetch hasn't landed yet. The caller
     *  is expected to retry once `loaded` flips to true. */
    autoStart: (key: TourKey) => boolean
    /** Called when the user finishes or skips a tour. Persists to DB
     *  and clears the active tour. */
    finishTour: (key: TourKey) => void
}

const TourContext = createContext<TourCtx | null>(null)

export function TourProvider({
    role,
    children,
}: {
    role: UserRole | null
    children: React.ReactNode
}) {
    const supabase = useMemo(() => createClient(), [])
    const [userId, setUserId] = useState<string | null>(null)
    const [completed, setCompleted] = useState<Record<string, true>>({})
    const [loaded, setLoaded] = useState<boolean>(false)
    const [activeTour, setActiveTour] = useState<TourKey | null>(null)
    /** Tracks tours we've already auto-fired this session so a fast
     *  back-button + return doesn't re-fire before the DB write
     *  lands. Lives in memory only — survives across pages while
     *  the SPA is mounted. */
    const [sessionFired, setSessionFired] = useState<Set<TourKey>>(new Set())

    // Initial load of the user's completed-tours map — DB ⊎ localStorage.
    useEffect(() => {
        let alive = true
        ;(async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                // No authenticated user — there's nothing to load, but
                // we still flip the gate so any PageTour mounted under
                // this provider doesn't wait forever. The role check
                // inside autoStart will short-circuit it for null role.
                if (alive) setLoaded(true)
                return
            }
            if (alive) setUserId(user.id)

            const localMap = readLocalCompleted(user.id)

            // DB read — may fail if migration 53 isn't applied. We
            // swallow the error and fall back to localStorage so the
            // user isn't re-toured every refresh in that case.
            let dbMap: Record<string, true> = {}
            try {
                const { data, error } = await supabase
                    .from("users")
                    .select("completed_tours")
                    .eq("id", user.id)
                    .maybeSingle() as {
                        data: { completed_tours: Record<string, unknown> | null } | null
                        error: { message: string } | null
                    }
                if (error) {
                    logWarn(`tour-provider: completed_tours read failed (${error.message}) — falling back to localStorage`)
                } else {
                    // We store ISO timestamps as values in the DB; for
                    // the in-memory map we collapse them to `true` so
                    // we never mistake a non-empty string for
                    // "uncompleted".
                    const raw = data?.completed_tours ?? {}
                    for (const k of Object.keys(raw)) dbMap[k] = true
                }
            } catch (e) {
                logWarn(`tour-provider: completed_tours read threw — ${String(e)}`)
            }
            if (!alive) return
            // Union of the two sources. If either marks a tour
            // complete, we honour it.
            setCompleted({ ...localMap, ...dbMap })
            // Flip the gate so PageTour's autoStart can proceed.
            // Without this, PageTour's setTimeout fires before the
            // fetch lands and sees `completed = {}`, then re-fires
            // a tour the user already completed.
            setLoaded(true)
        })()
        return () => { alive = false }
    }, [supabase])

    const runTour = useCallback((key: TourKey) => {
        const def: TourDef | undefined = TOURS[key]
        if (!def) return
        if (!tourVisibleToRole(def, role)) return
        setActiveTour(key)
    }, [role])

    const autoStart = useCallback((key: TourKey) => {
        // Race-condition guard. The initial fetch is async; if a
        // PageTour mounts and asks to auto-start before the fetch
        // lands, we'd see `completed = {}` and re-fire a tour the
        // user already completed. Returning false here forces the
        // caller to retry once `loaded` flips true.
        if (!loaded) return false
        if (activeTour) return false
        if (completed[key]) return false
        if (sessionFired.has(key)) return false
        const def = TOURS[key]
        if (!def || !tourVisibleToRole(def, role)) return false
        setSessionFired((prev) => {
            const next = new Set(prev)
            next.add(key)
            return next
        })
        setActiveTour(key)
        return true
    }, [loaded, activeTour, completed, sessionFired, role])

    const finishTour = useCallback((key: TourKey) => {
        // Optimistic local update — the user-visible truth.
        setCompleted((prev) => {
            const next = { ...prev, [key]: true } as Record<string, true>
            // Mirror to localStorage immediately so a refresh
            // survives even if the DB write below fails (e.g.
            // migration 53 not applied, network drop).
            if (userId) writeLocalCompleted(userId, next)
            return next
        })
        setActiveTour((curr) => (curr === key ? null : curr))
        // DB write — best-effort. If it fails we log so the bug is
        // visible during development but the user-facing experience
        // still respects the localStorage flag.
        void supabase
            .rpc("mark_tour_completed" as never, { p_tour_key: key } as never)
            .then((r) => {
                const err = (r as { error?: { message?: string } | null } | null)?.error
                if (err?.message) {
                    logWarn(`tour-provider: mark_tour_completed("${key}") failed — ${err.message}. localStorage backup still applies.`)
                }
            }, (e) => {
                logWarn(`tour-provider: mark_tour_completed("${key}") threw — ${String(e)}`)
            })
    }, [supabase, userId])

    const value = useMemo<TourCtx>(() => ({
        role,
        completed,
        loaded,
        activeTour,
        runTour,
        autoStart,
        finishTour,
    }), [role, completed, loaded, activeTour, runTour, autoStart, finishTour])

    return <TourContext.Provider value={value}>{children}</TourContext.Provider>
}

export function useTour() {
    const ctx = useContext(TourContext)
    if (!ctx) {
        throw new Error("useTour() called outside <TourProvider>")
    }
    return ctx
}

/** Sub-hook for the Replay button — wraps `reset_tour` (which clears
 *  the key from users.completed_tours) and then calls runTour. The
 *  reset is fire-and-forget; we don't block the UI on it. Also
 *  clears the localStorage shadow so the user doesn't have to
 *  refresh after replay to re-experience it on a fresh device. */
export function useReplayTour() {
    const { runTour } = useTour()
    const supabase = useMemo(() => createClient(), [])
    return useCallback((key: TourKey) => {
        // Best-effort: drop the key locally so a future page-load
        // doesn't see it as completed via the localStorage shadow.
        if (typeof window !== "undefined") {
            void supabase.auth.getUser().then(({ data }) => {
                const uid = data.user?.id
                if (!uid) return
                const cur = readLocalCompleted(uid)
                if (cur[key]) {
                    delete cur[key]
                    writeLocalCompleted(uid, cur)
                }
            })
        }
        void supabase.rpc("reset_tour" as never, { p_tour_key: key } as never)
        runTour(key)
    }, [supabase, runTour])
}
