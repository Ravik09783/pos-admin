import { describe, expect, it } from "vitest"

import {
    attendanceStatusColor,
    computeLateMinutes,
    computeWorkedMinutes,
    daysInMonth,
    formatMinutesAsHours,
    statusDayFraction,
    summarizeMonth,
} from "@/lib/hr/attendance"
import type { AttendanceStatus } from "@/types/database"

describe("computeWorkedMinutes", () => {
    it("returns 0 when either timestamp is missing", () => {
        expect(computeWorkedMinutes(null, "2026-06-08T18:00:00Z")).toBe(0)
        expect(computeWorkedMinutes("2026-06-08T09:00:00Z", null)).toBe(0)
        expect(computeWorkedMinutes(undefined, undefined)).toBe(0)
    })

    it("computes a normal shift", () => {
        // 09:04 → 18:10 = 9h 06m = 546 minutes
        expect(
            computeWorkedMinutes("2026-06-08T09:04:00Z", "2026-06-08T18:10:00Z"),
        ).toBe(546)
    })

    it("clamps an inverted pair to 0 rather than going negative", () => {
        expect(
            computeWorkedMinutes("2026-06-08T18:00:00Z", "2026-06-08T09:00:00Z"),
        ).toBe(0)
    })

    it("handles an overnight shift (crossing midnight)", () => {
        // 22:00 → 06:00 next day = 8h = 480 minutes
        expect(
            computeWorkedMinutes("2026-06-08T22:00:00Z", "2026-06-09T06:00:00Z"),
        ).toBe(480)
    })

    it("returns 0 for unparseable input", () => {
        expect(computeWorkedMinutes("nope", "2026-06-08T18:00:00Z")).toBe(0)
    })
})

describe("computeLateMinutes", () => {
    it("returns minutes past the shift start", () => {
        // local 09:30 arrival vs 09:00 start = 30 late
        const arrival = new Date(2026, 5, 8, 9, 30).toISOString()
        expect(computeLateMinutes(arrival, "09:00")).toBe(30)
    })

    it("returns 0 when on time or early", () => {
        const early = new Date(2026, 5, 8, 8, 45).toISOString()
        expect(computeLateMinutes(early, "09:00")).toBe(0)
        const exact = new Date(2026, 5, 8, 9, 0).toISOString()
        expect(computeLateMinutes(exact, "09:00")).toBe(0)
    })

    it("returns 0 for missing or malformed inputs", () => {
        expect(computeLateMinutes(null, "09:00")).toBe(0)
        expect(computeLateMinutes(new Date().toISOString(), "9am")).toBe(0)
        expect(computeLateMinutes(new Date().toISOString(), "99:99")).toBe(0)
    })
})

describe("statusDayFraction", () => {
    it("counts present as full and half-day as half", () => {
        expect(statusDayFraction("PRESENT")).toBe(1)
        expect(statusDayFraction("HALF_DAY")).toBe(0.5)
    })
    it("counts non-working statuses as 0", () => {
        for (const s of ["ABSENT", "LEAVE", "HOLIDAY", "WEEKLY_OFF"] as AttendanceStatus[]) {
            expect(statusDayFraction(s)).toBe(0)
        }
    })
})

describe("summarizeMonth", () => {
    it("rolls up counts, payable days, and worked minutes", () => {
        const rows = [
            { status: "PRESENT" as const, worked_minutes: 540 },
            { status: "PRESENT" as const, worked_minutes: 480 },
            { status: "HALF_DAY" as const, worked_minutes: 240 },
            { status: "ABSENT" as const, worked_minutes: 0 },
            { status: "LEAVE" as const, worked_minutes: 0 },
            { status: "HOLIDAY" as const, worked_minutes: 0 },
            { status: "WEEKLY_OFF" as const, worked_minutes: 0 },
        ]
        const s = summarizeMonth(rows)
        expect(s.present).toBe(2)
        expect(s.halfDay).toBe(1)
        expect(s.absent).toBe(1)
        expect(s.leave).toBe(1)
        expect(s.holiday).toBe(1)
        expect(s.weeklyOff).toBe(1)
        expect(s.payableDays).toBe(2.5) // 2 present + 0.5 half
        expect(s.totalWorkedMinutes).toBe(1260)
    })

    it("returns an all-zero summary for no rows", () => {
        const s = summarizeMonth([])
        expect(s.present).toBe(0)
        expect(s.payableDays).toBe(0)
        expect(s.totalWorkedMinutes).toBe(0)
    })
})

describe("formatMinutesAsHours", () => {
    it("formats minutes as Hh MMm", () => {
        expect(formatMinutesAsHours(546)).toBe("9h 06m")
        expect(formatMinutesAsHours(60)).toBe("1h 00m")
        expect(formatMinutesAsHours(0)).toBe("0h 00m")
    })
    it("clamps negatives and rounds", () => {
        expect(formatMinutesAsHours(-10)).toBe("0h 00m")
        expect(formatMinutesAsHours(null)).toBe("0h 00m")
    })
})

describe("daysInMonth", () => {
    it("knows month lengths", () => {
        expect(daysInMonth(2026, 6)).toBe(30) // June
        expect(daysInMonth(2026, 2)).toBe(28) // Feb non-leap
        expect(daysInMonth(2024, 2)).toBe(29) // Feb leap
    })
})

describe("attendanceStatusColor", () => {
    it("returns a class string for every status", () => {
        for (const s of [
            "PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "HOLIDAY", "WEEKLY_OFF",
        ] as AttendanceStatus[]) {
            expect(attendanceStatusColor(s)).toContain("border")
        }
    })
})
