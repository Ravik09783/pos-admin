/**
 * HR attendance — pure helpers.
 *
 * Everything here is side-effect-free integer/minute math so it can be
 * unit-tested in isolation and reused by both the admin marking screen and
 * the monthly sheet. Money math (payroll) lands in `salary.ts` in Phase 2
 * and uses decimal.js; attendance is just clocks and counts, so plain
 * numbers are fine.
 */

import type { AttendanceStatus, HrAttendance } from "@/types/database"

/** Minutes between two ISO timestamps. Returns 0 when either side is missing
 *  or the pair is inverted (check-out before check-in — a data glitch we
 *  clamp rather than surface as negative time). */
export function computeWorkedMinutes(
    checkIn: string | null | undefined,
    checkOut: string | null | undefined,
): number {
    if (!checkIn || !checkOut) return 0
    const inMs = Date.parse(checkIn)
    const outMs = Date.parse(checkOut)
    if (!Number.isFinite(inMs) || !Number.isFinite(outMs)) return 0
    const mins = Math.round((outMs - inMs) / 60000)
    return mins > 0 ? mins : 0
}

/**
 * Minutes a check-in is late versus the shift start.
 *
 * `shiftStart` is "HH:mm" in the same local wall-clock the check-in is read
 * in. We compare only the time-of-day, so an early arrival (or exactly on
 * time) yields 0 — never a negative.
 */
export function computeLateMinutes(
    checkIn: string | null | undefined,
    shiftStart: string | null | undefined,
): number {
    if (!checkIn || !shiftStart) return 0
    const inMs = Date.parse(checkIn)
    if (!Number.isFinite(inMs)) return 0
    const m = /^(\d{1,2}):(\d{2})$/.exec(shiftStart.trim())
    if (!m) return 0
    const startH = Number(m[1])
    const startMin = Number(m[2])
    if (startH > 23 || startMin > 59) return 0

    const d = new Date(inMs)
    const arrivalMinutes = d.getHours() * 60 + d.getMinutes()
    const shiftMinutes = startH * 60 + startMin
    const late = arrivalMinutes - shiftMinutes
    return late > 0 ? late : 0
}

/** Human label for an attendance status. */
export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
    PRESENT: "Present",
    ABSENT: "Absent",
    HALF_DAY: "Half day",
    LEAVE: "Leave",
    HOLIDAY: "Holiday",
    WEEKLY_OFF: "Weekly off",
}

/** Single-letter glyph for the dense monthly grid cell. */
export const ATTENDANCE_STATUS_GLYPH: Record<AttendanceStatus, string> = {
    PRESENT: "P",
    ABSENT: "A",
    HALF_DAY: "½",
    LEAVE: "L",
    HOLIDAY: "H",
    WEEKLY_OFF: "O",
}

/** Tailwind classes for a status — used by the marking screen badge and the
 *  monthly-sheet cell so the two surfaces stay colour-consistent. */
export function attendanceStatusColor(status: AttendanceStatus): string {
    switch (status) {
        case "PRESENT":
            return "bg-success/15 text-success border-success/30"
        case "ABSENT":
            return "bg-destructive/15 text-destructive border-destructive/30"
        case "HALF_DAY":
            return "bg-warning/15 text-warning border-warning/30"
        case "LEAVE":
            return "bg-primary/15 text-primary border-primary/30"
        case "HOLIDAY":
            return "bg-[hsl(var(--neon-magenta)/0.15)] text-[hsl(var(--neon-magenta))] border-[hsl(var(--neon-magenta)/0.3)]"
        case "WEEKLY_OFF":
            return "bg-muted text-muted-foreground border-border"
    }
}

/** How much of a working day each status counts as, for payroll pro-rating
 *  and the sheet's "days present" total. HOLIDAY / WEEKLY_OFF are paid
 *  non-working days → 0 worked but not deducted (Phase 2 payroll decides
 *  pay; here we only count attendance). */
export function statusDayFraction(status: AttendanceStatus): number {
    switch (status) {
        case "PRESENT":
            return 1
        case "HALF_DAY":
            return 0.5
        default:
            return 0
    }
}

export interface MonthSummary {
    present: number
    absent: number
    halfDay: number
    leave: number
    holiday: number
    weeklyOff: number
    /** Effective attended days: PRESENT = 1, HALF_DAY = 0.5. */
    payableDays: number
    totalWorkedMinutes: number
}

const EMPTY_SUMMARY: MonthSummary = {
    present: 0,
    absent: 0,
    halfDay: 0,
    leave: 0,
    holiday: 0,
    weeklyOff: 0,
    payableDays: 0,
    totalWorkedMinutes: 0,
}

/** Roll up a set of attendance rows (already filtered to one employee +
 *  month by the caller) into headline counts. */
export function summarizeMonth(
    rows: Pick<HrAttendance, "status" | "worked_minutes">[],
): MonthSummary {
    const out: MonthSummary = { ...EMPTY_SUMMARY }
    for (const r of rows) {
        switch (r.status) {
            case "PRESENT":
                out.present++
                break
            case "ABSENT":
                out.absent++
                break
            case "HALF_DAY":
                out.halfDay++
                break
            case "LEAVE":
                out.leave++
                break
            case "HOLIDAY":
                out.holiday++
                break
            case "WEEKLY_OFF":
                out.weeklyOff++
                break
        }
        out.payableDays += statusDayFraction(r.status)
        out.totalWorkedMinutes += r.worked_minutes ?? 0
    }
    return out
}

/** "8h 06m" style label for a minute count. */
export function formatMinutesAsHours(minutes: number | null | undefined): string {
    const m = Math.max(0, Math.round(minutes ?? 0))
    const h = Math.floor(m / 60)
    const rem = m % 60
    return `${h}h ${String(rem).padStart(2, "0")}m`
}

/** Days in a calendar month. `month` is 1-12. */
export function daysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate()
}
