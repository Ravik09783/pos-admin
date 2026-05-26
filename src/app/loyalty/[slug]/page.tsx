"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Award, Gift, Loader2, Search, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCurrency, formatDate } from "@/lib/utils"

interface LoyaltyResponse {
    tenant: { name: string; slug: string; loyalty_enabled?: boolean; loyalty_earn_per_100?: number; loyalty_redeem_value?: number }
    customer?: { name: string | null; loyalty_points: number; total_visits: number; total_spent: number } | null
    transactions: Array<{ type: string; points: number; notes: string | null; created_at: string }>
}

export default function PublicLoyaltyPage() {
    const params = useParams<{ slug: string }>()
    const [phone, setPhone] = useState("")
    const [loading, setLoading] = useState(false)
    const [tenantName, setTenantName] = useState("")
    const [data, setData] = useState<LoyaltyResponse | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        ;(async () => {
            // Pre-fetch tenant name
            const r = await fetch(`/api/public/loyalty/${params.slug}?phone=`)
            if (r.status === 400) {
                // means tenant exists but phone missing — body will still have tenant if passed; fallback:
            }
        })()
    }, [params.slug])

    async function lookup(e?: React.FormEvent) {
        e?.preventDefault()
        if (!phone.trim()) return
        setLoading(true)
        setError(null)
        try {
            const r = await fetch(`/api/public/loyalty/${params.slug}?phone=${encodeURIComponent(phone.trim())}`)
            const json = await r.json()
            if (!r.ok) throw new Error(json.error)
            setData(json as LoyaltyResponse)
            setTenantName((json as LoyaltyResponse).tenant.name)
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Lookup failed")
        } finally {
            setLoading(false)
        }
    }

    if (data && data.tenant.loyalty_enabled === false) {
        return (
            <div className="min-h-screen grid place-items-center p-6">
                <Card className="max-w-md w-full"><CardContent className="text-center py-12">
                    <h1 className="text-2xl font-bold">{data.tenant.name}</h1>
                    <p className="text-muted-foreground mt-2">Loyalty programme isn't enabled here yet.</p>
                </CardContent></Card>
            </div>
        )
    }

    const c = data?.customer
    return (
        <div className="min-h-screen p-4 max-w-md mx-auto pt-10">
            <div className="text-center mb-8">
                <Sparkles className="h-8 w-8 text-primary mx-auto mb-2" />
                <h1 className="text-3xl font-bold">{tenantName || "Loyalty"}</h1>
                <p className="text-muted-foreground text-sm">Check your rewards</p>
            </div>

            {!data ? (
                <Card className="neon-border">
                    <CardHeader><CardTitle className="text-base">Look up your account</CardTitle></CardHeader>
                    <CardContent>
                        <form onSubmit={lookup} className="space-y-3">
                            <div className="space-y-1.5">
                                <Label>Your phone number</Label>
                                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 ..." />
                            </div>
                            <Button type="submit" variant="neon" className="w-full" disabled={loading}>
                                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                                Check status
                            </Button>
                            {error && <p className="text-sm text-destructive">{error}</p>}
                        </form>
                    </CardContent>
                </Card>
            ) : c ? (
                <div className="space-y-4">
                    <Card className="neon-border bg-gradient-to-br from-primary/10 to-[hsl(var(--neon-magenta)/0.1)]">
                        <CardContent className="py-8 text-center space-y-2">
                            <Award className="h-10 w-10 text-primary mx-auto" />
                            <div>
                                <div className="text-5xl font-bold text-gradient">{c.loyalty_points}</div>
                                <div className="text-sm text-muted-foreground">loyalty points</div>
                            </div>
                            {data.tenant.loyalty_redeem_value && data.tenant.loyalty_redeem_value > 0 && (
                                <Badge variant="neon">
                                    Worth {formatCurrency(c.loyalty_points * Number(data.tenant.loyalty_redeem_value))}
                                </Badge>
                            )}
                        </CardContent>
                    </Card>

                    <div className="grid grid-cols-2 gap-3">
                        <Card><CardContent className="pt-6 text-center">
                            <div className="text-2xl font-bold">{c.total_visits}</div>
                            <div className="text-xs text-muted-foreground">visits</div>
                        </CardContent></Card>
                        <Card><CardContent className="pt-6 text-center">
                            <div className="text-2xl font-bold">{formatCurrency(c.total_spent)}</div>
                            <div className="text-xs text-muted-foreground">total spent</div>
                        </CardContent></Card>
                    </div>

                    {data.transactions.length > 0 && (
                        <Card>
                            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Gift className="h-4 w-4 text-primary" /> Recent activity</CardTitle></CardHeader>
                            <CardContent>
                                <ul className="space-y-2">
                                    {data.transactions.map((t, i) => (
                                        <li key={i} className="flex items-center justify-between text-sm border-b border-border/40 last:border-0 pb-2 last:pb-0">
                                            <div>
                                                <div className="font-medium">{t.type}</div>
                                                <div className="text-xs text-muted-foreground">{formatDate(t.created_at, { dateStyle: "medium" })}</div>
                                            </div>
                                            <div className={`font-semibold ${t.type === "EARN" ? "text-success" : t.type === "REDEEM" ? "text-warning" : ""}`}>
                                                {t.type === "EARN" ? "+" : t.type === "REDEEM" ? "−" : ""}{Math.abs(t.points)}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </CardContent>
                        </Card>
                    )}

                    <Button variant="outline" className="w-full" onClick={() => { setData(null); setPhone("") }}>Look up another number</Button>
                </div>
            ) : (
                <Card>
                    <CardContent className="text-center py-10">
                        {/* Generic "not found" — we deliberately do NOT
                          * echo the phone back. The page is public, so
                          * echoing turns the lookup into a phone-number
                          * enumeration oracle ("which numbers in this
                          * city are regulars at the restaurant"). */}
                        <p className="text-muted-foreground">No loyalty account matched that number.</p>
                        <p className="text-xs text-muted-foreground mt-2">Visit the restaurant and ask staff to enrol you.</p>
                        <Button variant="outline" className="mt-4" onClick={() => { setData(null); setPhone("") }}>Try again</Button>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
