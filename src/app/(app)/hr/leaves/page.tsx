"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarOff, Check, Loader2, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/app-shell/page-header"
import { HrGuard } from "@/components/hr/hr-guard"
import { createClient } from "@/lib/supabase/client"
import { formatDate } from "@/lib/utils"
import type { HrEmployee, HrHoliday, HrLeave, HrLeaveType, LeaveStatus } from "@/types/database"

interface LeaveRow extends HrLeave {
    employee: { full_name: string } | { full_name: string }[] | null
    leave_type: { name: string; is_paid: boolean } | { name: string; is_paid: boolean }[] | null
}
function one<T>(v: T | T[] | null): T | null {
    return v == null ? null : Array.isArray(v) ? (v[0] ?? null) : v
}
const LEAVE_VARIANT: Record<LeaveStatus, "warning" | "success" | "destructive" | "secondary"> = {
    PENDING: "warning", APPROVED: "success", REJECTED: "destructive", CANCELLED: "secondary",
}

function LeavesInner() {
    const supabase = createClient()
    const [employees, setEmployees] = useState<HrEmployee[]>([])
    const [types, setTypes] = useState<HrLeaveType[]>([])
    const [leaves, setLeaves] = useState<LeaveRow[]>([])
    const [holidays, setHolidays] = useState<HrHoliday[]>([])
    const [loading, setLoading] = useState(true)

    // Forms
    const [hol, setHol] = useState({ date: "", name: "" })
    const [lt, setLt] = useState({ name: "", is_paid: true, annual_quota: "0" })
    const [lv, setLv] = useState({ employee_id: "", leave_type_id: "", from_date: "", to_date: "", reason: "" })
    const [busy, setBusy] = useState(false)

    const refresh = useCallback(async () => {
        const [{ data: emps }, { data: tps }, { data: lvs }, { data: hols }] = await Promise.all([
            supabase.from("hr_employees").select("*").eq("is_active", true).order("full_name"),
            supabase.from("hr_leave_types").select("*").order("name"),
            supabase.from("hr_leaves").select("*, employee:hr_employees(full_name), leave_type:hr_leave_types(name, is_paid)").order("created_at", { ascending: false }).limit(200),
            supabase.from("hr_holidays").select("*").order("holiday_date", { ascending: false }),
        ])
        setEmployees((emps ?? []) as HrEmployee[])
        setTypes((tps ?? []) as HrLeaveType[])
        setLeaves((lvs ?? []) as unknown as LeaveRow[])
        setHolidays((hols ?? []) as HrHoliday[])
        setLoading(false)
    }, [supabase])
    useEffect(() => { refresh() }, [refresh])

    const activeTypes = useMemo(() => types.filter((t) => t.is_active), [types])

    async function addHoliday() {
        if (!hol.date || !hol.name.trim()) return toast.error("Date and name required")
        setBusy(true)
        const { error } = await supabase.rpc("hr_upsert_holiday" as never, { p_id: null, p_holiday_date: hol.date, p_name: hol.name.trim(), p_branch_id: null } as never)
        setBusy(false)
        if (error) return toast.error(error.message)
        setHol({ date: "", name: "" })
        toast.success("Holiday added")
        refresh()
    }
    async function delHoliday(id: string) {
        const { error } = await supabase.rpc("hr_delete_holiday" as never, { p_id: id } as never)
        if (error) return toast.error(error.message)
        refresh()
    }

    async function addType() {
        if (!lt.name.trim()) return toast.error("Name required")
        setBusy(true)
        const { error } = await supabase.rpc("hr_upsert_leave_type" as never, {
            p_id: null, p_name: lt.name.trim(), p_is_paid: lt.is_paid, p_annual_quota: Number(lt.annual_quota) || 0, p_is_active: true,
        } as never)
        setBusy(false)
        if (error) return toast.error(error.message)
        setLt({ name: "", is_paid: true, annual_quota: "0" })
        toast.success("Leave type added")
        refresh()
    }
    async function toggleType(t: HrLeaveType) {
        const { error } = await supabase.rpc("hr_upsert_leave_type" as never, {
            p_id: t.id, p_name: t.name, p_is_paid: t.is_paid, p_annual_quota: t.annual_quota, p_is_active: !t.is_active,
        } as never)
        if (error) return toast.error(error.message)
        refresh()
    }

    async function recordLeave() {
        if (!lv.employee_id || !lv.from_date || !lv.to_date) return toast.error("Employee and dates required")
        setBusy(true)
        const { error } = await supabase.rpc("hr_record_leave" as never, {
            p_employee_id: lv.employee_id, p_leave_type_id: lv.leave_type_id || null,
            p_from_date: lv.from_date, p_to_date: lv.to_date, p_reason: lv.reason.trim() || null,
        } as never)
        setBusy(false)
        if (error) return toast.error(error.message)
        setLv({ employee_id: "", leave_type_id: "", from_date: "", to_date: "", reason: "" })
        toast.success("Leave recorded")
        refresh()
    }
    async function decide(id: string, status: LeaveStatus) {
        const { error } = await supabase.rpc("hr_decide_leave" as never, { p_leave_id: id, p_status: status } as never)
        if (error) return toast.error(error.message)
        toast.success(`Leave ${status.toLowerCase()}`)
        refresh()
    }

    if (loading) {
        return <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-5xl space-y-6">
            <PageHeader
                kicker="Staff"
                title="Leave & holidays"
                highlight="time off"
                description="Record staff leave and approve it — approved paid leave is written to attendance and counts as a payable day. Company holidays reduce the working-day count used in payroll."
            />

            {/* ── Record leave ── */}
            <Card>
                <CardHeader className="py-3"><CardTitle className="text-base">Record a leave</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                    <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
                        <div className="space-y-1.5 lg:col-span-1">
                            <Label>Employee</Label>
                            <Select value={lv.employee_id} onValueChange={(v) => setLv({ ...lv, employee_id: v })}>
                                <SelectTrigger><SelectValue placeholder="Pick" /></SelectTrigger>
                                <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Type</Label>
                            <Select value={lv.leave_type_id} onValueChange={(v) => setLv({ ...lv, leave_type_id: v })}>
                                <SelectTrigger><SelectValue placeholder="Pick" /></SelectTrigger>
                                <SelectContent>{activeTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}{t.is_paid ? "" : " (unpaid)"}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5"><Label>From</Label><Input type="date" value={lv.from_date} onChange={(e) => setLv({ ...lv, from_date: e.target.value })} /></div>
                        <div className="space-y-1.5"><Label>To</Label><Input type="date" value={lv.to_date} min={lv.from_date} onChange={(e) => setLv({ ...lv, to_date: e.target.value })} /></div>
                        <div className="space-y-1.5 flex flex-col">
                            <Label>Reason</Label>
                            <div className="flex gap-2">
                                <Input value={lv.reason} onChange={(e) => setLv({ ...lv, reason: e.target.value })} placeholder="Optional" />
                                <Button variant="neon" disabled={busy} onClick={recordLeave}><Plus className="h-4 w-4" /></Button>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* ── Leaves list ── */}
            <Card>
                <CardHeader className="py-3"><CardTitle className="text-base">Leave requests</CardTitle></CardHeader>
                <CardContent className="px-0">
                    {leaves.length === 0 ? (
                        <p className="px-6 py-8 text-sm text-muted-foreground text-center">No leaves recorded.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Employee</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Dates</TableHead>
                                    <TableHead className="text-center">Days</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right w-28">Decide</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {leaves.map((l) => {
                                    const emp = one(l.employee)
                                    const lty = one(l.leave_type)
                                    return (
                                        <TableRow key={l.id}>
                                            <TableCell className="font-medium">{emp?.full_name ?? "—"}</TableCell>
                                            <TableCell className="text-sm">{lty?.name ?? "—"}{lty && !lty.is_paid ? <span className="text-xs text-muted-foreground"> · unpaid</span> : null}</TableCell>
                                            <TableCell className="text-sm">{formatDate(l.from_date, { dateStyle: "medium" })} – {formatDate(l.to_date, { dateStyle: "medium" })}</TableCell>
                                            <TableCell className="text-center text-sm">{l.days}</TableCell>
                                            <TableCell><Badge variant={LEAVE_VARIANT[l.status]} className="text-[10px]">{l.status}</Badge></TableCell>
                                            <TableCell className="text-right">
                                                {l.status === "PENDING" ? (
                                                    <div className="flex items-center gap-1 justify-end">
                                                        <Button size="icon" variant="ghost" className="h-7 w-7 text-success" title="Approve" onClick={() => decide(l.id, "APPROVED")}><Check className="h-3.5 w-3.5" /></Button>
                                                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Reject" onClick={() => decide(l.id, "REJECTED")}><X className="h-3.5 w-3.5" /></Button>
                                                    </div>
                                                ) : <span className="text-xs text-muted-foreground">—</span>}
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-6">
                {/* ── Holidays ── */}
                <Card>
                    <CardHeader className="py-3"><CardTitle className="text-base flex items-center gap-2"><CalendarOff className="h-4 w-4 text-muted-foreground" /> Holidays</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex items-end gap-2">
                            <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={hol.date} onChange={(e) => setHol({ ...hol, date: e.target.value })} className="w-40" /></div>
                            <div className="space-y-1.5 flex-1"><Label>Name</Label><Input value={hol.name} onChange={(e) => setHol({ ...hol, name: e.target.value })} placeholder="Diwali" /></div>
                            <Button variant="neon" disabled={busy} onClick={addHoliday}><Plus className="h-4 w-4" /></Button>
                        </div>
                        {holidays.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2">No holidays added.</p>
                        ) : (
                            <ul className="divide-y divide-border/60">
                                {holidays.map((h) => (
                                    <li key={h.id} className="flex items-center justify-between py-2">
                                        <div>
                                            <span className="text-sm font-medium">{h.name}</span>
                                            <span className="text-xs text-muted-foreground ml-2">{formatDate(h.holiday_date, { dateStyle: "medium" })}</span>
                                        </div>
                                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => delHoliday(h.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>

                {/* ── Leave types ── */}
                <Card>
                    <CardHeader className="py-3"><CardTitle className="text-base">Leave types</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex items-end gap-2">
                            <div className="space-y-1.5 flex-1"><Label>Name</Label><Input value={lt.name} onChange={(e) => setLt({ ...lt, name: e.target.value })} placeholder="Maternity" /></div>
                            <div className="space-y-1.5"><Label>Quota</Label><Input type="number" min="0" value={lt.annual_quota} onChange={(e) => setLt({ ...lt, annual_quota: e.target.value })} className="w-20" /></div>
                            <label className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground"><span>Paid</span><Switch checked={lt.is_paid} onCheckedChange={(v) => setLt({ ...lt, is_paid: v })} /></label>
                            <Button variant="neon" disabled={busy} onClick={addType}><Plus className="h-4 w-4" /></Button>
                        </div>
                        <ul className="divide-y divide-border/60">
                            {types.map((t) => (
                                <li key={t.id} className="flex items-center justify-between py-2">
                                    <div className="flex items-center gap-2">
                                        <span className={t.is_active ? "text-sm font-medium" : "text-sm font-medium line-through text-muted-foreground"}>{t.name}</span>
                                        <Badge variant={t.is_paid ? "secondary" : "outline"} className="text-[10px]">{t.is_paid ? "Paid" : "Unpaid"}</Badge>
                                        {t.annual_quota > 0 && <span className="text-[11px] text-muted-foreground">{t.annual_quota}/yr</span>}
                                    </div>
                                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                                        <Switch checked={t.is_active} onCheckedChange={() => toggleType(t)} /> Active
                                    </label>
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

export default function LeavesPage() {
    return (
        <HrGuard permission="attendance.manage">
            <LeavesInner />
        </HrGuard>
    )
}
