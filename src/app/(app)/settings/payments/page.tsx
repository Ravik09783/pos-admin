"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertCircle, ArrowRight, Banknote, CheckCircle2, Circle, Copy, CreditCard, ExternalLink, Eye, EyeOff, KeyRound, LayoutDashboard, Loader2, QrCode, RefreshCw, Save, Smartphone, Sparkles, User, Wallet, Zap } from "lucide-react"
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
    // Paytm — TWO independent credential pairs after migration 54:
    //   • production: paytmMid + paytmKey
    //   • test/staging: paytmMidStaging + paytmKeyStaging
    // `paytmEnv` picks which pair is ACTIVE at runtime. The owner can
    // configure both at once and switch live/test with one click.
    // Merchant keys are stored on tenant_payment_gateways (Owner-only
    // via RLS, read server-side only) and never echoed unless the
    // OWNER reveals them here.
    const [paytmMid, setPaytmMid] = useState("")
    const [paytmKey, setPaytmKey] = useState("")
    const [paytmMidStaging, setPaytmMidStaging] = useState("")
    const [paytmKeyStaging, setPaytmKeyStaging] = useState("")
    const [paytmEnv, setPaytmEnv] = useState<"staging" | "production">("production")
    const [showKey, setShowKey] = useState(false)
    const [showKeyStaging, setShowKeyStaging] = useState(false)
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
    // Tracks which Paytm env we're currently testing — null = idle.
    // Disables BOTH test buttons while a probe is in flight so the
    // owner can't fan out two requests with the same merchant key.
    const [testing, setTesting] = useState<"staging" | "production" | null>(null)
    const [disconnecting, setDisconnecting] = useState<"paytm" | "stripe" | null>(null)
    // Latest Paytm test result, rendered inline below the test buttons
    // so multi-line, actionable error messages survive (sonner toasts
    // collapse them to a single truncated line).
    //
    // `indeterminate` covers the most common outcome with Paytm: the
    // API returned a 501 / empty 400 / similar opaque response so we
    // can't say if the keys are valid or not. UI renders this as
    // "inconclusive" (info, not red) — failing softly so the merchant
    // isn't told their keys are broken when they probably aren't.
    const [lastTest, setLastTest] = useState<{
        env: "staging" | "production"
        ok: boolean
        indeterminate?: boolean
        message: string
    } | null>(null)

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
                    paytm_mid_staging?: string | null
                    paytm_merchant_key_staging?: string | null
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
                // Both credential pairs come down together — the
                // active one is determined by `paytm_env`.
                setPaytmMid(g.paytm_mid ?? "")
                setPaytmKey(g.paytm_merchant_key ?? "")
                setPaytmMidStaging(g.paytm_mid_staging ?? "")
                setPaytmKeyStaging(g.paytm_merchant_key_staging ?? "")
                setPaytmEnv(g.paytm_env === "staging" ? "staging" : "production")
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

    /** Ping Paytm with the staged MID + Merchant Key to verify they
     *  work. We test against the picked env (Test or Production) so
     *  the owner can confirm BOTH sets of credentials without saving
     *  the wrong one. The route exercises Paytm's order-status
     *  endpoint with a bogus orderId — auth gets validated, no money
     *  moves. See `/api/payments/paytm/test`. */
    async function testPaytmConnection(env: "staging" | "production") {
        // Test the env-specific pair — not whichever happens to be
        // active. So the owner can verify Production creds while Test
        // is still the active env, and vice versa.
        const mid = (env === "production" ? paytmMid : paytmMidStaging).trim()
        const key = (env === "production" ? paytmKey : paytmKeyStaging).trim()
        if (!mid || !key) {
            return toast.error(
                `Paste both the ${env === "production" ? "Production" : "Test"} MID and Merchant Key in that card before testing.`,
            )
        }
        setTesting(env)
        setLastTest(null)
        try {
            const r = await fetch("/api/payments/paytm/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mid, merchant_key: key, env }),
            })
            const data = await r.json().catch(() => ({}))
            if (!r.ok) throw new Error(data.error ?? "Test failed")
            const message = data.message ?? data.error ?? ""
            setLastTest({ env, ok: !!data.ok, indeterminate: !!data.indeterminate, message })
            // Toast headline; inline panel owns the multi-line detail.
            // Three outcomes: success / inconclusive / failed — pick
            // the matching tone so the merchant isn't alarmed by
            // Paytm's 501 hiccups.
            const envLabel = env === "production" ? "Production" : "Test"
            if (data.ok) {
                toast.success(`Paytm ${envLabel} credentials accepted.`)
            } else if (data.indeterminate) {
                toast.message(`Paytm ${envLabel} check was inconclusive — keys may still work. See details below.`)
            } else {
                toast.error(`Paytm ${envLabel} rejected the keys — see details below.`)
            }
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Couldn't reach Paytm."
            setLastTest({ env, ok: false, message })
            toast.error(message)
        } finally {
            setTesting(null)
        }
    }

    /** Remove Paytm credentials. Confirms first; clears MID + key and
     *  flips paytm_enabled off. The Paytm account itself isn't
     *  touched on Paytm's side — only our routing. */
    async function disconnectPaytm() {
        if (!window.confirm("Remove your Paytm credentials? Customers won't be able to pay automatically until you connect again.")) return
        setDisconnecting("paytm")
        try {
            const r = await fetch("/api/payments/paytm/disconnect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            })
            const data = await r.json().catch(() => ({}))
            if (!r.ok) throw new Error(data.error ?? "Couldn't remove Paytm")
            // Mirror in local state so the page reflects the change
            // without a refresh round-trip. Both pairs get cleared —
            // the server route wipes them all.
            setPaytmMid("")
            setPaytmKey("")
            setPaytmMidStaging("")
            setPaytmKeyStaging("")
            setPaytmEnv("production")
            setLastTest(null)
            // If the tenant was using Paytm, fall back to Manual UPI so
            // the form's UX state stays consistent with what's saved.
            if (gateway === "paytm") setGateway("manual")
            toast.success("Paytm removed. You can connect again any time.")
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Couldn't remove Paytm.")
        } finally {
            setDisconnecting(null)
        }
    }

    /** Disconnect the Stripe Connect account on the RestoPOS side.
     *  Stripe-side account is left intact (delete is a Stripe Dashboard
     *  action and requires a zero pending balance). */
    async function disconnectStripe() {
        if (!window.confirm("Disconnect Stripe from RestoPOS? Card payments will stop until you connect again. Your Stripe account on Stripe's side stays intact.")) return
        setDisconnecting("stripe")
        try {
            const r = await fetch("/api/payments/stripe/connect/disconnect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            })
            const data = await r.json().catch(() => ({}))
            if (!r.ok) throw new Error(data.error ?? "Couldn't disconnect Stripe")
            // Clear all the Stripe-related local state — the page now
            // looks like a fresh, unconnected account.
            setStripeAccountId("")
            setStripeEnabled(true)
            setStripeNotes("")
            setStripeChargesEnabled(null)
            setStripePayoutsEnabled(null)
            setStripeDetailsSubmitted(null)
            setStripeAccountCountry(null)
            setStripeLastPayoutAt(null)
            setStripeLastPayoutAmount(null)
            setStripeLastPayoutCurrency(null)
            setStripeLastPayoutStatus(null)
            toast.success("Stripe disconnected from RestoPOS.")
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Couldn't disconnect Stripe.")
        } finally {
            setDisconnecting(null)
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
        const prodMid = paytmMid.trim()
        const prodKey = paytmKey.trim()
        const testMid = paytmMidStaging.trim()
        const testKey = paytmKeyStaging.trim()
        // For non-India tenants the gateway is locked to "stripe" — the
        // India tabs are hidden, so we override the state on save. India
        // tenants keep whatever they picked in the tabs (paytm / manual).
        const isIndiaTenant = getGatewayForCountry(country) === "paytm"
        const persistedGateway: Gateway = isIndiaTenant ? gateway : "stripe"

        // The pair that has to be COMPLETE depends on which env the
        // owner picked as active. Test creds without Production are
        // fine if the owner is still in trial mode (and vice versa).
        const activePairFilled = paytmEnv === "production"
            ? (!!prodMid && !!prodKey)
            : (!!testMid && !!testKey)

        if (isIndiaTenant && persistedGateway === "paytm" && !activePairFilled) {
            return toast.error(
                paytmEnv === "production"
                    ? "Paste the PRODUCTION MID + Merchant Key (or switch the active env to Test)."
                    : "Paste the TEST MID + Merchant Key (or switch the active env to Production).",
            )
        }
        // Spaces in any filled pair are almost always a paste mistake.
        for (const [n, v] of [
            ["MID (Production)", prodMid], ["Merchant Key (Production)", prodKey],
            ["MID (Test)",       testMid], ["Merchant Key (Test)",       testKey],
        ] as const) {
            if (v && /\s/.test(v)) {
                return toast.error(`${n} shouldn't contain spaces — re-copy it from the Paytm dashboard`)
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
        // the ACTIVE env's pair is populated — the inactive pair can
        // be partial without disabling the gateway.
        const { error: ge } = await supabase
            .from("tenant_payment_gateways")
            .upsert({
                tenant_id: tenantId,
                paytm_mid: prodMid || null,
                paytm_merchant_key: prodKey || null,
                paytm_mid_staging: testMid || null,
                paytm_merchant_key_staging: testKey || null,
                paytm_env: paytmEnv,
                paytm_enabled: isIndiaTenant && persistedGateway === "paytm" && activePairFilled,
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

    // ── Computed status used by the hero + sticky save bar ───────────
    // Reflects the FORM state (not just the saved DB row) so the
    // merchant sees their setup turn "Ready" the moment they paste
    // valid credentials, before they even hit Save. The save bar
    // separately nudges them to actually persist.
    const paytmReady = isIndia && gateway === "paytm" && !!paytmMid.trim() && !!paytmKey.trim()
    const manualReady = isIndia && gateway === "manual" && !!upiId.trim()
    const stripeReady = !isIndia && !!stripeAccountId
        && stripeDetailsSubmitted === true
        && stripeChargesEnabled === true
        && stripePayoutsEnabled === true
    const stripePartial = !isIndia && !!stripeAccountId && !stripeReady

    const status: "ready" | "partial" | "missing" = (() => {
        if (isIndia) {
            if (paytmReady || manualReady) return "ready"
            return "missing"
        }
        if (stripeReady) return "ready"
        if (stripePartial) return "partial"
        return "missing"
    })()

    // Friendly one-liner: "what's happening right now"
    const activeMethodLabel = (() => {
        if (isIndia && paytmReady) return paytmEnv === "production" ? "Paytm UPI · Live" : "Paytm UPI · Test mode"
        if (isIndia && manualReady) return "Manual UPI · Screenshot review"
        if (!isIndia && stripeReady) return "Stripe · Cards & wallets"
        if (!isIndia && stripePartial) return "Stripe · Onboarding in progress"
        return "No payment method connected yet"
    })()

    // For the Paytm setup card, surface "Step N of 4 done" so the
    // owner always knows where they are mid-setup.
    const paytmStepsDone =
        (paytmEnv ? 1 : 0)             // 1: environment chosen (Production is the default → always 1)
        + (paytmMid.trim() ? 1 : 0)    // 2: MID pasted
        + (paytmKey.trim() ? 1 : 0)    // 3: Merchant key pasted
        + 0                            // 4: webhook URL in Paytm — we can't verify; counted separately
    // We don't have a way to know if the webhook is set in Paytm; the
    // step block tells the merchant to do it. So the visible "complete"
    // count tops out at 3/4 from here.

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-3xl space-y-6 pb-28">
            <PageHeader
                kicker="Configure"
                title="Payment gateway"
                highlight={isIndia ? "Paytm or UPI" : "Stripe Connect"}
                description={isIndia
                    ? "How customers pay you — on the POS customer screen and the table QR page. India uses Paytm UPI."
                    : `Card payments via Stripe — auto-routed for restaurants outside India.${country ? " Country: " + country + "." : ""}`}
            />

            {/* Hero status card — answers the question every merchant has
              * the second they land on this page: "Am I set up to take
              * payments right now?" One big icon, one big sentence,
              * one supporting line — and a green/amber/red rail down
              * the side so the verdict reads at a glance. */}
            <PaymentStatusHero
                status={status}
                method={activeMethodLabel}
                isIndia={isIndia}
                paytmReady={paytmReady}
                manualReady={manualReady}
                stripeReady={stripeReady}
                stripePartial={stripePartial}
                paytmStepsDone={paytmStepsDone}
            />

            {/* Visual money-flow: Customer → Gateway → Your bank.
              * Compact, scannable in two seconds — replaces the
              * previous prose-heavy "money flow" bullet boxes. */}
            <MoneyFlow
                gatewayName={isIndia ? (gateway === "manual" ? "Manual UPI" : "Paytm UPI") : "Stripe"}
                gatewayIcon={isIndia ? (gateway === "manual" ? Smartphone : Zap) : CreditCard}
                feeNote={
                    isIndia
                        ? (gateway === "manual" ? "0% fees — direct UPI" : "0% UPI MDR — set by RBI")
                        : "Stripe processing + 1% platform fee"
                }
                speedNote={
                    isIndia
                        ? (gateway === "manual" ? "Manual review at /pending-orders" : "Auto-confirmed by webhook")
                        : "Settles to your bank (T+2 in US, T+7 in EU)"
                }
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
                            {/* "What you get" — same content as the old
                              * prose box, distilled into scannable pills
                              * with icons. Half the height, easier to
                              * read on mobile. */}
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                <BenefitPill icon={Banknote} title="Your bank" sub="Direct settlement" />
                                <BenefitPill icon={Zap}      title="Auto-confirmed" sub="Via webhook" />
                                <BenefitPill icon={Smartphone} title="Any UPI app" sub="GPay · PhonePe · BHIM" />
                                <BenefitPill icon={Sparkles}  title="0% MDR" sub="RBI mandate" />
                            </div>

                            {/* Stepper — "Step N of 4". The merchant knows
                              * exactly where they are in the setup at a
                              * glance, including which steps still need
                              * action. Webhook step is unverifiable from
                              * our side so it shows as "do this in Paytm". */}
                            <SetupStepper
                                steps={[
                                    { label: "Create Paytm account", done: true /* always 1; assume merchant landed here intending to set up */ },
                                    { label: "Copy MID", done: !!paytmMid.trim() },
                                    { label: "Copy Merchant Key", done: !!paytmKey.trim() },
                                    { label: "Set webhook in Paytm", done: false, manual: true },
                                ]}
                            />

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
                                {/* Active-env selector. Two big chips —
                                  * whichever the owner picks is the pair
                                  * the runtime uses. Test creds without
                                  * Production (or vice versa) are fine;
                                  * only the ACTIVE pair has to be
                                  * complete to go live. */}
                                <div className="space-y-1.5">
                                    <Label className="text-foreground">Active environment</Label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <Button
                                            type="button"
                                            variant={paytmEnv === "staging" ? "neon" : "outline"}
                                            size="sm"
                                            onClick={() => setPaytmEnv("staging")}
                                            className="justify-center"
                                        >
                                            Test (staging)
                                        </Button>
                                        <Button
                                            type="button"
                                            variant={paytmEnv === "production" ? "neon" : "outline"}
                                            size="sm"
                                            onClick={() => setPaytmEnv("production")}
                                            className="justify-center"
                                        >
                                            Production (live)
                                        </Button>
                                    </div>
                                    <p className="text-[11px]">
                                        Paste credentials for BOTH environments below — you can keep them stored side-by-side and switch between them with one tap. The pair tagged <strong className="text-foreground">ACTIVE</strong> is the one that handles real payments.
                                    </p>
                                </div>

                                {/* Two credential cards, side-by-side on
                                  * desktop, stacked on mobile. Each owns
                                  * its own MID + Key + Test button +
                                  * Active pill. Colour-coded so the
                                  * owner never confuses Test and Live. */}
                                <div className="grid gap-3 lg:grid-cols-2">
                                    <CredCard
                                        env="staging"
                                        active={paytmEnv === "staging"}
                                        mid={paytmMidStaging}
                                        onMid={setPaytmMidStaging}
                                        keyValue={paytmKeyStaging}
                                        onKey={setPaytmKeyStaging}
                                        showKey={showKeyStaging}
                                        onToggleShowKey={() => setShowKeyStaging((s) => !s)}
                                        onTest={() => testPaytmConnection("staging")}
                                        testing={testing === "staging"}
                                        testDisabled={testing !== null}
                                    />
                                    <CredCard
                                        env="production"
                                        active={paytmEnv === "production"}
                                        mid={paytmMid}
                                        onMid={setPaytmMid}
                                        keyValue={paytmKey}
                                        onKey={setPaytmKey}
                                        showKey={showKey}
                                        onToggleShowKey={() => setShowKey((s) => !s)}
                                        onTest={() => testPaytmConnection("production")}
                                        testing={testing === "production"}
                                        testDisabled={testing !== null}
                                    />
                                </div>
                                <p className="text-[11px]">
                                    Keys are stored encrypted; never echoed to a customer&apos;s browser.
                                </p>
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

                            {/* "Ready when" checks the ACTIVE pair —
                              * inactive credentials are optional. */}
                            <div className="rounded-lg border border-border/60 p-3 space-y-1.5">
                                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                                    Ready when ({paytmEnv === "production" ? "Production" : "Test"} is active)
                                </div>
                                <ChecklistRow
                                    done={paytmEnv === "production" ? !!paytmMid.trim() : !!paytmMidStaging.trim()}
                                    label={`${paytmEnv === "production" ? "Production" : "Test"} MID pasted`}
                                />
                                <ChecklistRow
                                    done={paytmEnv === "production" ? !!paytmKey.trim() : !!paytmKeyStaging.trim()}
                                    label={`${paytmEnv === "production" ? "Production" : "Test"} Merchant Key pasted`}
                                />
                                <ChecklistRow
                                    done={
                                        paytmEnv === "production"
                                            ? !!paytmMid.trim() && !!paytmKey.trim()
                                            : !!paytmMidStaging.trim() && !!paytmKeyStaging.trim()
                                    }
                                    label="Both filled in — press “Save changes” at the bottom to go live"
                                />
                            </div>

                            {/* Inline result panel for the most recent
                              * test. THREE states drive the visuals:
                              *   • success   — green, "verified"
                              *   • indeterminate — primary/info, "inconclusive,
                              *                     try a real payment"
                              *   • hard fail — amber, "keys rejected"
                              * Paytm's order-status API returns
                              * 501/empty-body for many unrelated reasons,
                              * so "we couldn't tell" is the most common
                              * outcome and shouldn't shout RED at the
                              * merchant. */}
                            {lastTest && (() => {
                                const state =
                                    lastTest.ok ? "success" :
                                    lastTest.indeterminate ? "indeterminate" :
                                    "fail"
                                const tone =
                                    state === "success" ? "border-success/40 bg-success/[0.06]" :
                                    state === "indeterminate" ? "border-primary/40 bg-primary/[0.05]" :
                                    "border-warning/40 bg-warning/[0.06]"
                                const headline =
                                    state === "success" ? "Credentials verified" :
                                    state === "indeterminate" ? "Inconclusive — keys may still work" :
                                    "Keys rejected by Paytm"
                                const icon =
                                    state === "success" ? <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" /> :
                                    state === "indeterminate" ? <RefreshCw className="h-3.5 w-3.5 text-primary shrink-0" /> :
                                    <AlertCircle className="h-3.5 w-3.5 text-warning shrink-0" />
                                return (
                                    <div className={cn("rounded-md border px-3 py-2 text-xs space-y-1", tone)} role="status">
                                        <div className="flex items-center gap-1.5 font-semibold">
                                            {icon}
                                            <span>
                                                {headline}
                                                <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                                                    · {lastTest.env === "production" ? "Production" : "Test"}
                                                </span>
                                            </span>
                                        </div>
                                        <div className="whitespace-pre-line text-muted-foreground leading-relaxed">
                                            {lastTest.message}
                                        </div>
                                        {state === "indeterminate" && (
                                            <p className="pt-1 text-[11px] text-primary">
                                                Tip: hit <strong>Save changes</strong> below and ring up a small ₹1 test order from POS — a real payment is the only conclusive check.
                                            </p>
                                        )}
                                    </div>
                                )
                            })()}

                            {/* Destructive — remove BOTH pairs from
                              * RestoPOS. Visible only when there's
                              * something to remove. Paytm-side account
                              * is untouched. */}
                            {(paytmMid.trim() || paytmKey.trim() || paytmMidStaging.trim() || paytmKeyStaging.trim()) && (
                                <div className="rounded-lg border border-destructive/30 bg-destructive/[0.04] p-3 space-y-2">
                                    <div className="text-[11px] font-semibold text-destructive uppercase tracking-wider">Danger zone</div>
                                    <p className="text-xs text-muted-foreground">
                                        Wipes BOTH the Test and Production pairs from RestoPOS. Customers won&apos;t be able to pay via Paytm until you connect again. Your Paytm-for-Business account itself stays intact.
                                    </p>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="border-destructive/40 text-destructive hover:bg-destructive/10"
                                        onClick={disconnectPaytm}
                                        disabled={disconnecting === "paytm"}
                                    >
                                        {disconnecting === "paytm"
                                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            : <AlertCircle className="h-3.5 w-3.5" />}
                                        Remove Paytm
                                    </Button>
                                </div>
                            )}
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
                    {/* Compact "what you get" pills — same content as the
                      * old bullet list, easier to scan. The top-of-page
                      * MoneyFlow already shows the customer→gateway→bank
                      * arrow visually. */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <BenefitPill icon={CreditCard}  title="Cards & wallets" sub="Apple Pay, Google Pay, Link" />
                        <BenefitPill icon={Banknote}    title="Direct to bank" sub="T+2 US · T+7 EU" />
                        <BenefitPill icon={Sparkles}    title="Auto reconcile" sub="Webhook confirms" />
                        <BenefitPill icon={Wallet}      title="~2.9% + 1%" sub="Stripe fee + platform" />
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

                            {/* Destructive — disconnect Stripe on the
                              * RestoPOS side. The Stripe account itself
                              * stays put (deleting on Stripe's side
                              * requires a zero pending balance and is
                              * done from Stripe Dashboard). */}
                            <div className="rounded-md border border-destructive/30 bg-destructive/[0.04] p-3 space-y-2 mt-2">
                                <div className="text-[11px] font-semibold text-destructive uppercase tracking-wider">Danger zone</div>
                                <p className="text-xs text-muted-foreground">
                                    Disconnects the Connect account from RestoPOS. Cards stop running until you reconnect. Your Stripe account on Stripe&apos;s side is left intact — you can fully delete it from Stripe Dashboard after settling any pending balance.
                                </p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                                    onClick={disconnectStripe}
                                    disabled={disconnecting === "stripe"}
                                >
                                    {disconnecting === "stripe"
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <AlertCircle className="h-3.5 w-3.5" />}
                                    Disconnect Stripe
                                </Button>
                            </div>
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

            {isIndia && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <QrCode className="h-3.5 w-3.5 shrink-0" />
                    Customers scan the QR on the POS customer screen or the table-ordering page.
                    {tenantName ? ` Payments settle to ${tenantName}'s own Paytm account.` : ""}
                </p>
            )}

            {/* Sticky save bar — pinned to the viewport bottom so the
              * merchant doesn't lose the save action while scrolling
              * through Paytm setup steps or Stripe details. Carries
              * the current method label as a reminder of what's about
              * to be persisted. */}
            <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/85 backdrop-blur-xl">
                <div className="container mx-auto max-w-3xl px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex items-center gap-2 text-xs">
                        <Badge
                            variant={status === "ready" ? "success" : status === "partial" ? "warning" : "outline"}
                            className="shrink-0 capitalize"
                        >
                            {status === "ready" ? "Ready" : status === "partial" ? "Action needed" : "Setup"}
                        </Badge>
                        <span className="truncate text-muted-foreground">{activeMethodLabel}</span>
                    </div>
                    <Button variant="neon" onClick={save} disabled={busy} className="shrink-0">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save changes
                    </Button>
                </div>
            </div>
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

/**
 * Hero status card — the answer to "am I taking payments right now?"
 * Sits at the very top of the page so the merchant doesn't have to
 * scan the whole form to figure it out.
 *
 * Three states drive both copy and the accent rail down the left:
 *   • ready   — green, no action needed
 *   • partial — amber, account exists but Stripe/Paytm onboarding
 *               isn't finished yet
 *   • missing — slate, nothing's set up
 */
function PaymentStatusHero({
    status, method, isIndia, paytmReady, manualReady, stripeReady, stripePartial, paytmStepsDone,
}: {
    status: "ready" | "partial" | "missing"
    method: string
    isIndia: boolean
    paytmReady: boolean
    manualReady: boolean
    stripeReady: boolean
    stripePartial: boolean
    paytmStepsDone: number
}) {
    const tone =
        status === "ready" ? { rail: "bg-success", chip: "success", icon: CheckCircle2, iconClr: "text-success" } :
        status === "partial" ? { rail: "bg-warning", chip: "warning", icon: AlertCircle, iconClr: "text-warning" } :
        { rail: "bg-muted-foreground/30", chip: "outline", icon: Circle, iconClr: "text-muted-foreground" }
    const Icon = tone.icon

    const headline =
        status === "ready" ? "You're set up to take payments" :
        status === "partial" ? "One more step — finish onboarding" :
        "Connect a payment method to start"

    const subline =
        status === "ready" ? "Customers can pay; money settles directly to your account."
            : status === "partial" ? "Your account is created. Stripe still needs your business details and bank account before charges go live."
                : isIndia
                    ? "Pick Paytm UPI for automatic confirmations, or Manual UPI to review screenshots."
                    : "Connect with Stripe — we'll create a Connect account and walk you through onboarding."

    return (
        <Card className="relative overflow-hidden">
            {/* Accent rail down the left edge — colour matches status. */}
            <div className={cn("absolute inset-y-0 left-0 w-1.5", tone.rail)} aria-hidden />
            <CardContent className="p-5 pl-7">
                <div className="flex items-start gap-4">
                    <div className={cn(
                        "grid place-items-center h-12 w-12 rounded-2xl shrink-0",
                        status === "ready" && "bg-success/10",
                        status === "partial" && "bg-warning/10",
                        status === "missing" && "bg-muted/40",
                    )}>
                        <Icon className={cn("h-6 w-6", tone.iconClr)} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-lg md:text-xl font-bold leading-tight">{headline}</h2>
                            <Badge variant={tone.chip as "success" | "warning" | "outline"} className="capitalize">
                                {status === "ready" ? "Active" : status === "partial" ? "Pending" : "Not set"}
                            </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 leading-snug">{subline}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-muted-foreground">Method:</span>
                            <Badge variant="outline" className="font-mono">{method}</Badge>
                            {/* Tiny progress chip for India-Paytm flow */}
                            {isIndia && !paytmReady && !manualReady && (
                                <Badge variant="outline" className="text-[10px]">
                                    Paytm setup · {paytmStepsDone}/4 done
                                </Badge>
                            )}
                            {!isIndia && stripePartial && (
                                <Badge variant="outline" className="text-[10px]">Stripe · onboarding in progress</Badge>
                            )}
                            {!isIndia && stripeReady && (
                                <Badge variant="outline" className="text-[10px]">Stripe · live</Badge>
                            )}
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

/**
 * Three-step money-flow ribbon: Customer → Gateway → Your bank.
 * Replaces the prose-heavy "Money flow" bullet boxes — same content,
 * scannable in a glance. Fee + speed callouts sit inside the gateway
 * tile so the merchant sees them next to the brand mark.
 */
function MoneyFlow({
    gatewayName, gatewayIcon: GatewayIcon, feeNote, speedNote,
}: {
    gatewayName: string
    gatewayIcon: React.ComponentType<{ className?: string }>
    feeNote: string
    speedNote: string
}) {
    return (
        <Card>
            <CardContent className="p-4">
                <div className="grid grid-cols-[1fr_auto_2fr_auto_1fr] gap-2 items-center">
                    <Node icon={User} label="Customer" sub="Pays the bill" />
                    <ArrowRight className="h-4 w-4 text-muted-foreground mx-auto" aria-hidden />
                    <Node
                        icon={GatewayIcon}
                        label={gatewayName}
                        sub={feeNote}
                        accent
                    />
                    <ArrowRight className="h-4 w-4 text-muted-foreground mx-auto" aria-hidden />
                    <Node icon={Banknote} label="Your bank" sub={speedNote} />
                </div>
            </CardContent>
        </Card>
    )
}

function Node({
    icon: Icon, label, sub, accent,
}: {
    icon: React.ComponentType<{ className?: string }>
    label: string
    sub: string
    accent?: boolean
}) {
    return (
        <div className="flex flex-col items-center text-center gap-1.5 min-w-0">
            <div className={cn(
                "grid place-items-center h-10 w-10 rounded-xl shrink-0",
                accent ? "bg-gradient-to-br from-primary/30 to-[hsl(var(--neon-magenta)/0.25)] text-primary" : "bg-muted/50 text-muted-foreground",
            )}>
                <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
                <div className="text-xs font-semibold truncate">{label}</div>
                <div className="text-[10px] text-muted-foreground leading-tight line-clamp-2">{sub}</div>
            </div>
        </div>
    )
}

/**
 * Setup progress stepper — the Paytm flow has 4 steps, and an
 * owner mid-setup wants to see "I've done 2 of 4" without scrolling
 * to find the next thing. Each dot is filled when its step is done;
 * the `manual` flag means "we can't verify this from our side — go
 * do it in Paytm" (used for the webhook step).
 */
function SetupStepper({
    steps,
}: {
    steps: Array<{ label: string; done: boolean; manual?: boolean }>
}) {
    const done = steps.filter((s) => s.done).length
    const total = steps.length
    return (
        <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                    Setup progress
                </div>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                    {done} of {total} {done === total ? "· done" : "complete"}
                </span>
            </div>
            {/* Bar */}
            <div className="h-1.5 w-full rounded-full bg-border/60 overflow-hidden">
                <div
                    className="h-full bg-gradient-to-r from-primary to-[hsl(var(--neon-magenta))] transition-[width] duration-300"
                    style={{ width: `${(done / total) * 100}%` }}
                />
            </div>
            {/* Step list */}
            <ol className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {steps.map((s, i) => (
                    <li
                        key={s.label}
                        className={cn(
                            "flex items-start gap-1.5 text-[11px] leading-tight rounded-md px-2 py-1.5 border",
                            s.done
                                ? "border-success/40 bg-success/[0.06] text-foreground"
                                : s.manual
                                    ? "border-warning/40 bg-warning/[0.06]"
                                    : "border-border/60 text-muted-foreground",
                        )}
                    >
                        <span className={cn(
                            "grid place-items-center h-4 w-4 rounded-full shrink-0 text-[9px] font-bold mt-0.5",
                            s.done ? "bg-success text-success-foreground"
                                : s.manual ? "bg-warning/80 text-warning-foreground"
                                : "bg-muted text-muted-foreground",
                        )}>
                            {s.done ? "✓" : i + 1}
                        </span>
                        <span className="min-w-0">
                            <span className="block font-medium">{s.label}</span>
                            {s.manual && !s.done && (
                                <span className="text-[10px] text-warning/90">Do this in Paytm</span>
                            )}
                        </span>
                    </li>
                ))}
            </ol>
        </div>
    )
}

/** Compact icon+title+sub pill used to replace the verbose "Why X?" bullet lists. */
function BenefitPill({
    icon: Icon, title, sub,
}: {
    icon: React.ComponentType<{ className?: string }>
    title: string
    sub: string
}) {
    return (
        <div className="rounded-lg border border-border/60 bg-card/60 px-3 py-2 flex items-start gap-2">
            <div className="grid place-items-center h-7 w-7 rounded-md bg-primary/10 text-primary shrink-0">
                <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
                <div className="text-xs font-semibold leading-tight truncate">{title}</div>
                <div className="text-[10px] text-muted-foreground leading-tight line-clamp-2">{sub}</div>
            </div>
        </div>
    )
}

/**
 * Side-by-side credential card for one Paytm environment. Two of
 * these — Test (amber) and Production (cyan) — sit next to each other
 * inside the Paytm tab. Each owns its own MID + Merchant Key inputs
 * and an env-locked Test button.
 *
 * The "ACTIVE" pill lights up on whichever card matches `paytmEnv`,
 * so the merchant always knows which pair the runtime is using.
 */
function CredCard({
    env, active, mid, onMid, keyValue, onKey, showKey, onToggleShowKey, onTest, testing, testDisabled,
}: {
    env: "staging" | "production"
    active: boolean
    mid: string
    onMid: (v: string) => void
    keyValue: string
    onKey: (v: string) => void
    showKey: boolean
    onToggleShowKey: () => void
    onTest: () => void
    testing: boolean
    testDisabled: boolean
}) {
    const isProd = env === "production"
    const label = isProd ? "Production (live)" : "Test (staging)"
    const sub = isProd
        ? "Real payments. Copy from the Production API Details tab in Paytm."
        : "Sandbox. Copy from the Test API Details tab in Paytm — no KYC needed."
    return (
        <div className={cn(
            "rounded-xl border p-3 space-y-2.5 relative",
            // Colour identity per env — the merchant never has to
            // re-read the label to know which card they're in.
            isProd
                ? "border-primary/40 bg-primary/[0.04]"
                : "border-warning/40 bg-warning/[0.04]",
            // Subtle ring when this is the active pair.
            active && (isProd ? "ring-2 ring-primary/40" : "ring-2 ring-warning/40"),
        )}>
            <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn(
                            "grid place-items-center h-6 w-6 rounded-md text-[11px] font-bold",
                            isProd ? "bg-primary/15 text-primary" : "bg-warning/15 text-warning",
                        )}>
                            {isProd ? "P" : "T"}
                        </span>
                        <h5 className="font-semibold text-sm">{label}</h5>
                        {active && (
                            <Badge variant={isProd ? "default" : "warning"} className="text-[10px] uppercase tracking-wider">
                                Active
                            </Badge>
                        )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
                </div>
            </div>

            <div className="space-y-1.5">
                <Label className="text-[11px] text-foreground">Paytm MID</Label>
                <Input
                    value={mid}
                    onChange={(e) => onMid(e.target.value)}
                    className="font-mono text-xs"
                    placeholder={isProd ? "Production MID (~20 chars)" : "Test MID (~20 chars)"}
                    autoComplete="off"
                />
            </div>
            <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-[11px] text-foreground">
                    <KeyRound className="h-3.5 w-3.5" /> Merchant Key
                </Label>
                <div className="relative">
                    <Input
                        type={showKey ? "text" : "password"}
                        value={keyValue}
                        onChange={(e) => onKey(e.target.value)}
                        className="font-mono text-xs pr-10"
                        placeholder="16-character secret"
                        autoComplete="off"
                    />
                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="absolute right-1 top-1 h-7 w-7"
                        onClick={onToggleShowKey}
                        aria-label={showKey ? "Hide key" : "Show key"}
                    >
                        {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                </div>
            </div>
            <Button
                type="button"
                variant={isProd ? "neon" : "outline"}
                size="sm"
                className="w-full"
                onClick={onTest}
                disabled={testDisabled || !mid.trim() || !keyValue.trim()}
            >
                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Test {isProd ? "Production" : "Test"} connection
            </Button>
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
