"use client"

import { useEffect, useMemo, useState } from "react"
import { Building2, Link2, Loader2, Pencil, UserPlus, Users } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/app-shell/page-header"
import { ImageUploader } from "@/components/ui/image-uploader"
import { HrGuard } from "@/components/hr/hr-guard"
import { createClient } from "@/lib/supabase/client"
import { formatDate } from "@/lib/utils"
import type { AppUser, Branch, EmploymentType, HrEmployee, SalaryBasis } from "@/types/database"

const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
    { value: "FULL_TIME", label: "Full-time" },
    { value: "PART_TIME", label: "Part-time" },
    { value: "CONTRACT", label: "Contract" },
    { value: "DAILY_WAGE", label: "Daily wage" },
]
const SALARY_BASES: { value: SalaryBasis; label: string }[] = [
    { value: "MONTHLY", label: "Monthly salary" },
    { value: "DAILY", label: "Daily wage" },
    { value: "HOURLY", label: "Hourly rate" },
]
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const NONE = "__none__"

interface EmpForm {
    id: string | null
    full_name: string
    emp_code: string
    designation: string
    department: string
    phone: string
    email: string
    date_of_joining: string
    employment_type: EmploymentType
    branch_id: string | null
    user_id: string | null
    photo_url: string | null
    salary_basis: SalaryBasis
    base_amount: string
    expected_hours_per_day: string
    weekly_offs: number[]
    is_active: boolean
}
const EMPTY_FORM: EmpForm = {
    id: null, full_name: "", emp_code: "", designation: "", department: "", phone: "", email: "",
    date_of_joining: "", employment_type: "FULL_TIME", branch_id: null, user_id: null, photo_url: null,
    salary_basis: "MONTHLY", base_amount: "", expected_hours_per_day: "9", weekly_offs: [0], is_active: true,
}

function empPhotoPath(tenantId: string): string {
    const stamp = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36)
    return `${tenantId}/employees/photo-${stamp}.jpg`
}

function EmployeesInner() {
    const supabase = createClient()
    const [tenantId, setTenantId] = useState("")
    const [employees, setEmployees] = useState<HrEmployee[]>([])
    const [branches, setBranches] = useState<Branch[]>([])
    const [users, setUsers] = useState<AppUser[]>([])
    const [showInactive, setShowInactive] = useState(false)
    const [loading, setLoading] = useState(true)

    const [open, setOpen] = useState(false)
    const [form, setForm] = useState<EmpForm>(EMPTY_FORM)
    const [saving, setSaving] = useState(false)

    async function refresh() {
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) return
        const { data: me } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle() as { data: { tenant_id: string | null } | null }
        if (!me?.tenant_id) return
        setTenantId(me.tenant_id)
        const [{ data: emps }, { data: brs }, { data: us }] = await Promise.all([
            supabase.from("hr_employees").select("*").order("is_active", { ascending: false }).order("full_name"),
            supabase.from("branches").select("*").eq("is_active", true).order("name"),
            supabase.from("users").select("id, full_name, email, is_active").order("full_name"),
        ])
        setEmployees((emps ?? []) as HrEmployee[])
        setBranches((brs ?? []) as Branch[])
        setUsers((us ?? []) as AppUser[])
        setLoading(false)
    }
    useEffect(() => { refresh() }, [])

    const branchName = (id: string | null) => id ? branches.find((b) => b.id === id)?.name ?? "—" : "—"
    const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])

    const visible = employees.filter((e) => showInactive || e.is_active)
    const inactiveCount = employees.filter((e) => !e.is_active).length

    function openCreate() {
        setForm({ ...EMPTY_FORM, branch_id: branches.length === 1 ? branches[0]!.id : null })
        setOpen(true)
    }
    function openEdit(e: HrEmployee) {
        setForm({
            id: e.id,
            full_name: e.full_name,
            emp_code: e.emp_code ?? "",
            designation: e.designation ?? "",
            department: e.department ?? "",
            phone: e.phone ?? "",
            email: e.email ?? "",
            date_of_joining: e.date_of_joining ?? "",
            employment_type: e.employment_type,
            branch_id: e.branch_id,
            user_id: e.user_id,
            photo_url: e.photo_url,
            salary_basis: e.salary_basis ?? "MONTHLY",
            base_amount: e.base_amount != null ? String(e.base_amount) : "",
            expected_hours_per_day: e.expected_hours_per_day != null ? String(e.expected_hours_per_day) : "9",
            weekly_offs: e.weekly_offs ?? [0],
            is_active: e.is_active,
        })
        setOpen(true)
    }

    function toggleWeeklyOff(day: number) {
        setForm((f) => ({
            ...f,
            weekly_offs: f.weekly_offs.includes(day)
                ? f.weekly_offs.filter((d) => d !== day)
                : [...f.weekly_offs, day].sort(),
        }))
    }

    async function save(e: React.FormEvent) {
        e.preventDefault()
        if (!form.full_name.trim()) return toast.error("Employee name is required")
        if (branches.length >= 2 && !form.branch_id) return toast.error("Pick a branch for this employee")
        setSaving(true)
        try {
            const { data, error } = await supabase.rpc("hr_upsert_employee" as never, {
                p_id: form.id,
                p_full_name: form.full_name.trim(),
                p_emp_code: form.emp_code.trim() || null,
                p_phone: form.phone.trim() || null,
                p_email: form.email.trim() || null,
                p_designation: form.designation.trim() || null,
                p_department: form.department.trim() || null,
                p_date_of_joining: form.date_of_joining || null,
                p_employment_type: form.employment_type,
                p_branch_id: branches.length > 0 ? form.branch_id : null,
                p_user_id: form.user_id,
                p_photo_url: form.photo_url,
                p_salary_basis: form.salary_basis,
                p_base_amount: form.base_amount ? Number(form.base_amount) : null,
                p_expected_hours_per_day: form.expected_hours_per_day ? Number(form.expected_hours_per_day) : null,
                p_weekly_offs: form.weekly_offs,
                p_is_active: form.is_active,
            } as never)
            if (error) throw new Error(error.message)
            const res = data as { ok?: boolean } | null
            if (!res?.ok) throw new Error("Failed to save employee")
            toast.success(form.id ? "Employee updated" : "Employee added")
            setOpen(false)
            refresh()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to save employee")
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-6xl space-y-6">
            <PageHeader
                kicker="Staff"
                title="Employees"
                highlight="payroll roster"
                description="The full roster used for attendance and payroll. Unlike login accounts, you can add as many employees here as you need — including people who never sign in."
                actions={
                    <Button variant="neon" onClick={openCreate}>
                        <UserPlus className="h-4 w-4" /> Add employee
                    </Button>
                }
            />

            <Card>
                <CardHeader className="flex-row items-center justify-between py-3 space-y-0 flex-wrap gap-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        {showInactive ? "All employees" : "Active employees"}
                        <span className="text-xs font-normal text-muted-foreground">· {visible.length}</span>
                    </CardTitle>
                    {inactiveCount > 0 && (
                        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                            <Switch checked={showInactive} onCheckedChange={setShowInactive} />
                            Show inactive ({inactiveCount})
                        </label>
                    )}
                </CardHeader>
                <CardContent className="px-0">
                    {loading ? (
                        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                        </div>
                    ) : visible.length === 0 ? (
                        <p className="px-6 py-10 text-sm text-muted-foreground text-center">
                            No employees yet. Click <strong>Add employee</strong> to build your roster.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-12" />
                                    <TableHead>Name</TableHead>
                                    <TableHead>Code</TableHead>
                                    <TableHead>Designation</TableHead>
                                    {branches.length >= 2 && <TableHead>Branch</TableHead>}
                                    <TableHead>Type</TableHead>
                                    <TableHead>Login</TableHead>
                                    <TableHead>Joined</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right w-16">Edit</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {visible.map((e) => (
                                    <TableRow key={e.id} className={e.is_active ? undefined : "opacity-60"}>
                                        <TableCell>
                                            {e.photo_url
                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                ? <img src={e.photo_url} alt="" className="h-8 w-8 rounded-full object-cover border border-border/60" />
                                                : <div className="h-8 w-8 rounded-full bg-muted grid place-items-center text-xs font-semibold">{e.full_name.slice(0, 1).toUpperCase()}</div>}
                                        </TableCell>
                                        <TableCell className="font-medium">{e.full_name}</TableCell>
                                        <TableCell className="text-sm text-muted-foreground">{e.emp_code ?? "—"}</TableCell>
                                        <TableCell className="text-sm">{e.designation ?? "—"}</TableCell>
                                        {branches.length >= 2 && (
                                            <TableCell className="text-sm">
                                                <span className="inline-flex items-center gap-1">
                                                    <Building2 className="h-3 w-3 text-muted-foreground" />{branchName(e.branch_id)}
                                                </span>
                                            </TableCell>
                                        )}
                                        <TableCell>
                                            <Badge variant="outline" className="text-[10px]">
                                                {EMPLOYMENT_TYPES.find((t) => t.value === e.employment_type)?.label ?? e.employment_type}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            {e.user_id ? (
                                                <span className="inline-flex items-center gap-1 text-success" title="Can self-punch & download own slips">
                                                    <Link2 className="h-3 w-3" />
                                                    {userById.get(e.user_id)?.full_name ?? userById.get(e.user_id)?.email ?? "Linked"}
                                                </span>
                                            ) : <span className="text-muted-foreground text-xs">—</span>}
                                        </TableCell>
                                        <TableCell className="text-sm">{e.date_of_joining ? formatDate(e.date_of_joining, { dateStyle: "medium" }) : "—"}</TableCell>
                                        <TableCell>
                                            <Badge variant={e.is_active ? "secondary" : "outline"} className="text-[10px]">
                                                {e.is_active ? "Active" : "Inactive"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(e)} title="Edit">
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader><DialogTitle>{form.id ? "Edit employee" : "Add employee"}</DialogTitle></DialogHeader>
                    <form onSubmit={save} className="space-y-4">
                        <div className="flex items-start gap-4">
                            <ImageUploader
                                label="Photo"
                                value={form.photo_url}
                                onChange={(url) => setForm({ ...form, photo_url: url })}
                                bucket="user-avatars"
                                path={empPhotoPath(tenantId)}
                                size={88}
                            />
                            <div className="flex-1 grid sm:grid-cols-2 gap-3">
                                <div className="space-y-1.5 sm:col-span-2">
                                    <Label>Full name *</Label>
                                    <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Karan Sharma" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Employee code</Label>
                                    <Input value={form.emp_code} onChange={(e) => setForm({ ...form, emp_code: e.target.value })} placeholder="EMP-001" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Designation</Label>
                                    <Input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="Chef" />
                                </div>
                            </div>
                        </div>

                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Department</Label>
                                <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Kitchen" />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Employment type</Label>
                                <Select value={form.employment_type} onValueChange={(v) => setForm({ ...form, employment_type: v as EmploymentType })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {EMPLOYMENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Phone</Label>
                                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 ..." />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Email</Label>
                                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Date of joining</Label>
                                <Input type="date" value={form.date_of_joining} onChange={(e) => setForm({ ...form, date_of_joining: e.target.value })} max={new Date().toISOString().slice(0, 10)} />
                            </div>
                            {branches.length >= 2 && (
                                <div className="space-y-1.5">
                                    <Label>Branch *</Label>
                                    <Select value={form.branch_id ?? ""} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
                                        <SelectTrigger><SelectValue placeholder="Pick a branch" /></SelectTrigger>
                                        <SelectContent>
                                            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            <div className="space-y-1.5 sm:col-span-2">
                                <Label>Link to a login account (optional)</Label>
                                <Select value={form.user_id ?? NONE} onValueChange={(v) => setForm({ ...form, user_id: v === NONE ? null : v })}>
                                    <SelectTrigger><SelectValue placeholder="Not linked" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={NONE}>Not linked (admin marks attendance)</SelectItem>
                                        {users.filter((u) => u.is_active !== false).map((u) => (
                                            <SelectItem key={u.id} value={u.id}>{u.full_name ?? u.email}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-[11px] text-muted-foreground">
                                    Linking lets this employee punch in/out themselves and download their own salary slips.
                                </p>
                            </div>
                        </div>

                        {/* ── Payroll (used by the salary engine in Phase 2) ── */}
                        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Payroll</div>
                            <div className="grid sm:grid-cols-3 gap-3">
                                <div className="space-y-1.5">
                                    <Label>Salary basis</Label>
                                    <Select value={form.salary_basis} onValueChange={(v) => setForm({ ...form, salary_basis: v as SalaryBasis })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {SALARY_BASES.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label>
                                        {form.salary_basis === "MONTHLY" ? "Monthly amount" : form.salary_basis === "DAILY" ? "Daily rate" : "Hourly rate"}
                                    </Label>
                                    <Input type="number" min="0" step="0.01" value={form.base_amount} onChange={(e) => setForm({ ...form, base_amount: e.target.value })} placeholder="0.00" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Hours / day</Label>
                                    <Input type="number" min="0" step="0.5" value={form.expected_hours_per_day} onChange={(e) => setForm({ ...form, expected_hours_per_day: e.target.value })} />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Weekly offs</Label>
                                <div className="flex flex-wrap gap-1.5">
                                    {WEEKDAYS.map((d, i) => (
                                        <Button
                                            key={d}
                                            type="button"
                                            size="sm"
                                            variant={form.weekly_offs.includes(i) ? "neon" : "outline"}
                                            className="h-7 px-2.5 text-xs"
                                            onClick={() => toggleWeeklyOff(i)}
                                        >
                                            {d}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                                Active
                            </label>
                        </div>

                        <DialogFooter>
                            <Button type="submit" variant="neon" disabled={saving}>
                                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                                {form.id ? "Save changes" : "Add employee"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}

export default function EmployeesPage() {
    return (
        <HrGuard permission="attendance.manage">
            <EmployeesInner />
        </HrGuard>
    )
}
