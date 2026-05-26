/**
 * Tiny localStorage wrapper that survives private mode, quota errors and
 * corrupt JSON without throwing. We deliberately don't reach for IndexedDB
 * yet — payload sizes are small (reservation buffer is ~5 KB, pending
 * queue grows by ~5 KB per pending bill) and the synchronous API keeps
 * the offline-fallback code path simple.
 */

export function readJSON<T>(key: string, fallback: T): T {
    if (typeof window === "undefined") return fallback
    try {
        const raw = window.localStorage.getItem(key)
        if (!raw) return fallback
        return JSON.parse(raw) as T
    } catch {
        return fallback
    }
}

export function writeJSON(key: string, value: unknown): boolean {
    if (typeof window === "undefined") return false
    try {
        window.localStorage.setItem(key, JSON.stringify(value))
        return true
    } catch {
        // QuotaExceededError / private-mode SecurityError
        return false
    }
}

export function removeKey(key: string): void {
    if (typeof window === "undefined") return
    try { window.localStorage.removeItem(key) } catch { /* ignore */ }
}
