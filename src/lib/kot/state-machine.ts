/**
 * Pure mirror of the KOT state machine defined in migration 027's
 * `update_kot_status` RPC. Lives here so the UI can grey out invalid
 * actions client-side AND so we can unit-test the transition table
 * without spinning up a database.
 *
 * Valid transitions:
 *   PENDING    → PREPARING | CANCELLED
 *   PREPARING  → READY     | CANCELLED
 *   READY      → SERVED
 *   SERVED, CANCELLED — terminal
 */

export type KotStatus = "PENDING" | "PREPARING" | "READY" | "SERVED" | "CANCELLED"

const TABLE: Record<KotStatus, KotStatus[]> = {
    PENDING:   ["PREPARING", "CANCELLED"],
    PREPARING: ["READY", "CANCELLED"],
    READY:     ["SERVED"],
    SERVED:    [],
    CANCELLED: [],
}

export function nextStatuses(current: KotStatus): KotStatus[] {
    return TABLE[current] ?? []
}

export function canTransition(from: KotStatus, to: KotStatus): boolean {
    return TABLE[from]?.includes(to) ?? false
}

export function isTerminal(status: KotStatus): boolean {
    return TABLE[status]?.length === 0
}

export const STATUS_LABEL: Record<KotStatus, string> = {
    PENDING:   "Pending",
    PREPARING: "Preparing",
    READY:     "Ready to serve",
    SERVED:    "Served",
    CANCELLED: "Cancelled",
}

/** Per-status accent used by the kitchen card UI. */
export const STATUS_ACCENT: Record<KotStatus, "warning" | "primary" | "success" | "muted" | "destructive"> = {
    PENDING:   "warning",
    PREPARING: "primary",
    READY:     "success",
    SERVED:    "muted",
    CANCELLED: "destructive",
}
