"use client"

import { useEffect, useState } from "react"
import { Gift, Loader2, Plus, Wallet } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency, formatDate } from "@/lib/utils"
import type { GiftCard } from "@/types/database"

function genCode(): string {
    return "GC-" + Math.random().toString(36).slice(2, 6).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase()
}

export default function GiftCardsPage() {
    const supabase = createClient()
    const [tenantId, setTenantId] = useState("")
    const [cards, setCards] = useState<GiftCard[]>([])
    const [issueOpen, setIssueOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const [form, setForm] = useState({
        code: genCode(),
        initial_value: "1000",
        issued_to_name: "",
        issued_to_phone: "",
        issued_to_email: "",
        expires_at: "",
        notes: "",
    })

    const [redeemOpen, setRedeemOpen] = useState(false)
    const [redeemCode, setRedeemCode] = useState("")
    const [redeemAmount, setRedeemAmount] = useState("")
    const [redeemBusy, setRedeemBusy] = useState(false)

    async function refresh() {
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) return
        const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
        if (!row?.tenant_id) return
        setTenantId(row.tenant_id)
        const { data } = await supabase.from("gift_cards").select("*").order("created_at", { ascending: false }).limit(200)
        setCards((data ?? []) as GiftCard[])
    }
    useEffect(() => { refresh() }, [])

    async function issue(e: React.FormEvent) {
        e.preventDefault()
        const v = Number(form.initial_value)
        if (!Number.isFinite(v) || v <= 0) return toast.error("Amount required")
        setBusy(true)
        const { data, error } = await supabase.from("gift_cards").insert({
            tenant_id: tenantId,
            code: form.code,
            initial_value: v,
            current_balance: v,
            issued_to_name: form.issued_to_name || null,
            issued_to_phone: form.issued_to_phone || null,
            issued_to_email: form.issued_to_email || null,
            expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
            notes: form.notes || null,
        } as never).select("id").maybeSingle()
        if (error) {
            setBusy(false)
            return toast.error(error.message)
        }
        await supabase.from("gift_card_transactions").insert({
            tenant_id: tenantId,
            gift_card_id: (data as { id: string }).id,
            type: "ISSUE",
            amount: v,
            balance_after: v,
        } as never)
        setBusy(false)
        toast.success(`Gift card ${form.code} issued`)
        setIssueOpen(false)
        setForm({ ...form, code: genCode(), initial_value: "1000", issued_to_name: "", issued_to_phone: "", notes: "" })
        refresh()
    }

    async function redeem(e: React.FormEvent) {
        e.preventDefault()
        if (!redeemCode.trim()) return toast.error("Enter card code")
        const v = Number(redeemAmount)
        if (!Number.isFinite(v) || v <= 0) return toast.error("Enter amount")
        setRedeemBusy(true)
        const { data, error } = await supabase.rpc("redeem_gift_card" as never, {
            p_code: redeemCode.trim(),
            p_amount: v,
        } as never)
        setRedeemBusy(false)
        if (error) return toast.error(error.message)
        const r = data as { ok: boolean; error?: string; remaining_balance?: number }
        if (!r.ok) return toast.error(r.error ?? "Redemption failed")
        toast.success(`Redeemed. Balance: ${formatCurrency(r.remaining_balance ?? 0)}`)
        setRedeemOpen(false)
        setRedeemCode(""); setRedeemAmount("")
        refresh()
    }

    const totalIssued = cards.reduce((s, c) => s + Number(c.initial_value), 0)
    const totalRedeemed = cards.reduce((s, c) => s + (Number(c.initial_value) - Number(c.current_balance)), 0)
    const totalActive = cards.reduce((s, c) => s + Number(c.current_balance), 0)

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-6">
            <PageHeader
                kicker="Growth"
                title="Gift cards"
                highlight="prepaid value"
                description="Sell credits now, customers redeem on future visits."
                actions={
                    <>
                        <Button variant="outline" onClick={() => setRedeemOpen(true)}><Wallet className="h-4 w-4" /> Redeem</Button>
                        <Button variant="neon" onClick={() => { setForm({ ...form, code: genCode() }); setIssueOpen(true) }}><Plus className="h-4 w-4" /> Issue card</Button>
                    </>
                }
            />

            <div className="grid gap-4 grid-cols-3">
                <Kpi label="Total issued" value={formatCurrency(totalIssued)} />
                <Kpi label="Total redeemed" value={formatCurrency(totalRedeemed)} />
                <Kpi label="Outstanding (liability)" value={formatCurrency(totalActive)} highlight />
            </div>

            <Card>
                <CardHeader><CardTitle className="text-base">All cards</CardTitle></CardHeader>
                <CardContent className="px-0">
                    {cards.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <Gift className="h-8 w-8 mx-auto mb-2 opacity-50" /> No gift cards issued yet.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Code</TableHead>
                                    <TableHead>Issued to</TableHead>
                                    <TableHead className="text-right">Initial</TableHead>
                                    <TableHead className="text-right">Balance</TableHead>
                                    <TableHead>Expires</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {cards.map((c) => {
                                    const expired = c.expires_at && new Date(c.expires_at) < new Date()
                                    const empty = Number(c.current_balance) <= 0
                                    return (
                                        <TableRow key={c.id}>
                                            <TableCell className="font-mono text-xs">{c.code}</TableCell>
                                            <TableCell className="text-sm">
                                                <div>{c.issued_to_name ?? "—"}</div>
                                                {c.issued_to_phone && <div className="text-xs text-muted-foreground">{c.issued_to_phone}</div>}
                                            </TableCell>
                                            <TableCell className="text-right">{formatCurrency(c.initial_value)}</TableCell>
                                            <TableCell className="text-right font-semibold">{formatCurrency(c.current_balance)}</TableCell>
                                            <TableCell className="text-sm">{c.expires_at ? formatDate(c.expires_at, { dateStyle: "short" }) : "—"}</TableCell>
                                            <TableCell>
                                                {empty ? <Badge variant="secondary">EMPTY</Badge> :
                                                 expired ? <Badge variant="destructive">EXPIRED</Badge> :
                                                 <Badge variant="success">ACTIVE</Badge>}
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Issue gift card</DialogTitle></DialogHeader>
                    <form onSubmit={issue} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5"><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="font-mono" /></div>
                            <div className="space-y-1.5"><Label>Amount (₹) *</Label><Input type="number" step="0.01" value={form.initial_value} onChange={(e) => setForm({ ...form, initial_value: e.target.value })} /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5"><Label>Recipient name</Label><Input value={form.issued_to_name} onChange={(e) => setForm({ ...form, issued_to_name: e.target.value })} /></div>
                            <div className="space-y-1.5"><Label>Phone</Label><Input value={form.issued_to_phone} onChange={(e) => setForm({ ...form, issued_to_phone: e.target.value })} /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.issued_to_email} onChange={(e) => setForm({ ...form, issued_to_email: e.target.value })} /></div>
                            <div className="space-y-1.5"><Label>Expires</Label><Input type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} /></div>
                        </div>
                        <div className="space-y-1.5"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                        <DialogFooter><Button type="submit" variant="neon" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Issue</Button></DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={redeemOpen} onOpenChange={setRedeemOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Redeem gift card</DialogTitle></DialogHeader>
                    <form onSubmit={redeem} className="space-y-3">
                        <div className="space-y-1.5">
                            <Label>Card code</Label>
                            <Input value={redeemCode} onChange={(e) => setRedeemCode(e.target.value.toUpperCase())} className="font-mono" placeholder="GC-XXXX-XXXX" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Amount to redeem</Label>
                            <Input type="number" step="0.01" value={redeemAmount} onChange={(e) => setRedeemAmount(e.target.value)} />
                        </div>
                        <DialogFooter><Button type="submit" variant="neon" disabled={redeemBusy}>{redeemBusy && <Loader2 className="h-4 w-4 animate-spin" />} Redeem</Button></DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
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
