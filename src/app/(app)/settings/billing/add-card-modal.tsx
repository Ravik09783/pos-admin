"use client"

import { useEffect, useState } from "react"
import { loadStripe, type Stripe } from "@stripe/stripe-js"
import {
    Elements,
    PaymentElement,
    useElements,
    useStripe,
} from "@stripe/react-stripe-js"
import { CreditCard, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { formatDate } from "@/lib/utils"
import { formatPlanPrice, type PlanDefinition } from "@/lib/billing/plans"

/**
 * "Add card" modal — Stripe Payment Element with the platform's dark
 * theme baked into the Elements appearance API so the embedded form
 * stops looking like a vanilla Stripe widget plopped onto the page.
 *
 * Why Payment Element and not CardElement:
 *   - Payment Element is Stripe's current-recommended component; the
 *     legacy CardElement is in maintenance.
 *   - Real-time validation, post-code prompts, brand auto-detection,
 *     and 3DS challenges all render inside the same iframe — fewer
 *     edge cases for us to handle.
 *   - We restrict it to cards (`payment_method_types: ['card']` on the
 *     SetupIntent + `paymentMethodTypes: ['card']` here). Non-card
 *     methods (Klarna, Afterpay) don't support recurring without extra
 *     setup, and this modal is feeding a subscription.
 *
 * Flow:
 *   1. Caller opens the modal → we POST /api/billing/setup-intent and
 *      get back a SetupIntent client_secret + the customer id.
 *   2. <Elements> + <PaymentElement> render the card form.
 *   3. On submit: stripe.confirmSetup({ elements }) tokenises + 3DS-
 *      challenges if needed. The returned pm_… is then attached to the
 *      Stripe Customer (Stripe does this automatically when the
 *      SetupIntent was created against `customer: cus_...`).
 *   4. onSaved() fires — caller refetches the payment-methods list.
 */
export function AddCardModal({
    open,
    onClose,
    onSaved,
    /** When this is the FIRST card and a subscription doesn't exist
     *  yet, we want the parent to also kick off `start-subscription`
     *  after the PM is attached. Set false for "add another card"
     *  flows on an already-subscribed account. */
    startSubscriptionAfter = false,
    /** ISO date the trial ends on. When passed, the modal shows a
     *  transparent "we'll charge on this date, nothing today" preview
     *  so the OWNER knows exactly what they're agreeing to. */
    trialEndsAt = null,
    /** Plan the OWNER picked on the tier card before opening the
     *  modal. Surfaced in the preview block so they can see "Starter
     *  · $49 / month" without leaving the modal. */
    chosenPlan = null,
}: {
    open: boolean
    onClose: () => void
    onSaved: () => void
    startSubscriptionAfter?: boolean
    trialEndsAt?: string | null
    chosenPlan?: PlanDefinition | null
}) {
    const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null)
    const [clientSecret, setClientSecret] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    // Lazy-load stripe-js. Loading it on the bare /settings/billing
    // page mount is wasted bandwidth for the 99% of OWNERs who never
    // open this modal — the publishable key gets fetched once the user
    // actually clicks "Add card".
    useEffect(() => {
        if (!open) return
        const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
        if (!key) {
            setError("Stripe publishable key isn't configured.")
            return
        }
        if (!stripePromise) setStripePromise(loadStripe(key))
    }, [open, stripePromise])

    // Mint a SetupIntent each time the modal opens. Stripe SetupIntents
    // are single-use; reusing one across opens would error on submit.
    useEffect(() => {
        if (!open) {
            setClientSecret(null)
            setError(null)
            return
        }
        let cancelled = false
        ;(async () => {
            try {
                const r = await fetch("/api/billing/setup-intent", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: "{}",
                })
                const data = await r.json() as { client_secret?: string; error?: string }
                if (cancelled) return
                if (!r.ok || !data.client_secret) {
                    throw new Error(data.error ?? "Couldn't start card setup")
                }
                setClientSecret(data.client_secret)
            } catch (e) {
                if (cancelled) return
                setError(e instanceof Error ? e.message : "Couldn't start card setup")
            }
        })()
        return () => { cancelled = true }
    }, [open])

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <CreditCard className="h-4 w-4" />
                        {chosenPlan ? `Lock in the ${chosenPlan.name} plan` : "Add payment method"}
                    </DialogTitle>
                    <DialogDescription>
                        {chosenPlan && trialEndsAt
                            ? <>We&apos;ll save the card today and only charge it on <span className="font-semibold text-foreground">{formatDate(trialEndsAt, { dateStyle: "medium" })}</span> when your free trial ends. Cancel any time before then and you&apos;re never billed.</>
                            : "Cards are tokenised by Stripe and never touch our servers."}
                    </DialogDescription>
                </DialogHeader>

                {/* TRIAL preview block — visible only when the OWNER
                  * arrived here via "pick a plan during trial". Spells
                  * out plan + price + first-charge date so they can
                  * verify before tokenising. */}
                {chosenPlan && (
                    <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Selected plan</div>
                                <div className="text-base font-bold">{chosenPlan.name}</div>
                            </div>
                            <div className="text-right">
                                <div className="text-xl font-bold tabular-nums">{formatPlanPrice(chosenPlan)}</div>
                                <div className="text-[11px] text-muted-foreground">/ month</div>
                            </div>
                        </div>
                        <div className="text-xs text-muted-foreground border-t border-primary/15 pt-2 leading-relaxed">
                            <div className="flex items-center justify-between gap-2">
                                <span>Charge today</span>
                                <span className="font-semibold text-success">{chosenPlan.currencySymbol}0.00</span>
                            </div>
                            {trialEndsAt && (
                                <div className="flex items-center justify-between gap-2 mt-0.5">
                                    <span>First charge on</span>
                                    <span className="font-semibold text-foreground">{formatDate(trialEndsAt, { dateStyle: "medium" })}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {error && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">
                        {error}
                    </div>
                )}

                {clientSecret && stripePromise ? (
                    <Elements
                        stripe={stripePromise}
                        options={{
                            clientSecret,
                            // Dark-theme Elements styling, derived from the
                            // app's CSS variables so the form matches the
                            // dialog chrome around it. `appearance` keys
                            // accept CSS-color strings only (no `hsl(var())`),
                            // so we pick concrete values that match.
                            appearance: {
                                theme: "night",
                                variables: {
                                    colorPrimary: "#22d3ee",
                                    colorBackground: "#0a0e1a",
                                    colorText: "#f4f4f5",
                                    colorTextSecondary: "#a1a1aa",
                                    colorTextPlaceholder: "#6b7280",
                                    colorDanger: "#ef4444",
                                    fontFamily: "system-ui, -apple-system, sans-serif",
                                    spacingUnit: "4px",
                                    borderRadius: "8px",
                                },
                                rules: {
                                    ".Input": {
                                        backgroundColor: "rgba(255,255,255,0.04)",
                                        border: "1px solid rgba(255,255,255,0.12)",
                                    },
                                    ".Input:focus": {
                                        borderColor: "#22d3ee",
                                        boxShadow: "0 0 0 1px #22d3ee",
                                    },
                                    ".Label": {
                                        color: "#a1a1aa",
                                        fontSize: "12px",
                                        textTransform: "uppercase",
                                        letterSpacing: "0.05em",
                                    },
                                },
                            },
                            // Card-only restriction comes from the
                            // SetupIntent itself (it was minted with
                            // payment_method_types=['card']). The Payment
                            // Element auto-respects that — no need for
                            // an Elements-level option here.
                        }}
                    >
                        <AddCardForm
                            onSaved={onSaved}
                            onClose={onClose}
                            startSubscriptionAfter={startSubscriptionAfter}
                        />
                    </Elements>
                ) : !error ? (
                    <div className="flex items-center justify-center py-6 text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    )
}

function AddCardForm({
    onSaved,
    onClose,
    startSubscriptionAfter,
}: {
    onSaved: () => void
    onClose: () => void
    startSubscriptionAfter: boolean
}) {
    const stripe = useStripe()
    const elements = useElements()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        if (!stripe || !elements) return
        setBusy(true)
        setError(null)
        try {
            // 1. Confirm the SetupIntent. `redirect: 'if_required'`
            //    keeps the user on this page for non-3DS cards; 3DS-
            //    requiring cards get an inline iframe challenge.
            const result = await stripe.confirmSetup({
                elements,
                redirect: "if_required",
            })
            if (result.error) {
                throw new Error(result.error.message ?? "Card couldn't be saved")
            }
            const pmId = result.setupIntent?.payment_method as string | null
            if (!pmId) throw new Error("Stripe didn't return a payment method id")

            // 2. Either start a subscription (first-card flow) or just
            //    notify the parent so it can refetch the PM list.
            if (startSubscriptionAfter) {
                const r = await fetch("/api/billing/start-subscription", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ payment_method_id: pmId }),
                })
                const sub = await r.json() as { error?: string; client_secret?: string }
                if (!r.ok || sub.error) throw new Error(sub.error ?? "Failed to start subscription")
                // Stripe may need a 3DS confirmation on the first
                // invoice payment — handle it inline so the OWNER
                // never leaves this dialog.
                if (sub.client_secret) {
                    const conf = await stripe.confirmCardPayment(sub.client_secret)
                    if (conf.error) throw new Error(conf.error.message ?? "Payment authentication failed")
                }
                toast.success("Subscription started — POS billing is active.")
            } else {
                toast.success("Card saved.")
            }

            onSaved()
            onClose()
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Couldn't save card"
            setError(msg)
            toast.error(msg)
        } finally {
            setBusy(false)
        }
    }

    return (
        <form onSubmit={submit} className="space-y-4">
            <PaymentElement
                options={{ layout: "tabs" }}
                // Surface a load failure inline instead of letting the user
                // click "Save" into a cryptic "no mounted Payment Element"
                // error. The usual cause is a publishable/secret key pair
                // from different Stripe accounts or test-vs-live modes.
                onLoadError={(e) =>
                    setError(
                        e.error?.message
                            ? `${e.error.message} (Check that NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY and STRIPE_SECRET_KEY are from the same Stripe account and the same test/live mode.)`
                            : "The card form failed to load — check your Stripe keys.",
                    )
                }
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                    Cancel
                </Button>
                <Button type="submit" variant="neon" disabled={!stripe || busy}>
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    {startSubscriptionAfter ? "Save & start subscription" : "Save card"}
                </Button>
            </div>
            <p className="text-[11px] text-muted-foreground text-center">
                Powered by Stripe · we never see your card details.
            </p>
        </form>
    )
}
