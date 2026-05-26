"use client"

import { useEffect, useMemo, useState } from "react"
import { Cake, Heart, Loader2, MessageCircle, RefreshCw, Send, Sparkles, UserX } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency, formatDate } from "@/lib/utils"
import { WhatsappStatusCard, type WhatsappCredentialsStatus } from "@/components/integrations/whatsapp-status-card"
import type { Coupon } from "@/types/database"

type CampaignType = "WIN_BACK" | "BIRTHDAY" | "ANNIVERSARY"
type Channel = "whatsapp" | "sms"

interface EligibleCustomer {
    id: string
    name: string | null
    phone: string | null
    email: string | null
    loyalty_tier: string
    total_spent: number
    last_visit_at: string | null
    date_of_birth: string | null
    anniversary_date: string | null
}

const TYPE_META: Record<CampaignType, { label: string; icon: typeof UserX; description: string; defaultLookback: number }> = {
    WIN_BACK: {
        label: "Win-back",
        icon: UserX,
        description: "Customers who haven't visited in a while — send a coupon to bring them back.",
        defaultLookback: 60,
    },
    BIRTHDAY: {
        label: "Birthday",
        icon: Cake,
        description: "Customers celebrating their birthday today — send a special discount.",
        defaultLookback: 0,
    },
    ANNIVERSARY: {
        label: "Anniversary",
        icon: Heart,
        description: "Customers with anniversaries today.",
        defaultLookback: 0,
    },
}

export default function MarketingPage() {
    const supabase = createClient()
    const [tenantId, setTenantId] = useState("")
    const [type, setType] = useState<CampaignType>("WIN_BACK")
    const [lookback, setLookback] = useState(60)
    const [channel, setChannel] = useState<Channel>("whatsapp")
    const [eligible, setEligible] = useState<EligibleCustomer[]>([])
    const [loading, setLoading] = useState(false)
    const [coupons, setCoupons] = useState<Coupon[]>([])
    const [selectedCoupon, setSelectedCoupon] = useState<string>("")
    const [sending, setSending] = useState(false)
    const [progress, setProgress] = useState({ sent: 0, failed: 0 })
    const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string; type: string; channel: string; sent_count: number; failed_count: number; status: string; created_at: string }>>([])
    const [tenantName, setTenantName] = useState("")
    /** Cached snapshot of /api/notifications/credentials. Drives both the
     *  banner at the top AND whether the Send button is enabled for the
     *  currently-picked channel. Same shape the WhatsappStatusCard fetches
     *  internally; we keep our own copy here so the page can react to it. */
    const [msgStatus, setMsgStatus] = useState<WhatsappCredentialsStatus | null>(null)

    async function bootstrap() {
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) return
        const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
        if (!row?.tenant_id) return
        setTenantId(row.tenant_id)
        const { data: tenant } = await supabase.from("tenants").select("name").eq("id", row.tenant_id).maybeSingle()
        setTenantName(((tenant as { name?: string } | null)?.name) ?? "")
        // Three parallel reads: coupons (attach-on-send), recent campaigns
        // (the audit table at the bottom of the page), and the messaging
        // provider status — drives whether the Send button is enabled
        // for the currently-picked channel.
        const [couponsRes, campRes, msgRes] = await Promise.all([
            supabase.from("coupons").select("*").eq("is_active", true).order("created_at", { ascending: false }),
            supabase.from("marketing_campaigns").select("*").order("created_at", { ascending: false }).limit(20),
            fetch("/api/notifications/credentials", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).catch(() => null),
        ])
        setCoupons((couponsRes.data ?? []) as Coupon[])
        setCampaigns((campRes.data ?? []) as never)
        setMsgStatus(msgRes as WhatsappCredentialsStatus | null)
    }
    useEffect(() => { bootstrap() }, [])

    async function loadEligible() {
        setLoading(true)
        const { data, error } = await supabase.rpc("eligible_customers" as never, {
            p_type: type,
            p_lookback_days: lookback,
        } as never)
        setLoading(false)
        if (error) return toast.error(error.message)
        setEligible((data ?? []) as EligibleCustomer[])
    }
    useEffect(() => { if (tenantId) loadEligible() }, [type, lookback, tenantId])

    function buildMessage(c: EligibleCustomer): string {
        const coupon = coupons.find((x) => x.id === selectedCoupon)
        const name = c.name ?? "there"
        if (type === "BIRTHDAY") {
            return `🎂 Happy Birthday ${name}! ${tenantName} wishes you a wonderful day. ${coupon ? `Enjoy ${coupon.type === "PERCENT" ? coupon.value + "% off" : "₹" + coupon.value + " off"} with code *${coupon.code}* on your next visit!` : "We'd love to see you soon!"}`
        }
        if (type === "ANNIVERSARY") {
            return `❤️ Happy Anniversary ${name}! Celebrate with us at ${tenantName}. ${coupon ? `Use code *${coupon.code}* for a special treat.` : ""}`
        }
        return `Hi ${name}! We've missed you at ${tenantName}. ${coupon ? `Come back and enjoy ${coupon.type === "PERCENT" ? coupon.value + "% off" : "₹" + coupon.value + " off"} with code *${coupon.code}*.` : "Visit us this week for something special."}`
    }

    async function sendCampaign() {
        if (eligible.length === 0) return toast.error("No eligible customers")
        // Pre-flight: the picked channel must actually be wired up. If
        // the admin lands here before configuring Twilio every recipient
        // would 4xx silently — show the real problem instead.
        const channelReady = channel === "whatsapp" ? !!msgStatus?.whatsapp_ready : !!msgStatus?.sms_ready
        if (!channelReady) {
            return toast.error(`${channel.toUpperCase()} isn't connected yet. Open Settings → Notifications to connect your Twilio account, then come back.`)
        }
        if (!confirm(`Send to ${eligible.length} customer(s) via ${channel.toUpperCase()}? This may incur Twilio charges.`)) return
        setSending(true)
        setProgress({ sent: 0, failed: 0 })

        // create campaign record
        const { data: { user } } = await supabase.auth.getUser()
        const { data: campaign } = await supabase.from("marketing_campaigns").insert({
            tenant_id: tenantId,
            name: `${TYPE_META[type].label} — ${new Date().toISOString().slice(0, 10)}`,
            type,
            channel,
            // "none" is the sentinel for the "— None —" option (Radix
            // Select forbids an empty-string item value); treat it as null.
            coupon_id: selectedCoupon && selectedCoupon !== "none" ? selectedCoupon : null,
            target_count: eligible.length,
            status: "SENDING",
            created_by: user?.id ?? null,
        } as never).select("id").maybeSingle()
        const campaignId = (campaign as { id: string } | null)?.id

        let sent = 0, failed = 0
        for (const c of eligible) {
            if (!c.phone) { failed++; continue }
            try {
                const r = await fetch("/api/notifications/send", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        template: "marketing",
                        channel,
                        to: c.phone,
                        args: { message: buildMessage(c) },
                    }),
                })
                if (!r.ok) failed++; else sent++
            } catch {
                failed++
            }
            setProgress({ sent, failed })
        }

        if (campaignId) {
            await supabase.from("marketing_campaigns").update({
                sent_count: sent,
                failed_count: failed,
                status: failed === eligible.length ? "FAILED" : "COMPLETED",
                completed_at: new Date().toISOString(),
            } as never).eq("id", campaignId)
        }
        setSending(false)
        toast.success(`Campaign complete: ${sent} sent, ${failed} failed`)
        bootstrap()
    }

    const Meta = TYPE_META[type]
    const channelReady = channel === "whatsapp" ? !!msgStatus?.whatsapp_ready : !!msgStatus?.sms_ready

    return (
        <div className="container mx-auto py-8 max-w-6xl space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Marketing</h1>
                    <p className="text-muted-foreground">Win-back lapsed customers and celebrate special days.</p>
                </div>
                <Badge variant="neon"><Sparkles className="h-3 w-3 mr-1" /> Free + driven by your customer data</Badge>
            </div>

            {/* Messaging-provider status banner. When WhatsApp is not yet
              * connected, the card expands the step-by-step setup guide
              * automatically — admins land here, see exactly what's
              * blocking the Send button, and get a one-click path to the
              * Notifications settings to fix it. */}
            <WhatsappStatusCard />

            <Tabs value={type} onValueChange={(v) => setType(v as CampaignType)}>
                <TabsList>
                    {(["WIN_BACK", "BIRTHDAY", "ANNIVERSARY"] as const).map((t) => {
                        const M = TYPE_META[t]
                        return (
                            <TabsTrigger key={t} value={t}>
                                <M.icon className="h-3.5 w-3.5 mr-1" /> {M.label}
                            </TabsTrigger>
                        )
                    })}
                </TabsList>
                {(["WIN_BACK", "BIRTHDAY", "ANNIVERSARY"] as const).map((t) => (
                    <TabsContent key={t} value={t} className="space-y-4">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-base"><Meta.icon className="h-4 w-4 text-primary" /> {Meta.label} campaign</CardTitle>
                                <CardDescription>{Meta.description}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid sm:grid-cols-3 gap-3 items-end">
                                    {t === "WIN_BACK" && (
                                        <div className="space-y-1.5">
                                            <Label>Hasn't visited in (days)</Label>
                                            <Input type="number" min="7" value={lookback} onChange={(e) => setLookback(Number(e.target.value) || 60)} />
                                        </div>
                                    )}
                                    <div className="space-y-1.5">
                                        <Label>Channel</Label>
                                        <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                                                <SelectItem value="sms">SMS</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Attach coupon (optional)</Label>
                                        <Select value={selectedCoupon} onValueChange={setSelectedCoupon}>
                                            <SelectTrigger><SelectValue placeholder="No coupon" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">— None —</SelectItem>
                                                {coupons.map((c) => (
                                                    <SelectItem key={c.id} value={c.id}>
                                                        {c.code} ({c.type === "PERCENT" ? `${c.value}%` : formatCurrency(c.value)})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="rounded-md bg-muted/40 p-3 text-sm border border-border/40">
                                    <div className="font-medium mb-1 text-xs text-muted-foreground uppercase tracking-wider">Preview</div>
                                    <div className="whitespace-pre-line">{buildMessage({
                                        id: "x", name: "Aman", phone: "+91", email: null, loyalty_tier: "BRONZE", total_spent: 0,
                                        last_visit_at: null, date_of_birth: null, anniversary_date: null,
                                    })}</div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-base">Eligible customers ({eligible.length})</CardTitle>
                                    <div className="flex gap-2">
                                        <Button size="sm" variant="outline" onClick={loadEligible} disabled={loading}>
                                            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="neon"
                                            onClick={sendCampaign}
                                            disabled={sending || eligible.length === 0 || !channelReady}
                                            title={!channelReady
                                                ? `${channel.toUpperCase()} isn't connected yet — open Settings → Notifications to connect Twilio.`
                                                : undefined}
                                        >
                                            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                            Send to all ({eligible.length})
                                        </Button>
                                    </div>
                                </div>
                                {sending && (
                                    <CardDescription>Sending… {progress.sent} sent, {progress.failed} failed</CardDescription>
                                )}
                            </CardHeader>
                            <CardContent className="px-0">
                                {loading ? (
                                    <div className="text-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
                                ) : eligible.length === 0 ? (
                                    <div className="text-center py-12 text-muted-foreground">
                                        <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                        No eligible customers right now.
                                    </div>
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Name</TableHead>
                                                <TableHead>Phone</TableHead>
                                                <TableHead>Tier</TableHead>
                                                <TableHead className="text-right">Spent</TableHead>
                                                <TableHead>Last visit</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {eligible.slice(0, 50).map((c) => (
                                                <TableRow key={c.id}>
                                                    <TableCell>{c.name ?? "—"}</TableCell>
                                                    <TableCell className="font-mono text-xs">{c.phone}</TableCell>
                                                    <TableCell><Badge variant="outline">{c.loyalty_tier}</Badge></TableCell>
                                                    <TableCell className="text-right">{formatCurrency(c.total_spent)}</TableCell>
                                                    <TableCell className="text-sm text-muted-foreground">{c.last_visit_at ? formatDate(c.last_visit_at, { dateStyle: "medium" }) : "—"}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                ))}
            </Tabs>

            <Card>
                <CardHeader><CardTitle className="text-base">Recent campaigns</CardTitle></CardHeader>
                <CardContent className="px-0">
                    {campaigns.length === 0 ? (
                        <p className="text-center py-8 text-sm text-muted-foreground">No campaigns sent yet.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Channel</TableHead>
                                    <TableHead>Sent</TableHead>
                                    <TableHead>Failed</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>When</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {campaigns.map((c) => (
                                    <TableRow key={c.id}>
                                        <TableCell>{c.name}</TableCell>
                                        <TableCell><Badge variant="outline">{c.type}</Badge></TableCell>
                                        <TableCell>{c.channel}</TableCell>
                                        <TableCell className="text-success">{c.sent_count}</TableCell>
                                        <TableCell className="text-destructive">{c.failed_count}</TableCell>
                                        <TableCell><Badge variant={c.status === "COMPLETED" ? "success" : c.status === "FAILED" ? "destructive" : "warning"}>{c.status}</Badge></TableCell>
                                        <TableCell className="text-sm">{formatDate(c.created_at, { dateStyle: "medium" })}</TableCell>
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
