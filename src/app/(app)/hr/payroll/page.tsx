"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Calculator, Download, Loader2, Lock, Plus, Trash2, Wallet, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/app-shell/page-header"
import { HrGuard } from "@/components/hr/hr-guard"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency } from "@/lib/utils"
import { migratePayslipDesign, downloadPayslip, fetchLogo } from "@/lib/hr/payslip"
import type {
    HrEmployee, HrPayslip, PayslipStatus, SalaryBasis, SalaryComponent, Tenant,
} from "@/types/database"

const SALARY_BASES: { value: SalaryBasis; label: string }[] = [
    { value: "MONTHLY", label: "Monthly" },
    { value: "DAILY", label: "Daily wage" },
    { value: "HOURLY", label: "Hourly" },
]
function currentMonth(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}
const STATUS_VARIANT: Record<PayslipStatus, "secondary" | "success" | "warning"> = {
    DRAFT: "warning", FINALIZED: "success", PAID: "success",
}

interface SalaryForm {
    salary_basis: SalaryBasis
    base_amount: string
    expected_hours_per_day: string
    earnings: SalaryComponent[]
    deductions: SalaryComponent[]
    bank_name: string
    bank_account: string
    bank_ifsc: string
    pan: string
}

function PayrollInner() {
    const supabase = createClient()
    const [tenant, setTenant] = useState<Tenant | null>(null)
    const [employees, setEmployees] = useState<HrEmployee[]>([])
    const [slips, setSlips] = useState<HrPayslip[]>([])
    const [month, setMonth] = useState(currentMonth())
    const [loading, setLoading] = useState(true)
    const [busyId, setBusyId] = useState<string | null>(null)
    const [bulkBusy, setBulkBusy] = useState(false)

    const [editEmp, setEditEmp] = useState<HrEmployee | null>(null)
    const [form, setForm] = useState<SalaryForm | null>(null)
    const [savingSalary, setSavingSalary] = useState(false)

    const periodFirst = `${month}-01`
    const money = (v: number) => formatCurrency(v, tenant?.currency ?? "INR")

    const loadSlips = useCallback(async (m: string) => {
        const { data } = await supabase.from("hr_payslips").select("*").eq("period_month", `${m}-01`)
        setSlips((data ?? []) as HrPayslip[])
    }, [supabase])

    const refresh = useCallback(async () => {
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) return
        const { data: me } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle() as { data: { tenant_id: string | null } | null }
        if (!me?.tenant_id) return
        const [{ data: t }, { data: emps }] = await Promise.all([
            supabase.from("tenants").select("*").eq("id", me.tenant_id).maybeSingle(),
            supabase.from("hr_employees").select("*").eq("is_active", true).order("full_name"),
        ])
        setTenant(t as Tenant)
        setEmployees((emps ?? []) as HrEmployee[])
        await loadSlips(month)
        setLoading(false)
    }, [supabase, month, loadSlips])

    useEffect(() => { refresh() }, [refresh])
    useEffect(() => { if (!loading) loadSlips(month) }, [month, loadSlips, loading])

    const slipByEmp = useMemo(() => new Map(slips.map((s) => [s.employee_id, s])), [slips])
    const design = useMemo(
        () => migratePayslipDesign((tenant?.settings as { payslip_design?: Record<string, unknown> } | null)?.payslip_design),
        [tenant],
    )

    function openSalary(e: HrEmployee) {
        setEditEmp(e)
        setForm({
            salary_basis: e.salary_basis ?? "MONTHLY",
            base_amount: e.base_amount != null ? String(e.base_amount) : "",
            expected_hours_per_day: e.expected_hours_per_day != null ? String(e.expected_hours_per_day) : "9",
            earnings: e.earnings ?? [],
            deductions: e.deductions ?? [],
            bank_name: e.bank_name ?? "",
            bank_account: e.bank_account ?? "",
            bank_ifsc: e.bank_ifsc ?? "",
            pan: e.pan ?? "",
        })
    }

    async function saveSalary() {
        if (!editEmp || !form) return
        setSavingSalary(true)
        try {
            const clean = (arr: SalaryComponent[]) => arr
                .filter((c) => c.name.trim() && Number(c.amount) > 0)
                .map((c) => ({ name: c.name.trim(), type: c.type, amount: Number(c.amount) }))
            const { error } = await supabase.rpc("hr_set_salary_structure" as never, {
                p_employee_id: editEmp.id,
                p_salary_basis: form.salary_basis,
                p_base_amount: form.base_amount ? Number(form.base_amount) : null,
                p_expected_hours_per_day: form.expected_hours_per_day ? Number(form.expected_hours_per_day) : null,
                p_earnings: clean(form.earnings),
                p_deductions: clean(form.deductions),
                p_bank_name: form.bank_name.trim() || null,
                p_bank_account: form.bank_account.trim() || null,
                p_bank_ifsc: form.bank_ifsc.trim() || null,
                p_pan: form.pan.trim() || null,
            } as never)
            if (error) throw new Error(error.message)
            toast.success("Salary structure saved")
            setEditEmp(null)
            refresh()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to save")
        } finally {
            setSavingSalary(false)
        }
    }

    async function generate(empId: string) {
        setBusyId(empId)
        try {
            const { error } = await supabase.rpc("hr_generate_payslip" as never, { p_employee_id: empId, p_period: periodFirst } as never)
            if (error) throw new Error(error.message)
            await loadSlips(month)
            toast.success("Payslip generated")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to generate")
        } finally {
            setBusyId(null)
        }
    }

    async function generateAll() {
        setBulkBusy(true)
        let ok = 0
        for (const e of employees) {
            if (slipByEmp.get(e.id)?.status && slipByEmp.get(e.id)?.status !== "DRAFT") continue
            const { error } = await supabase.rpc("hr_generate_payslip" as never, { p_employee_id: e.id, p_period: periodFirst } as never)
            if (!error) ok++
        }
        await loadSlips(month)
        setBulkBusy(false)
        toast.success(`Generated ${ok} payslip${ok === 1 ? "" : "s"}`)
    }

    async function setStatus(slip: HrPayslip, status: PayslipStatus) {
        const { error } = await supabase.rpc("hr_finalize_payslip" as never, { p_id: slip.id, p_status: status } as never)
        if (error) return toast.error(error.message)
        await loadSlips(month)
        toast.success(status === "DRAFT" ? "Unlocked" : `Marked ${status.toLowerCase()}`)
    }

    async function download(emp: HrEmployee, slip: HrPayslip) {
        if (!tenant) return
        const logo = design.show_logo ? await fetchLogo(tenant.logo_url) : null
        downloadPayslip({
            tenant: {
                name: tenant.name,
                currency: tenant.currency,
                gstin: tenant.gstin,
                addressLines: [tenant.address_line1 ?? "", tenant.address_line2 ?? "", [tenant.city, tenant.state, tenant.pincode].filter(Boolean).join(" ")],
            },
            employee: emp,
            payslip: slip,
            design,
            logo,
        })
    }

    function updateComp(kind: "earnings" | "deductions", idx: number, patch: Partial<SalaryComponent>) {
        setForm((f) => f ? { ...f, [kind]: f[kind].map((c, i) => i === idx ? { ...c, ...patch } : c) } : f)
    }
    function addComp(kind: "earnings" | "deductions") {
        setForm((f) => f ? { ...f, [kind]: [...f[kind], { name: "", type: "fixed", amount: 0 }] } : f)
    }
    function removeComp(kind: "earnings" | "deductions", idx: number) {
        setForm((f) => f ? { ...f, [kind]: f[kind].filter((_, i) => i !== idx) } : f)
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-6xl space-y-6">
            <PageHeader
                kicker="Staff"
                title="Payroll"
                highlight="salaries & payslips"
                description="Set each employee's salary structure, then generate monthly payslips from their attendance. Finalise a slip to lock it; employees can download finalised slips themselves."
                actions={
                    <Button variant="neon" onClick={generateAll} disabled={loading || bulkBusy || employees.length === 0}>
                        {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
                        Generate all
                    </Button>
                }
            />

            <Card>
                <CardHeader className="flex-row items-center justify-between py-3 space-y-0 flex-wrap gap-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Wallet className="h-4 w-4 text-muted-foreground" /> Payroll for
                    </CardTitle>
                    <Input type="month" value={month} max={currentMonth()} onChange={(e) => setMonth(e.target.value)} className="h-9 w-40" />
                </CardHeader>
                <CardContent className="px-0">
                    {loading ? (
                        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                        </div>
                    ) : employees.length === 0 ? (
                        <p className="px-6 py-10 text-sm text-muted-foreground text-center">No active employees.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Employee</TableHead>
                                    <TableHead>Basis</TableHead>
                                    <TableHead className="text-right">Base</TableHead>
                                    <TableHead className="text-right">Net pay</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right w-[260px]">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {employees.map((e) => {
                                    const slip = slipByEmp.get(e.id)
                                    const locked = slip && slip.status !== "DRAFT"
                                    return (
                                        <TableRow key={e.id}>
                                            <TableCell>
                                                <div className="font-medium">{e.full_name}</div>
                                                <div className="text-xs text-muted-foreground">{e.designation ?? e.emp_code ?? ""}</div>
                                            </TableCell>
                                            <TableCell className="text-sm">{SALARY_BASES.find((b) => b.value === (e.salary_basis ?? "MONTHLY"))?.label}</TableCell>
                                            <TableCell className="text-right text-sm">{e.base_amount != null ? money(e.base_amount) : "—"}</TableCell>
                                            <TableCell className="text-right font-medium">{slip ? money(slip.net_pay) : "—"}</TableCell>
                                            <TableCell>
                                                {slip ? <Badge variant={STATUS_VARIANT[slip.status]} className="text-[10px]">{slip.status}</Badge>
                                                    : <span className="text-xs text-muted-foreground">Not generated</span>}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center gap-1 justify-end flex-wrap">
                                                    <Button size="sm" variant="ghost" className="h-8" onClick={() => openSalary(e)}>Salary</Button>
                                                    <Button size="sm" variant="outline" className="h-8" disabled={busyId === e.id || Boolean(locked)} onClick={() => generate(e.id)}>
                                                        {busyId === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calculator className="h-3.5 w-3.5" />}
                                                        {slip ? "Re-gen" : "Generate"}
                                                    </Button>
                                                    {slip && (
                                                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Download PDF" onClick={() => download(e, slip)}>
                                                            <Download className="h-3.5 w-3.5" />
                                                        </Button>
                                                    )}
                                                    {slip && slip.status === "DRAFT" && (
                                                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Finalise" onClick={() => setStatus(slip, "FINALIZED")}>
                                                            <Lock className="h-3.5 w-3.5" />
                                                        </Button>
                                                    )}
                                                    {slip && slip.status !== "DRAFT" && (
                                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" title="Unlock to edit" onClick={() => setStatus(slip, "DRAFT")}>
                                                            <X className="h-3.5 w-3.5" />
                                                        </Button>
                                                    )}
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

            {/* ── Salary-structure dialog ── */}
            <Dialog open={!!editEmp} onOpenChange={(o) => { if (!o) setEditEmp(null) }}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader><DialogTitle>Salary · {editEmp?.full_name}</DialogTitle></DialogHeader>
                    {form && (
                        <div className="space-y-4">
                            <div className="grid sm:grid-cols-3 gap-3">
                                <div className="space-y-1.5">
                                    <Label>Basis</Label>
                                    <Select value={form.salary_basis} onValueChange={(v) => setForm({ ...form, salary_basis: v as SalaryBasis })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>{SALARY_BASES.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label>{form.salary_basis === "MONTHLY" ? "Monthly" : form.salary_basis === "DAILY" ? "Daily rate" : "Hourly rate"}</Label>
                                    <Input type="number" min="0" step="0.01" value={form.base_amount} onChange={(e) => setForm({ ...form, base_amount: e.target.value })} />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Hours / day</Label>
                                    <Input type="number" min="0" step="0.5" value={form.expected_hours_per_day} onChange={(e) => setForm({ ...form, expected_hours_per_day: e.target.value })} />
                                </div>
                            </div>

                            <ComponentEditor title="Earnings / allowances" kind="earnings" items={form.earnings}
                                onAdd={() => addComp("earnings")} onRemove={(i) => removeComp("earnings", i)} onChange={(i, p) => updateComp("earnings", i, p)} />
                            <ComponentEditor title="Deductions" kind="deductions" items={form.deductions}
                                onAdd={() => addComp("deductions")} onRemove={(i) => removeComp("deductions", i)} onChange={(i, p) => updateComp("deductions", i, p)} />

                            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Bank & PAN (for the slip)</div>
                                <div className="grid sm:grid-cols-2 gap-3">
                                    <div className="space-y-1.5"><Label>Bank name</Label><Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} /></div>
                                    <div className="space-y-1.5"><Label>Account no.</Label><Input value={form.bank_account} onChange={(e) => setForm({ ...form, bank_account: e.target.value })} /></div>
                                    <div className="space-y-1.5"><Label>IFSC</Label><Input value={form.bank_ifsc} onChange={(e) => setForm({ ...form, bank_ifsc: e.target.value })} /></div>
                                    <div className="space-y-1.5"><Label>PAN</Label><Input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value })} /></div>
                                </div>
                            </div>

                            <DialogFooter>
                                <Button variant="neon" disabled={savingSalary} onClick={saveSalary}>
                                    {savingSalary && <Loader2 className="h-4 w-4 animate-spin" />} Save salary
                                </Button>
                            </DialogFooter>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}

function ComponentEditor({ title, items, onAdd, onRemove, onChange }: {
    title: string
    kind: "earnings" | "deductions"
    items: SalaryComponent[]
    onAdd: () => void
    onRemove: (i: number) => void
    onChange: (i: number, patch: Partial<SalaryComponent>) => void
}) {
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <Label>{title}</Label>
                <Button type="button" size="sm" variant="outline" className="h-7" onClick={onAdd}><Plus className="h-3.5 w-3.5" /> Add</Button>
            </div>
            {items.length === 0 ? (
                <p className="text-xs text-muted-foreground">None.</p>
            ) : items.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                    <Input placeholder="Name (e.g. HRA)" value={c.name} onChange={(e) => onChange(i, { name: e.target.value })} className="h-8 flex-1" />
                    <Select value={c.type} onValueChange={(v) => onChange(i, { type: v as SalaryComponent["type"] })}>
                        <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="fixed">Fixed</SelectItem>
                            <SelectItem value="percent">% of base</SelectItem>
                        </SelectContent>
                    </Select>
                    <Input type="number" min="0" step="0.01" value={c.amount || ""} onChange={(e) => onChange(i, { amount: Number(e.target.value) })} className="h-8 w-28" />
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => onRemove(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
            ))}
        </div>
    )
}

export default function PayrollPage() {
    return (
        <HrGuard permission="payroll.manage">
            <PayrollInner />
        </HrGuard>
    )
}
