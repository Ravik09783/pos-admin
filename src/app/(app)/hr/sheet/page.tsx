"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, Loader2, Sheet as SheetIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell/page-header"
import { HrGuard } from "@/components/hr/hr-guard"
import { createClient } from "@/lib/supabase/client"
import {
    ATTENDANCE_STATUS_GLYPH,
    ATTENDANCE_STATUS_LABEL,
    attendanceStatusColor,
    daysInMonth,
    summarizeMonth,
} from "@/lib/hr/attendance"
import { cn } from "@/lib/utils"
import type { AttendanceStatus, HrAttendance, HrEmployee } from "@/types/database"

function currentMonth(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}
function pad(n: number): string { return String(n).padStart(2, "0") }

const LEGEND: AttendanceStatus[] = ["PRESENT", "HALF_DAY", "ABSENT", "LEAVE", "HOLIDAY", "WEEKLY_OFF"]

function SheetInner() {
    const supabase = createClient()
    const [month, setMonth] = useState(currentMonth())
    const [employees, setEmployees] = useState<HrEmployee[]>([])
    const [rows, setRows] = useState<HrAttendance[]>([])
    const [loading, setLoading] = useState(true)

    const [year, mon] = month.split("-").map(Number)
    const nDays = daysInMonth(year, mon)
    const days = useMemo(() => Array.from({ length: nDays }, (_, i) => i + 1), [nDays])

    const load = useCallback(async (m: string) => {
        setLoading(true)
        const [yy, mm] = m.split("-").map(Number)
        const start = `${yy}-${pad(mm)}-01`
        const end = `${yy}-${pad(mm)}-${pad(daysInMonth(yy, mm))}`
        const [{ data: emps }, { data: att }] = await Promise.all([
            supabase.from("hr_employees").select("*").eq("is_active", true).order("full_name"),
            supabase.from("hr_attendance").select("*").gte("work_date", start).lte("work_date", end),
        ])
        setEmployees((emps ?? []) as HrEmployee[])
        setRows((att ?? []) as HrAttendance[])
        setLoading(false)
    }, [supabase])

    useEffect(() => { load(month) }, [month, load])

    // employeeId -> dayNumber -> status
    const grid = useMemo(() => {
        const g = new Map<string, Map<number, AttendanceStatus>>()
        for (const r of rows) {
            const day = Number(r.work_date.slice(8, 10))
            if (!g.has(r.employee_id)) g.set(r.employee_id, new Map())
            g.get(r.employee_id)!.set(day, r.status)
        }
        return g
    }, [rows])

    const rowsByEmp = useMemo(() => {
        const m = new Map<string, HrAttendance[]>()
        for (const r of rows) {
            if (!m.has(r.employee_id)) m.set(r.employee_id, [])
            m.get(r.employee_id)!.push(r)
        }
        return m
    }, [rows])

    function exportCsv() {
        const header = ["Employee", "Code", ...days.map(String), "Present", "Half", "Absent", "Leave", "Payable days", "Worked hrs"]
        const lines = [header.join(",")]
        for (const e of employees) {
            const dayMap = grid.get(e.id)
            const summary = summarizeMonth(rowsByEmp.get(e.id) ?? [])
            const cells = days.map((d) => {
                const s = dayMap?.get(d)
                return s ? ATTENDANCE_STATUS_GLYPH[s] : ""
            })
            const workedHrs = (summary.totalWorkedMinutes / 60).toFixed(1)
            const row = [
                `"${e.full_name.replace(/"/g, '""')}"`, e.emp_code ?? "", ...cells,
                summary.present, summary.halfDay, summary.absent, summary.leave,
                summary.payableDays, workedHrs,
            ]
            lines.push(row.join(","))
        }
        const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `attendance-${month}.csv`
        a.click()
        URL.revokeObjectURL(url)
        toast.success("Sheet exported")
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-[1400px] space-y-6">
            <PageHeader
                kicker="Staff"
                title="Monthly sheet"
                highlight="attendance at a glance"
                description="The whole month for every employee in one grid. Each cell is a day; colours show the status."
                actions={
                    <Button variant="outline" onClick={exportCsv} disabled={loading || employees.length === 0}>
                        <Download className="h-4 w-4" /> Export CSV
                    </Button>
                }
            />

            <Card>
                <CardHeader className="flex-row items-center justify-between py-3 space-y-0 flex-wrap gap-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <SheetIcon className="h-4 w-4 text-muted-foreground" /> Month grid
                    </CardTitle>
                    <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                            {LEGEND.map((s) => (
                                <span key={s} className="inline-flex items-center gap-1">
                                    <span className={cn("inline-grid place-items-center h-4 w-4 rounded text-[9px] font-bold border", attendanceStatusColor(s))}>
                                        {ATTENDANCE_STATUS_GLYPH[s]}
                                    </span>
                                    {ATTENDANCE_STATUS_LABEL[s]}
                                </span>
                            ))}
                        </div>
                        <Input type="month" value={month} max={currentMonth()} onChange={(e) => setMonth(e.target.value)} className="h-9 w-40" />
                    </div>
                </CardHeader>
                <CardContent className="px-0">
                    {loading ? (
                        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                        </div>
                    ) : employees.length === 0 ? (
                        <p className="px-6 py-10 text-sm text-muted-foreground text-center">No active employees.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-sm">
                                <thead>
                                    <tr className="border-b">
                                        <th className="sticky left-0 bg-card z-10 text-left px-3 py-2 font-semibold min-w-[160px]">Employee</th>
                                        {days.map((d) => (
                                            <th key={d} className="px-0 py-2 text-center font-medium text-[11px] text-muted-foreground w-7">{d}</th>
                                        ))}
                                        <th className="px-2 py-2 text-center font-semibold text-xs border-l">P</th>
                                        <th className="px-2 py-2 text-center font-semibold text-xs">½</th>
                                        <th className="px-2 py-2 text-center font-semibold text-xs">A</th>
                                        <th className="px-2 py-2 text-center font-semibold text-xs">Pay</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {employees.map((e) => {
                                        const dayMap = grid.get(e.id)
                                        const summary = summarizeMonth(rowsByEmp.get(e.id) ?? [])
                                        return (
                                            <tr key={e.id} className="border-b hover:bg-muted/30">
                                                <td className="sticky left-0 bg-card z-10 px-3 py-1.5">
                                                    <div className="font-medium truncate max-w-[150px]">{e.full_name}</div>
                                                    {e.emp_code && <div className="text-[10px] text-muted-foreground">{e.emp_code}</div>}
                                                </td>
                                                {days.map((d) => {
                                                    const s = dayMap?.get(d)
                                                    return (
                                                        <td key={d} className="px-0.5 py-1 text-center">
                                                            {s ? (
                                                                <span
                                                                    title={ATTENDANCE_STATUS_LABEL[s]}
                                                                    className={cn("inline-grid place-items-center h-6 w-6 rounded text-[10px] font-bold border", attendanceStatusColor(s))}
                                                                >
                                                                    {ATTENDANCE_STATUS_GLYPH[s]}
                                                                </span>
                                                            ) : (
                                                                <span className="text-muted-foreground/30">·</span>
                                                            )}
                                                        </td>
                                                    )
                                                })}
                                                <td className="px-2 py-1.5 text-center border-l font-medium text-success">{summary.present}</td>
                                                <td className="px-2 py-1.5 text-center text-warning">{summary.halfDay}</td>
                                                <td className="px-2 py-1.5 text-center text-destructive">{summary.absent}</td>
                                                <td className="px-2 py-1.5 text-center font-semibold">{summary.payableDays}</td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

export default function SheetPage() {
    return (
        <HrGuard permission="attendance.manage">
            <SheetInner />
        </HrGuard>
    )
}
