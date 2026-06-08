"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
    AlertCircle,
    ArrowUpRight,
    CheckCircle2,
    CreditCard,
    ExternalLink,
    HelpCircle,
    Loader2,
    Save,
    ShieldCheck,
    Smartphone,
    Wallet,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { getGatewayForCountry } from "@/lib/payments/gateway"

/**
 * Payment settings — per-tenant gateway connection.
 *
 * India tenants get the PhonePe Business form (Client Id + Client Secret
 * + Client Version, with a staging / production pair) plus a manual UPI
 * fallback the customer-facing flows downgrade to when PhonePe isn't
 * connected. Non-India tenants get Stripe Connect.
 */
type PhonePeEnv = "staging" | "production"

interface PhonePeRow {
    phonepe_mid: string | null
    phonepe_merchant_key: string | null
    phonepe_salt_index: string | null
    phonepe_mid_staging: string | null
    phonepe_merchant_key_staging: string | null
    phonepe_salt_index_staging: string | null
    phonepe_enabled: boolean | null
    phonepe_env: PhonePeEnv | null
}

export default function PaymentSettingsPage() {
    const supabase = createClient()
    const [tenantId, setTenantId] = useState("")
    const [tenantName, setTenantName] = useState("")
    const [country, setCountry] = useState<string | null>(null)

    // Manual UPI fallback
    const [upiId, setUpiId] = useState("")
    const [upiPayee, setUpiPayee] = useState("")

    // Which India method's config is on screen — PhonePe / Paytm / Manual UPI
    // live in tabs so the operator configures ONE at a time and the three
    // forms never crowd each other. Defaults to the tenant's active method.
    const [methodTab, setMethodTab] = useState<"phonepe" | "paytm" | "manual">("phonepe")

    // PhonePe — production pair
    const [ppMidProd, setPpMidProd] = useState("")
    const [ppKeyProd, setPpKeyProd] = useState("")
    const [ppIndexProd, setPpIndexProd] = useState("1")
    // PhonePe — staging pair (kept separate so the user can flip env
    // without re-pasting credentials)
    const [ppMidStaging, setPpMidStaging] = useState("")
    const [ppKeyStaging, setPpKeyStaging] = useState("")
    const [ppIndexStaging, setPpIndexStaging] = useState("1")
    const [ppEnv, setPpEnv] = useState<PhonePeEnv>("staging")
    const [ppEnabled, setPpEnabled] = useState(false)

    // Paytm — production + staging pairs (MID + Merchant Key; no salt index)
    const [paytmMidProd, setPaytmMidProd] = useState("")
    const [paytmKeyProd, setPaytmKeyProd] = useState("")
    const [paytmMidStaging, setPaytmMidStaging] = useState("")
    const [paytmKeyStaging, setPaytmKeyStaging] = useState("")
    const [paytmEnv, setPaytmEnv] = useState<PhonePeEnv>("staging")
    const [paytmEnabled, setPaytmEnabled] = useState(false)
    const [testingPaytm, setTestingPaytm] = useState(false)

    // Stripe
    const [stripeAccountId, setStripeAccountId] = useState("")
    const [stripeEnabled, setStripeEnabled] = useState(true)
    const [stripeAccountCountry, setStripeAccountCountry] = useState<string | null>(null)

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [testing, setTesting] = useState(false)
    const [disconnectingPp, setDisconnectingPp] = useState(false)
    const [connectingStripe, setConnectingStripe] = useState(false)
    const [disconnectingStripe, setDisconnectingStripe] = useState(false)
    // True once we've confirmed the `tenant_payment_gateways.phonepe_*`
    // columns exist. False until `scripts/sql/install-phonepe.sql` has
    // been applied to the database. The PhonePe card hides its form
    // (and shows a "Run the SQL first" notice) while this is false.
    const [phonepeSchemaInstalled, setPhonepeSchemaInstalled] = useState(true)
    const [stripeDashboardBusy, setStripeDashboardBusy] = useState(false)

    useEffect(() => {
        void (async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { setLoading(false); return }
            const { data: row } = await supabase.from("users").select("tenant_id").eq("id", user.id).maybeSingle()
            const tid = (row as { tenant_id?: string } | null)?.tenant_id
            if (!tid) { setLoading(false); return }
            setTenantId(tid)
            const { data: t } = await supabase
                .from("tenants")
                .select("name, country, upi_id, upi_payee_name, payment_gateway")
                .eq("id", tid)
                .maybeSingle()
            const tt = t as { name?: string; country?: string | null; upi_id?: string | null; upi_payee_name?: string | null; payment_gateway?: string | null } | null
            setTenantName(tt?.name ?? "")
            setCountry(tt?.country ?? null)
            setUpiId(tt?.upi_id ?? "")
            setUpiPayee(tt?.upi_payee_name ?? "")
            // Load Stripe + PhonePe rows separately so the page survives
            // a database that hasn't yet had `install-phonepe.sql` applied
            // (where the phonepe_* columns simply don't exist — without
            // this split, ONE bad column name 400s the whole query and
            // even Stripe settings can't load).
            const { data: stripeGw } = await supabase
                .from("tenant_payment_gateways")
                .select("stripe_connected_account_id, stripe_account_enabled, stripe_account_country")
                .eq("tenant_id", tid)
                .maybeSingle()
            const sg = stripeGw as {
                stripe_connected_account_id?: string | null
                stripe_account_enabled?: boolean | null
                stripe_account_country?: string | null
            } | null
            if (sg) {
                setStripeAccountId(sg.stripe_connected_account_id ?? "")
                setStripeEnabled(sg.stripe_account_enabled !== false)
                setStripeAccountCountry(sg.stripe_account_country ?? null)
            }

            const { data: ppGw, error: ppErr } = await supabase
                .from("tenant_payment_gateways")
                .select("phonepe_mid, phonepe_merchant_key, phonepe_salt_index, phonepe_mid_staging, phonepe_merchant_key_staging, phonepe_salt_index_staging, phonepe_enabled, phonepe_env")
                .eq("tenant_id", tid)
                .maybeSingle()
            // PostgrestError 42703 = "column does not exist" → schema
            // missing; switch the PhonePe card into a "run the SQL"
            // notice and leave the Stripe / manual UPI controls usable.
            if (ppErr && (ppErr.code === "42703" || /does not exist/i.test(ppErr.message ?? ""))) {
                setPhonepeSchemaInstalled(false)
            } else {
                const g = ppGw as PhonePeRow | null
                if (g) {
                    setPpMidProd(g.phonepe_mid ?? "")
                    setPpKeyProd(g.phonepe_merchant_key ?? "")
                    setPpIndexProd(g.phonepe_salt_index ?? "1")
                    setPpMidStaging(g.phonepe_mid_staging ?? "")
                    setPpKeyStaging(g.phonepe_merchant_key_staging ?? "")
                    setPpIndexStaging(g.phonepe_salt_index_staging ?? "1")
                    setPpEnv((g.phonepe_env ?? "staging") as PhonePeEnv)
                    setPpEnabled(!!g.phonepe_enabled)
                }
            }

            // Paytm row (columns exist from migrations 33 + 54). Loaded
            // separately so a missing column can't 400 the whole page.
            const { data: paytmGw } = await supabase
                .from("tenant_payment_gateways")
                .select("paytm_mid, paytm_merchant_key, paytm_mid_staging, paytm_merchant_key_staging, paytm_enabled, paytm_env")
                .eq("tenant_id", tid)
                .maybeSingle()
            const pg = paytmGw as {
                paytm_mid?: string | null; paytm_merchant_key?: string | null
                paytm_mid_staging?: string | null; paytm_merchant_key_staging?: string | null
                paytm_enabled?: boolean | null; paytm_env?: string | null
            } | null
            if (pg) {
                setPaytmMidProd(pg.paytm_mid ?? "")
                setPaytmKeyProd(pg.paytm_merchant_key ?? "")
                setPaytmMidStaging(pg.paytm_mid_staging ?? "")
                setPaytmKeyStaging(pg.paytm_merchant_key_staging ?? "")
                setPaytmEnv((pg.paytm_env ?? "staging") as PhonePeEnv)
                setPaytmEnabled(!!pg.paytm_enabled)
            }

            // Open the tab for the currently-active method: the enabled flag
            // wins, then the stored payment_gateway, else default to PhonePe.
            const ppOn = (ppGw as PhonePeRow | null)?.phonepe_enabled
            const pgw = tt?.payment_gateway
            setMethodTab(
                pg?.paytm_enabled || pgw === "paytm" ? "paytm"
                    : ppOn || pgw === "phonepe" ? "phonepe"
                    : pgw === "manual" ? "manual"
                    : "phonepe",
            )
            setLoading(false)
        })()
    }, [supabase])

    const isIndia = country
        ? getGatewayForCountry(country) === "phonepe"
        : false

    // The pair the active env will actually use — the Test connection
    // button targets these so the operator validates the right pair.
    const activeMid = ppEnv === "production" ? ppMidProd : ppMidStaging
    const activeKey = ppEnv === "production" ? ppKeyProd : ppKeyStaging
    const activeIndex = ppEnv === "production" ? ppIndexProd : ppIndexStaging
    const phonepeConnected =
        !!ppEnabled && !!activeMid.trim() && !!activeKey.trim()

    const activePaytmMid = paytmEnv === "production" ? paytmMidProd : paytmMidStaging
    const activePaytmKey = paytmEnv === "production" ? paytmKeyProd : paytmKeyStaging
    const paytmConnected = !!paytmEnabled && !!activePaytmMid.trim() && !!activePaytmKey.trim()

    // Single active gateway: turning one ON turns the others OFF. The DB
    // trigger (migration 58) is the backstop; this keeps the UI honest so
    // the operator never tries to save two live gateways.
    function enablePhonePe(v: boolean) {
        setPpEnabled(v)
        if (v) setPaytmEnabled(false)
    }
    function enablePaytm(v: boolean) {
        setPaytmEnabled(v)
        if (v) setPpEnabled(false)
    }

    async function testPhonePe() {
        if (!activeMid.trim() || !activeKey.trim()) {
            toast.error("Enter both Client Id and Client Secret first.")
            return
        }
        setTesting(true)
        try {
            const r = await fetch("/api/payments/phonepe/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    merchant_id: activeMid.trim(),
                    salt_key: activeKey.trim(),
                    salt_index: activeIndex.trim() || "1",
                    env: ppEnv,
                }),
            })
            const data = await r.json() as { ok?: boolean; message?: string; error?: string }
            if (data.ok) {
                toast.success(data.message || "PhonePe credentials are valid")
            } else {
                toast.error(data.error || "PhonePe rejected the credentials")
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't reach PhonePe")
        } finally {
            setTesting(false)
        }
    }

    async function disconnectPhonePe() {
        if (!window.confirm("Disconnect PhonePe? In-flight transactions will still resolve, but no new payments can be minted until you reconnect.")) return
        setDisconnectingPp(true)
        try {
            const r = await fetch("/api/payments/phonepe/disconnect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            })
            const data = await r.json() as { ok?: boolean; error?: string }
            if (!r.ok || !data.ok) throw new Error(data.error ?? "Disconnect failed")
            setPpMidProd("")
            setPpKeyProd("")
            setPpIndexProd("1")
            setPpMidStaging("")
            setPpKeyStaging("")
            setPpIndexStaging("1")
            setPpEnv("staging")
            setPpEnabled(false)
            toast.success("PhonePe disconnected")
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Disconnect failed")
        } finally {
            setDisconnectingPp(false)
        }
    }

    async function testPaytm() {
        if (!activePaytmMid.trim() || !activePaytmKey.trim()) {
            toast.error("Enter both Merchant ID and Merchant Key first.")
            return
        }
        setTestingPaytm(true)
        try {
            const r = await fetch("/api/payments/paytm/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mid: activePaytmMid.trim(), merchant_key: activePaytmKey.trim(), env: paytmEnv }),
            })
            const data = await r.json() as { ok?: boolean; message?: string; error?: string }
            if (data.ok) toast.success(data.message || "Paytm credentials are valid")
            else toast.error(data.error || "Paytm rejected the credentials")
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't reach Paytm")
        } finally {
            setTestingPaytm(false)
        }
    }

    async function disconnectPaytm() {
        if (!window.confirm("Disconnect Paytm? In-flight transactions still resolve, but no new Paytm QRs can be minted until you reconnect.")) return
        try {
            const { error } = await supabase
                .from("tenant_payment_gateways")
                .upsert({
                    tenant_id: tenantId,
                    paytm_mid: null, paytm_merchant_key: null,
                    paytm_mid_staging: null, paytm_merchant_key_staging: null,
                    paytm_enabled: false,
                } as never)
            if (error) throw error
            setPaytmMidProd(""); setPaytmKeyProd(""); setPaytmMidStaging(""); setPaytmKeyStaging("")
            setPaytmEnv("staging"); setPaytmEnabled(false)
            toast.success("Paytm disconnected")
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Disconnect failed")
        }
    }

    async function save() {
        if (!tenantId) return
        setSaving(true)
        try {
            // For India, the active method is the single source of truth in
            // tenants.payment_gateway: whichever online gateway is enabled, or
            // 'manual' when neither is. Non-India tenants route through Stripe
            // (the resolver ignores this column for them) so we leave it alone.
            const tenantUpdate: Record<string, unknown> = {
                upi_id: upiId.trim() || null,
                upi_payee_name: upiPayee.trim() || null,
            }
            if (isIndia) {
                tenantUpdate.payment_gateway = ppEnabled ? "phonepe" : paytmEnabled ? "paytm" : "manual"
            }
            const { error: tErr } = await supabase
                .from("tenants")
                .update(tenantUpdate as never)
                .eq("id", tenantId)
            if (tErr) throw tErr
            // Build the upsert payload conditionally — if the PhonePe
            // schema migration hasn't been applied yet, omit every
            // phonepe_* column or the upsert 400s on "column doesn't
            // exist" and the cashier can't even save their Stripe info.
            const upsertPayload: Record<string, unknown> = {
                tenant_id: tenantId,
                stripe_connected_account_id: stripeAccountId.trim() || null,
                stripe_account_enabled: stripeEnabled,
            }
            if (phonepeSchemaInstalled) {
                upsertPayload.phonepe_mid = ppMidProd.trim() || null
                upsertPayload.phonepe_merchant_key = ppKeyProd.trim() || null
                upsertPayload.phonepe_salt_index = ppIndexProd.trim() || "1"
                upsertPayload.phonepe_mid_staging = ppMidStaging.trim() || null
                upsertPayload.phonepe_merchant_key_staging = ppKeyStaging.trim() || null
                upsertPayload.phonepe_salt_index_staging = ppIndexStaging.trim() || "1"
                upsertPayload.phonepe_env = ppEnv
                upsertPayload.phonepe_enabled = ppEnabled
            }
            // Paytm columns exist from migrations 33 + 54.
            upsertPayload.paytm_mid = paytmMidProd.trim() || null
            upsertPayload.paytm_merchant_key = paytmKeyProd.trim() || null
            upsertPayload.paytm_mid_staging = paytmMidStaging.trim() || null
            upsertPayload.paytm_merchant_key_staging = paytmKeyStaging.trim() || null
            upsertPayload.paytm_env = paytmEnv
            upsertPayload.paytm_enabled = paytmEnabled
            const { error: gErr } = await supabase
                .from("tenant_payment_gateways")
                .upsert(upsertPayload as never)
            if (gErr) throw gErr
            toast.success(
                phonepeSchemaInstalled
                    ? "Payment settings saved"
                    : "Saved — apply scripts/sql/install-phonepe.sql to enable PhonePe",
            )
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't save")
        } finally {
            setSaving(false)
        }
    }

    async function connectStripe() {
        setConnectingStripe(true)
        try {
            const r = await fetch("/api/payments/stripe/connect/onboard", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refresh_url: window.location.href, return_url: window.location.href }),
            })
            const data = await r.json() as { url?: string; error?: string }
            if (!r.ok || !data.url) throw new Error(data.error ?? "Couldn't start Stripe onboarding")
            window.location.href = data.url
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Stripe onboarding failed")
            setConnectingStripe(false)
        }
    }

    async function disconnectStripe() {
        if (!window.confirm("Disconnect Stripe from RestoPOS? Card payments will stop until you reconnect.")) return
        setDisconnectingStripe(true)
        try {
            const r = await fetch("/api/payments/stripe/connect/disconnect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            })
            const data = await r.json() as { ok?: boolean; error?: string }
            if (!r.ok || !data.ok) throw new Error(data.error ?? "Disconnect failed")
            setStripeAccountId("")
            setStripeEnabled(true)
            setStripeAccountCountry(null)
            toast.success("Stripe disconnected")
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Disconnect failed")
        } finally {
            setDisconnectingStripe(false)
        }
    }

    async function openStripeDashboard() {
        setStripeDashboardBusy(true)
        try {
            const r = await fetch("/api/payments/stripe/connect/dashboard-link", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            })
            const data = await r.json() as { url?: string; error?: string }
            if (!r.ok || !data.url) throw new Error(data.error ?? "Couldn't open Stripe dashboard")
            window.open(data.url, "_blank", "noopener")
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't open Stripe dashboard")
        } finally {
            setStripeDashboardBusy(false)
        }
    }

    if (loading) {
        return (
            <div className="container mx-auto py-12 px-4 max-w-3xl">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading payment settings…
                </div>
            </div>
        )
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-3xl space-y-6 pb-24">
            <PageHeader
                kicker="Settings"
                title="Payments"
                description={
                    isIndia
                        ? `How ${tenantName || "your restaurant"} accepts money from customers. Connect PhonePe Business for auto-confirmed UPI, or use manual UPI screenshots as a fallback.`
                        : `How ${tenantName || "your restaurant"} accepts money from customers. Connect a Stripe account to take cards.${country ? " Country: " + country + "." : ""}`
                }
            />

            {/* ── India: PhonePe / Paytm / Manual UPI in tabs ──────────
              * One tab per method so the three forms never crowd each other.
              * The active method (the one that's enabled) is marked with a dot;
              * enabling a gateway in its tab disables the others (single-active
              * rule, enforced in save() + the DB trigger). */}
            {isIndia && (
                <Tabs value={methodTab} onValueChange={(v) => setMethodTab(v as "phonepe" | "paytm" | "manual")} className="space-y-4">
                    <TabsList className="grid grid-cols-3 w-full">
                        <TabsTrigger value="phonepe">PhonePe{ppEnabled ? " ●" : ""}</TabsTrigger>
                        <TabsTrigger value="paytm">Paytm{paytmEnabled ? " ●" : ""}</TabsTrigger>
                        <TabsTrigger value="manual">Manual UPI{!ppEnabled && !paytmEnabled ? " ●" : ""}</TabsTrigger>
                    </TabsList>

                    <TabsContent value="phonepe" className="space-y-4 mt-0">
                    <Card className="border-primary/30">
                        <CardHeader className="space-y-3">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <ShieldCheck className="h-4 w-4 text-primary" />
                                        PhonePe Business
                                        {phonepeConnected ? (
                                            <Badge variant="success" className="ml-2 text-[10px]">Connected</Badge>
                                        ) : (
                                            <Badge variant="outline" className="ml-2 text-[10px]">Not connected</Badge>
                                        )}
                                    </CardTitle>
                                    <CardDescription>
                                        Auto-confirmed UPI payments. Staff bills generate a dynamic QR shown on the customer screen; QR-ordering opens any UPI app via intent link. Webhook flips the bill to PAID.
                                    </CardDescription>
                                </div>
                                <Button asChild variant="ghost" size="sm" className="shrink-0">
                                    <Link href="/setup-guide/phonepe">
                                        <HelpCircle className="h-4 w-4" /> Setup guide
                                        <ArrowUpRight className="h-3 w-3" />
                                    </Link>
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {!phonepeSchemaInstalled && (
                                <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm space-y-1.5">
                                    <div className="flex items-center gap-2 font-semibold text-warning">
                                        <AlertCircle className="h-4 w-4" />
                                        Database migration required
                                    </div>
                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                        The PhonePe credential columns aren&apos;t in your database yet. Open Supabase SQL Editor and run{" "}
                                        <code className="font-mono text-[11px] bg-background/70 px-1 py-0.5 rounded border border-border/60">
                                            scripts/sql/install-phonepe.sql
                                        </code>
                                        {" "}— it&apos;s idempotent, safe to apply on a live database. The page will start showing the credential form as soon as the migration is applied.
                                    </p>
                                </div>
                            )}

                            {phonepeSchemaInstalled && (
                            <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3">
                                <div>
                                    <Label>Accept UPI payments via PhonePe</Label>
                                    <p className="text-xs text-muted-foreground">
                                        Toggle off to temporarily stop minting new PhonePe transactions without erasing credentials. Enabling this turns Paytm off — only one gateway runs at a time.
                                    </p>
                                </div>
                                <Switch checked={ppEnabled} onCheckedChange={enablePhonePe} />
                            </div>
                            )}

                            {phonepeSchemaInstalled && (
                            <Tabs value={ppEnv} onValueChange={(v) => setPpEnv(v as PhonePeEnv)} className="space-y-3">
                                <TabsList className="grid grid-cols-2 w-full">
                                    <TabsTrigger value="staging">Sandbox (UAT)</TabsTrigger>
                                    <TabsTrigger value="production">Production (live)</TabsTrigger>
                                </TabsList>

                                <TabsContent value="staging" className="space-y-3 mt-0">
                                    <p className="text-xs text-muted-foreground">
                                        Use PhonePe&apos;s test environment for end-to-end testing before going live. Enable <strong>Test Mode</strong> in your PhonePe Business dashboard → Developer Settings → API Keys, then copy the test credentials here.
                                    </p>
                                    <div className="grid sm:grid-cols-[1fr_140px] gap-3">
                                        <div className="space-y-1.5">
                                            <Label htmlFor="pp-mid-staging">Client Id</Label>
                                            <Input
                                                id="pp-mid-staging"
                                                placeholder="M22JQD81LRJIC_2606031436"
                                                value={ppMidStaging}
                                                onChange={(e) => setPpMidStaging(e.target.value)}
                                                autoComplete="off"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="pp-idx-staging">Client Version</Label>
                                            <Input
                                                id="pp-idx-staging"
                                                placeholder="1"
                                                value={ppIndexStaging}
                                                onChange={(e) => setPpIndexStaging(e.target.value)}
                                                autoComplete="off"
                                                inputMode="numeric"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="pp-key-staging">Client Secret</Label>
                                        <Input
                                            id="pp-key-staging"
                                            type="password"
                                            placeholder="YmI2NDI0Y2YtOGJhYy00YzA0LTg2NmItNmIzMTUxY2U1YzUw"
                                            value={ppKeyStaging}
                                            onChange={(e) => setPpKeyStaging(e.target.value)}
                                            autoComplete="off"
                                        />
                                        <p className="text-[11px] text-muted-foreground">
                                            Stored encrypted at rest. Only the OWNER role can read this back.
                                        </p>
                                    </div>
                                </TabsContent>

                                <TabsContent value="production" className="space-y-3 mt-0">
                                    <p className="text-xs text-muted-foreground">
                                        Production credentials from your PhonePe Business dashboard. Turn <strong>Test Mode</strong> off in Developer Settings → API Keys to see your live values. Switch your active environment here only after the sandbox flow works end-to-end and PhonePe has approved your account for live transactions.
                                    </p>
                                    <div className="grid sm:grid-cols-[1fr_140px] gap-3">
                                        <div className="space-y-1.5">
                                            <Label htmlFor="pp-mid-prod">Client Id</Label>
                                            <Input
                                                id="pp-mid-prod"
                                                placeholder="M22XXXXXXXXXXX_XXXXXXXXXX"
                                                value={ppMidProd}
                                                onChange={(e) => setPpMidProd(e.target.value)}
                                                autoComplete="off"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="pp-idx-prod">Client Version</Label>
                                            <Input
                                                id="pp-idx-prod"
                                                placeholder="1"
                                                value={ppIndexProd}
                                                onChange={(e) => setPpIndexProd(e.target.value)}
                                                autoComplete="off"
                                                inputMode="numeric"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="pp-key-prod">Client Secret</Label>
                                        <Input
                                            id="pp-key-prod"
                                            type="password"
                                            placeholder="Production Client Secret from PhonePe"
                                            value={ppKeyProd}
                                            onChange={(e) => setPpKeyProd(e.target.value)}
                                            autoComplete="off"
                                        />
                                    </div>
                                </TabsContent>
                            </Tabs>
                            )}

                            {phonepeSchemaInstalled && (
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={testPhonePe}
                                    disabled={testing}
                                >
                                    {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                    Test connection
                                </Button>
                                {phonepeConnected && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={disconnectPhonePe}
                                        disabled={disconnectingPp}
                                        className="text-destructive hover:bg-destructive/10"
                                    >
                                        {disconnectingPp ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertCircle className="h-4 w-4" />}
                                        Disconnect PhonePe
                                    </Button>
                                )}
                                <div className="ml-auto text-[11px] text-muted-foreground">
                                    Active: {ppEnv === "production" ? "Production" : "Sandbox"}
                                </div>
                            </div>
                            )}
                        </CardContent>
                    </Card>
                    </TabsContent>

                    {/* ── Paytm ──────────────────────────────────────── */}
                    <TabsContent value="paytm" className="space-y-4 mt-0">
                    <Card className="border-primary/20">
                        <CardHeader className="space-y-2">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Wallet className="h-4 w-4 text-primary" />
                                Paytm
                                {paytmConnected ? (
                                    <Badge variant="success" className="ml-2 text-[10px]">Connected</Badge>
                                ) : (
                                    <Badge variant="outline" className="ml-2 text-[10px]">Not connected</Badge>
                                )}
                            </CardTitle>
                            <CardDescription>
                                Auto-confirmed UPI via Paytm&apos;s dynamic QR — same scan-to-pay + webhook flow as PhonePe. Connect your own Paytm Business account; money settles to your bank.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3">
                                <div>
                                    <Label>Accept UPI payments via Paytm</Label>
                                    <p className="text-xs text-muted-foreground">
                                        Enabling this turns PhonePe off — only one gateway runs at a time.
                                    </p>
                                </div>
                                <Switch checked={paytmEnabled} onCheckedChange={enablePaytm} />
                            </div>

                            <Tabs value={paytmEnv} onValueChange={(v) => setPaytmEnv(v as PhonePeEnv)} className="space-y-3">
                                <TabsList className="grid grid-cols-2 w-full">
                                    <TabsTrigger value="staging">Sandbox (staging)</TabsTrigger>
                                    <TabsTrigger value="production">Production (live)</TabsTrigger>
                                </TabsList>
                                <TabsContent value="staging" className="space-y-3 mt-0">
                                    <p className="text-xs text-muted-foreground">
                                        Paytm test credentials from your dashboard (securegw-stage). Validate end-to-end here before going live.
                                    </p>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="paytm-mid-staging">Merchant ID (MID)</Label>
                                        <Input id="paytm-mid-staging" placeholder="TESTMID..." value={paytmMidStaging} onChange={(e) => setPaytmMidStaging(e.target.value)} autoComplete="off" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="paytm-key-staging">Merchant Key</Label>
                                        <Input id="paytm-key-staging" type="password" placeholder="Test Merchant Key" value={paytmKeyStaging} onChange={(e) => setPaytmKeyStaging(e.target.value)} autoComplete="off" />
                                        <p className="text-[11px] text-muted-foreground">Stored encrypted at rest. Only the OWNER role can read this back.</p>
                                    </div>
                                </TabsContent>
                                <TabsContent value="production" className="space-y-3 mt-0">
                                    <p className="text-xs text-muted-foreground">
                                        Live Paytm credentials (securegw). Switch the active environment here only after the sandbox flow works end-to-end.
                                    </p>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="paytm-mid-prod">Merchant ID (MID)</Label>
                                        <Input id="paytm-mid-prod" placeholder="Your live MID" value={paytmMidProd} onChange={(e) => setPaytmMidProd(e.target.value)} autoComplete="off" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="paytm-key-prod">Merchant Key</Label>
                                        <Input id="paytm-key-prod" type="password" placeholder="Live Merchant Key" value={paytmKeyProd} onChange={(e) => setPaytmKeyProd(e.target.value)} autoComplete="off" />
                                    </div>
                                </TabsContent>
                            </Tabs>

                            <div className="flex flex-wrap items-center gap-2 pt-1">
                                <Button type="button" variant="outline" size="sm" onClick={testPaytm} disabled={testingPaytm}>
                                    {testingPaytm ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                    Test connection
                                </Button>
                                {paytmConnected && (
                                    <Button type="button" variant="ghost" size="sm" onClick={disconnectPaytm} className="text-destructive hover:bg-destructive/10">
                                        <AlertCircle className="h-4 w-4" /> Disconnect Paytm
                                    </Button>
                                )}
                                <div className="ml-auto text-[11px] text-muted-foreground">
                                    Active: {paytmEnv === "production" ? "Production" : "Sandbox"}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    </TabsContent>

                    <TabsContent value="manual" className="space-y-4 mt-0">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Smartphone className="h-4 w-4 text-primary" /> Manual UPI (fallback)
                            </CardTitle>
                            <CardDescription>
                                Used when PhonePe isn&apos;t connected — customers pay from any UPI app, then staff verify a screenshot before confirming the order.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid sm:grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="upi-id">UPI ID</Label>
                                    <Input
                                        id="upi-id"
                                        placeholder="restaurant@hdfc"
                                        value={upiId}
                                        onChange={(e) => setUpiId(e.target.value)}
                                    />
                                    <p className="text-[11px] text-muted-foreground">Lowercase letters, digits, dots — e.g. `restoname@oksbi`.</p>
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="upi-payee">Payee name</Label>
                                    <Input
                                        id="upi-payee"
                                        placeholder={tenantName || "Restaurant name"}
                                        value={upiPayee}
                                        onChange={(e) => setUpiPayee(e.target.value)}
                                    />
                                    <p className="text-[11px] text-muted-foreground">Shown on the customer&apos;s UPI app before they pay.</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    </TabsContent>
                </Tabs>
            )}

            {/* ── Non-India: Stripe Connect ────────────────────────── */}
            {!isIndia && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <CreditCard className="h-4 w-4 text-primary" /> Stripe Connect
                        </CardTitle>
                        <CardDescription>
                            Cards + wallets (Apple Pay, Google Pay) in 135+ currencies. Money settles to your bank; we take a small platform fee.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {stripeAccountId ? (
                            <>
                                <div className="rounded-md border border-success/40 bg-success/5 p-3 text-sm">
                                    <div className="flex items-center gap-2 font-semibold text-success">
                                        <CheckCircle2 className="h-4 w-4" />
                                        Connected
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                        Account: <span className="font-mono">{stripeAccountId}</span>
                                        {stripeAccountCountry && <> · {stripeAccountCountry}</>}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3">
                                    <div>
                                        <Label>Accept card payments</Label>
                                        <p className="text-xs text-muted-foreground">Turn off to temporarily disable Stripe without disconnecting.</p>
                                    </div>
                                    <Switch checked={stripeEnabled} onCheckedChange={setStripeEnabled} />
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={openStripeDashboard}
                                        disabled={stripeDashboardBusy}
                                    >
                                        {stripeDashboardBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                                        Open Stripe dashboard
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={disconnectStripe}
                                        disabled={disconnectingStripe}
                                        className="text-destructive hover:bg-destructive/10"
                                    >
                                        {disconnectingStripe ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertCircle className="h-4 w-4" />}
                                        Disconnect
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <div className="space-y-3">
                                <p className="text-sm text-muted-foreground">
                                    Click below to start Stripe&apos;s onboarding — they&apos;ll ask for your business details, bank account, and identity verification. Takes ~5 minutes.
                                </p>
                                <Button onClick={connectStripe} disabled={connectingStripe} variant="neon">
                                    {connectingStripe ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                                    Connect Stripe account
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* ── Sticky save bar ──────────────────────────────────── */}
            <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/85 backdrop-blur-xl">
                <div className="container mx-auto max-w-3xl px-4 py-3 flex items-center justify-end gap-3">
                    <Button variant="neon" onClick={save} disabled={saving} className="min-w-32">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save changes
                    </Button>
                </div>
            </div>
        </div>
    )
}
