import { describe, expect, it } from "vitest"

import {
    amountInWords,
    computePayslip,
    workingDaysInMonth,
    type AttendanceTotals,
    type SalaryStructure,
} from "@/lib/hr/salary"

const noAtt: AttendanceTotals = { present: 0, halfDay: 0, leave: 0, absent: 0, workedMinutes: 0, overtimeMinutes: 0 }

describe("workingDaysInMonth", () => {
    it("excludes weekly offs", () => {
        // June 2026 has 30 days; Sundays (0) in June 2026: 7,14,21,28 → 4
        expect(workingDaysInMonth(2026, 6, [0], [])).toBe(26)
    })
    it("excludes holidays that fall on working days", () => {
        // remove one extra working-day holiday (June 1 2026 is a Monday)
        expect(workingDaysInMonth(2026, 6, [0], [1])).toBe(25)
    })
    it("does not double-count a holiday landing on a weekly off", () => {
        // June 7 2026 is a Sunday (already excluded)
        expect(workingDaysInMonth(2026, 6, [0], [7])).toBe(26)
    })
})

describe("computePayslip — MONTHLY", () => {
    const struct: SalaryStructure = {
        salary_basis: "MONTHLY", base_amount: 30000, expected_hours_per_day: 8,
        earnings: [], deductions: [],
    }
    it("pays full base when all working days are payable", () => {
        const r = computePayslip(struct, { ...noAtt, present: 26 }, 26)
        expect(r.earnedBase).toBe(30000)
        expect(r.netPay).toBe(30000)
    })
    it("pro-rates by payable days (absent reduces pay)", () => {
        // 24 present + 1 half = 24.5 payable / 26 working
        const r = computePayslip(struct, { ...noAtt, present: 24, halfDay: 1 }, 26)
        // 30000 * 24.5/26 = 28269.23
        expect(r.earnedBase).toBe(28269.23)
    })
    it("counts paid leave as payable", () => {
        const r = computePayslip(struct, { ...noAtt, present: 24, leave: 2 }, 26)
        expect(r.payableDays).toBe(26)
        expect(r.earnedBase).toBe(30000)
    })
    it("adds percent allowances on earned base and percent deductions on gross", () => {
        const s: SalaryStructure = {
            ...struct,
            earnings: [{ name: "HRA", type: "percent", amount: 20 }, { name: "Travel", type: "fixed", amount: 1000 }],
            deductions: [{ name: "PF", type: "percent", amount: 12 }],
        }
        const r = computePayslip(s, { ...noAtt, present: 26 }, 26)
        // earnedBase 30000, HRA 6000, Travel 1000 → gross 37000
        expect(r.grossEarnings).toBe(37000)
        // PF 12% of 37000 = 4440
        expect(r.totalDeductions).toBe(4440)
        expect(r.netPay).toBe(32560)
        // earnings lines: Earned salary, HRA, Travel (no overtime)
        expect(r.earnings.map((e) => e.name)).toEqual(["Earned salary", "HRA", "Travel"])
    })
    it("caps earned base at full salary even if more days are marked than working days", () => {
        // 28 present in a 26-working-day month (admin marked weekly-offs too)
        const r = computePayslip(struct, { ...noAtt, present: 28 }, 26)
        expect(r.earnedBase).toBe(30000) // never overpays beyond base
    })
    it("yields zero when no salary is configured", () => {
        const s: SalaryStructure = { ...struct, base_amount: 0 }
        const r = computePayslip(s, { ...noAtt, present: 26 }, 26)
        expect(r.netPay).toBe(0)
    })
    it("falls back to a safe denominator when working days is zero", () => {
        const r = computePayslip(struct, { ...noAtt, present: 1 }, 0)
        expect(Number.isFinite(r.earnedBase)).toBe(true)
        expect(r.earnedBase).toBeGreaterThanOrEqual(0)
    })
    it("adds an overtime line when overtime minutes exist", () => {
        // perHour = 30000 / (26*8) = 144.2307…; 2h OT → 288.46
        const r = computePayslip(struct, { ...noAtt, present: 26, overtimeMinutes: 120 }, 26)
        expect(r.overtimeAmount).toBeCloseTo(288.46, 2)
        expect(r.earnings.some((e) => e.name === "Overtime")).toBe(true)
    })
})

describe("computePayslip — DAILY", () => {
    it("pays per payable day", () => {
        const s: SalaryStructure = { salary_basis: "DAILY", base_amount: 800, expected_hours_per_day: 8, earnings: [], deductions: [] }
        const r = computePayslip(s, { ...noAtt, present: 20, halfDay: 2 }, 26)
        // 800 * (20 + 1) = 16800
        expect(r.earnedBase).toBe(16800)
        expect(r.netPay).toBe(16800)
    })
})

describe("computePayslip — HOURLY", () => {
    it("pays per worked hour", () => {
        const s: SalaryStructure = { salary_basis: "HOURLY", base_amount: 100, expected_hours_per_day: 8, earnings: [], deductions: [] }
        const r = computePayslip(s, { ...noAtt, workedMinutes: 90 * 60 }, 26)
        // 100 * 90 = 9000
        expect(r.earnedBase).toBe(9000)
    })
})

describe("amountInWords", () => {
    it("formats common amounts in Indian English", () => {
        expect(amountInWords(0)).toBe("Rupees Zero only")
        expect(amountInWords(32560)).toBe("Rupees Thirty Two Thousand Five Hundred Sixty only")
        expect(amountInWords(100000)).toBe("Rupees One Lakh only")
        expect(amountInWords(2500000)).toBe("Rupees Twenty Five Lakh only")
    })
    it("ignores paise (floors) and supports non-INR", () => {
        expect(amountInWords(1500.75, "USD")).toBe("One Thousand Five Hundred only")
    })
})
