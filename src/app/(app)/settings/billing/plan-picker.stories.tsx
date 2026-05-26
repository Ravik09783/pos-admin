import type { Meta, StoryObj } from "@storybook/react-vite"
import { Check, Crown, Lock } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
    getPlans, formatPlanPrice, isUnlimited,
    type PlanDefinition, type PlanRegion, type PlanTier,
} from "@/lib/billing/plans"

/**
 * Story-only twin of `PlanPicker`. The live component fetches the
 * current overage state from `/api/billing/plan-overage` and POSTs to
 * `/api/billing/set-plan` on click — neither of which Storybook can do.
 * This rebuilds the same visual tree from static props so designers can
 * audit every state (no tier picked, Starter picked, Growth picked,
 * over-limit warning visible, India region, INTL region).
 *
 * Real component: `src/app/(app)/settings/billing/plan-picker.tsx`.
 */
interface PlanPickerViewProps {
    region: PlanRegion
    /** The tier that's currently active on the tenant. `null` = no tier
     *  picked yet (typically a fresh trial). */
    currentTier: PlanTier | null
    /** When true, the picker copy switches to "every tier is open during
     *  trial" — the chosen tier is just what kicks in when the trial ends. */
    isTrial: boolean
    /** Counts driving the overage warning footer. `0/0` hides it. */
    extraBranches: number
    extraStaff: number
}

function PlanPickerView({
    region, currentTier, isTrial, extraBranches, extraStaff,
}: PlanPickerViewProps) {
    const plans = getPlans(region)
    const locked = extraBranches > 0 || extraStaff > 0

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                    <Crown className="h-4 w-4" /> Choose your plan
                </CardTitle>
                <CardDescription>
                    {isTrial
                        ? "During your free trial every tier is open. Pick the plan you want to keep when the trial ends — you can switch anytime."
                        : "Switch tier anytime. Downgrading is safe: nothing is deleted, but seats beyond the new cap won't be able to sign in until you upgrade again."}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid md:grid-cols-3 gap-3">
                    {plans.map((plan) => (
                        <TierCard
                            key={plan.tier}
                            plan={plan}
                            current={currentTier === plan.tier}
                        />
                    ))}
                </div>

                {locked && (
                    <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/[0.06] p-3 text-xs">
                        <Lock className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                        <span className="text-muted-foreground">
                            <span className="font-semibold text-foreground">
                                {extraBranches > 0 && `${extraBranches} outlet${extraBranches === 1 ? "" : "s"}`}
                                {extraBranches > 0 && extraStaff > 0 && " and "}
                                {extraStaff > 0 && `${extraStaff} staff seat${extraStaff === 1 ? "" : "s"}`}
                            </span>
                            {" "}exceed your current plan&apos;s caps. Affected users can&apos;t sign in until you pick a higher tier or remove extras.
                        </span>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

function TierCard({ plan, current }: { plan: PlanDefinition; current: boolean }) {
    return (
        <div className={cn(
            "rounded-xl border p-4 flex flex-col gap-3 transition-colors",
            current
                ? "border-primary/50 bg-primary/[0.04]"
                : "border-border/60 hover:border-border",
        )}>
            <div className="flex items-start justify-between gap-2">
                <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">{plan.name}</div>
                    <div className="text-2xl font-bold tabular-nums">{formatPlanPrice(plan)}</div>
                    <div className="text-[11px] text-muted-foreground">/ month</div>
                </div>
                {current && <Badge variant="success" className="text-[10px]">Current</Badge>}
                {plan.highlight && !current && <Badge variant="warning" className="text-[10px]">Popular</Badge>}
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
                variant={current ? "outline" : plan.highlight ? "neon" : "outline"}
                disabled={current}
                className="w-full"
            >
                {current ? "Selected" : "Switch to this plan"}
            </Button>
        </div>
    )
}

const meta: Meta<typeof PlanPickerView> = {
    title: "Settings/Billing/PlanPicker",
    component: PlanPickerView,
    tags: ["autodocs"],
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Three-card tier picker shown on `/settings/billing`. Driven entirely by `src/lib/billing/plans.ts` — the cards, prices, caps, and feature lists all come from that file (edit there, not here). Selecting a tier mirrors the resolved `{maxBranches, maxStaffPerBranch}` onto `tenants` so the SQL gate (`is_user_within_plan_limits`) can enforce without re-importing TypeScript. Downgrading is safe: extras get locked, nothing is deleted, and an overage footer appears explaining the consequence.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof PlanPickerView>

/** India tenant on TRIAL, no tier selected yet. INR prices, trial copy
 *  in the description. */
export const IN_TrialNoSelection: Story = {
    args: {
        region: "IN",
        currentTier: null,
        isTrial: true,
        extraBranches: 0,
        extraStaff: 0,
    },
}

/** India tenant on the Growth tier — middle card badged "Current". */
export const IN_GrowthSelected: Story = {
    args: {
        region: "IN",
        currentTier: "growth",
        isTrial: false,
        extraBranches: 0,
        extraStaff: 0,
    },
}

/** India tenant downgraded to Starter while still running 5 outlets +
 *  extra staff — the overage footer renders. */
export const IN_StarterWithOverage: Story = {
    args: {
        region: "IN",
        currentTier: "starter",
        isTrial: false,
        extraBranches: 4,
        extraStaff: 8,
    },
}

/** Non-India tenant on TRIAL — USD prices, no selection. */
export const INTL_TrialNoSelection: Story = {
    args: {
        region: "INTL",
        currentTier: null,
        isTrial: true,
        extraBranches: 0,
        extraStaff: 0,
    },
}

/** Non-India tenant on the Scale tier — top tier badged "Current". */
export const INTL_ScaleSelected: Story = {
    args: {
        region: "INTL",
        currentTier: "scale",
        isTrial: false,
        extraBranches: 0,
        extraStaff: 0,
    },
}

/** Non-India tenant on Starter with one outlet over — singular copy. */
export const INTL_StarterOneOutletOver: Story = {
    args: {
        region: "INTL",
        currentTier: "starter",
        isTrial: false,
        extraBranches: 1,
        extraStaff: 0,
    },
}
