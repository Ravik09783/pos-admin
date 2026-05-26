"use client"

import { useCallback, useMemo, useSyncExternalStore } from "react"

import { createClient } from "@/lib/supabase/client"
import type { Branch, UserRole } from "@/types/database"

/**
 * Global "active branch" context.
 *
 * One switcher in the topbar drives what every list page (Orders, Bills,
 * Reservations, Menu, POS, …) reads + what new rows are created under.
 * Replaces the per-page tab strips and per-form branch pickers — the
 * admin picks a branch once, the whole app re-scopes.
 *
 * Roles:
 *   - OWNER / MANAGER → can switch freely, including an "All branches"
 *     view for cross-branch reporting.
 *   - everyone else   → locked to their assigned branch (the one set on
 *     their `users` row by the OWNER on the Staff page). Switcher hides.
 *
 * Persistence: per signed-in user + tenant via localStorage. That keeps a
 * manager's saved branch from bleeding into another account on the same
 * browser.
 */
const STORAGE_KEY_PREFIX = "restopos:active-branch"
const LEGACY_STORAGE_KEY = STORAGE_KEY_PREFIX
export const BRANCHES_CHANGED_EVENT = "restopos:branches-changed"
export const ACTIVE_BRANCH_CHANGED_EVENT = "restopos:active-branch-changed"

/** Sentinel string used in localStorage for the "All branches" choice.
 *  We use a string rather than null so we can distinguish "user has
 *  deliberately chosen all-branches" from "nothing saved yet". */
const ALL_BRANCHES_TOKEN = "__ALL__"

export interface ActiveBranchState {
    /** Null = "All branches" (admins or multi-branch users). Otherwise
     *  the chosen branch id. */
    activeBranchId: string | null
    /** The resolved branch row matching activeBranchId, or null when in
     *  the "All branches" view (or when the id doesn't match any branch,
     *  e.g. stale localStorage after a branch was deleted). */
    activeBranch: Branch | null
    /** Every active branch in the tenant. Admins use this list directly;
     *  non-admin multi-branch users see only their `accessibleBranches`. */
    branches: Branch[]
    /** Branches this user can read — admin: all; otherwise home + any
     *  `user_branch_access` grants. Drives the switcher dropdown. */
    accessibleBranches: Branch[]
    role: UserRole | null
    /** The branch the current user was assigned to via Settings → Staff.
     *  Used as their default + write-side "home". */
    userBranchId: string | null
    /** Extra branches the user has been granted access to via
     *  `user_branch_access` (migration 45). Empty unless the OWNER has
     *  added rows for this user. */
    extraBranchIds: string[]
    /** True for OWNER + MANAGER OR any user with ≥2 accessible branches. */
    canSwitch: boolean
    /** True while we're still fetching the user / branches from the DB. */
    loading: boolean
    /** True for ~250ms right after a branch switch — surfaces a visual
     *  "something is happening" cue across the app while pages re-query. */
    switching: boolean
    setActiveBranch: (id: string | null) => void
}

function readSavedBranch(key: string): string | null {
    if (typeof window === "undefined") return null
    try {
        const saved = localStorage.getItem(key)
        if (saved) return saved

        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
        if (legacy) {
            localStorage.setItem(key, legacy)
            localStorage.removeItem(LEGACY_STORAGE_KEY)
            return legacy
        }
    } catch {
        return null
    }
    return null
}

// ── Module-level shared store ─────────────────────────────────────────────
//
// Every page (Dashboard, POS, Bills, …) and several app-shell pieces
// (Topbar, BranchSwitcher, NavBody via usePendingCount) call
// `useActiveBranch()`. Without a shared store each call site would fire
// its own `getUser + users + branches` queries on mount — multiple
// network round-trips per page load. The store fetches once per session
// and broadcasts updates to every subscriber.
interface BranchStoreSnapshot {
    activeBranchId: string | null
    branches: Branch[]
    /** From migration 45 — extra branches this user can read. */
    extraBranchIds: string[]
    role: UserRole | null
    userBranchId: string | null
    loading: boolean
    switching: boolean
    storageKey: string | null
}

const EMPTY_SNAPSHOT: BranchStoreSnapshot = {
    activeBranchId: null,
    branches: [],
    extraBranchIds: [],
    role: null,
    userBranchId: null,
    loading: true,
    switching: false,
    storageKey: null,
}

let snapshot: BranchStoreSnapshot = EMPTY_SNAPSHOT
const listeners = new Set<() => void>()
let loadPromise: Promise<void> | null = null
let externalListenersBound = false
let switchingTimer: ReturnType<typeof setTimeout> | null = null

function emit() {
    listeners.forEach((fn) => fn())
}

function set(patch: Partial<BranchStoreSnapshot>) {
    snapshot = { ...snapshot, ...patch }
    emit()
}

async function loadBranchData() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        set({ loading: false })
        return
    }
    const [{ data: u }, { data: brs }, { data: grants }] = await Promise.all([
        supabase.from("users").select("tenant_id, role, branch_id").eq("id", user.id).maybeSingle(),
        supabase.from("branches").select("*").eq("is_active", true).order("is_main", { ascending: false }).order("name"),
        // Migration 45: extra branches this user has been granted access to.
        // RLS lets them read their own rows. Swallow errors so a missing
        // migration in dev doesn't lock the whole switcher.
        supabase.from("user_branch_access").select("branch_id").eq("user_id", user.id),
    ])
    const userRow = u as { tenant_id?: string | null; role?: UserRole; branch_id?: string | null } | null
    const tenantId = userRow?.tenant_id ?? "no-tenant"
    const r = userRow?.role ?? null
    const ub = userRow?.branch_id ?? null
    const nextBranches = (brs ?? []) as Branch[]
    const extraBranchIds = ((grants ?? []) as { branch_id: string }[]).map((g) => g.branch_id)
    const storageKey = `${STORAGE_KEY_PREFIX}:${tenantId}:${user.id}`

    let nextActive: string | null
    const isAdmin = r === "OWNER" || r === "MANAGER"
    // A non-admin with grants gets to pick across home + extras. Without
    // grants they're still pinned to their home branch.
    const hasMultiBranch = !isAdmin && extraBranchIds.length > 0

    if (isAdmin) {
        const saved = readSavedBranch(storageKey)
        const fallbackBranchId = ub && nextBranches.some((b) => b.id === ub) ? ub : nextBranches[0]?.id ?? null
        if (saved === ALL_BRANCHES_TOKEN) nextActive = null
        else if (saved && nextBranches.some((b) => b.id === saved)) nextActive = saved
        else nextActive = fallbackBranchId
    } else if (hasMultiBranch) {
        const allowed = new Set<string>(
            [ub, ...extraBranchIds].filter((x): x is string => !!x),
        )
        const saved = readSavedBranch(storageKey)
        if (saved === ALL_BRANCHES_TOKEN) nextActive = null
        else if (saved && allowed.has(saved)) nextActive = saved
        else nextActive = ub ?? extraBranchIds[0] ?? null
    } else {
        nextActive = ub
    }

    set({
        activeBranchId: nextActive,
        branches: nextBranches,
        extraBranchIds,
        role: r,
        userBranchId: ub,
        loading: false,
        storageKey,
    })
}

function ensureLoaded(): Promise<void> {
    if (!loadPromise) {
        loadPromise = loadBranchData().catch((e) => {
            // Reset on failure so a transient error doesn't permanently
            // pin the app in `loading: true`.
            loadPromise = null
            throw e
        })
    }
    return loadPromise
}

function refresh() {
    loadPromise = null
    void ensureLoaded()
}

function bindExternalListeners() {
    if (externalListenersBound || typeof window === "undefined") return
    externalListenersBound = true
    window.addEventListener(BRANCHES_CHANGED_EVENT, refresh)
    window.addEventListener(ACTIVE_BRANCH_CHANGED_EVENT, refresh)
}

function subscribe(fn: () => void): () => void {
    listeners.add(fn)
    bindExternalListeners()
    void ensureLoaded()
    return () => { listeners.delete(fn) }
}

function getSnapshot(): BranchStoreSnapshot { return snapshot }
function getServerSnapshot(): BranchStoreSnapshot { return EMPTY_SNAPSHOT }

export function useActiveBranch(): ActiveBranchState {
    const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

    // Branches the user is actually allowed to read. Admins see all;
    // everyone else sees their home branch + any user_branch_access
    // grants. Drives the switcher's dropdown so a CASHIER who's been
    // granted access to two branches can flip between them, but never
    // sees branches they can't touch.
    const accessibleBranches = useMemo(() => {
        const isAdmin = s.role === "OWNER" || s.role === "MANAGER"
        if (isAdmin) return s.branches
        const allowed = new Set<string>(
            [s.userBranchId, ...s.extraBranchIds].filter((x): x is string => !!x),
        )
        return s.branches.filter((b) => allowed.has(b.id))
    }, [s.branches, s.role, s.userBranchId, s.extraBranchIds])

    const setActiveBranch = useCallback((id: string | null) => {
        // Defensive: refuse switches to a branch the user can't actually
        // read (e.g. a malformed deep link). Admins skip the check — they
        // see everything anyway.
        const isAdmin = s.role === "OWNER" || s.role === "MANAGER"
        if (!isAdmin && id !== null) {
            const allowed = id === s.userBranchId || s.extraBranchIds.includes(id)
            if (!allowed) return
        }
        set({ activeBranchId: id, switching: true })
        if (switchingTimer) clearTimeout(switchingTimer)
        switchingTimer = setTimeout(() => set({ switching: false }), 350)
        if (typeof window !== "undefined" && snapshot.storageKey) {
            try { localStorage.setItem(snapshot.storageKey, id ?? ALL_BRANCHES_TOKEN) } catch { /* ignore */ }
            window.dispatchEvent(new Event(ACTIVE_BRANCH_CHANGED_EVENT))
        }
    }, [s.role, s.userBranchId, s.extraBranchIds])

    const canSwitch =
        s.role === "OWNER" || s.role === "MANAGER" || accessibleBranches.length > 1
    const activeBranch = s.activeBranchId
        ? s.branches.find((b) => b.id === s.activeBranchId) ?? null
        : null
    return {
        activeBranchId: s.activeBranchId,
        activeBranch,
        branches: s.branches,
        accessibleBranches,
        role: s.role,
        userBranchId: s.userBranchId,
        extraBranchIds: s.extraBranchIds,
        canSwitch,
        loading: s.loading,
        switching: s.switching,
        setActiveBranch,
    }
}

// ── Query helpers ──────────────────────────────────────────────────────
//
// Used by list pages so the same filtering logic isn't copy-pasted across
// Orders / Bills / Reservations / etc. The branch column name defaults
// to "branch_id" but is overridable for tables where the column lives
// somewhere else (joins, etc).

type Query = {
    eq: (col: string, v: unknown) => Query
    or: (filter: string) => Query
    is: (col: string, v: unknown) => Query
}

/** Strict per-branch filter. NULL active branch = no filter (admin
 *  picked "All branches"). Otherwise `eq("branch_id", id)`. Used for
 *  Orders, Bills, Reservations — these belong to exactly one branch. */
// export function scopeQueryToBranch<T extends Query>(q: T, activeBranchId: string | null, column = "branch_id"): T {
//     if (activeBranchId === null) return q
//     return q.eq(column, activeBranchId) as T
// }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scopeQueryToBranch(q: any, activeBranchId: string | null, column = "branch_id"): any {
    if (activeBranchId === null) return q
    return q.eq(column, activeBranchId)
}

/** Inclusive filter for menu_items. NULL `branch_id` on a row means
 *  "available at every branch" — so when an admin is viewing branch X
 *  they should see X-scoped items AND globally-shared items. Used for
 *  the menu admin page and the POS / QR menu queries. */
export function scopeMenuToBranch<T extends Query>(q: T, activeBranchId: string | null, column = "branch_id"): T {
    if (activeBranchId === null) return q
    // Postgres OR: branch_id eq active OR branch_id is null.
    return q.or(`${column}.eq.${activeBranchId},${column}.is.null`) as T
}
