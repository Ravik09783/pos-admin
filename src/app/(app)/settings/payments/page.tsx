"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertCircle, CheckCircle2, Copy, CreditCard, ExternalLink, Eye, EyeOff, KeyRound, LayoutDashboard, Loader2, QrCode, RefreshCw, Save, Smartphone, Sparkles, Zap } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { getGatewayForCountry } from "@/lib/payments/gateway"
import { cn, formatCurrency, formatDate } from "@/lib/utils"

type Gateway = "manual" | "paytm" | "stripe"

/**
 * Payment settings — per-tenant gateway connection.
 *
 * India uses **Paytm**: each restaurant connects ITS OWN Paytm for
 * Business account (MID + Merchant Key). The platform holds no money and
 * needs no KYC — payments go `customer → Paytm → restaurant's bank`. The
 * customer scans a Paytm dynamic UPI QR and pays from any UPI app; the
 * Paytm webhook auto-confirms and finalises the bill.
 *
 * What an Indian admin configures here:
 *   - Method: Paytm (automatic) or Manual UPI (screenshot)
 *   - Paytm: MID + Merchant Key + environment (Test / Production)
 *   - Manual UPI: a UPI ID + payee name
 * If Paytm credentials are filled in, Paytm is the preferred method.
 *
 * Non-India tenants use **Stripe Connect** (the block lower down) — same
 * idea: each restaurant is a Connect account that receives transfers.
 */
export default function PaymentSettingsPage() {
    const supabase = createClient()
    const [tenantId, setTenantId] = useState("")
    const [tenantName, setTenantName] = useState("")
    const [country, setCountry] = useState<string | null>(null)
    const [gateway, setGateway] = useState<Gateway>("manual")
    const [upiId, setUpiId] = useState("")
    const [upiPayee, setUpiPayee] = useState("")
    // Paytm — per-tenant merchant credentials. The merchant key is a
    // secret: stored on tenant_payment_gateways (Owner-only via RLS, read
    // server-side only) and never echoed back to the browser in plain
    // form unless the OWNER reveals it here.
    const [paytmMid, setPaytmMid] = useState("")
    const [paytmKey, setPaytmKey] = useState("")
    const [paytmEnv, setPaytmEnv] = useState<"staging" | "production">("production")
    const [showKey, setShowKey] = useState(false)
    // Test (staging) mode is tucked away by default — a live restaurant
    // only ever uses Production. Revealed when the owner taps "just
    // testing", or when a saved row is already on staging.
    const [showTest, setShowTest] = useState(false)
    // Stripe Connect — independent of the India gateway choice above. Used
    // for POS card payments where the cashier sends a Stripe Checkout link
    // (or charges in person via a Stripe Terminal). Restaurant gets gross
    // minus Stripe's processing fee minus the platform's 1% application fee.
    const [stripeAccountId, setStripeAccountId] = useState("")
    const [stripeEnabled, setStripeEnabled] = useState(true)
    const [stripeNotes, setStripeNotes] = useState("")
    // Stripe-reported live status — populated by the account.updated webhook.
    const [stripeChargesEnabled, setStripeChargesEnabled] = useState<boolean | null>(null)
    const [stripePayoutsEnabled, setStripePayoutsEnabled] = useState<boolean | null>(null)
    const [stripeDetailsSubmitted, setStripeDetailsSubmitted] = useState<boolean | null>(null)
    const [stripeAccountCountry, setStripeAccountCountry] = useState<string | null>(null)
    const [stripeLastPayoutAt, setStripeLastPayoutAt] = useState<string | null>(null)
    const [stripeLastPayoutAmount, setStripeLastPayoutAmount] = useState<number | null>(null)
    const [stripeLastPayoutCurrency, setStripeLastPayoutCurrency] = useState<string | null>(null)
    const [stripeLastPayoutStatus, setStripeLastPayoutStatus] = useState<string | null>(null)
    const [stripeConnecting, setStripeConnecting] = useState(false)
    const [stripeDashboardBusy, setStripeDashboardBusy] = useState(false)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        ;(async () => {
            const { data: u } = await supabase.auth.getUser()
            if (!u.user) return
            const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
            if (!row?.tenant_id) return
            setTenantId(row.tenant_id)
            const [{ data: t }, { data: gw }] = await Promise.all([
                supabase.from("tenants").select("name, payment_gateway, upi_id, upi_payee_name, country").eq("id", row.tenant_id).maybeSingle(),
                supabase.from("tenant_payment_gateways").select("*").eq("tenant_id", row.tenant_id).maybeSingle(),
            ])
            if (t) {
                const tt = t as { name?: string; payment_gateway?: Gateway; upi_id?: string; upi_payee_name?: string; country?: string }
                setTenantName(tt.name ?? "")
                setCountry(tt.country ?? null)
                // Default the gateway to the country-correct choice when the
                // tenant row hasn't been explicitly set yet. India → paytm,
                // elsewhere → stripe. Admin can still flip India to "manual"
                // via the tabs below.
                setGateway((tt.payment_gateway as Gateway) ?? getGatewayForCountry(tt.country ?? null))
                setUpiId(tt.upi_id ?? "")
                setUpiPayee(tt.upi_payee_name ?? "")
            }
            if (gw) {
                const g = gw as {
                    paytm_mid?: string | null
                    paytm_merchant_key?: string | null
                    paytm_env?: string | null
                    stripe_connected_account_id?: string
                    stripe_account_enabled?: boolean
                    stripe_account_notes?: string
                    stripe_charges_enabled?: boolean | null
                    stripe_payouts_enabled?: boolean | null
                    stripe_details_submitted?: boolean | null
                    stripe_account_country?: string | null
                    stripe_last_payout_at?: string | null
                    stripe_last_payout_amount?: number | null
                    stripe_last_payout_currency?: string | null
                    stripe_last_payout_status?: string | null
                }
                setPaytmMid(g.paytm_mid ?? "")
                setPaytmKey(g.paytm_merchant_key ?? "")
                if (g.paytm_env === "staging") {
                    // Already connected on Test → keep it and reveal the toggle.
                    setPaytmEnv("staging")
                    setShowTest(true)
                }
                setStripeAccountId(g.stripe_connected_account_id ?? "")
                setStripeEnabled(g.stripe_account_enabled !== false)
                setStripeNotes(g.stripe_account_notes ?? "")
                setStripeChargesEnabled(g.stripe_charges_enabled ?? null)
                setStripePayoutsEnabled(g.stripe_payouts_enabled ?? null)
                setStripeDetailsSubmitted(g.stripe_details_submitted ?? null)
                setStripeAccountCountry(g.stripe_account_country ?? null)
                setStripeLastPayoutAt(g.stripe_last_payout_at ?? null)
                setStripeLastPayoutAmount(g.stripe_last_payout_amount ?? null)
                setStripeLastPayoutCurrency(g.stripe_last_payout_currency ?? null)
                setStripeLastPayoutStatus(g.stripe_last_payout_status ?? null)
            }
        })()
    }, [supabase])

    // Read the Stripe redirect query params so we can show a friendly
    // banner after the OWNER returns from Stripe-hosted onboarding.
    useEffect(() => {
        if (typeof window === "undefined") return
        const sp = new URLSearchParams(window.location.search)
        if (sp.get("stripe_onboarded") === "1") {
            toast.success("Stripe onboarding complete — we're verifying with Stripe. Status will update in a moment.")
            // Clean the URL so refreshing the page doesn't re-show the toast.
            window.history.replaceState({}, "", window.location.pathname)
        } else if (sp.get("stripe_error") === "refresh") {
            toast.error("Stripe onboarding link expired. Click 'Connect with Stripe' to start a fresh one.")
            window.history.replaceState({}, "", window.location.pathname)
        }
    }, [])

    async function startStripeOnboarding() {
        setStripeConnecting(true)
        try {
            const r = await fetch("/api/payments/stripe/connect/onboard", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            })
            const data = await r.json().catch(() => ({ error: "Bad response" }))
            if (!r.ok || !data.url) throw new Error(data.error ?? "Couldn't start onboarding")
            // Open Stripe in a NEW tab so the owner can come back to our
            // page if they bail mid-onboarding.
            window.open(data.url, "_blank", "noopener")
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Couldn't start onboarding")
        } finally {
            setStripeConnecting(false)
        }
    }

    async function openStripeDashboard() {
        setStripeDashboardBusy(true)
        try {
            const r = await fetch("/api/payments/stripe/connect/dashboard-link", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            })
            const data = await r.json().catch(() => ({ error: "Bad response" }))
            if (!r.ok || !data.url) throw new Error(data.error ?? "Couldn't generate dashboard link")
            window.open(data.url, "_blank", "noopener")
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Couldn't open Stripe dashboard")
        } finally {
            setStripeDashboardBusy(false)
        }
    }

    async function save() {
        if (!tenantId) return
        const trimmedStripe = stripeAccountId.trim()
        const trimmedMid = paytmMid.trim()
        const trimmedKey = paytmKey.trim()
        // For non-India tenants the gateway is locked to "stripe" — the
        // India tabs are hidden, so we override the state on save. India
        // tenants keep whatever they picked in the tabs (paytm / manual).
        const isIndiaTenant = getGatewayForCountry(country) === "paytm"
        const persistedGateway: Gateway = isIndiaTenant ? gateway : "stripe"

        if (isIndiaTenant && persistedGateway === "paytm") {
            if (!trimmedMid || !trimmedKey) {
                return toast.error("Paytm MID and Merchant Key are both required to accept automatic UPI payments")
            }
            if (/\s/.test(trimmedMid) || /\s/.test(trimmedKey)) {
                return toast.error("Paytm MID / Merchant Key shouldn't contain spaces — re-copy them from the Paytm dashboard")
            }
        }
        if (isIndiaTenant && persistedGateway === "manual" && !upiId.trim()) {
            return toast.error("UPI ID is required for manual mode")
        }
        // Stripe is REQUIRED for non-India tenants (no other gateway is
        // offered) but optional for India. Validate format whenever filled.
        if (trimmedStripe && !/^acct_[A-Za-z0-9]+$/.test(trimmedStripe)) {
            return toast.error("Stripe Account ID should start with 'acct_' followed by letters/digits")
        }
        setBusy(true)
        const { error: te } = await supabase
            .from("tenants")
            .update({
                payment_gateway: persistedGateway,
                upi_id: upiId.trim() || null,
                upi_payee_name: upiPayee.trim() || null,
            } as never)
            .eq("id", tenantId)
        if (te) { setBusy(false); return toast.error(te.message) }

        // One upsert covers BOTH Paytm (India) and Stripe (Connect). The
        // columns are independent so setting one doesn't disturb the other.
        // `paytm_enabled` is true only when the tenant chose Paytm AND
        // supplied both credentials — that's the flag the QR / webhook
        // routes check before issuing a Paytm QR.
        const { error: ge } = await supabase
            .from("tenant_payment_gateways")
            .upsert({
                tenant_id: tenantId,
                paytm_mid: trimmedMid || null,
                paytm_merchant_key: trimmedKey || null,
                paytm_env: paytmEnv,
                paytm_enabled: isIndiaTenant && persistedGateway === "paytm" && !!trimmedMid && !!trimmedKey,
                stripe_connected_account_id: trimmedStripe || null,
                stripe_account_enabled: stripeEnabled,
                stripe_account_notes: stripeNotes.trim() || null,
            } as never)
        if (ge) { setBusy(false); return toast.error(ge.message) }

        setBusy(false)
        toast.success("Payment settings saved")
    }

    // India → Paytm (the only country where Paytm is the right default
    // and where manual UPI is a meaningful fallback). Anywhere else → Stripe.
    const isIndia = useMemo(() => getGatewayForCountry(country) === "paytm", [country])
    const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/webhooks/paytm` : "/api/webhooks/paytm"

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-3xl space-y-6">
            <PageHeader
                kicker="Configure"
                title="Payment gateway"
                highlight={isIndia ? "Paytm or UPI" : "Stripe Connect"}
                description={isIndia
                    ? "How customers pay you — on the POS customer screen and the table QR page. India uses Paytm UPI."
                    : `Card payments via Stripe — auto-routed for restaurants outside India.${country ? " Country: " + country + "." : ""}`}
            />

            {/* India-only block: Paytm (automatic UPI) or Manual UPI fallback.
             *  Hidden entirely for non-Indian restaurants because Paytm is
             *  India-only and manual-UPI doesn't apply abroad. */}
            {isIndia && (
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Choose your payment method</CardTitle>
                    <CardDescription>Paytm is recommended — fully automatic, money goes straight to your bank. If you fill in Paytm details, Paytm is used.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Tabs value={gateway === "stripe" ? "paytm" : gateway} onValueChange={(v) => setGateway(v as Gateway)}>
                        <TabsList className="grid grid-cols-2 w-full">
                            <TabsTrigger value="paytm">
                                <Zap className="h-3.5 w-3.5 mr-1" /> Paytm (auto)
                            </TabsTrigger>
                            <TabsTrigger value="manual">
                                <Smartphone className="h-3.5 w-3.5 mr-1" /> Manual UPI
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="paytm" className="space-y-5 mt-4">
                            <div className="rounded-md bg-primary/5 border border-primary/30 p-3 text-sm space-y-1">
                                <div className="font-semibold flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-primary" /> Why Paytm?</div>
                                <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
                                    <li>Money lands directly in <strong>your own</strong> bank account — the platform never touches it</li>
                                    <li>Auto-confirmed via webhook — no manual screenshot review</li>
                                    <li>Customers pay from <strong>any</strong> UPI app — Google Pay, PhonePe, Paytm, BHIM</li>
                                    <li>UPI is <strong>0% MDR</strong> (government-mandated) — effectively free</li>
                                </ul>
                            </div>

                            {/* Guided 4-step setup. Each restaurant connects its OWN
                             *  Paytm for Business account; the steps walk a non-
                             *  technical owner from sign-up to a working webhook. */}
                            <StepBlock num={1} title="Create your Paytm for Business account">
                                <p>
                                    Go to{" "}
                                    <a href="https://business.paytm.com" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                                        business.paytm.com <ExternalLink className="h-3 w-3" />
                                    </a>{" "}
                                    and sign up with your business phone &amp; email. Open the <strong>Payment Gateway</strong> product.
                                </p>
                                <p>
                                    Complete <strong>your</strong> business KYC — Paytm asks for your <strong>PAN</strong> and
                                    {" "}<strong>bank account</strong> (where money settles). It usually clears in 1–3 days.
                                </p>
                                <p className="rounded bg-muted/60 px-2 py-1.5 text-[11px]">
                                    💡 Want to trial it first? Paytm&apos;s <strong>Test</strong> credentials work right away — no KYC needed. Use those now, switch to live ones after KYC.
                                </p>
                            </StepBlock>

                            <StepBlock num={2} title="Find your MID and Merchant Key in Paytm">
                                <p>In the Paytm dashboard, open <strong>Developer Settings → API Keys</strong>. You&apos;ll see two tabs:</p>
                                <ul className="list-disc list-inside space-y-0.5">
                                    <li><strong>Test API Details</strong> — works without KYC; use it to trial.</li>
                                    <li><strong>Production API Details</strong> — unlocked after KYC; use it when you go live.</li>
                                </ul>
                                <p>From the tab you want, copy <strong>two</strong> values:</p>
                                <ul className="list-disc list-inside space-y-0.5">
                                    <li><strong>MID</strong> (Merchant ID) — around 20 characters</li>
                                    <li><strong>Merchant Key</strong> — a 16-character secret</li>
                                </ul>
                                <div className="flex flex-wrap gap-2 pt-1">
                                    <Button asChild variant="outline" size="sm">
                                        <a href="https://dashboard.paytm.com/next/apikeys" target="_blank" rel="noreferrer">
                                            Open my Paytm API Keys page <ExternalLink className="h-3 w-3" />
                                        </a>
                                    </Button>
                                    <Button asChild variant="ghost" size="sm">
                                        <a href="https://business.paytm.com/support/how-do-i-generate-my-api-keys-for-production-environment" target="_blank" rel="noreferrer">
                                            Paytm&apos;s step-by-step guide <ExternalLink className="h-3 w-3" />
                                        </a>
                                    </Button>
                                </div>
                            </StepBlock>

                            <StepBlock num={3} title="Paste them here">
                                <div className="space-y-1.5">
                                    <Label className="text-foreground">Environment</Label>
                                    {!showTest ? (
                                        <>
                                            <div className="rounded-md border border-success/40 bg-success/5 px-3 py-2 text-xs flex items-start gap-2">
                                                <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />
                                                <span><strong>Production (live)</strong> — real payments. Paste the credentials from the <strong>Production API Details</strong> tab in Paytm.</span>
                                            </div>
                                            <button
                                                type="button"
                                                className="text-[11px] text-primary hover:underline"
                                                onClick={() => { setShowTest(true); setPaytmEnv("staging") }}
                                            >
                                                Just trying it out before KYC? Use Test mode instead →
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <div className="grid grid-cols-2 gap-2">
                                                <Button
                                                    type="button"
                                                    variant={paytmEnv === "staging" ? "neon" : "outline"}
                                                    size="sm"
                                                    onClick={() => setPaytmEnv("staging")}
                                                >
                                                    Test (staging)
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant={paytmEnv === "production" ? "neon" : "outline"}
                                                    size="sm"
                                                    onClick={() => setPaytmEnv("production")}
                                                >
                                                    Production (live)
                                                </Button>
                                            </div>
                                            <p className="text-[11px]">Test keys only work in Test mode, live keys only in Production — this must match the tab you copied from in Paytm.</p>
                                        </>
                                    )}
                                </div>

                                <div className="space-y-1.5">
                                    <Label className="text-foreground">Paytm MID (Merchant ID) *</Label>
                                    <Input
                                        value={paytmMid}
                                        onChange={(e) => setPaytmMid(e.target.value)}
                                        className="font-mono text-xs"
                                        placeholder="e.g. ABCdef12345678901234"
                                        autoComplete="off"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <Label className="flex items-center gap-2 text-foreground">
                                        <KeyRound className="h-3.5 w-3.5" /> Paytm Merchant Key *
                                    </Label>
                                    <div className="relative">
                                        <Input
                                            type={showKey ? "text" : "password"}
                                            value={paytmKey}
                                            onChange={(e) => setPaytmKey(e.target.value)}
                                            className="font-mono text-xs pr-10"
                                            placeholder="16-character secret"
                                            autoComplete="off"
                                        />
                                        <Button
                                            type="button"
                                            size="icon"
                                            variant="ghost"
                                            className="absolute right-1 top-1 h-7 w-7"
                                            onClick={() => setShowKey((s) => !s)}
                                            aria-label={showKey ? "Hide key" : "Show key"}
                                        >
                                            {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                        </Button>
                                    </div>
                                    <p className="text-[11px]">Stored encrypted, read server-side only — never sent to a customer&apos;s browser.</p>
                                </div>
                            </StepBlock>

                            <StepBlock num={4} title="Set the webhook URL inside Paytm">
                                <p>
                                    This is how Paytm tells RestoPOS the <strong>instant</strong> a customer pays — so the
                                    bill is marked paid automatically. In the Paytm dashboard, find the
                                    {" "}<strong>Webhook / Transaction callback URL</strong> setting (under Developer
                                    Settings) and paste this exact URL:
                                </p>
                                <div className="flex items-center gap-2">
                                    <Input
                                        readOnly
                                        value={webhookUrl}
                                        className="font-mono text-xs bg-muted/40"
                                        onFocus={(e) => e.currentTarget.select()}
                                    />
                                    <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => copyText(webhookUrl, "Webhook URL")}>
                                        <Copy className="h-3.5 w-3.5" /> Copy
                                    </Button>
                                </div>
                                {webhookUrl.includes("localhost") && (
                                    <p className="rounded bg-warning/10 border border-warning/30 px-2 py-1.5 text-[11px]">
                                        ⚠ This is a <strong>localhost</strong> URL — Paytm can&apos;t reach it from the internet.
                                        For local testing, expose your server with a tunnel (e.g. <code className="text-[10px]">ngrok http 3000</code>) and
                                        paste the tunnel&apos;s <strong>https://</strong> URL instead. On your live site this is your real domain.
                                    </p>
                                )}
                                <p className="text-[11px]">
                                    Paytm only accepts <strong>https://</strong> webhook URLs (port 443) — a plain
                                    {" "}<code className="text-[10px]">http://</code> address is rejected. One URL serves your
                                    whole account, so paste it just once.
                                </p>
                                <div className="flex flex-wrap gap-2 pt-1">
                                    <Button asChild variant="ghost" size="sm">
                                        <a href="https://business.paytm.com/docs/callback-and-webhookurl-faq/" target="_blank" rel="noreferrer">
                                            Paytm&apos;s webhook setup guide <ExternalLink className="h-3 w-3" />
                                        </a>
                                    </Button>
                                </div>
                            </StepBlock>

                            <div className="rounded-lg border border-border/60 p-3 space-y-1.5">
                                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Ready when</div>
                                <ChecklistRow done={!!paytmMid.trim()} label="Paytm MID pasted" />
                                <ChecklistRow done={!!paytmKey.trim()} label="Merchant Key pasted" />
                                <ChecklistRow done={!!paytmMid.trim() && !!paytmKey.trim()} label="Both filled in — press “Save payment settings” below to go live" />
                            </div>
                        </TabsContent>

                        <TabsContent value="manual" className="space-y-4 mt-4">
                            <div className="rounded-md bg-warning/5 border border-warning/30 p-3 text-xs text-muted-foreground">
                                Customers pay via UPI to your ID, then upload a screenshot. You verify it manually on the <Link href="/pending-orders" className="text-primary hover:underline">Pending Orders</Link> page before confirming.
                                Choose this if you don&apos;t want to connect Paytm — no KYC, no fee, but not automatic.
                            </div>
                            <div className="space-y-1.5">
                                <Label>UPI ID *</Label>
                                <Input value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="restaurant@upi" className="font-mono" />
                                <p className="text-[11px] text-muted-foreground">Use a business / merchant UPI ID — personal IDs have low daily limits.</p>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Payee name</Label>
                                <Input value={upiPayee} onChange={(e) => setUpiPayee(e.target.value)} placeholder="defaults to restaurant name" />
                            </div>
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>
            )}

            {/* Stripe — primary gateway for non-India tenants, hidden for
             *  Indian tenants (they use Paytm above). For Indian
             *  restaurants who also want to accept international cards
             *  out-of-band, that's a follow-up — not exposed here today
             *  to keep the form simple. */}
            {!isIndia && (
            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <CreditCard className="h-4 w-4" /> Stripe (card payments)
                    </CardTitle>
                    <CardDescription>
                        Auto-selected for your region — customers pay by card and the rest is wired to your bank account by Stripe.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="rounded-md bg-primary/5 border border-primary/30 p-3 text-sm space-y-1">
                        <div className="font-semibold flex items-center gap-2">
                            <Sparkles className="h-3.5 w-3.5 text-primary" /> Money flow
                        </div>
                        <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
                            <li>Customer pays the full bill via Stripe Checkout</li>
                            <li>Stripe deducts their processing fee (~2.9% + currency-specific fixed)</li>
                            <li>Platform retains a 1% application fee</li>
                            <li>The remainder is auto-transferred to your Stripe-connected bank account (T+2 in the US, T+7 in most of Europe)</li>
                        </ul>
                    </div>

                    {/* ── Stripe Connect status panel ───────────────────────
                      *
                      * Three states:
                      *   - No acct_*           → big "Connect with Stripe" CTA
                      *   - acct_*, KYC pending → "Finish onboarding" button +
                      *                           live status pills
                      *   - acct_*, fully ready → status badges + dashboard
                      *                           buttons + last payout
                      *
                      * Stripe-reported flags come from the account.updated
                      * webhook so this UI never has to poll Stripe. */}
                    {!stripeAccountId ? (
                        <div className="rounded-lg border border-primary/40 bg-primary/[0.04] p-4 space-y-3">
                            <div className="text-sm">
                                <div className="font-semibold mb-1">Get started — one click</div>
                                <p className="text-xs text-muted-foreground">
                                    We&apos;ll create a Stripe Connect Express account on your behalf and open Stripe&apos;s hosted onboarding in a new tab. You&apos;ll add your bank details, tax ID, and identity verification there. Comes back here when done.
                                </p>
                            </div>
                            <Button
                                variant="neon"
                                onClick={startStripeOnboarding}
                                disabled={stripeConnecting}
                                size="lg"
                                className="w-full"
                            >
                                {stripeConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                                Connect with Stripe
                            </Button>
                        </div>
                    ) : (
                        <div className="rounded-lg border border-border/60 p-4 space-y-3">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                                <div className="font-semibold text-sm flex items-center gap-2">
                                    {stripeDetailsSubmitted && stripeChargesEnabled && stripePayoutsEnabled ? (
                                        <Badge variant="success" className="gap-1">
                                            <CheckCircle2 className="h-3 w-3" /> Stripe connected
                                        </Badge>
                                    ) : (
                                        <Badge variant="warning" className="gap-1">
                                            <AlertCircle className="h-3 w-3" /> Onboarding incomplete
                                        </Badge>
                                    )}
                                    <span className="text-xs text-muted-foreground font-mono">{stripeAccountId}</span>
                                    {stripeAccountCountry && (
                                        <Badge variant="outline" className="text-[10px]">{stripeAccountCountry}</Badge>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <StripeFlagPill label="Details submitted" value={stripeDetailsSubmitted} />
                                <StripeFlagPill label="Charges enabled" value={stripeChargesEnabled} />
                                <StripeFlagPill label="Payouts enabled" value={stripePayoutsEnabled} />
                            </div>

                            {stripeLastPayoutAt && stripeLastPayoutAmount != null && (
                                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs flex items-center justify-between">
                                    <span className="text-muted-foreground">Last payout</span>
                                    <span className="font-semibold tabular-nums">
                                        {formatCurrency(stripeLastPayoutAmount, (stripeLastPayoutCurrency ?? "USD").toUpperCase())}
                                        <span className="text-muted-foreground font-normal ml-1.5">
                                            · {formatDate(stripeLastPayoutAt, { dateStyle: "medium" })}
                                        </span>
                                        {stripeLastPayoutStatus === "FAILED" && (
                                            <Badge variant="destructive" className="ml-2 text-[10px]">Failed</Badge>
                                        )}
                                    </span>
                                </div>
                            )}

                            {/* Action row — onboarding vs. live state branch */}
                            {!stripeDetailsSubmitted ? (
                                <div className="rounded-md border border-warning/30 bg-warning/5 p-3 space-y-2">
                                    <p className="text-xs text-muted-foreground">
                                        Stripe still needs more information before payments can run. Finish the hosted onboarding flow to unlock card charges and payouts.
                                    </p>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={startStripeOnboarding}
                                        disabled={stripeConnecting}
                                    >
                                        {stripeConnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                        Resume onboarding
                                    </Button>
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    <Button asChild variant="neon" size="sm">
                                        <Link href="/settings/payments/dashboard">
                                            <LayoutDashboard className="h-3.5 w-3.5" /> Open Payments dashboard
                                        </Link>
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={openStripeDashboard}
                                        disabled={stripeDashboardBusy}
                                    >
                                        {stripeDashboardBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                                        Stripe-hosted dashboard
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Accepted payment methods ────────────────────────
                      * Stripe's Dynamic Payment Methods means the actual
                      * list shown on Checkout comes from the merchant's
                      * Dashboard. We can't enumerate it from our side
                      * without an API call, so we instead show the common
                      * methods Stripe enables by default + a link to add
                      * more. Keeps the OWNER aware of what's accepted
                      * without being a fragile list-of-truth. */}
                    {stripeAccountId && stripeDetailsSubmitted && (
                        <div className="rounded-lg border border-border/60 p-4 space-y-3">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                                <div className="text-sm font-semibold">Accepted at checkout</div>
                                <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                                    <a
                                        href="https://dashboard.stripe.com/settings/payment_methods"
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        Add more <ExternalLink className="h-3 w-3" />
                                    </a>
                                </Button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {[
                                    "Cards",
                                    "Apple Pay",
                                    "Google Pay",
                                    "Link",
                                    ...(stripeAccountCountry === "US" ? ["ACH", "Klarna", "Affirm"] : []),
                                    ...(stripeAccountCountry === "GB" ? ["Bacs Direct Debit", "Klarna"] : []),
                                    ...((stripeAccountCountry && ["DE","FR","NL","BE","IT","ES","AT","IE","PT","FI","LU"].includes(stripeAccountCountry)) ? ["SEPA Direct Debit", "iDEAL", "Bancontact", "Klarna"] : []),
                                    ...(stripeAccountCountry === "AU" ? ["Afterpay"] : []),
                                ].map((m) => (
                                    <Badge key={m} variant="outline" className="text-[10px]">{m}</Badge>
                                ))}
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                Apple Pay &amp; Google Pay show up automatically on supported devices.
                                The exact list shown to a customer depends on their country, device,
                                and the methods you&apos;ve enabled in your Stripe Dashboard.
                                Customers also get a Stripe-branded email receipt on every paid bill.
                            </p>
                        </div>
                    )}

                    <div className="space-y-3">
                        <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                            <div>
                                <Label>Card payments</Label>
                                <p className="text-[11px] text-muted-foreground">Pause if you&apos;re troubleshooting a dispute. The account stays connected.</p>
                            </div>
                            <Switch checked={stripeEnabled} onCheckedChange={setStripeEnabled} disabled={!stripeAccountId} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Internal notes</Label>
                            <Input value={stripeNotes} onChange={(e) => setStripeNotes(e.target.value)} placeholder="e.g. main current account at XYZ Bank" />
                        </div>
                    </div>
                </CardContent>
            </Card>
            )}

            <div className="flex justify-end">
                <Button variant="neon" onClick={save} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save payment settings
                </Button>
            </div>

            {isIndia && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <QrCode className="h-3.5 w-3.5 shrink-0" />
                    Customers scan the QR on the POS customer screen or the table-ordering page.
                    {tenantName ? ` Payments settle to ${tenantName}'s own Paytm account.` : ""}
                </p>
            )}
        </div>
    )
}

/** Copy text to the clipboard with a toast — used for the webhook URL. */
function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text).then(
        () => toast.success(`${label} copied`),
        () => toast.message(text),
    )
}

/** A numbered step card for the guided Paytm setup. */
function StepBlock({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-lg border border-border/60 p-3.5 space-y-2">
            <div className="flex items-center gap-2">
                <span className="grid place-items-center h-6 w-6 rounded-full bg-primary/15 text-primary text-xs font-bold shrink-0">{num}</span>
                <h4 className="font-semibold text-sm">{title}</h4>
            </div>
            <div className="text-xs text-muted-foreground space-y-2 leading-relaxed pl-8">
                {children}
            </div>
        </div>
    )
}

function ChecklistRow({ done, label }: { done: boolean; label: string }) {
    return (
        <div className="flex items-center gap-2 text-xs">
            <CheckCircle2 className={`h-3.5 w-3.5 ${done ? "text-success" : "text-muted-foreground/40"}`} />
            <span className={done ? "" : "text-muted-foreground/60"}>{label}</span>
        </div>
    )
}

/** A pill that shows a tri-state Stripe-reported flag — green check when
 *  true, amber clock when null (we haven't received an account.updated
 *  yet, e.g. the OWNER hit "Connect" but hasn't started Stripe-side
 *  onboarding), red cross when false. */
function StripeFlagPill({ label, value }: { label: string; value: boolean | null }) {
    const tone = value === true ? "success" : value === false ? "destructive" : "muted"
    return (
        <div
            className={cn(
                "rounded-md border px-3 py-2 text-xs flex items-center gap-2",
                tone === "success" && "border-success/40 bg-success/5",
                tone === "destructive" && "border-destructive/40 bg-destructive/5",
                tone === "muted" && "border-border/60 bg-muted/30",
            )}
        >
            {value === true ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
            ) : value === false ? (
                <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
            ) : (
                <Loader2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            <span className="truncate">{label}</span>
        </div>
    )
}
