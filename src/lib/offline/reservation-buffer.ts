/**
 * Per-tenant buffer of pre-allocated invoice numbers. Reserved on the server
 * via `reserve_invoice_numbers(N)` while the user is online; consumed one at
 * a time when generating bills offline. The numbers are real, server-issued,
 * GST-sequential — the only mode of failure is a number expiring unused
 * (which becomes a documented gap in the audit log, never a duplicate).
 */

import { readJSON, writeJSON } from "./storage"

export interface InvoiceReservation {
    id: string                      // reservation row id (server-side)
    invoice_number: string          // e.g. "INV-2025-26-00042"
    sequence_value: number
    fy_label: string                // e.g. "2025-26"
    expires_at: string              // ISO timestamp
}

// Use `any` for the supabase client param. Its real type is deeply
// generic (PostgrestFilterBuilder<...>) and TS bails on structural
// matching against a narrower interface. Tests pass simpler mocks
// just as happily.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any

const KEY_PREFIX = "offline:reservations:"
/** When the buffer drops below this, top it up. Set well above the
 *  per-transaction churn rate so the buffer never approaches zero during
 *  normal use — the refill happens in the background and is invisible. */
export const LOW_WATERMARK = 20
/** Target buffer size after a top-up. Sized to comfortably cover a single
 *  cashier's offline shift (~50 bills/3-4hr at peak); the doc-recommended
 *  default that won't choke even if the network is flaky for an hour. */
export const TARGET_BUFFER = 50

function key(tenantId: string): string { return KEY_PREFIX + tenantId }

function isFresh(r: InvoiceReservation, nowMs = Date.now()): boolean {
    const t = Date.parse(r.expires_at)
    return Number.isFinite(t) && t > nowMs
}

/** Read all unexpired reservations for a tenant, oldest first. */
export function listReservations(tenantId: string): InvoiceReservation[] {
    const all = readJSON<InvoiceReservation[]>(key(tenantId), [])
    return all.filter((r) => isFresh(r)).sort((a, b) => a.sequence_value - b.sequence_value)
}

/** How many usable reservations are left for this tenant. */
export function remainingCount(tenantId: string): number {
    return listReservations(tenantId).length
}

/** Pop the next reservation (lowest sequence value). Returns null if empty. */
export function takeReservation(tenantId: string): InvoiceReservation | null {
    const buf = listReservations(tenantId)
    if (buf.length === 0) return null
    const [next, ...rest] = buf
    writeJSON(key(tenantId), rest)
    return next
}

/** Return a reservation to the buffer — call this when generate_bill fails
 *  in a way that didn't claim the number (network error before commit, RLS
 *  rejection, etc.) so we don't lose it. */
export function returnReservation(tenantId: string, r: InvoiceReservation): void {
    const buf = listReservations(tenantId)
    if (buf.some((b) => b.invoice_number === r.invoice_number)) return
    buf.push(r)
    buf.sort((a, b) => a.sequence_value - b.sequence_value)
    writeJSON(key(tenantId), buf)
}

/** Drop a specific reservation (e.g. server says it's already claimed). */
export function dropReservation(tenantId: string, invoiceNumber: string): void {
    const buf = listReservations(tenantId).filter((r) => r.invoice_number !== invoiceNumber)
    writeJSON(key(tenantId), buf)
}

interface ReserveRpcResponse {
    ok: boolean
    reservations: InvoiceReservation[]
}

/**
 * Top the buffer up to `target` by calling reserve_invoice_numbers on the
 * server. No-op if already at target or above. Returns the new total.
 */
export async function topUp(
    supabase: SupabaseLike,
    tenantId: string,
    target = TARGET_BUFFER,
): Promise<{ ok: boolean; count: number; error?: string }> {
    const existing = listReservations(tenantId)
    const want = Math.max(0, target - existing.length)
    if (want === 0) return { ok: true, count: existing.length }

    const { data, error } = await supabase.rpc("reserve_invoice_numbers", { p_count: want })
    if (error) return { ok: false, count: existing.length, error: error.message }
    const res = data as ReserveRpcResponse | null
    if (!res?.ok || !Array.isArray(res.reservations)) {
        return { ok: false, count: existing.length, error: "Unexpected response" }
    }
    const merged = [...existing, ...res.reservations].sort((a, b) => a.sequence_value - b.sequence_value)
    writeJSON(key(tenantId), merged)
    return { ok: true, count: merged.length }
}

/** Top up only if we're below the low watermark — cheap to call on every
 *  navigation / online event. */
export async function refillIfLow(supabase: SupabaseLike, tenantId: string): Promise<void> {
    if (remainingCount(tenantId) >= LOW_WATERMARK) return
    await topUp(supabase, tenantId)
}

/** Forget everything we know — used on sign-out / tenant switch. */
export function clearAll(tenantId: string): void {
    writeJSON(key(tenantId), [])
}
