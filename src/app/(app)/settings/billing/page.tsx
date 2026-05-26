"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Loader2, ShieldAlert, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/app-shell/page-header"
import { cn, formatDate } from "@/lib/utils"
import { PlanPicker } from "./plan-picker"
import { PaymentMethodsCard } from "./payment-methods-card"
import { InvoicesCard } from "./invoices-card"
import { SubscriptionActionsCard } from "./subscription-actions-card"

/**
 * Subscription billing page (platform → restaurant SaaS fee).
 *
 *  - TRIAL          → countdown + "Add payment method" CTA
 *  - ACTIVE         → next bill date + card on file + portal link
 *  - PAST_DUE       → "payment failed, update card" + portal link
 *  - SUSPENDED      → red banner + "Pay now" via Customer Portal
 *  - CANCELED       → "Reactivate" CTA
 *
 * Every tenant — India and international — pays the SaaS fee through
 * Stripe; India just resolves to the INR price IDs.
 *
 * The OWNER never sees raw Stripe IDs. Everything's mediated through
 * /api/billing/* endpoints; the Card Element flow attaches the PM and
 * triggers start-subscription. Self-serve management (update card,
 * download invoices, cancel) all happens in the Stripe Customer Portal.
 */
type BillingStatus = {
    status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED" | null
    country: string | null
    is_billable: boolean
    is_india: boolean
    trial_ends_at: string | null
    current_period_end: string | null
    days_until_billing: number | null
    has_payment_method: boolean
    card_brand: string | null
    card_last4: string | null
    has_stripe_customer: boolean
    /** True when a real Stripe subscription (sub_…) exists for this
     *  tenant, regardless of state. Drives whether a tier swap needs
     *  the cancel-and-activate confirmation dialog. */
    has_subscription: boolean
    /** True when the OWNER has hit Cancel — the subscription is still
     *  ACTIVE until `cancels_on`, then it ends. Drives the
     *  "Reactivate" button + "ending soon" banner. */
    cancel_at_period_end: boolean
    /** ISO date when a soft-canceled subscription actually ends. */
    cancels_on: string | null
    platform_configured: boolean
}

export default function BillingSettingsPage() {
    const [status, setStatus] = useState<BillingStatus | null>(null)
    const [loading, setLoading] = useState(true)

    async function refresh() {
        try {
            const r = await fetch("/api/billing/status")
            if (!r.ok) throw new Error("failed")
            const data = await r.json() as BillingStatus
            setStatus(data)
        } catch {
            setStatus(null)
        } finally {
            setLoading(false)
        }
    }
    useEffect(() => { refresh() }, [])

    if (loading) {
        return (
            <div className="container mx-auto py-8 px-4 max-w-3xl">
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                </div>
            </div>
        )
    }
    if (!status) {
        return (
            <div className="container mx-auto py-8 px-4 max-w-3xl">
                <Card className="border-destructive/40 bg-destructive/5">
                    <CardContent className="py-6">
                        <p className="text-sm">Couldn&apos;t load your subscription status. Try refreshing.</p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-3xl space-y-6">
            <PageHeader
                kicker="Configure"
                title="Billing"
                highlight={statusHighlight(status.status)}
                description="Your RestoPOS subscription — payment method, next bill, history."
            />

            <StatusCard status={status} />

            {/* ── Plan picker ────────────────────────────────────────────
              * Three tier cards. Active tier is badged "Current"; clicking
              * another card mirrors the new limits to the tenant row via
              * /api/billing/set-plan. While the OWNER is on a TRIAL ("free
              * plan") we recommend the top tier explicitly — they're not
              * paying yet, so it's the best window to anchor on the
              * highest plan; downgrade is one click later. */}
            <PlanPicker
                isIndia={status.is_india}
                isTrial={status.status === "TRIAL"}
                // Drives the cancel-and-activate confirmation dialog.
                // Tenants without a Stripe sub yet (raw trial, no card)
                // switch tiers silently — there's no Stripe-side state
                // to swap. Once a sub exists, every tier change goes
                // through the confirmation dialog.
                hasSubscription={status.has_subscription}
                // Drives the "add card before honouring tier pick" flow
                // during TRIAL. Without a card on file we MUST collect
                // one — otherwise the trial ends with no payment
                // instrument and POS billing suspends silently.
                hasPaymentMethod={status.has_payment_method}
                trialEndsAt={status.trial_ends_at}
                onChange={refresh}
            />

            {/* ── Payment methods + Invoices. Every tenant — India and
              *  international — pays the SaaS fee through Stripe; India
              *  just resolves to the INR price IDs. Shown once the
              *  platform billing env vars are configured. */}
            {!status.platform_configured ? (
                <PlatformNotConfiguredNotice />
            ) : (
                <>
                    <PaymentMethodsCard
                        hasSubscription={status.status === "ACTIVE" || status.status === "PAST_DUE"}
                        onChange={refresh}
                    />

                    {/* In-app cancel + reactivate. Renders nothing when
                      * no Stripe subscription exists (raw trial, etc.). */}
                    <SubscriptionActionsCard
                        hasSubscription={status.has_subscription}
                        cancelAtPeriodEnd={status.cancel_at_period_end}
                        cancelsOn={status.cancels_on}
                        onChange={refresh}
                    />

                    <InvoicesCard />

                    {/* Stripe Customer Portal escape hatch — kept for
                      * things we don't expose in-app (retry a failed
                      * invoice, update tax IDs, change billing address). */}
                    <Card>
                        <CardContent className="py-4 flex items-center justify-between gap-3 flex-wrap">
                            <div className="space-y-1">
                                <div className="text-sm font-semibold">Other billing actions</div>
                                <p className="text-xs text-muted-foreground">
                                    Retry a failed invoice, update tax IDs, change billing address — handled in the Stripe portal.
                                </p>
                            </div>
                            <PortalButton />
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    )
}

function PlatformNotConfiguredNotice() {
    return (
        <Card className="border-warning/40 bg-warning/5">
            <CardContent className="py-6 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                <div className="space-y-1">
                    <div className="font-semibold">Platform billing isn&apos;t configured</div>
                    <p className="text-sm text-muted-foreground">
                        The platform owner needs to set <code>STRIPE_PLATFORM_PRICE_ID_INTL_*</code> in the server env vars before restaurants can subscribe.
                    </p>
                </div>
            </CardContent>
        </Card>
    )
}

/* ──────────────────────────────────────────────────────────────────────
 *  Top status card — renders one of five layouts based on subscription
 *  state. Each tone (success/warning/destructive) signals urgency to the
 *  OWNER at a glance.
 * ──────────────────────────────────────────────────────────────────── */
function StatusCard({ status }: { status: BillingStatus }) {
    const isActive = status.status === "ACTIVE"
    const isTrial = status.status === "TRIAL"
    const isPastDue = status.status === "PAST_DUE"
    const isSuspended = status.status === "SUSPENDED"
    const isCanceled = status.status === "CANCELED"

    const billingDate = status.current_period_end ?? status.trial_ends_at
    const daysLeft = status.days_until_billing

    return (
        <Card className={cn(
            "border-2",
            isActive && "border-success/40 bg-success/[0.03]",
            isTrial && daysLeft != null && daysLeft <= 7 && "border-warning/40 bg-warning/[0.04]",
            isTrial && (daysLeft == null || daysLeft > 7) && "border-primary/40 bg-primary/[0.03]",
            isPastDue && "border-warning/40 bg-warning/[0.05]",
            isSuspended && "border-destructive/50 bg-destructive/[0.05]",
            isCanceled && "border-muted-foreground/30 bg-muted/40",
        )}>
            <CardContent className="py-5 flex items-start gap-4">
                <span className={cn(
                    "grid place-items-center h-12 w-12 rounded-xl shrink-0",
                    isActive && "bg-success/15 text-success",
                    isTrial && "bg-primary/15 text-primary",
                    (isPastDue) && "bg-warning/15 text-warning",
                    (isSuspended || isCanceled) && "bg-destructive/15 text-destructive",
                )}>
                    {isActive ? <CheckCircle2 className="h-6 w-6" />
                        : isTrial ? <Sparkles className="h-6 w-6" />
                        : isPastDue ? <Clock className="h-6 w-6" />
                        : <ShieldAlert className="h-6 w-6" />}
                </span>
                <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-bold text-lg">
                            {isActive && "Subscription active"}
                            {isTrial && (daysLeft != null && daysLeft <= 0 ? "Trial ended" : "Free trial")}
                            {isPastDue && "Payment failed"}
                            {isSuspended && "POS billing suspended"}
                            {isCanceled && "Subscription canceled"}
                        </div>
                        <Badge variant={status.is_billable ? "success" : "destructive"} className="text-[10px]">
                            {status.is_billable ? "Billing enabled" : "Billing blocked"}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">Plans from $49 / month</Badge>
                    </div>

                    {/* State-specific copy */}
                    {isTrial && daysLeft != null && daysLeft > 0 && (
                        <div className="space-y-1.5">
                            <p className="text-sm text-muted-foreground">
                                <span className="font-semibold text-foreground">{daysLeft} day{daysLeft === 1 ? "" : "s"}</span> left on your free trial.
                                {billingDate && <> Your trial ends on <span className="font-semibold text-foreground">{formatDate(billingDate, { dateStyle: "medium" })}</span>.</>}
                            </p>
                            {/* Two distinct sub-states. Without a card we
                              * push the OWNER to add one before the
                              * trial lapses; with a card we explicitly
                              * tell them when (and from which card) the
                              * first charge will fire so the auto-renew
                              * is never a surprise. */}
                            {!status.has_payment_method ? (
                                <p className="text-sm text-foreground">
                                    To keep using RestoPOS after your trial ends, pick a plan below — we&apos;ll ask
                                    for a card and only charge it on the trial-end date. <span className="text-muted-foreground">No charge until then; cancel any time.</span>
                                </p>
                            ) : (
                                <p className="text-sm text-foreground">
                                    Your <span className="font-semibold capitalize">{status.card_brand ?? "card"}</span>
                                    {status.card_last4 ? <> ending in <span className="font-mono">{status.card_last4}</span></> : null}
                                    {" "}is on file. We&apos;ll charge it on the trial-end date for the plan you have selected below. <span className="text-muted-foreground">Cancel before then and you&apos;re never billed.</span>
                                </p>
                            )}
                        </div>
                    )}
                    {isTrial && (daysLeft == null || daysLeft <= 0) && (
                        <p className="text-sm text-muted-foreground">
                            Your trial has ended. Pick a plan below and add a payment method to resume bill generation.
                        </p>
                    )}
                    {isActive && billingDate && (
                        <p className="text-sm text-muted-foreground">
                            Next charge on <span className="font-semibold text-foreground">{formatDate(billingDate, { dateStyle: "medium" })}</span>
                            {status.card_last4 ? <> from card ending in <span className="font-mono">{status.card_last4}</span></> : null}.
                        </p>
                    )}
                    {isPastDue && (
                        <p className="text-sm text-muted-foreground">
                            Your last invoice failed. Stripe will retry automatically, but it&apos;s safer to update your card now from the billing portal to avoid suspension.
                        </p>
                    )}
                    {isSuspended && (
                        <p className="text-sm">
                            <span className="font-semibold text-destructive">POS bill generation is paused.</span>{" "}
                            <span className="text-muted-foreground">Pay the outstanding invoice from the billing portal to instantly re-enable billing.</span>
                        </p>
                    )}
                    {isCanceled && (
                        <p className="text-sm text-muted-foreground">
                            Your subscription was canceled. Add a new payment method to start again.
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}

/* ──────────────────────────────────────────────────────────────────────
 *  Stripe Customer Portal trigger. Self-serve everything once the OWNER
 *  has a sub: update card, retry payment, view invoices, cancel.
 *  Kept as an escape hatch alongside the in-app PaymentMethodsCard /
 *  InvoicesCard for actions we don't expose in-app yet.
 * ──────────────────────────────────────────────────────────────────── */
function PortalButton() {
    const [busy, setBusy] = useState(false)
    async function open() {
        setBusy(true)
        try {
            const r = await fetch("/api/billing/portal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
            })
            const data = await r.json()
            if (!r.ok || !data.url) throw new Error(data.error ?? "Couldn't open portal")
            window.open(data.url, "_blank", "noopener")
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Couldn't open portal")
        } finally {
            setBusy(false)
        }
    }
    return (
        <Button variant="outline" size="sm" onClick={open} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
            Manage in Stripe portal
        </Button>
    )
}

function statusHighlight(s: BillingStatus["status"]): string {
    switch (s) {
        case "ACTIVE":    return "subscription active"
        case "TRIAL":     return "free trial"
        case "PAST_DUE":  return "payment failed"
        case "SUSPENDED": return "POS suspended"
        case "CANCELED":  return "canceled"
        default:          return "subscription"
    }
}
