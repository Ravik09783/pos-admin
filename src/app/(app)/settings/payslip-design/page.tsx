"use client"

import { useEffect, useMemo, useState } from "react"
import { Download, Loader2, Save } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell/page-header"
import { HrGuard } from "@/components/hr/hr-guard"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency } from "@/lib/utils"
import { amountInWords } from "@/lib/hr/salary"
import { cn } from "@/lib/utils"
import {
    DEFAULT_PAYSLIP_DESIGN, downloadPayslip, fetchLogo, migratePayslipDesign, periodLabel,
    PAYSLIP_TEMPLATES, type PayslipDesign, type PayslipTemplate,
} from "@/lib/hr/payslip"
import type { HrEmployee, HrPayslip, Tenant } from "@/types/database"

const TOGGLES: { key: keyof PayslipDesign; label: string }[] = [
    { key: "show_logo", label: "Company logo" },
    { key: "show_employee_code", label: "Employee code" },
    { key: "show_designation", label: "Designation" },
    { key: "show_department", label: "Department" },
    { key: "show_doj", label: "Date of joining" },
    { key: "show_pay_date", label: "Pay date" },
    { key: "show_attendance_summary", label: "Attendance summary" },
    { key: "show_bank_details", label: "Bank details" },
    { key: "show_pan", label: "PAN" },
    { key: "show_net_in_words", label: "Net pay in words" },
    { key: "show_signatory", label: "Signatory line" },
]

// Sample data so the admin sees a realistic slip while designing.
const SAMPLE_EMP: Pick<HrEmployee, "full_name" | "emp_code" | "designation" | "department" | "date_of_joining" | "bank_name" | "bank_account" | "bank_ifsc" | "pan"> = {
    full_name: "Karan Sharma", emp_code: "EMP-001", designation: "Head Chef", department: "Kitchen",
    date_of_joining: "2024-04-01", bank_name: "HDFC Bank", bank_account: "50100XXXXXX12", bank_ifsc: "HDFC0000123", pan: "ABCPK1234D",
}
function sampleSlip(currency: string): HrPayslip {
    return {
        id: "sample", tenant_id: "", employee_id: "", branch_id: null, period_month: "2026-06-01",
        currency, salary_basis: "MONTHLY", base_amount: 30000, working_days: 26, present_days: 24, half_days: 1,
        leave_days: 1, holiday_days: 1, weekly_off_days: 4, absent_days: 0, payable_days: 25.5, worked_minutes: 12000,
        overtime_minutes: 0, overtime_amount: 0, earned_base: 29423.08, gross_earnings: 35423.08, total_deductions: 4250.77,
        net_pay: 31172.31,
        earnings: [{ name: "Earned salary", amount: 29423.08 }, { name: "HRA", amount: 6000 }],
        deductions: [{ name: "PF", amount: 4250.77 }],
        status: "FINALIZED", notes: null, generated_by: null, finalized_at: "2026-07-01T00:00:00Z", created_at: "", updated_at: "",
    }
}

function PayslipDesignInner() {
    const supabase = createClient()
    const [tenant, setTenant] = useState<Tenant | null>(null)
    const [design, setDesign] = useState<PayslipDesign>(DEFAULT_PAYSLIP_DESIGN)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        ;(async () => {
            const { data: u } = await supabase.auth.getUser()
            if (!u.user) return
            const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle() as { data: { tenant_id: string | null } | null }
            if (!row?.tenant_id) return
            const { data: t } = await supabase.from("tenants").select("*").eq("id", row.tenant_id).maybeSingle()
            if (!t) return
            setTenant(t as Tenant)
            setDesign(migratePayslipDesign((t as Tenant).settings?.payslip_design as Record<string, unknown> | undefined))
        })()
    }, [supabase])

    const currency = tenant?.currency ?? "INR"
    const money = (v: number) => formatCurrency(v, currency)
    const slip = useMemo(() => sampleSlip(currency), [currency])

    function set<K extends keyof PayslipDesign>(k: K, v: PayslipDesign[K]) {
        setDesign((d) => ({ ...d, [k]: v }))
    }

    async function save() {
        if (!tenant) return
        setBusy(true)
        const newSettings = { ...((tenant.settings as Record<string, unknown>) ?? {}), payslip_design: design }
        const { error } = await supabase.from("tenants").update({ settings: newSettings } as never).eq("id", tenant.id)
        setBusy(false)
        if (error) return toast.error(error.message)
        toast.success("Payslip format saved")
    }

    async function downloadSample() {
        if (!tenant) return
        const logo = design.show_logo ? await fetchLogo(tenant.logo_url) : null
        downloadPayslip({
            tenant: { name: tenant.name, currency, gstin: tenant.gstin, addressLines: [tenant.address_line1 ?? "", [tenant.city, tenant.state].filter(Boolean).join(" ")] },
            employee: SAMPLE_EMP as HrEmployee, payslip: slip, design, logo,
        })
    }
    function pickTemplate(t: PayslipTemplate) {
        const meta = PAYSLIP_TEMPLATES.find((m) => m.id === t)
        setDesign((d) => ({ ...d, template: t, accent_color: meta?.accent ?? d.accent_color }))
    }

    if (!tenant) return <div className="container mx-auto py-8 text-muted-foreground">Loading…</div>

    const accent = design.accent_color

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-5xl space-y-6">
            <PageHeader
                kicker="Configure"
                title="Salary slip"
                highlight="design"
                description="Choose what appears on the payslip and its accent colour. Employees download the PDF from their Payslips screen."
                actions={
                    <>
                        <Button variant="outline" onClick={downloadSample}><Download className="h-4 w-4" /> Sample PDF</Button>
                        <Button variant="neon" onClick={save} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save</Button>
                    </>
                }
            />

            <div className="grid lg:grid-cols-2 gap-6">
                {/* ── Controls ── */}
                <Card>
                    <CardHeader className="py-3"><CardTitle className="text-base">Options</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Format</Label>
                            <div className="grid sm:grid-cols-3 gap-2">
                                {PAYSLIP_TEMPLATES.map((t) => (
                                    <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => pickTemplate(t.id)}
                                        className={cn(
                                            "text-left rounded-lg border p-2.5 transition-all",
                                            design.template === t.id ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "border-border hover:border-primary/50",
                                        )}
                                    >
                                        <div className="h-10 rounded mb-1.5" style={{ background: t.accent }} />
                                        <div className="text-xs font-semibold">{t.name}</div>
                                        <div className="text-[10px] text-muted-foreground leading-tight line-clamp-2">{t.blurb}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <Label className="w-32">Accent colour</Label>
                            <input type="color" value={accent} onChange={(e) => set("accent_color", e.target.value)} className="h-9 w-14 rounded border border-border cursor-pointer" />
                            <Input value={accent} onChange={(e) => set("accent_color", e.target.value)} className="w-28 font-mono text-xs" />
                        </div>
                        <div className="grid sm:grid-cols-2 gap-2">
                            {TOGGLES.map((t) => (
                                <label key={t.key} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm cursor-pointer">
                                    {t.label}
                                    <Switch checked={design[t.key] as boolean} onCheckedChange={(v) => set(t.key, v as never)} />
                                </label>
                            ))}
                        </div>
                        {design.show_signatory && (
                            <div className="space-y-1.5">
                                <Label>Signatory label</Label>
                                <Input value={design.signatory_label} onChange={(e) => set("signatory_label", e.target.value)} placeholder="Authorised Signatory" />
                            </div>
                        )}
                        <div className="space-y-1.5">
                            <Label>Footer message</Label>
                            <Textarea value={design.footer_message} onChange={(e) => set("footer_message", e.target.value)} rows={2} />
                        </div>
                    </CardContent>
                </Card>

                {/* ── Live preview (HTML mock of the PDF) ── */}
                <Card>
                    <CardHeader className="py-3"><CardTitle className="text-base">Preview</CardTitle></CardHeader>
                    <CardContent>
                        <div className={cn("rounded-lg border overflow-hidden text-xs", design.template === "corporate" ? "border-2" : "border-border")} style={design.template === "corporate" ? { borderColor: accent } : undefined}>
                            {design.template === "classic" && (
                                <div style={{ background: accent }} className="text-white p-3 flex items-center justify-between gap-2">
                                    <div>
                                        <div className="font-bold text-sm">{tenant.name}</div>
                                        <div className="opacity-90">Payslip — {periodLabel(slip.period_month)}</div>
                                    </div>
                                    {design.show_logo && tenant.logo_url && (
                                        /* eslint-disable-next-line @next/next/no-img-element */
                                        <img src={tenant.logo_url} alt="" className="h-8 max-w-[80px] object-contain" />
                                    )}
                                </div>
                            )}
                            {design.template === "modern" && (
                                <div className="p-3 border-l-4" style={{ borderColor: accent }}>
                                    <div className="flex items-center gap-2">
                                        {design.show_logo && tenant.logo_url && (
                                            /* eslint-disable-next-line @next/next/no-img-element */
                                            <img src={tenant.logo_url} alt="" className="h-7 max-w-[70px] object-contain" />
                                        )}
                                        <div className="font-bold text-base">{tenant.name}</div>
                                    </div>
                                    <div className="mt-1 pt-1 border-t font-semibold" style={{ color: accent, borderColor: accent }}>
                                        PAYSLIP · {periodLabel(slip.period_month).toUpperCase()}
                                    </div>
                                </div>
                            )}
                            {design.template === "corporate" && (
                                <div className="p-3">
                                    <div className="flex items-center gap-2">
                                        {design.show_logo && tenant.logo_url && (
                                            /* eslint-disable-next-line @next/next/no-img-element */
                                            <img src={tenant.logo_url} alt="" className="h-8 max-w-[80px] object-contain" />
                                        )}
                                        <div className="font-bold text-sm">{tenant.name}</div>
                                    </div>
                                    <div className="text-center font-bold mt-1 pt-1 border-t" style={{ color: accent, borderColor: accent }}>SALARY SLIP</div>
                                    <div className="text-center text-[10px] text-muted-foreground">{periodLabel(slip.period_month)}</div>
                                </div>
                            )}
                            <div className="p-3 space-y-3">
                                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                    <Field label="Employee" value={SAMPLE_EMP.full_name} />
                                    {design.show_employee_code && <Field label="Code" value={SAMPLE_EMP.emp_code!} />}
                                    {design.show_designation && <Field label="Designation" value={SAMPLE_EMP.designation!} />}
                                    {design.show_department && <Field label="Department" value={SAMPLE_EMP.department!} />}
                                    {design.show_doj && <Field label="Joined" value={SAMPLE_EMP.date_of_joining!} />}
                                    {design.show_pan && <Field label="PAN" value={SAMPLE_EMP.pan!} />}
                                </div>

                                {design.show_attendance_summary && (
                                    <div className="grid grid-cols-6 gap-1 text-center border rounded">
                                        {[["Work", slip.working_days], ["Pres", slip.present_days], ["Half", slip.half_days], ["Leave", slip.leave_days], ["Abs", slip.absent_days], ["Pay", slip.payable_days]].map(([k, v]) => (
                                            <div key={k} className="py-1 border-r last:border-r-0">
                                                <div className="text-[9px] text-muted-foreground">{k}</div>
                                                <div className="font-semibold">{v}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-2">
                                    <div className="border rounded">
                                        <div style={{ background: accent }} className="text-white px-2 py-1 font-semibold">Earnings</div>
                                        {slip.earnings.map((l) => <Row key={l.name} name={l.name} value={money(l.amount)} />)}
                                        <Row name="Gross" value={money(slip.gross_earnings)} bold />
                                    </div>
                                    <div className="border rounded">
                                        <div style={{ background: accent }} className="text-white px-2 py-1 font-semibold">Deductions</div>
                                        {slip.deductions.map((l) => <Row key={l.name} name={l.name} value={money(l.amount)} />)}
                                        <Row name="Total" value={money(slip.total_deductions)} bold />
                                    </div>
                                </div>

                                <div style={{ background: accent }} className="text-white flex items-center justify-between px-3 py-2 rounded font-bold">
                                    <span>NET PAY</span><span>{money(slip.net_pay)}</span>
                                </div>
                                {design.show_net_in_words && <div className="italic text-muted-foreground">{amountInWords(slip.net_pay, currency)}</div>}
                                {design.show_bank_details && (
                                    <div className="text-[11px] text-muted-foreground">
                                        Bank: {SAMPLE_EMP.bank_name} · A/C {SAMPLE_EMP.bank_account} · {SAMPLE_EMP.bank_ifsc}
                                    </div>
                                )}
                                {design.show_signatory && (
                                    <div className="flex justify-end pt-4">
                                        <div className="text-center">
                                            <div className="border-t border-muted-foreground/60 w-28" />
                                            <div className="text-[10px] text-muted-foreground mt-0.5">{design.signatory_label}</div>
                                            <div className="text-[10px] text-muted-foreground">{tenant.name}</div>
                                        </div>
                                    </div>
                                )}
                                {design.footer_message && <div className="text-center text-[10px] text-muted-foreground pt-1 italic">{design.footer_message}</div>}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

function Field({ label, value }: { label: string; value: string }) {
    return <div><span className="text-muted-foreground">{label}: </span><span className="font-medium">{value}</span></div>
}
function Row({ name, value, bold }: { name: string; value: string; bold?: boolean }) {
    return (
        <div className={`flex justify-between px-2 py-1 border-t ${bold ? "font-semibold" : ""}`}>
            <span>{name}</span><span>{value}</span>
        </div>
    )
}

export default function PayslipDesignPage() {
    return (
        <HrGuard permission="payroll.manage">
            <PayslipDesignInner />
        </HrGuard>
    )
}
