"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, KeyRound, Loader2, MessageCircle, Save, Send, XCircle } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { PageHeader } from "@/components/app-shell/page-header"
import { WhatsappSetupGuide } from "@/components/integrations/whatsapp-status-card"
import { createClient } from "@/lib/supabase/client"
import type { Tenant } from "@/types/database"

interface NotificationSettings {
    bill_whatsapp: boolean
    bill_sms: boolean
    reservation_whatsapp: boolean
    reservation_sms: boolean
    reservation_reminder_hours: number
    low_stock_whatsapp: boolean
    low_stock_to: string
}

const DEFAULTS: NotificationSettings = {
    bill_whatsapp: false,
    bill_sms: false,
    reservation_whatsapp: false,
    reservation_sms: false,
    reservation_reminder_hours: 2,
    low_stock_whatsapp: false,
    low_stock_to: "",
}

/** Shape of GET /api/notifications/credentials — the auth token is never
 *  part of this; only `has_auth_token`. */
interface MessagingStatus {
    provider: string
    enabled: boolean
    account_sid: string | null
    has_auth_token: boolean
    whatsapp_from: string | null
    sms_from: string | null
    source: "tenant" | "env" | "none"
    whatsapp_ready: boolean
    sms_ready: boolean
    can_edit: boolean
}

export default function NotificationSettingsPage() {
    const supabase = createClient()
    const [tenant, setTenant] = useState<Tenant | null>(null)
    const [settings, setSettings] = useState<NotificationSettings>(DEFAULTS)
    const [loyaltyEnabled, setLoyaltyEnabled] = useState(false)
    const [loyaltyEarn, setLoyaltyEarn] = useState("5")
    const [loyaltyRedeem, setLoyaltyRedeem] = useState("0.5")
    const [busy, setBusy] = useState(false)

    // ── Messaging provider (Twilio) credentials ──────────────────────────
    const [msg, setMsg] = useState<MessagingStatus | null>(null)
    const [accountSid, setAccountSid] = useState("")
    const [authToken, setAuthToken] = useState("")
    const [whatsappFrom, setWhatsappFrom] = useState("")
    const [smsFrom, setSmsFrom] = useState("")
    const [msgEnabled, setMsgEnabled] = useState(false)
    const [savingCreds, setSavingCreds] = useState(false)
    // Test send
    const [testPhone, setTestPhone] = useState("")
    const [testChannel, setTestChannel] = useState<"whatsapp" | "sms">("sms")
    const [testing, setTesting] = useState(false)
    const [showGuide, setShowGuide] = useState(false)

    async function loadMessaging() {
        try {
            const r = await fetch("/api/notifications/credentials", { cache: "no-store" })
            if (!r.ok) return
            const data = (await r.json()) as MessagingStatus
            setMsg(data)
            setAccountSid(data.account_sid ?? "")
            setWhatsappFrom(data.whatsapp_from ?? "")
            setSmsFrom(data.sms_from ?? "")
            setMsgEnabled(data.enabled)
            setAuthToken("") // never prefill the secret
        } catch { /* leave msg null — card shows a soft error */ }
    }

    useEffect(() => {
        ;(async () => {
            const { data: u } = await supabase.auth.getUser()
            if (!u.user) return
            const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
            if (!row?.tenant_id) return
            const { data: t } = await supabase.from("tenants").select("*").eq("id", row.tenant_id).maybeSingle()
            if (t) {
                const tt = t as Tenant & { loyalty_enabled?: boolean; loyalty_earn_per_100?: number; loyalty_redeem_value?: number }
                setTenant(tt)
                const stored = (tt.settings as { notifications?: Partial<NotificationSettings> })?.notifications ?? {}
                setSettings({ ...DEFAULTS, ...stored })
                setLoyaltyEnabled(!!tt.loyalty_enabled)
                setLoyaltyEarn(String(tt.loyalty_earn_per_100 ?? 5))
                setLoyaltyRedeem(String(tt.loyalty_redeem_value ?? 0.5))
            }
            await loadMessaging()
        })()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [supabase])

    async function save() {
        if (!tenant) return
        setBusy(true)
        const newSettings = { ...(tenant.settings ?? {}), notifications: settings }
        const { error } = await supabase
            .from("tenants")
            .update({
                settings: newSettings,
                loyalty_enabled: loyaltyEnabled,
                loyalty_earn_per_100: Number(loyaltyEarn) || 0,
                loyalty_redeem_value: Number(loyaltyRedeem) || 0,
            } as never)
            .eq("id", tenant.id)
        setBusy(false)
        if (error) return toast.error(error.message)
        toast.success("Notification settings saved")
    }

    async function saveCreds() {
        setSavingCreds(true)
        try {
            const r = await fetch("/api/notifications/credentials", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    account_sid: accountSid,
                    auth_token: authToken,            // blank = keep the saved one
                    whatsapp_from: whatsappFrom,
                    sms_from: smsFrom,
                    enabled: msgEnabled,
                }),
            })
            const data = (await r.json()) as { ok?: boolean; error?: string }
            if (!r.ok || !data.ok) throw new Error(data.error ?? "Couldn't save")
            toast.success("Messaging credentials saved")
            await loadMessaging()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't save credentials")
        } finally {
            setSavingCreds(false)
        }
    }

    async function sendTest() {
        if (!testPhone.trim()) return toast.error("Enter a phone number to test")
        setTesting(true)
        try {
            const r = await fetch("/api/notifications/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    template: "marketing",
                    channel: testChannel,
                    to: testPhone.trim(),
                    args: { message: `Test message from ${tenant?.name ?? "your restaurant"} — RestoPOS messaging is working. ✅` },
                }),
            })
            const data = (await r.json()) as { ok?: boolean; error?: string }
            if (!r.ok || !data.ok) throw new Error(data.error ?? "Send failed")
            toast.success(`Test ${testChannel.toUpperCase()} sent to ${testPhone.trim()}`)
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Test send failed")
        } finally {
            setTesting(false)
        }
    }

    function set<K extends keyof NotificationSettings>(k: K, v: NotificationSettings[K]) {
        setSettings((prev) => ({ ...prev, [k]: v }))
    }

    if (!tenant) return <div className="container mx-auto py-8 text-muted-foreground">Loading…</div>

    const whatsappReady = !!msg?.whatsapp_ready
    const smsReady = !!msg?.sms_ready
    const canEdit = msg?.can_edit !== false

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-3xl space-y-6">
            <PageHeader
                kicker="Configure"
                title="Notifications &amp; Loyalty"
                highlight="WhatsApp + SMS"
                description="Connect your messaging account, then send bill / reservation / promotional messages."
            />

            {/* ── Messaging provider credentials ──────────────────────────── */}
            <Card>
                <CardHeader>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                            <CardTitle className="text-base flex items-center gap-2">
                                <KeyRound className="h-4 w-4" /> WhatsApp &amp; SMS provider
                            </CardTitle>
                            <CardDescription>
                                Connect your own <strong>Twilio</strong> account — one account sends both WhatsApp and
                                SMS. Messages then go out on your number and your bill.
                            </CardDescription>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setShowGuide((v) => !v)}
                        >
                            {showGuide ? "Hide" : "Show"} step-by-step guide
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    {showGuide && <WhatsappSetupGuide compact />}
                    <div className="grid grid-cols-2 gap-4">
                        <Status label="WhatsApp" ok={whatsappReady} />
                        <Status label="SMS" ok={smsReady} />
                    </div>
                    {msg?.source === "env" && (
                        <p className="text-xs text-muted-foreground rounded-md bg-muted/40 px-3 py-2">
                            Currently using the platform default sender. Enter your own Twilio details below to
                            send under your restaurant&apos;s number instead.
                        </p>
                    )}

                    <div className="grid sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label>Twilio Account SID</Label>
                            <Input
                                value={accountSid}
                                onChange={(e) => setAccountSid(e.target.value)}
                                placeholder="ACxxxxxxxxxxxxxxxx"
                                className="font-mono text-xs"
                                disabled={!canEdit}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Twilio Auth Token</Label>
                            <Input
                                type="password"
                                value={authToken}
                                onChange={(e) => setAuthToken(e.target.value)}
                                placeholder={msg?.has_auth_token ? "•••••••• saved — leave blank to keep" : "your auth token"}
                                className="font-mono text-xs"
                                disabled={!canEdit}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>WhatsApp sender</Label>
                            <Input
                                value={whatsappFrom}
                                onChange={(e) => setWhatsappFrom(e.target.value)}
                                placeholder="whatsapp:+14155238886"
                                className="font-mono text-xs"
                                disabled={!canEdit}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>SMS sender</Label>
                            <Input
                                value={smsFrom}
                                onChange={(e) => setSmsFrom(e.target.value)}
                                placeholder="+14155238886"
                                className="font-mono text-xs"
                                disabled={!canEdit}
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                        <div>
                            <Label>Enable messaging</Label>
                            <p className="text-xs text-muted-foreground">Off = messages fall back to the platform default (if any).</p>
                        </div>
                        <Switch checked={msgEnabled} onCheckedChange={setMsgEnabled} disabled={!canEdit} />
                    </div>

                    <p className="text-xs text-muted-foreground rounded-md bg-warning/10 border border-warning/30 px-3 py-2 leading-relaxed">
                        <strong>Before promotions go out:</strong> WhatsApp marketing messages must use
                        Meta-approved message templates, and SMS to Indian numbers needs a DLT-registered
                        sender ID &amp; templates. Set those up in your Twilio / provider console — this screen
                        only stores the account that sends them.
                    </p>

                    {canEdit && (
                        <div className="flex justify-end">
                            <Button variant="neon" onClick={saveCreds} disabled={savingCreds}>
                                {savingCreds ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                Save credentials
                            </Button>
                        </div>
                    )}

                    {/* Test send — confirms the account actually works. */}
                    <div className="rounded-md border border-border/50 bg-muted/20 p-3 space-y-2">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Send a test message</Label>
                        <div className="flex flex-wrap gap-2 items-end">
                            <Input
                                value={testPhone}
                                onChange={(e) => setTestPhone(e.target.value)}
                                placeholder="+91 98765 43210"
                                className="w-48"
                            />
                            <Select value={testChannel} onValueChange={(v) => setTestChannel(v as "whatsapp" | "sms")}>
                                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="sms">SMS</SelectItem>
                                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                                </SelectContent>
                            </Select>
                            <Button
                                variant="outline"
                                onClick={sendTest}
                                disabled={testing || (testChannel === "whatsapp" ? !whatsappReady : !smsReady)}
                            >
                                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                Send test
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Bill notifications</CardTitle>
                    <CardDescription>Send the bill PDF link to the customer when generated.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Toggle label="WhatsApp" value={settings.bill_whatsapp} onChange={(v) => set("bill_whatsapp", v)} disabled={!whatsappReady} />
                    <Toggle label="SMS" value={settings.bill_sms} onChange={(v) => set("bill_sms", v)} disabled={!smsReady} />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Reservation notifications</CardTitle>
                    <CardDescription>Confirm bookings and remind guests before arrival.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Toggle label="Confirmation via WhatsApp" value={settings.reservation_whatsapp} onChange={(v) => set("reservation_whatsapp", v)} disabled={!whatsappReady} />
                    <Toggle label="Confirmation via SMS" value={settings.reservation_sms} onChange={(v) => set("reservation_sms", v)} disabled={!smsReady} />
                    <div className="grid grid-cols-2 gap-3 items-end">
                        <div className="space-y-1.5">
                            <Label>Reminder hours before booking</Label>
                            <Input type="number" min="0" value={settings.reservation_reminder_hours} onChange={(e) => set("reservation_reminder_hours", Number(e.target.value))} />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Low stock alerts</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Toggle label="WhatsApp the owner when stock falls below reorder level" value={settings.low_stock_whatsapp} onChange={(v) => set("low_stock_whatsapp", v)} disabled={!whatsappReady} />
                    <div className="space-y-1.5">
                        <Label>Owner phone for stock alerts</Label>
                        <Input value={settings.low_stock_to} onChange={(e) => set("low_stock_to", e.target.value)} placeholder="+91 ..." />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Loyalty programme</CardTitle>
                    <CardDescription>Reward repeat customers with points, redeemable on next visit.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                        <div>
                            <Label>Enable loyalty</Label>
                            <p className="text-xs text-muted-foreground">Public link: /loyalty/{tenant.slug}</p>
                        </div>
                        <Switch checked={loyaltyEnabled} onCheckedChange={setLoyaltyEnabled} />
                    </div>
                    {loyaltyEnabled && (
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Earn rate (points per ₹100 spent)</Label>
                                <Input type="number" min="0" value={loyaltyEarn} onChange={(e) => setLoyaltyEarn(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Redeem value (₹ per point)</Label>
                                <Input type="number" step="0.01" min="0" value={loyaltyRedeem} onChange={(e) => setLoyaltyRedeem(e.target.value)} />
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="flex justify-end">
                <Button variant="neon" onClick={save} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                </Button>
            </div>
        </div>
    )
}

function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
    return (
        <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
            <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-muted-foreground" />
                <Label className={disabled ? "text-muted-foreground" : ""}>{label}</Label>
                {disabled && <Badge variant="secondary" className="text-[10px]">not configured</Badge>}
            </div>
            <Switch checked={value} onCheckedChange={onChange} disabled={disabled} />
        </div>
    )
}

function Status({ label, ok }: { label: string; ok: boolean }) {
    return (
        <div className="flex items-center gap-2 rounded-md border border-border/60 p-3">
            {ok ? <CheckCircle2 className="h-5 w-5 text-success" /> : <XCircle className="h-5 w-5 text-muted-foreground" />}
            <div>
                <div className="font-medium text-sm">{label}</div>
                <div className="text-xs text-muted-foreground">{ok ? "Ready to send" : "Not configured"}</div>
            </div>
        </div>
    )
}
