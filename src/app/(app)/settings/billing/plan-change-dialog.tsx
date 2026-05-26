"use client"

import { ArrowDown, ArrowUp, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { formatPlanPrice, type PlanDefinition } from "@/lib/billing/plans"

/**
 * Cancel-and-activate confirmation dialog for a plan tier switch.
 *
 * Triggered when:
 *   - The tenant has an existing Stripe subscription (sub_… exists in
 *     our DB cache via /api/billing/status.has_subscription)
 *   - The clicked tier differs from the currently-active tier
 *
 * Three flavours of copy based on the `direction` derived in the
 * picker:
 *   - "upgrade":   from + price difference is positive   → green-tinted header
 *   - "downgrade": from + price difference is negative   → warning-tinted header,
 *                                                          + over-cap callout
 *   - "same":      shouldn't normally trigger (the picker filters
 *                  re-clicks). Renders a generic "Switch" copy as a
 *                  safety net.
 *
 * Why the cancel/activate framing: the user is explicitly transitioning
 * from one paid plan to another. Stripe's API does this by swapping the
 * subscription's line item with proration; functionally that's "cancel
 * the old, activate the new" so the dialog uses that language to set
 * the right expectation about credits / re-bills.
 */
export type PlanChangeDirection = "upgrade" | "downgrade" | "same"

export function PlanChangeDialog({
    open,
    current,
    target,
    direction,
    busy,
    onCancel,
    onConfirm,
}: {
    open: boolean
    current: PlanDefinition | null
    target: PlanDefinition | null
    direction: PlanChangeDirection
    busy: boolean
    onCancel: () => void
    onConfirm: () => void
}) {
    if (!target) return null

    const isUpgrade = direction === "upgrade"
    const isDowngrade = direction === "downgrade"

    const title = isUpgrade
        ? "Upgrade your subscription?"
        : isDowngrade
            ? "Downgrade your subscription?"
            : "Switch your subscription?"

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel() }}>
            <DialogContent className={cn(
                "sm:max-w-md border-2",
                isUpgrade && "border-success/40",
                isDowngrade && "border-warning/40",
            )}>
                <DialogHeader>
                    <div className="flex items-center gap-2">
                        <span className={cn(
                            "grid place-items-center h-8 w-8 rounded-lg shrink-0",
                            isUpgrade && "bg-success/15 text-success",
                            isDowngrade && "bg-warning/15 text-warning",
                            !isUpgrade && !isDowngrade && "bg-primary/15 text-primary",
                        )}>
                            {isUpgrade
                                ? <ArrowUp className="h-4 w-4" />
                                : isDowngrade
                                    ? <ArrowDown className="h-4 w-4" />
                                    : <ArrowUp className="h-4 w-4" />}
                        </span>
                        <DialogTitle>{title}</DialogTitle>
                    </div>
                    <DialogDescription>
                        Your current plan will be cancelled and the new plan will be activated.
                    </DialogDescription>
                </DialogHeader>

                {/* From → To summary */}
                <div className="grid grid-cols-[1fr,auto,1fr] items-center gap-3 py-2">
                    <PlanCol label="Current" plan={current} tone="muted" />
                    <div className="text-muted-foreground">
                        {isDowngrade
                            ? <ArrowDown className="h-4 w-4" />
                            : <ArrowUp className="h-4 w-4" />}
                    </div>
                    <PlanCol
                        label="New"
                        plan={target}
                        tone={isUpgrade ? "success" : isDowngrade ? "warning" : "primary"}
                    />
                </div>

                <Separator />

                {/* Direction-specific consequences */}
                {isUpgrade && (
                    <div className="text-xs text-muted-foreground space-y-1.5">
                        <p>
                            <span className="font-medium text-foreground">You&apos;ll be charged the prorated difference today</span> for the remaining days of the current billing period.
                        </p>
                        <p>
                            The new plan&apos;s higher caps (outlets, staff seats, features) apply immediately. Future renewals charge the full new-plan price.
                        </p>
                    </div>
                )}

                {isDowngrade && (
                    <div className="text-xs text-muted-foreground space-y-1.5">
                        <p>
                            <span className="font-medium text-foreground">Unused time on your current plan becomes a credit</span> on your next invoice — no money is lost.
                        </p>
                        <p>
                            <span className="font-medium text-warning">Heads up:</span> if you currently have more outlets or staff than the new plan allows, the extras will be <span className="font-medium text-foreground">locked</span> (they stay in the DB but can&apos;t sign in) until you either upgrade again or remove them.
                        </p>
                    </div>
                )}

                {direction === "same" && (
                    <p className="text-xs text-muted-foreground">
                        Switching to {target.name}. Stripe will reconcile any difference on the next invoice.
                    </p>
                )}

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="ghost" onClick={onCancel} disabled={busy}>
                        Keep current plan
                    </Button>
                    <Button
                        variant={isDowngrade ? "outline" : "neon"}
                        onClick={onConfirm}
                        disabled={busy}
                        className={isDowngrade ? "border-warning/50 text-warning hover:bg-warning/10 hover:text-warning" : ""}
                    >
                        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                        {isUpgrade && `Upgrade to ${target.name}`}
                        {isDowngrade && `Downgrade to ${target.name}`}
                        {direction === "same" && `Switch to ${target.name}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function PlanCol({
    label, plan, tone,
}: {
    label: string
    plan: PlanDefinition | null
    tone: "muted" | "success" | "warning" | "primary"
}) {
    return (
        <div className={cn(
            "rounded-lg border p-3 space-y-0.5",
            tone === "muted" && "border-border/40 bg-muted/30",
            tone === "success" && "border-success/40 bg-success/[0.05]",
            tone === "warning" && "border-warning/40 bg-warning/[0.05]",
            tone === "primary" && "border-primary/40 bg-primary/[0.05]",
        )}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
            {plan ? (
                <>
                    <div className="font-semibold text-sm">{plan.name}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                        {formatPlanPrice(plan)} <span className="opacity-60">/ mo</span>
                    </div>
                </>
            ) : (
                <>
                    <div className="font-semibold text-sm text-muted-foreground">No plan</div>
                    <Badge variant="outline" className="text-[10px]">Free trial</Badge>
                </>
            )}
        </div>
    )
}

/** Tier rank for comparing two tiers. Higher rank = pricier plan. */
const TIER_RANK = { starter: 1, growth: 2, scale: 3 } as const

/** Decide whether a target tier is an upgrade, downgrade, or same vs
 *  the current tier. Exported so the picker doesn't re-implement the
 *  ranking.
 *
 *  No current plan (a trial owner who hasn't picked one yet) → "upgrade":
 *  going from nothing to a plan is a fresh activation. Returning "same"
 *  here was a bug — the picker's `if (direction === "same") return`
 *  guard then swallowed the very first plan click and nothing happened. */
export function planChangeDirection(
    current: "starter" | "growth" | "scale" | null,
    target: "starter" | "growth" | "scale",
): PlanChangeDirection {
    if (!current) return "upgrade"
    const c = TIER_RANK[current]
    const t = TIER_RANK[target]
    if (t > c) return "upgrade"
    if (t < c) return "downgrade"
    return "same"
}
