import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function formatCurrency(value: number | string | null | undefined, currency = "INR"): string {
    const n = typeof value === "string" ? Number(value) : (value ?? 0)
    if (!Number.isFinite(n)) return "—"
    // INR keeps lakh/crore grouping via en-IN; other currencies use en-US
    // so a Swiss tenant's CHF totals don't render with Indian grouping
    // ("CHF 12,34,567" → "CHF 1,234,567").
    const locale = currency === "INR" ? "en-IN" : "en-US"
    return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
    }).format(n)
}

export function formatDate(date: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
    if (!date) return "—"
    const d = typeof date === "string" ? new Date(date) : date
    return d.toLocaleString("en-IN", opts ?? { dateStyle: "medium", timeStyle: "short" })
}

/**
 * Friendly "time ago" label — "just now", "5 minutes ago", "3 hours ago",
 * "2 days ago", "last month", "2 years ago". Built on Intl.RelativeTimeFormat.
 *
 * Returns "" for missing / unparseable input. Pass `now` to make it
 * deterministic in tests. Future dates render as "in 5 minutes" etc.
 */
export function timeAgo(value: string | Date | null | undefined, now: Date = new Date()): string {
    if (!value) return ""
    const d = typeof value === "string" ? new Date(value) : value
    const ms = d.getTime()
    if (Number.isNaN(ms)) return ""

    const sec = Math.round((now.getTime() - ms) / 1000)
    if (Math.abs(sec) < 45) return "just now"

    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
    // `format(-n, unit)` reads as "n units ago"; a negative diff (future
    // date) flips the sign back to "in n units".
    const min = Math.round(sec / 60)
    if (Math.abs(min) < 45) return rtf.format(-min, "minute")
    const hr = Math.round(sec / 3600)
    if (Math.abs(hr) < 24) return rtf.format(-hr, "hour")
    const day = Math.round(sec / 86400)
    if (Math.abs(day) < 30) return rtf.format(-day, "day")
    const month = Math.round(day / 30)
    if (Math.abs(month) < 12) return rtf.format(-month, "month")
    return rtf.format(-Math.round(day / 365), "year")
}

export function slugify(input: string): string {
    return input
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 60)
}

/** Parse a GSTIN and return the 2-digit state code (positions 1-2). */
export function gstinStateCode(gstin: string | null | undefined): string | null {
    if (!gstin || gstin.length < 2) return null
    const code = gstin.slice(0, 2)
    return /^\d{2}$/.test(code) ? code : null
}

/** Validate a GSTIN format (15 chars, structure check). Not exhaustive. */
export function isValidGSTIN(gstin: string): boolean {
    return /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1}$/.test(gstin)
}
