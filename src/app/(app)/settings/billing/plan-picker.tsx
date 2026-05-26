"use client"

import { useEffect, useState } from "react"
import { Check, Crown, Loader2, Lock, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn, formatDate } from "@/lib/utils"
import {
    getPlans, findPlan, formatPlanPrice, isUnlimited,
    type PlanDefinition, type PlanRegion, type PlanTier,
} from "@/lib/billing/plans"
import { PlanChangeDialog, planChangeDirection, type PlanChangeDirection } from "./plan-change-dialog"
import { AddCardModal } from "./add-card-modal"

interface OverageData {
    extra_branches: number
    extra_staff: number
    locked: boolean
    plan_tier: PlanTier | null
    max_branches: number | null
    max_staff_per_branch: number | null
}

/**
 * Plan picker — three tier cards the OWNER chooses from. The currently-
 * active tier is badged; clicking another card calls /api/billing/set-plan
 * which mirrors the new limits to the tenant row.
 *
 * If the new tier would still leave the tenant over its limits (e.g.
 * downgrading from Scale to Starter while running 5 branches), the API
 * call still succeeds — the SQL enforcement then locks the extras and
 * the over-limit banner appears. That's intentional: the owner is the
 * one with the data to decide which seats to deactivate.
 *
 * `isIndia` flips the region between IN and INTL. Today both regions
 * have the same numeric limits per tier — the picker still chooses the
 * right region so the displayed currency + feature list is correct.
 */
export function PlanPicker({
    isIndia,
    isTrial,
    hasSubscription = false,
    hasPaymentMethod = false,
    trialEndsAt = null,
    onChange,
}: {
    isIndia: boolean
    isTrial: boolean
    /** True when the tenant has a real Stripe subscription (sub_…)
     *  attached. Drives whether tier switches need the cancel-and-
     *  activate confirmation dialog. Trial tenants with no card yet
     *  pass false and switch tiers silently (no Stripe-side action). */
    hasSubscription?: boolean
    /** True when at least one card is on file. Drives whether TRIAL
     *  picks force the AddCardModal: no card on file means we MUST
     *  collect one before honouring the pick — otherwise the trial
     *  ends with no payment instrument and the POS suspends. */
    hasPaymentMethod?: boolean
    /** ISO date for trial end. Surfaced inside the "add card to lock in
     *  this plan" modal so the OWNER sees exactly when the first
     *  charge fires. */
    trialEndsAt?: string | null
    /** Bubbles up after a TRIAL→card flow finishes so the parent's
     *  billing-status payload (and the StatusCard / PaymentMethodsCard)
     *  refresh without a full page reload. */
    onChange?: () => void
}) {
    const region: PlanRegion = isIndia ? "IN" : "INTL"
    const plans = getPlans(region)

    // The Stripe "add a card to lock in this plan" flow runs for any
    // tenant on the trial with no card yet — India included. India pays
    // the SaaS fee through Stripe too (in INR, via the IN price IDs).
    const trialNeedsCard = isTrial && !hasPaymentMethod && !hasSubscription

    const [overage, setOverage] = useState<OverageData | null>(null)
    const [busyTier, setBusyTier] = useState<PlanTier | null>(null)
    // Pending confirmation: a tier the user clicked that's currently
    // waiting for them to confirm in the change-plan dialog. Only set
    // when an active subscription exists.
    const [pendingTier, setPendingTier] = useState<{ tier: PlanTier; direction: PlanChangeDirection } | null>(null)
    // TRIAL + no-card path: the tier the OWNER picked, kept in state
    // while the AddCardModal is open. Once the card is saved and
    // start-subscription returns ok, we clear this and refresh.
    const [addCardForTier, setAddCardForTier] = useState<PlanTier | null>(null)

    async function refresh() {
        try {
            const r = await fetch("/api/billing/plan-overage")
            if (!r.ok) return
            setOverage(await r.json() as OverageData)
        } catch { /* silent */ }
    }
    useEffect(() => { refresh() }, [])

    const currentTier = overage?.plan_tier ?? null
    const currentPlan = currentTier ? findPlan(region, currentTier) : null
    const pendingPlan = pendingTier ? findPlan(region, pendingTier.tier) : null

    /** Actually call /api/billing/set-plan. Separated from `requestPick`
     *  below so the dialog's Confirm handler can call this directly
     *  without re-prompting. Returns true iff the tier change landed
     *  successfully — the TRIAL+no-card branch uses the boolean to
     *  decide whether to open the AddCardModal (don't open it if
     *  set-plan failed; the user would otherwise be asked for a card
     *  under a tier they never actually got switched to).
     *
     *  Pass `{ silent: true }` to skip the success toast — the TRIAL
     *  flow follows up with a card-collection step where the success
     *  message is "Subscription started — POS billing is active",
     *  so a "Switched to Starter" toast first is redundant noise. */
    async function applyTier(tier: PlanTier, opts?: { silent?: boolean }): Promise<boolean> {
        setBusyTier(tier)
        try {
            const r = await fetch("/api/billing/set-plan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tier }),
            })
            const data = await r.json() as { ok?: boolean; error?: string; plan?: { name?: string } }
            if (!r.ok || !data.ok) throw new Error(data.error ?? "Failed to switch plan")
            if (!opts?.silent) toast.success(`Switched to ${data.plan?.name ?? tier}`)
            setPendingTier(null)
            await refresh()
            return true
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to switch plan")
            return false
        } finally {
            setBusyTier(null)
        }
    }

    /** What the tier card calls on click. Three branches:
     *
     *   1. TRIAL + no payment method → "ghost pick" is dangerous. Write
     *      plan_tier locally so start-subscription picks the right
     *      Stripe Price ID, then open the AddCardModal which collects a
     *      card AND fires start-subscription. The Stripe sub is created
     *      with `trial_end = trial_ends_at` so nothing is charged until
     *      the trial ends. This is the transparent, no-surprises flow
     *      the OWNER asked for.
     *
     *   2. Active Stripe subscription → tier swap is a real money event
     *      (proration on the next invoice). Gate behind the
     *      cancel-and-activate confirmation dialog.
     *
     *   3. Same tier or no subscription needed (India invoice path,
     *      free trial WITH card already on file, etc.) → write
     *      plan_tier directly. The set-plan Stripe sync handles the
     *      line-item swap if a sub already exists. */
    function requestPick(tier: PlanTier) {
        const direction = planChangeDirection(currentTier, tier)
        if (direction === "same") return

        // ── Branch 1: non-India TRIAL with no card on file ────────
        if (trialNeedsCard) {
            // Persist the tier choice first so start-subscription
            // resolves the right Stripe Price ID. Only open the card
            // modal if set-plan actually succeeded — otherwise we'd
            // collect a card under a tier the user never got switched
            // to and the resulting subscription would be on the
            // wrong Price. applyTier handles its own busyTier +
            // toast on failure, so we just guard on its return.
            void (async () => {
                const ok = await applyTier(tier, { silent: true })
                if (ok) setAddCardForTier(tier)
            })()
            return
        }

        // ── Branch 2: live Stripe sub → confirm before swap ───────
        if (hasSubscription) {
            setPendingTier({ tier, direction })
            return
        }

        // ── Branch 3: free path (no sub yet OR India invoice) ─────
        void applyTier(tier)
    }

    return (
        <>
        <Card>
            <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                    <Crown className="h-4 w-4" /> Choose your plan
                </CardTitle>
                <CardDescription>
                    {trialNeedsCard ? (
                        <>
                            You&apos;re on the free trial. Picking a plan opens a card form — we save the card now and
                            charge it <span className="font-semibold text-foreground">on {trialEndsAt ? formatDate(trialEndsAt, { dateStyle: "medium" }) : "your trial end date"}</span>,
                            not before. Cancel anytime during the trial and you&apos;re never billed.
                        </>
                    ) : isTrial ? (
                        <>
                            You&apos;re on the free trial. Your card is on file — we&apos;ll charge it on{" "}
                            <span className="font-semibold text-foreground">{trialEndsAt ? formatDate(trialEndsAt, { dateStyle: "medium" }) : "the trial end date"}</span>
                            {" "}for the plan you have selected. Switch tier or cancel anytime before then.
                        </>
                    ) : (
                        "Switch tier anytime. Downgrading is safe: nothing is deleted, but seats beyond the new cap won't be able to sign in until you upgrade again."
                    )}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid md:grid-cols-3 gap-3">
                    {plans.map((plan, idx) => (
                        <TierCard
                            key={plan.tier}
                            plan={plan}
                            current={currentTier === plan.tier}
                            busy={busyTier === plan.tier}
                            disabled={busyTier !== null}
                            // Pre-select the highest tier as the
                            // "recommended pick" only while the OWNER is
                            // on the free trial AND hasn't already
                            // chosen a tier (currentTier null). Once
                            // they've picked one, we stop nudging.
                            recommended={isTrial && currentTier == null && idx === plans.length - 1}
                            needsCard={trialNeedsCard}
                            onSelect={() => requestPick(plan.tier)}
                        />
                    ))}
                </div>

                {/* Reassurance footer — visible only on the trial-no-card
                  * path. Spells out the no-surprise-charge guarantee so
                  * the OWNER understands clicking a tier is safe. */}
                {trialNeedsCard && (
                    <div className="mt-4 flex items-start gap-2 rounded-md border border-success/30 bg-success/[0.04] p-3 text-xs">
                        <ShieldCheck className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />
                        <span className="text-muted-foreground leading-relaxed">
                            <span className="font-semibold text-foreground">No charge today.</span>{" "}
                            We collect the card now so your POS keeps running the moment your trial ends. You can cancel
                            or switch tier any time before <span className="font-semibold text-foreground">{trialEndsAt ? formatDate(trialEndsAt, { dateStyle: "medium" }) : "the trial end date"}</span>{" "}
                            and not be charged.
                        </span>
                    </div>
                )}

                {overage?.locked && (
                    <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/[0.06] p-3 text-xs">
                        <Lock className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                        <span className="text-muted-foreground">
                            <span className="font-semibold text-foreground">
                                {overage.extra_branches > 0 && `${overage.extra_branches} outlet${overage.extra_branches === 1 ? "" : "s"}`}
                                {overage.extra_branches > 0 && overage.extra_staff > 0 && " and "}
                                {overage.extra_staff > 0 && `${overage.extra_staff} staff seat${overage.extra_staff === 1 ? "" : "s"}`}
                            </span>
                            {" "}exceed your current plan&apos;s caps. Affected users can&apos;t sign in until you pick a higher tier or remove extras.
                        </span>
                    </div>
                )}
            </CardContent>
        </Card>

        {/* Cancel-and-activate confirmation. Lives outside the Card so
          * its overlay doesn't get clipped by the card padding. */}
        <PlanChangeDialog
            open={pendingTier != null}
            current={currentPlan}
            target={pendingPlan}
            direction={pendingTier?.direction ?? "same"}
            busy={busyTier != null}
            onCancel={() => setPendingTier(null)}
            onConfirm={() => { if (pendingTier) void applyTier(pendingTier.tier) }}
        />

        {/* TRIAL → first card. The chosen tier is already written to
          * tenants.plan_tier, so start-subscription will use the right
          * Stripe Price ID. Modal handles attach + start-subscription
          * which passes `trial_end = trial_ends_at` so the first
          * charge fires on the trial end date, not immediately. */}
        <AddCardModal
            open={addCardForTier != null}
            onClose={() => setAddCardForTier(null)}
            onSaved={() => {
                setAddCardForTier(null)
                onChange?.()
                void refresh()
            }}
            startSubscriptionAfter
            trialEndsAt={trialEndsAt}
            chosenPlan={addCardForTier ? findPlan(region, addCardForTier) : null}
        />
        </>
    )
}

function TierCard({
    plan, current, busy, disabled, recommended, needsCard, onSelect,
}: {
    plan: PlanDefinition
    current: boolean
    busy: boolean
    disabled: boolean
    /** True when this is the max tier and we want to nudge the user
     *  toward it (free-trial + no plan picked yet). */
    recommended?: boolean
    /** True when clicking the tier will open the AddCardModal (TRIAL
     *  + no card on file). Drives the button label so the OWNER knows
     *  they're about to be asked for a card — no surprise modal. */
    needsCard?: boolean
    onSelect: () => void
}) {
    return (
        <div className={cn(
            "rounded-xl border p-4 flex flex-col gap-3 transition-colors relative",
            current
                ? "border-primary/50 bg-primary/[0.04]"
                : recommended
                    ? "border-primary/60 bg-primary/[0.05] shadow-[0_0_0_1px_hsl(var(--primary)/0.4)]"
                    : "border-border/60 hover:border-border",
        )}>
            <div className="flex items-start justify-between gap-2">
                <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">{plan.name}</div>
                    <div className="text-2xl font-bold tabular-nums">{formatPlanPrice(plan)}</div>
                    <div className="text-[11px] text-muted-foreground">/ month</div>
                </div>
                {current && (
                    <Badge variant="success" className="text-[10px]">Current</Badge>
                )}
                {recommended && !current && (
                    <Badge variant="neon" className="text-[10px]">★ Recommended</Badge>
                )}
                {plan.highlight && !current && !recommended && (
                    <Badge variant="warning" className="text-[10px]">Popular</Badge>
                )}
            </div>

            <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-[10px]">
                    {isUnlimited(plan.maxBranches) ? "Unlimited" : plan.maxBranches} outlet{plan.maxBranches === 1 ? "" : "s"}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                    {isUnlimited(plan.maxStaffPerBranch) ? "Unlimited" : plan.maxStaffPerBranch} staff / outlet
                </Badge>
            </div>

            <ul className="space-y-1 text-xs text-muted-foreground flex-1">
                {plan.features.slice(0, 4).map((f) => (
                    <li key={f} className="flex items-start gap-1.5">
                        <Check className="h-3 w-3 text-success shrink-0 mt-0.5" />
                        <span>{f}</span>
                    </li>
                ))}
            </ul>

            <Button
                size="sm"
                variant={current ? "outline" : (recommended || plan.highlight) ? "neon" : "outline"}
                onClick={onSelect}
                disabled={disabled || current}
                className="w-full"
            >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {current
                    ? "Selected"
                    : needsCard
                        ? "Add card to pick this plan"
                        : recommended
                            ? "Start with this plan"
                            : "Switch to this plan"}
            </Button>
        </div>
    )
}
