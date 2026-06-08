"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarDays, Check, Loader2, Save } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/app-shell/page-header"
import { HrGuard } from "@/components/hr/hr-guard"
import { createClient } from "@/lib/supabase/client"
import {
    ATTENDANCE_STATUS_LABEL,
    attendanceStatusColor,
    computeWorkedMinutes,
    formatMinutesAsHours,
} from "@/lib/hr/attendance"
import { cn } from "@/lib/utils"
import type { AttendanceStatus, HrAttendance, HrEmployee } from "@/types/database"

const STATUSES: AttendanceStatus[] = ["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "HOLIDAY", "WEEKLY_OFF"]

function todayStr(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
/** Combine the chosen date + a "HH:mm" wall-clock into an ISO timestamp. */
function toIso(dateStr: string, time: string): string | null {
    if (!time) return null
    const [h, m] = time.split(":").map(Number)
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null
    const d = new Date(`${dateStr}T00:00:00`)
    d.setHours(h, m, 0, 0)
    return d.toISOString()
}
function timeOf(iso: string | null | undefined): string {
    if (!iso) return ""
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

interface Draft {
    status: AttendanceStatus
    checkIn: string   // HH:mm
    checkOut: string  // HH:mm
    notes: string
    dirty: boolean
    saving: boolean
    existing: boolean
}
function emptyDraft(): Draft {
    return { status: "PRESENT", checkIn: "", checkOut: "", notes: "", dirty: false, saving: false, existing: false }
}

function AttendanceInner() {
    const supabase = createClient()
    const [date, setDate] = useState(todayStr())
    const [employees, setEmployees] = useState<HrEmployee[]>([])
    const [drafts, setDrafts] = useState<Record<string, Draft>>({})
    const [loading, setLoading] = useState(true)
    const isFuture = date > todayStr()

    const loadForDate = useCallback(async (d: string) => {
        setLoading(true)
        const [{ data: emps }, { data: att }] = await Promise.all([
            supabase.from("hr_employees").select("*").eq("is_active", true).order("full_name"),
            supabase.from("hr_attendance").select("*").eq("work_date", d),
        ])
        const empList = (emps ?? []) as HrEmployee[]
        const attList = (att ?? []) as HrAttendance[]
        const byEmp = new Map(attList.map((a) => [a.employee_id, a]))
        const next: Record<string, Draft> = {}
        for (const e of empList) {
            const a = byEmp.get(e.id)
            next[e.id] = a
                ? {
                    status: a.status,
                    checkIn: timeOf(a.check_in),
                    checkOut: timeOf(a.check_out),
                    notes: a.notes ?? "",
                    dirty: false, saving: false, existing: true,
                }
                : emptyDraft()
        }
        setEmployees(empList)
        setDrafts(next)
        setLoading(false)
    }, [supabase])

    useEffect(() => { loadForDate(date) }, [date, loadForDate])

    function patch(empId: string, p: Partial<Draft>) {
        setDrafts((prev) => ({ ...prev, [empId]: { ...prev[empId], ...p, dirty: true } }))
    }

    const workedLabel = (d: Draft): string => {
        const inIso = toIso(date, d.checkIn)
        const outIso = toIso(date, d.checkOut)
        return formatMinutesAsHours(computeWorkedMinutes(inIso, outIso))
    }

    async function saveOne(emp: HrEmployee) {
        const d = drafts[emp.id]
        if (!d) return
        setDrafts((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], saving: true } }))
        try {
            const { error } = await supabase.rpc("hr_mark_attendance" as never, {
                p_employee_id: emp.id,
                p_work_date: date,
                p_status: d.status,
                p_check_in: toIso(date, d.checkIn),
                p_check_out: toIso(date, d.checkOut),
                p_worked_minutes: null,
                p_late_minutes: null,
                p_overtime_minutes: null,
                p_notes: d.notes.trim() || null,
                p_reason: d.existing ? "Corrected via attendance screen" : "Marked via attendance screen",
            } as never)
            if (error) throw new Error(error.message)
            setDrafts((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], dirty: false, saving: false, existing: true } }))
            toast.success(`Saved · ${emp.full_name}`)
        } catch (err) {
            setDrafts((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], saving: false } }))
            toast.error(err instanceof Error ? err.message : "Failed to save")
        }
    }

    async function markAllPresent() {
        const targets = employees.filter((e) => {
            const d = drafts[e.id]
            return d && !d.existing && d.status === "PRESENT"
        })
        if (targets.length === 0) return toast.message("Everyone already has an entry for this day")
        let ok = 0
        for (const emp of targets) {
            try {
                const { error } = await supabase.rpc("hr_mark_attendance" as never, {
                    p_employee_id: emp.id, p_work_date: date, p_status: "PRESENT",
                    p_check_in: null, p_check_out: null, p_worked_minutes: null,
                    p_late_minutes: null, p_overtime_minutes: null, p_notes: null,
                    p_reason: "Bulk mark-present",
                } as never)
                if (!error) ok++
            } catch { /* keep going */ }
        }
        toast.success(`Marked ${ok} present`)
        loadForDate(date)
    }

    const unmarkedCount = useMemo(
        () => employees.filter((e) => !drafts[e.id]?.existing).length,
        [employees, drafts],
    )

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-6xl space-y-6">
            <PageHeader
                kicker="Staff"
                title="Attendance"
                highlight="daily marking"
                description="Mark or correct attendance for any day. Add missing check-in / check-out times for late arrivals, or mark someone present if they forgot to punch in. Every change is recorded in the history."
                actions={
                    <Button variant="outline" onClick={markAllPresent} disabled={loading || isFuture || unmarkedCount === 0}>
                        <Check className="h-4 w-4" /> Mark all present
                    </Button>
                }
            />

            <Card>
                <CardHeader className="flex-row items-center justify-between py-3 space-y-0 flex-wrap gap-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <CalendarDays className="h-4 w-4 text-muted-foreground" />
                        Attendance for
                    </CardTitle>
                    <div className="flex items-center gap-3">
                        {unmarkedCount > 0 && !loading && (
                            <span className="text-xs text-muted-foreground">{unmarkedCount} unmarked</span>
                        )}
                        <Input
                            type="date"
                            value={date}
                            max={todayStr()}
                            onChange={(e) => setDate(e.target.value)}
                            className="h-9 w-44"
                        />
                    </div>
                </CardHeader>
                <CardContent className="px-0">
                    {loading ? (
                        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                        </div>
                    ) : employees.length === 0 ? (
                        <p className="px-6 py-10 text-sm text-muted-foreground text-center">
                            No active employees. Add them on the Employees screen first.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Employee</TableHead>
                                    <TableHead className="w-40">Status</TableHead>
                                    <TableHead className="w-28">In</TableHead>
                                    <TableHead className="w-28">Out</TableHead>
                                    <TableHead className="w-24">Worked</TableHead>
                                    <TableHead>Notes</TableHead>
                                    <TableHead className="text-right w-24">Save</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {employees.map((e) => {
                                    const d = drafts[e.id] ?? emptyDraft()
                                    const showTimes = d.status === "PRESENT" || d.status === "HALF_DAY"
                                    return (
                                        <TableRow key={e.id}>
                                            <TableCell>
                                                <div className="font-medium">{e.full_name}</div>
                                                <div className="text-xs text-muted-foreground">{e.designation ?? e.emp_code ?? ""}</div>
                                            </TableCell>
                                            <TableCell>
                                                <Select value={d.status} onValueChange={(v) => patch(e.id, { status: v as AttendanceStatus })}>
                                                    <SelectTrigger className={cn("h-8 text-xs border", attendanceStatusColor(d.status))}>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {STATUSES.map((s) => (
                                                            <SelectItem key={s} value={s}>{ATTENDANCE_STATUS_LABEL[s]}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </TableCell>
                                            <TableCell>
                                                <Input type="time" value={d.checkIn} disabled={!showTimes}
                                                    onChange={(ev) => patch(e.id, { checkIn: ev.target.value })} className="h-8" />
                                            </TableCell>
                                            <TableCell>
                                                <Input type="time" value={d.checkOut} disabled={!showTimes}
                                                    onChange={(ev) => patch(e.id, { checkOut: ev.target.value })} className="h-8" />
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {showTimes && d.checkIn && d.checkOut ? workedLabel(d) : "—"}
                                            </TableCell>
                                            <TableCell>
                                                <Input value={d.notes} onChange={(ev) => patch(e.id, { notes: ev.target.value })}
                                                    placeholder="Optional" className="h-8" />
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    {d.existing && !d.dirty && (
                                                        <Badge variant="secondary" className="text-[10px]">Saved</Badge>
                                                    )}
                                                    <Button size="sm" variant={d.dirty ? "neon" : "outline"} className="h-8"
                                                        disabled={d.saving} onClick={() => saveOne(e)}>
                                                        {d.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

export default function AttendancePage() {
    return (
        <HrGuard permission="attendance.manage">
            <AttendanceInner />
        </HrGuard>
    )
}
