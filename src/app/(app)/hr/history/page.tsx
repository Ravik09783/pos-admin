"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { History, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/app-shell/page-header"
import { HrGuard } from "@/components/hr/hr-guard"
import { createClient } from "@/lib/supabase/client"
import { ATTENDANCE_STATUS_LABEL } from "@/lib/hr/attendance"
import { formatDate } from "@/lib/utils"
import type { AttendanceAuditAction, AttendanceStatus, HrEmployee } from "@/types/database"

const ALL = "__all__"

interface AuditRow {
    id: string
    employee_id: string | null
    action: AttendanceAuditAction
    before_state: Record<string, unknown> | null
    after_state: Record<string, unknown> | null
    reason: string | null
    created_at: string
    employee: { full_name: string } | { full_name: string }[] | null
    changed_by_user: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null
}

const ACTION_VARIANT: Record<AttendanceAuditAction, "secondary" | "success" | "warning" | "outline" | "destructive"> = {
    PUNCH_IN: "success",
    PUNCH_OUT: "secondary",
    CREATE: "success",
    UPDATE: "warning",
    DELETE: "destructive",
}
const ACTION_LABEL: Record<AttendanceAuditAction, string> = {
    PUNCH_IN: "Punch in",
    PUNCH_OUT: "Punch out",
    CREATE: "Created",
    UPDATE: "Updated",
    DELETE: "Deleted",
}

function one<T>(v: T | T[] | null): T | null {
    if (v == null) return null
    return Array.isArray(v) ? (v[0] ?? null) : v
}
function statusOf(state: Record<string, unknown> | null): AttendanceStatus | null {
    const s = state?.status
    return typeof s === "string" ? (s as AttendanceStatus) : null
}

function HistoryInner() {
    const supabase = createClient()
    const [employees, setEmployees] = useState<HrEmployee[]>([])
    const [empFilter, setEmpFilter] = useState<string>(ALL)
    const [rows, setRows] = useState<AuditRow[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        supabase.from("hr_employees").select("*").order("full_name").then(({ data }) => {
            setEmployees((data ?? []) as HrEmployee[])
        })
    }, [supabase])

    const load = useCallback(async (emp: string) => {
        setLoading(true)
        let q = supabase
            .from("hr_attendance_audit")
            .select("id, employee_id, action, before_state, after_state, reason, created_at, employee:hr_employees(full_name), changed_by_user:users!hr_attendance_audit_changed_by_fkey(full_name, email)")
            .order("created_at", { ascending: false })
            .limit(300)
        if (emp !== ALL) q = q.eq("employee_id", emp)
        const { data } = await q
        setRows((data ?? []) as unknown as AuditRow[])
        setLoading(false)
    }, [supabase])

    useEffect(() => { load(empFilter) }, [empFilter, load])

    const describe = useMemo(() => (r: AuditRow): string => {
        const before = statusOf(r.before_state)
        const after = statusOf(r.after_state)
        if (r.action === "UPDATE" && before && after && before !== after) {
            return `${ATTENDANCE_STATUS_LABEL[before]} → ${ATTENDANCE_STATUS_LABEL[after]}`
        }
        if (after) return ATTENDANCE_STATUS_LABEL[after]
        if (before) return ATTENDANCE_STATUS_LABEL[before]
        return "—"
    }, [])

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-5xl space-y-6">
            <PageHeader
                kicker="Staff"
                title="Attendance history"
                highlight="audit trail"
                description="Every attendance change — punches, admin corrections, and deletions — with who made it and why. This log is append-only and can't be edited."
            />

            <Card>
                <CardHeader className="flex-row items-center justify-between py-3 space-y-0 flex-wrap gap-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <History className="h-4 w-4 text-muted-foreground" /> Change log
                    </CardTitle>
                    <Select value={empFilter} onValueChange={setEmpFilter}>
                        <SelectTrigger className="h-9 w-56 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>All employees</SelectItem>
                            {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </CardHeader>
                <CardContent className="px-0">
                    {loading ? (
                        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                        </div>
                    ) : rows.length === 0 ? (
                        <p className="px-6 py-10 text-sm text-muted-foreground text-center">No changes recorded yet.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-44">When</TableHead>
                                    <TableHead>Employee</TableHead>
                                    <TableHead className="w-28">Action</TableHead>
                                    <TableHead>Change</TableHead>
                                    <TableHead>By</TableHead>
                                    <TableHead>Reason</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map((r) => {
                                    const emp = one(r.employee)
                                    const by = one(r.changed_by_user)
                                    return (
                                        <TableRow key={r.id}>
                                            <TableCell className="text-xs text-muted-foreground">
                                                {formatDate(r.created_at, { dateStyle: "medium", timeStyle: "short" })}
                                            </TableCell>
                                            <TableCell className="text-sm font-medium">{emp?.full_name ?? "—"}</TableCell>
                                            <TableCell>
                                                <Badge variant={ACTION_VARIANT[r.action]} className="text-[10px]">{ACTION_LABEL[r.action]}</Badge>
                                            </TableCell>
                                            <TableCell className="text-sm">{describe(r)}</TableCell>
                                            <TableCell className="text-sm text-muted-foreground">{by?.full_name ?? by?.email ?? "—"}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground">{r.reason ?? "—"}</TableCell>
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

export default function HistoryPage() {
    return (
        <HrGuard permission="attendance.manage">
            <HistoryInner />
        </HrGuard>
    )
}
