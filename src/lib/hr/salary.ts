/**
 * Payroll salary engine — pure money math.
 *
 * This is the TypeScript MIRROR of the authoritative SQL in
 * `supabase/migrations/_backup_2026-05-20/57_hr_payroll.sql`
 * (function `hr_generate_payslip`). The DB computes the stored payslip; this
 * mirror drives the live preview in the payroll UI so the admin sees the
 * exact same numbers before generating. **Keep the two in sync** — same
 * formula, same per-line ROUND_HALF_UP to 2 decimals.
 *
 * Formula (see the SQL banner for the canonical statement):
 *   workingDays = days in month that are NOT a weekly-off and NOT a holiday
 *   payableDays = present + 0.5·half + leave            (paid leave counts)
 *   earnedBase  = MONTHLY: base · payable/workingDays
 *                 DAILY  : base · payable
 *                 HOURLY : base · workedHours
 *   overtime    = perHourRate · overtimeHours
 *   earnings[i] = fixed → amount ; percent → earnedBase · pct/100
 *   gross       = earnedBase + Σ earnings + overtime
 *   deduct[i]   = fixed → amount ; percent → gross · pct/100
 *   net         = gross − Σ deductions
 */

import Decimal from "decimal.js"

import type { PayslipLine, SalaryBasis, SalaryComponent } from "@/types/database"
import { daysInMonth } from "@/lib/hr/attendance"

Decimal.set({ rounding: Decimal.ROUND_HALF_UP })

function r2(v: Decimal.Value): number {
    return new Decimal(v).toDecimalPlaces(2).toNumber()
}

export interface SalaryStructure {
    salary_basis: SalaryBasis
    base_amount: number
    expected_hours_per_day: number
    earnings: SalaryComponent[]
    deductions: SalaryComponent[]
}

export interface AttendanceTotals {
    present: number
    halfDay: number
    leave: number
    absent: number
    workedMinutes: number
    overtimeMinutes: number
}

export interface PayslipComputation {
    workingDays: number
    payableDays: number
    earnedBase: number
    overtimeAmount: number
    grossEarnings: number
    totalDeductions: number
    netPay: number
    earnings: PayslipLine[]
    deductions: PayslipLine[]
}

/**
 * Working days in a month = calendar days that are neither a weekly-off nor a
 * holiday. `year`/`month` (1-12); `weeklyOffs` are JS weekday numbers (0=Sun);
 * `holidayDays` is the set of day-of-month numbers (1-31) that are holidays.
 */
export function workingDaysInMonth(
    year: number,
    month: number,
    weeklyOffs: number[],
    holidayDays: number[],
): number {
    const n = daysInMonth(year, month)
    const offs = new Set(weeklyOffs)
    const hol = new Set(holidayDays)
    let count = 0
    for (let day = 1; day <= n; day++) {
        const dow = new Date(year, month - 1, day).getDay()
        if (offs.has(dow)) continue
        if (hol.has(day)) continue
        count++
    }
    return count
}

/** Per-hour rate derived from the base + basis. */
function perHourRate(s: SalaryStructure, workingDays: number): Decimal {
    const base = new Decimal(s.base_amount || 0)
    const hpd = new Decimal(s.expected_hours_per_day || 0)
    if (s.salary_basis === "HOURLY") return base
    if (hpd.lte(0)) return new Decimal(0)
    if (s.salary_basis === "DAILY") return base.div(hpd)
    // MONTHLY
    if (workingDays <= 0) return new Decimal(0)
    return base.div(new Decimal(workingDays).mul(hpd))
}

/** Compute a full payslip breakdown. `workingDays` must be precomputed via
 *  workingDaysInMonth() (the UI knows the month + holidays). */
export function computePayslip(
    structure: SalaryStructure,
    totals: AttendanceTotals,
    workingDays: number,
): PayslipComputation {
    const base = new Decimal(structure.base_amount || 0)
    const payable = new Decimal(totals.present)
        .plus(new Decimal(totals.halfDay).mul(0.5))
        .plus(totals.leave)
    const wd = workingDays > 0 ? workingDays : 1

    let earnedBase: Decimal
    if (structure.salary_basis === "DAILY") {
        earnedBase = base.mul(payable)
    } else if (structure.salary_basis === "HOURLY") {
        earnedBase = base.mul(new Decimal(totals.workedMinutes).div(60))
    } else {
        const capped = Decimal.min(payable, wd)
        earnedBase = base.mul(capped.div(wd))
    }
    earnedBase = new Decimal(r2(earnedBase))

    const otHours = new Decimal(totals.overtimeMinutes).div(60)
    const otAmount = new Decimal(r2(perHourRate(structure, wd).mul(otHours)))

    const earnings: PayslipLine[] = [{ name: "Earned salary", amount: earnedBase.toNumber() }]
    let earnTotal = new Decimal(0)
    for (const c of structure.earnings ?? []) {
        const line = c.type === "percent"
            ? new Decimal(r2(earnedBase.mul(c.amount || 0).div(100)))
            : new Decimal(r2(c.amount || 0))
        earnTotal = earnTotal.plus(line)
        earnings.push({ name: c.name || "Allowance", amount: line.toNumber() })
    }
    if (otAmount.gt(0)) earnings.push({ name: "Overtime", amount: otAmount.toNumber() })

    const gross = earnedBase.plus(earnTotal).plus(otAmount)

    const deductions: PayslipLine[] = []
    let dedTotal = new Decimal(0)
    for (const c of structure.deductions ?? []) {
        const line = c.type === "percent"
            ? new Decimal(r2(gross.mul(c.amount || 0).div(100)))
            : new Decimal(r2(c.amount || 0))
        dedTotal = dedTotal.plus(line)
        deductions.push({ name: c.name || "Deduction", amount: line.toNumber() })
    }

    const net = gross.minus(dedTotal)

    return {
        workingDays: wd,
        payableDays: payable.toNumber(),
        earnedBase: earnedBase.toNumber(),
        overtimeAmount: otAmount.toNumber(),
        grossEarnings: r2(gross),
        totalDeductions: r2(dedTotal),
        netPay: r2(net),
        earnings,
        deductions,
    }
}

/** Net pay in words (Indian English) — used on the slip. Handles up to crores. */
export function amountInWords(amount: number, currency = "INR"): string {
    const n = Math.floor(Math.abs(amount))
    if (n === 0) return currency === "INR" ? "Rupees Zero only" : "Zero only"
    const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
        "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
    const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]
    const two = (x: number): string => x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? " " + ones[x % 10] : ""}`
    const three = (x: number): string => {
        const h = Math.floor(x / 100)
        const rest = x % 100
        return `${h ? ones[h] + " Hundred" + (rest ? " " : "") : ""}${rest ? two(rest) : ""}`
    }
    let words = ""
    const crore = Math.floor(n / 10000000)
    const lakh = Math.floor((n % 10000000) / 100000)
    const thousand = Math.floor((n % 100000) / 1000)
    const rest = n % 1000
    if (crore) words += `${two(crore)} Crore `
    if (lakh) words += `${two(lakh)} Lakh `
    if (thousand) words += `${two(thousand)} Thousand `
    if (rest) words += three(rest)
    words = words.trim()
    return currency === "INR" ? `Rupees ${words} only` : `${words} only`
}
