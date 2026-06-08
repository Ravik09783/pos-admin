"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, FileText, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { useMyPermissions } from "@/lib/rbac/use-permissions"
import { formatCurrency } from "@/lib/utils"
import { downloadPayslip, fetchLogo, migratePayslipDesign, periodLabel } from "@/lib/hr/payslip"
import type { HrEmployee, HrPayslip, PayslipStatus, Tenant } from "@/types/database"

const STATUS_VARIANT: Record<PayslipStatus, "secondary" | "success" | "warning"> = {
    DRAFT: "warning", FINALIZED: "success", PAID: "success",
}

export default function PayslipsPage() {
    const supabase = createClient()
    const { can, loading: permLoading } = useMyPermissions()
    const canManage = can("payroll.manage")
    const [tenant, setTenant] = useState<Tenant | null>(null)
    const [slips, setSlips] = useState<HrPayslip[]>([])
    const [employees, setEmployees] = useState<HrEmployee[]>([])
    const [loading, setLoading] = useState(true)

    const refresh = useCallback(async () => {
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) { setLoading(false); return }
        const { data: me } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle() as { data: { tenant_id: string | null } | null }
        if (!me?.tenant_id) { setLoading(false); return }
        const [{ data: t }, { data: emps }, { data: ps }] = await Promise.all([
            supabase.from("tenants").select("*").eq("id", me.tenant_id).maybeSingle(),
            supabase.from("hr_employees").select("*"),               // RLS: own row or all (admin)
            supabase.from("hr_payslips").select("*").order("period_month", { ascending: false }), // RLS-scoped
        ])
        setTenant(t as Tenant)
        setEmployees((emps ?? []) as HrEmployee[])
        setSlips((ps ?? []) as HrPayslip[])
        setLoading(false)
    }, [supabase])

    useEffect(() => { refresh() }, [refresh])

    const empById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])
    const money = (v: number) => formatCurrency(v, tenant?.currency ?? "INR")
    const design = useMemo(
        () => migratePayslipDesign((tenant?.settings as { payslip_design?: Record<string, unknown> } | null)?.payslip_design),
        [tenant],
    )

    // Employees only ever download finalised slips; managers see drafts too.
    const visible = useMemo(
        () => slips.filter((s) => canManage || s.status !== "DRAFT"),
        [slips, canManage],
    )

    async function download(slip: HrPayslip) {
        const emp = empById.get(slip.employee_id)
        if (!tenant || !emp) return toast.error("Missing employee details")
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

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-4xl space-y-6">
            <PageHeader
                kicker="Staff"
                title={canManage ? "All payslips" : "My payslips"}
                highlight="download anytime"
                description={canManage
                    ? "Every generated payslip across the team. Generate and finalise on the Payroll screen."
                    : "Your salary slips. Download any month as a PDF."}
            />

            <Card>
                <CardHeader className="py-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" /> Payslips
                    </CardTitle>
                </CardHeader>
                <CardContent className="px-0">
                    {loading || permLoading ? (
                        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                        </div>
                    ) : visible.length === 0 ? (
                        <p className="px-6 py-10 text-sm text-muted-foreground text-center">
                            No payslips yet{canManage ? " — generate them on the Payroll screen." : "."}
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Month</TableHead>
                                    {canManage && <TableHead>Employee</TableHead>}
                                    <TableHead className="text-right">Net pay</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right w-28">Download</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {visible.map((s) => (
                                    <TableRow key={s.id}>
                                        <TableCell className="font-medium">{periodLabel(s.period_month)}</TableCell>
                                        {canManage && <TableCell className="text-sm">{empById.get(s.employee_id)?.full_name ?? "—"}</TableCell>}
                                        <TableCell className="text-right font-medium">{money(s.net_pay)}</TableCell>
                                        <TableCell><Badge variant={STATUS_VARIANT[s.status]} className="text-[10px]">{s.status}</Badge></TableCell>
                                        <TableCell className="text-right">
                                            <Button size="sm" variant="outline" className="h-8" onClick={() => download(s)}>
                                                <Download className="h-3.5 w-3.5" /> PDF
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
