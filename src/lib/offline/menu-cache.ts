/**
 * Offline cache for the POS page's menu data.
 *
 * The POS page loads its catalog (categories, items, recommendations) and
 * the cashier's identity from Supabase on every visit. When the network
 * is down that load fails, leaving the till with an empty menu — useless
 * for offline billing. So after every SUCCESSFUL online load the POS
 * snapshots everything here; if a later load fails (offline, or the
 * queries error), the POS restores from this snapshot and keeps working.
 *
 * One snapshot per device under a fixed key — a till is one cashier at
 * one branch, so the last successful load is what they need offline.
 * Identity is stored alongside the menu because `auth.getUser()` itself
 * needs the network; offline the POS falls back to this cached identity.
 *
 * localStorage (via `./storage`) is enough: a typical restaurant menu is
 * well under the ~5 MB budget, and the synchronous API keeps the
 * offline-fallback path simple — same trade-off the rest of this folder
 * already makes.
 */
import { readJSON, writeJSON } from "./storage"
import type { MenuCategory, MenuItem, UserRole } from "@/types/database"

const KEY = "restopos.pos.cache.v1"

export interface PosTenantInfo {
    name: string
    country: string | null
    service_charge_percent: number
    upi_id: string | null
    upi_payee_name: string | null
    /** Tenant default for charging tax on bills (migration 38). Optional so
     *  snapshots taken before this field still load — treat missing as true. */
    tax_enabled?: boolean
}

export interface PosCache {
    /** Epoch ms the snapshot was taken. */
    cachedAt: number
    branchId: string | null
    tenantId: string
    userId: string
    userRole: UserRole | null
    tenant: PosTenantInfo | null
    categories: MenuCategory[]
    items: MenuItem[]
    /** item_id → recommended item_ids. */
    recs: Record<string, string[]>
}

/** Snapshot the current POS catalog + identity after a good online load. */
export function savePosCache(data: Omit<PosCache, "cachedAt">): void {
    writeJSON(KEY, { ...data, cachedAt: Date.now() })
}

/** Last good POS snapshot, or null if this device has never loaded the POS. */
export function readPosCache(): PosCache | null {
    return readJSON<PosCache | null>(KEY, null)
}
