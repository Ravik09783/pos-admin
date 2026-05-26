"use client"

import { useEffect, useState } from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency, formatDate } from "@/lib/utils"
import { buildPeriod } from "@/lib/ca-export/fetch"
import type { ExpenseCategory, ExpensePLGroup } from "@/types/database"

interface ExpenseRow {
    id: string
    expense_date: string
    description: string
    amount: number
    gst_amount: number
    vendor_name: string | null
    category_id: string | null
    payment_method: string | null
    fy_label: string
    expense_categories?: { name: string; pl_group: ExpensePLGroup } | null
}

interface BSRow {
    id: string
    fy_label: string
    section: "ASSETS" | "LIABILITIES" | "EQUITY"
    sub_section: string
    head: string
    opening_balance: number
    closing_balance: number
}

const PL_GROUPS: ExpensePLGroup[] = ["COGS", "OPERATING", "SALARIES", "RENT", "UTILITIES", "MARKETING", "FINANCE", "DEPRECIATION", "OTHER"]

export default function AccountingPage() {
    const supabase = createClient()
    const [tenantId, setTenantId] = useState("")
    const [tenantFyStart, setTenantFyStart] = useState(4)

    const [categories, setCategories] = useState<ExpenseCategory[]>([])
    const [expenses, setExpenses] = useState<ExpenseRow[]>([])
    const [bs, setBs] = useState<BSRow[]>([])

    const [expOpen, setExpOpen] = useState(false)
    const [expForm, setExpForm] = useState({
        date: new Date().toISOString().slice(0, 10),
        description: "",
        amount: "",
        gst_amount: "0",
        vendor_name: "",
        category_id: "",
        payment_method: "CASH",
    })
    const [savingExp, setSavingExp] = useState(false)

    const [catOpen, setCatOpen] = useState(false)
    const [catForm, setCatForm] = useState<{ name: string; pl_group: ExpensePLGroup }>({ name: "", pl_group: "OPERATING" })

    const [bsOpen, setBsOpen] = useState(false)
    const [bsForm, setBsForm] = useState<{
        fy_label: string
        section: BSRow["section"]
        sub_section: string
        head: string
        opening: string
        closing: string
    }>({
        fy_label: buildPeriod(new Date().getFullYear(), new Date().getMonth() + 1).fyLabel,
        section: "ASSETS",
        sub_section: "Current Assets",
        head: "",
        opening: "0",
        closing: "0",
    })

    async function refresh() {
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) return
        const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
        if (!row?.tenant_id) return
        setTenantId(row.tenant_id)
        const { data: tenant } = await supabase.from("tenants").select("fy_start_month").eq("id", row.tenant_id).maybeSingle()
        const fyStart = tenant?.fy_start_month ?? 4
        setTenantFyStart(fyStart)
        // Default the balance-sheet form's FY to the tenant's real fiscal year
        // so entries save under the same `fy_label` the CA export queries —
        // the April default would mismatch January/July-FY countries.
        setBsForm((f) => ({
            ...f,
            fy_label: buildPeriod(new Date().getFullYear(), new Date().getMonth() + 1, fyStart).fyLabel,
        }))
        const [{ data: cats }, { data: exps }, { data: bsd }] = await Promise.all([
            supabase.from("expense_categories").select("*").order("name"),
            supabase.from("expenses").select("*, expense_categories:category_id(name, pl_group)").order("expense_date", { ascending: false }).limit(100),
            supabase.from("balance_sheet_entries").select("*").order("section"),
        ])
        setCategories((cats ?? []) as ExpenseCategory[])
        setExpenses((exps ?? []) as ExpenseRow[])
        setBs((bsd ?? []) as BSRow[])
    }
    useEffect(() => { refresh() }, [])

    async function saveExpense(e: React.FormEvent) {
        e.preventDefault()
        if (!expForm.description.trim()) return toast.error("Description required")
        if (!expForm.amount || Number(expForm.amount) <= 0) return toast.error("Amount required")
        setSavingExp(true)
        const fy = buildPeriod(
            new Date(expForm.date).getFullYear(),
            new Date(expForm.date).getMonth() + 1,
            tenantFyStart,
        ).fyLabel
        const { error } = await supabase.from("expenses").insert({
            tenant_id: tenantId,
            expense_date: expForm.date,
            fy_label: fy,
            description: expForm.description.trim(),
            amount: Number(expForm.amount),
            gst_amount: Number(expForm.gst_amount) || 0,
            vendor_name: expForm.vendor_name || null,
            category_id: expForm.category_id || null,
            payment_method: expForm.payment_method,
        } as never)
        setSavingExp(false)
        if (error) return toast.error(error.message)
        toast.success("Expense recorded")
        setExpOpen(false)
        setExpForm({ ...expForm, description: "", amount: "", gst_amount: "0", vendor_name: "" })
        refresh()
    }

    async function saveCategory(e: React.FormEvent) {
        e.preventDefault()
        if (!catForm.name.trim()) return
        const { error } = await supabase.from("expense_categories").insert({
            tenant_id: tenantId,
            name: catForm.name.trim(),
            pl_group: catForm.pl_group,
        } as never)
        if (error) return toast.error(error.message)
        toast.success("Category added")
        setCatOpen(false)
        setCatForm({ name: "", pl_group: "OPERATING" })
        refresh()
    }

    async function saveBs(e: React.FormEvent) {
        e.preventDefault()
        if (!bsForm.head.trim()) return toast.error("Head required")
        const { error } = await supabase.from("balance_sheet_entries").upsert({
            tenant_id: tenantId,
            fy_label: bsForm.fy_label,
            section: bsForm.section,
            sub_section: bsForm.sub_section,
            head: bsForm.head.trim(),
            opening_balance: Number(bsForm.opening) || 0,
            closing_balance: Number(bsForm.closing) || 0,
        } as never, { onConflict: "tenant_id,fy_label,section,sub_section,head" })
        if (error) return toast.error(error.message)
        toast.success("Saved")
        setBsOpen(false)
        setBsForm({ ...bsForm, head: "", opening: "0", closing: "0" })
        refresh()
    }

    async function deleteExpense(id: string) {
        if (!confirm("Delete this expense?")) return
        const { error } = await supabase.from("expenses").delete().eq("id", id)
        if (error) return toast.error(error.message)
        refresh()
    }

    async function deleteBs(id: string) {
        if (!confirm("Delete this entry?")) return
        const { error } = await supabase.from("balance_sheet_entries").delete().eq("id", id)
        if (error) return toast.error(error.message)
        refresh()
    }

    const expensesTotal = expenses.reduce((s, e) => s + Number(e.amount), 0)

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-6">
            <PageHeader
                kicker="Finance"
                title="Accounting"
                highlight="P&amp;L + Balance Sheet"
                description="Capture expenses and balance-sheet entries — these flow into the CA Export."
            />

            <Tabs defaultValue="expenses">
                <TabsList>
                    <TabsTrigger value="expenses">Expenses</TabsTrigger>
                    <TabsTrigger value="balance-sheet">Balance Sheet</TabsTrigger>
                    <TabsTrigger value="categories">Categories</TabsTrigger>
                </TabsList>

                <TabsContent value="expenses" className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">{expenses.length} entries · {formatCurrency(expensesTotal)} total</p>
                        </div>
                        <Button variant="neon" onClick={() => setExpOpen(true)}>
                            <Plus className="h-4 w-4" /> Add expense
                        </Button>
                    </div>
                    <Card>
                        <CardContent className="px-0">
                            {expenses.length === 0 ? (
                                <div className="text-center py-12 text-sm text-muted-foreground">
                                    No expenses recorded yet.
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Date</TableHead>
                                            <TableHead>Description</TableHead>
                                            <TableHead>Category</TableHead>
                                            <TableHead>Vendor</TableHead>
                                            <TableHead className="text-right">Amount</TableHead>
                                            <TableHead className="w-12" />
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {expenses.map((e) => (
                                            <TableRow key={e.id}>
                                                <TableCell className="text-sm">{formatDate(e.expense_date, { dateStyle: "medium" })}</TableCell>
                                                <TableCell>{e.description}</TableCell>
                                                <TableCell>
                                                    {e.expense_categories
                                                        ? <Badge variant="outline">{e.expense_categories.name}</Badge>
                                                        : "—"}
                                                </TableCell>
                                                <TableCell className="text-sm">{e.vendor_name ?? "—"}</TableCell>
                                                <TableCell className="text-right font-medium">{formatCurrency(e.amount)}</TableCell>
                                                <TableCell>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteExpense(e.id)}>
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="balance-sheet" className="space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">{bs.length} heads</p>
                        <Button variant="neon" onClick={() => setBsOpen(true)}>
                            <Plus className="h-4 w-4" /> Add / update head
                        </Button>
                    </div>
                    <Card>
                        <CardContent className="px-0">
                            {bs.length === 0 ? (
                                <div className="text-center py-12 text-sm text-muted-foreground">
                                    No balance sheet heads yet. Typical heads: Cash in hand, Bank balance, Inventory, Equipment, Loan from owner, Trade payables.
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>FY</TableHead>
                                            <TableHead>Section</TableHead>
                                            <TableHead>Sub-section</TableHead>
                                            <TableHead>Head</TableHead>
                                            <TableHead className="text-right">Opening</TableHead>
                                            <TableHead className="text-right">Closing</TableHead>
                                            <TableHead className="w-12" />
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {bs.map((b) => (
                                            <TableRow key={b.id}>
                                                <TableCell className="font-mono text-xs">{b.fy_label}</TableCell>
                                                <TableCell><Badge variant="outline">{b.section}</Badge></TableCell>
                                                <TableCell>{b.sub_section}</TableCell>
                                                <TableCell>{b.head}</TableCell>
                                                <TableCell className="text-right">{formatCurrency(b.opening_balance)}</TableCell>
                                                <TableCell className="text-right font-medium">{formatCurrency(b.closing_balance)}</TableCell>
                                                <TableCell>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteBs(b.id)}>
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="categories" className="space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">{categories.length} categories</p>
                        <Button variant="neon" onClick={() => setCatOpen(true)}>
                            <Plus className="h-4 w-4" /> Add category
                        </Button>
                    </div>
                    <Card>
                        <CardContent className="px-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Name</TableHead>
                                        <TableHead>P&amp;L group</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {categories.map((c) => (
                                        <TableRow key={c.id}>
                                            <TableCell>{c.name}</TableCell>
                                            <TableCell><Badge variant="outline">{c.pl_group}</Badge></TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <Dialog open={expOpen} onOpenChange={setExpOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader><DialogTitle>Add expense</DialogTitle></DialogHeader>
                    <form onSubmit={saveExpense} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Date</Label>
                                <Input type="date" value={expForm.date} onChange={(e) => setExpForm({ ...expForm, date: e.target.value })} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Amount</Label>
                                <Input type="number" step="0.01" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Description</Label>
                            <Textarea value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} placeholder="Monthly electricity bill" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Category</Label>
                                <Select value={expForm.category_id} onValueChange={(v) => setExpForm({ ...expForm, category_id: v })}>
                                    <SelectTrigger><SelectValue placeholder="Pick category" /></SelectTrigger>
                                    <SelectContent>
                                        {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>GST (incl)</Label>
                                <Input type="number" step="0.01" value={expForm.gst_amount} onChange={(e) => setExpForm({ ...expForm, gst_amount: e.target.value })} />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Vendor (optional)</Label>
                            <Input value={expForm.vendor_name} onChange={(e) => setExpForm({ ...expForm, vendor_name: e.target.value })} />
                        </div>
                        <DialogFooter>
                            <Button type="submit" variant="neon" disabled={savingExp}>
                                {savingExp && <Loader2 className="h-4 w-4 animate-spin" />}
                                Save
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={catOpen} onOpenChange={setCatOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>New category</DialogTitle></DialogHeader>
                    <form onSubmit={saveCategory} className="space-y-3">
                        <div className="space-y-1.5">
                            <Label>Name</Label>
                            <Input value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>P&amp;L group</Label>
                            <Select value={catForm.pl_group} onValueChange={(v) => setCatForm({ ...catForm, pl_group: v as ExpensePLGroup })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {PL_GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <DialogFooter><Button type="submit" variant="neon">Create</Button></DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={bsOpen} onOpenChange={setBsOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Balance sheet head</DialogTitle></DialogHeader>
                    <form onSubmit={saveBs} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Financial year</Label>
                                <Input value={bsForm.fy_label} onChange={(e) => setBsForm({ ...bsForm, fy_label: e.target.value })} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Section</Label>
                                <Select value={bsForm.section} onValueChange={(v) => setBsForm({ ...bsForm, section: v as BSRow["section"] })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ASSETS">ASSETS</SelectItem>
                                        <SelectItem value="LIABILITIES">LIABILITIES</SelectItem>
                                        <SelectItem value="EQUITY">EQUITY</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Sub-section</Label>
                            <Input value={bsForm.sub_section} onChange={(e) => setBsForm({ ...bsForm, sub_section: e.target.value })} placeholder="Current Assets / Fixed Assets / Current Liabilities" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Head</Label>
                            <Input value={bsForm.head} onChange={(e) => setBsForm({ ...bsForm, head: e.target.value })} placeholder="Cash in hand / Bank balance / Inventory" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Opening</Label>
                                <Input type="number" step="0.01" value={bsForm.opening} onChange={(e) => setBsForm({ ...bsForm, opening: e.target.value })} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Closing</Label>
                                <Input type="number" step="0.01" value={bsForm.closing} onChange={(e) => setBsForm({ ...bsForm, closing: e.target.value })} />
                            </div>
                        </div>
                        <DialogFooter><Button type="submit" variant="neon">Save</Button></DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
