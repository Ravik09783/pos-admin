"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, FileUp, Loader2, Search, Trash2, Wand2, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency, formatDate } from "@/lib/utils"
import type { BankTransaction, Payment } from "@/types/database"

interface UnmatchedPayment extends Payment {
    bills?: { invoice_number: string; grand_total: number } | null
}

export default function BankRecPage() {
    const supabase = createClient()
    const [tenantId, setTenantId] = useState("")
    const [loading, setLoading] = useState(true)
    const [bankTxns, setBankTxns] = useState<BankTransaction[]>([])
    const [payments, setPayments] = useState<UnmatchedPayment[]>([])
    const [search, setSearch] = useState("")
    const [busy, setBusy] = useState(false)
    const [csvText, setCsvText] = useState("")
    const [importOpen, setImportOpen] = useState(false)

    async function refresh() {
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) return
        const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
        if (!row?.tenant_id) return
        setTenantId(row.tenant_id)
        const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const [{ data: bt }, { data: p }] = await Promise.all([
            supabase.from("bank_transactions").select("*").gte("txn_date", since).order("txn_date", { ascending: false }),
            supabase.from("payments").select("*, bills:bill_id(invoice_number, grand_total)").gte("created_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()).order("created_at", { ascending: false }),
        ])
        setBankTxns((bt ?? []) as BankTransaction[])
        setPayments((p ?? []) as UnmatchedPayment[])
        setLoading(false)
    }
    useEffect(() => { refresh() }, [])

    const matchedPaymentIds = useMemo(
        () => new Set(bankTxns.filter((b) => b.matched_payment_id).map((b) => b.matched_payment_id!)),
        [bankTxns],
    )

    function parseCsv(text: string): Array<{ date: string; description: string; amount: number; reference?: string }> {
        const lines = text.split(/\r?\n/).filter((l) => l.trim())
        if (lines.length === 0) return []
        const header = lines[0]!.toLowerCase()
        const out: Array<{ date: string; description: string; amount: number; reference?: string }> = []
        const cols = header.split(",").map((c) => c.trim())
        const dateIdx = cols.findIndex((c) => /date/.test(c))
        const descIdx = cols.findIndex((c) => /(narration|description|particular|details|remark)/.test(c))
        const amtIdx = cols.findIndex((c) => /(amount|amt|deposit|credit)/.test(c))
        const debitIdx = cols.findIndex((c) => /debit|withdrawal/.test(c))
        const refIdx = cols.findIndex((c) => /(ref|chq|cheque|utr)/.test(c))
        for (let i = 1; i < lines.length; i++) {
            const cells = lines[i]!.split(",").map((c) => c.trim().replace(/^"|"$/g, ""))
            const date = cells[dateIdx >= 0 ? dateIdx : 0] ?? ""
            const desc = cells[descIdx >= 0 ? descIdx : 1] ?? ""
            const credit = parseFloat((cells[amtIdx] ?? "").replace(/[,]/g, "")) || 0
            const debit = parseFloat((cells[debitIdx] ?? "").replace(/[,]/g, "")) || 0
            const amount = credit > 0 ? credit : -debit
            if (!date || amount === 0) continue
            out.push({ date: normaliseDate(date), description: desc, amount, reference: refIdx >= 0 ? cells[refIdx] : undefined })
        }
        return out
    }

    async function importCsv() {
        if (!csvText.trim()) return toast.error("Paste CSV first")
        const rows = parseCsv(csvText)
        if (rows.length === 0) return toast.error("No valid rows parsed")
        setBusy(true)
        const { data: stmt, error: se } = await supabase.from("bank_statements").insert({
            tenant_id: tenantId,
            file_name: `pasted-${new Date().toISOString().slice(0, 10)}`,
            period_from: rows[0]!.date,
            period_to: rows[rows.length - 1]!.date,
        } as never).select("id").maybeSingle()
        if (se) { setBusy(false); return toast.error(se.message) }
        const { error } = await supabase.from("bank_transactions").insert(
            rows.map((r) => ({
                tenant_id: tenantId,
                statement_id: (stmt as { id: string } | null)?.id,
                txn_date: r.date,
                description: r.description,
                reference: r.reference ?? null,
                amount: r.amount,
                type: r.amount >= 0 ? "CREDIT" : "DEBIT",
            })) as never,
        )
        setBusy(false)
        if (error) return toast.error(error.message)
        toast.success(`Imported ${rows.length} transactions`)
        setImportOpen(false)
        setCsvText("")
        refresh()
    }

    async function autoMatch() {
        setBusy(true)
        let matched = 0
        for (const bt of bankTxns.filter((b) => !b.is_reconciled && Number(b.amount) > 0)) {
            const candidate = payments.find((p) => {
                if (matchedPaymentIds.has(p.id)) return false
                if (Math.abs(Number(p.amount) - Number(bt.amount)) > 0.01) return false
                const dpDate = new Date(p.created_at).toISOString().slice(0, 10)
                const dbDate = bt.txn_date.slice(0, 10)
                const days = Math.abs((+new Date(dpDate) - +new Date(dbDate)) / 86400000)
                return days <= 3
            })
            if (candidate) {
                await supabase.from("bank_transactions").update({
                    matched_payment_id: candidate.id,
                    matched_at: new Date().toISOString(),
                    is_reconciled: true,
                } as never).eq("id", bt.id)
                matched++
            }
        }
        setBusy(false)
        toast.success(`Auto-matched ${matched} transaction(s)`)
        refresh()
    }

    async function manualMatch(btId: string, payId: string) {
        const { error } = await supabase.from("bank_transactions").update({
            matched_payment_id: payId,
            matched_at: new Date().toISOString(),
            is_reconciled: true,
        } as never).eq("id", btId)
        if (error) return toast.error(error.message)
        refresh()
    }

    async function unmatch(btId: string) {
        const { error } = await supabase.from("bank_transactions").update({
            matched_payment_id: null,
            matched_at: null,
            is_reconciled: false,
        } as never).eq("id", btId)
        if (error) return toast.error(error.message)
        refresh()
    }

    async function deleteTxn(btId: string) {
        if (!confirm("Delete this bank transaction?")) return
        const { error } = await supabase.from("bank_transactions").delete().eq("id", btId)
        if (error) return toast.error(error.message)
        refresh()
    }

    const filtered = bankTxns.filter((b) => {
        if (!search.trim()) return true
        const s = search.toLowerCase()
        return (b.description ?? "").toLowerCase().includes(s) || (b.reference ?? "").toLowerCase().includes(s)
    })
    const reconciledCount = bankTxns.filter((b) => b.is_reconciled).length
    const totalCredits = bankTxns.filter((b) => Number(b.amount) > 0).reduce((s, b) => s + Number(b.amount), 0)
    const totalPaymentsRecorded = payments.reduce((s, p) => s + Number(p.amount), 0)

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-6">
            <PageHeader
                kicker="Finance"
                title="Bank Reconciliation"
                highlight="CA-ready"
                description="Match bank deposits with POS payments."
                actions={
                    <>
                        <Button variant="outline" onClick={autoMatch} disabled={busy || bankTxns.length === 0}>
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                            Auto-match
                        </Button>
                        <Button variant="neon" onClick={() => setImportOpen(true)}><FileUp className="h-4 w-4" /> Import CSV</Button>
                    </>
                }
            />

            <div className="grid gap-4 grid-cols-3">
                <Kpi label="Imported transactions" value={String(bankTxns.length)} />
                <Kpi label="Reconciled" value={`${reconciledCount} / ${bankTxns.length}`} />
                <Kpi label="Bank credits vs POS payments" value={`${formatCurrency(totalCredits)} / ${formatCurrency(totalPaymentsRecorded)}`} highlight={Math.abs(totalCredits - totalPaymentsRecorded) > 100} />
            </div>

            {importOpen && (
                <Card className="neon-border">
                    <CardHeader>
                        <CardTitle className="text-base">Paste CSV from your bank</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                            Most Indian banks export CSV with columns like Date, Narration, Debit, Credit, Balance.
                            Paste the CSV text below — we&apos;ll auto-detect columns.
                        </p>
                        <textarea
                            className="w-full min-h-[160px] rounded-md border border-input bg-background/40 p-3 text-xs font-mono"
                            value={csvText}
                            onChange={(e) => setCsvText(e.target.value)}
                            placeholder="Date,Narration,Debit,Credit,Balance&#10;01/04/2025,UPI/JOHN DOE/...,0,500.00,12345.00"
                        />
                        <div className="flex gap-2 justify-end">
                            <Button variant="ghost" onClick={() => { setImportOpen(false); setCsvText("") }}>Cancel</Button>
                            <Button variant="neon" onClick={importCsv} disabled={busy}>
                                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Import
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Tabs defaultValue="all">
                <TabsList>
                    <TabsTrigger value="all">All ({bankTxns.length})</TabsTrigger>
                    <TabsTrigger value="unreconciled">Unreconciled ({bankTxns.length - reconciledCount})</TabsTrigger>
                    <TabsTrigger value="reconciled">Reconciled ({reconciledCount})</TabsTrigger>
                </TabsList>
                {(["all", "unreconciled", "reconciled"] as const).map((tab) => (
                    <TabsContent key={tab} value={tab}>
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-base">Bank transactions</CardTitle>
                                    <div className="relative">
                                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                        <Input placeholder="Search description / ref" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 w-56" />
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="px-0">
                                {loading ? (
                                    <div className="p-6 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
                                ) : filtered.filter((b) => tab === "all" || (tab === "reconciled" ? b.is_reconciled : !b.is_reconciled)).length === 0 ? (
                                    <div className="text-center py-12 text-muted-foreground">
                                        <FileUp className="h-8 w-8 mx-auto mb-2 opacity-50" /> Nothing here. Import a CSV from your bank to start.
                                    </div>
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Date</TableHead>
                                                <TableHead>Description</TableHead>
                                                <TableHead>Reference</TableHead>
                                                <TableHead className="text-right">Amount</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead className="w-12" />
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {filtered
                                                .filter((b) => tab === "all" || (tab === "reconciled" ? b.is_reconciled : !b.is_reconciled))
                                                .map((bt) => {
                                                    const matched = payments.find((p) => p.id === bt.matched_payment_id)
                                                    return (
                                                        <TableRow key={bt.id}>
                                                            <TableCell className="text-sm">{formatDate(bt.txn_date, { dateStyle: "medium" })}</TableCell>
                                                            <TableCell className="text-sm">{bt.description ?? "—"}</TableCell>
                                                            <TableCell className="font-mono text-xs">{bt.reference ?? "—"}</TableCell>
                                                            <TableCell className={`text-right font-medium ${Number(bt.amount) >= 0 ? "text-success" : "text-destructive"}`}>
                                                                {Number(bt.amount) > 0 ? "+" : ""}{formatCurrency(bt.amount)}
                                                            </TableCell>
                                                            <TableCell>
                                                                {bt.is_reconciled ? (
                                                                    <Badge variant="success">
                                                                        <CheckCircle2 className="h-3 w-3 mr-1" />
                                                                        {matched?.bills?.invoice_number ?? "matched"}
                                                                    </Badge>
                                                                ) : (
                                                                    <Badge variant="warning">UNRECONCILED</Badge>
                                                                )}
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="flex gap-1">
                                                                    {bt.is_reconciled ? (
                                                                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => unmatch(bt.id)}>
                                                                            <X className="h-3.5 w-3.5" />
                                                                        </Button>
                                                                    ) : (
                                                                        <ManualMatchButton txn={bt} payments={payments.filter((p) => !matchedPaymentIds.has(p.id))} onMatch={(pid) => manualMatch(bt.id, pid)} />
                                                                    )}
                                                                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteTxn(bt.id)}>
                                                                        <Trash2 className="h-3.5 w-3.5" />
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
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    )
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <Card className={highlight ? "neon-border bg-warning/5" : ""}>
            <CardContent className="pt-6">
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
                <div className={`text-2xl font-bold mt-1 ${highlight ? "text-warning" : ""}`}>{value}</div>
            </CardContent>
        </Card>
    )
}

function ManualMatchButton({ txn, payments, onMatch }: { txn: BankTransaction; payments: UnmatchedPayment[]; onMatch: (id: string) => void }) {
    const [open, setOpen] = useState(false)
    const candidates = payments
        .filter((p) => Math.abs(Number(p.amount) - Number(txn.amount)) < 5)
        .slice(0, 5)
    if (candidates.length === 0) return null
    return (
        <div className="relative">
            <Button size="icon" variant="ghost" className="h-7 w-7" title="Match manually" onClick={() => setOpen(!open)}>
                <Wand2 className="h-3.5 w-3.5" />
            </Button>
            {open && (
                <div className="absolute right-0 top-8 z-10 bg-popover border border-border rounded-md shadow-lg p-2 min-w-[260px]">
                    <div className="text-xs text-muted-foreground mb-1">Match with…</div>
                    {candidates.map((p) => (
                        <button
                            key={p.id}
                            onClick={() => { onMatch(p.id); setOpen(false) }}
                            className="w-full text-left text-sm rounded-md px-2 py-1.5 hover:bg-accent"
                        >
                            <div className="font-mono text-xs">{p.bills?.invoice_number ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{p.method} · {formatCurrency(p.amount)}</div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

function normaliseDate(s: string): string {
    // Accept DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, etc.
    const m1 = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
    if (m1) return `${m1[3]}-${m1[2]!.padStart(2, "0")}-${m1[1]!.padStart(2, "0")}`
    const m2 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
    if (m2) return `${m2[1]}-${m2[2]!.padStart(2, "0")}-${m2[3]!.padStart(2, "0")}`
    return new Date(s).toISOString().slice(0, 10)
}
