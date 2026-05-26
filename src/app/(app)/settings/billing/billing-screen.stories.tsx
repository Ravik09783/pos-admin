import type { Meta, StoryObj } from "@storybook/react-vite"
import { AlertTriangle, CheckCircle2, Clock, CreditCard, ExternalLink, ShieldAlert, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * Screen-level twin of the billing settings page
 * (`src/app/(app)/settings/billing/page.tsx`). The component-level
 * `plan-picker.stories.tsx` already documents the tier picker in
 * isolation; this story shows how the full page composes:
 *
 *   - StatusCard (subscription state — trial / active / past due / suspended)
 *   - PlanPicker (three tier cards)
 *   - Stripe Elements card form OR an India-specific "invoice-based" note
 */
type BillingStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED"

interface BillingScreenViewProps {
    status: BillingStatus
    daysLeft?: number
    nextBillDate?: string
    cardLast4?: string
    isIndia: boolean
    hasPaymentMethod: boolean
}

function BillingScreenView({
    status, daysLeft, nextBillDate, cardLast4, isIndia, hasPaymentMethod,
}: BillingScreenViewProps) {
    return (
        <div className="min-h-[800px] w-full bg-background text-foreground rounded-md border border-border/40 p-5 max-w-3xl mx-auto space-y-5">
            {/* Header */}
            <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Configure</div>
                <h1 className="text-xl font-bold">Billing</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Your RestoPOS subscription — payment method, next bill, history.
                </p>
            </div>

            <StatusCard status={status} daysLeft={daysLeft} nextBillDate={nextBillDate} cardLast4={cardLast4} />

            {/* Plan picker — minimal stub. The real picker has its own story. */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Choose your plan</CardTitle>
                    <CardDescription>
                        {status === "TRIAL"
                            ? "During your free trial every tier is open. Pick the plan you want to keep when the trial ends."
                            : "Switch tier anytime. Downgrading is safe — extras get locked, nothing is deleted."}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid md:grid-cols-3 gap-3">
                        {["Starter", "Growth", "Scale"].map((name, i) => (
                            <PlanCardStub
                                key={name}
                                name={name}
                                price={isIndia ? ["₹3,500", "₹5,000", "₹10,000"][i]! : ["$49", "$99", "$199"][i]!}
                                outlets={[1, 3, 10][i]!}
                                staff={[1, 3, 3][i]!}
                                highlight={i === 1}
                                current={i === 0}
                            />
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Payment method block */}
            {isIndia ? (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Payment method</CardTitle>
                        <CardDescription>
                            India subscription billing is invoice-based — our team will reach out with payment instructions. POS billing keeps working as long as your plan is active.
                        </CardDescription>
                    </CardHeader>
                </Card>
            ) : hasPaymentMethod ? (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Payment method on file</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
                            <CreditCard className="h-5 w-5 text-primary shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="font-medium capitalize">Visa</div>
                                <div className="text-xs text-muted-foreground font-mono">•••• •••• •••• {cardLast4 ?? "????"}</div>
                            </div>
                        </div>
                        <Button variant="outline" size="sm">
                            <ExternalLink className="h-4 w-4" /> Manage in Stripe portal
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <CreditCard className="h-4 w-4" /> Add payment method
                        </CardTitle>
                        <CardDescription>
                            Plans start at <span className="font-semibold text-foreground">$49/month</span> (1 outlet, 1 staff) and scale up to <span className="font-semibold text-foreground">$199/month</span> (10 outlets, 30 staff). Charging begins after your free trial ends.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-lg border border-dashed border-border/60 p-4 grid place-items-center text-xs text-muted-foreground">
                            [ Stripe Card Element renders here in the live app ]
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}

function PlanCardStub({
    name, price, outlets, staff, highlight, current,
}: { name: string; price: string; outlets: number; staff: number; highlight: boolean; current: boolean }) {
    return (
        <div className={cn(
            "rounded-xl border p-4 space-y-2",
            current ? "border-primary/50 bg-primary/[0.04]" : "border-border/60",
        )}>
            <div className="flex items-start justify-between">
                <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">{name}</div>
                    <div className="text-2xl font-bold tabular-nums">{price}</div>
                    <div className="text-[10px] text-muted-foreground">/ month</div>
                </div>
                {current && <Badge variant="success" className="text-[10px]">Current</Badge>}
                {highlight && !current && <Badge variant="warning" className="text-[10px]">Popular</Badge>}
            </div>
            <div className="flex flex-wrap gap-1">
                <Badge variant="outline" className="text-[10px]">{outlets} outlet{outlets > 1 ? "s" : ""}</Badge>
                <Badge variant="outline" className="text-[10px]">{staff} staff / outlet</Badge>
            </div>
            <Button size="sm" variant={current ? "outline" : highlight ? "neon" : "outline"} className="w-full" disabled={current}>
                {current ? "Selected" : "Switch"}
            </Button>
        </div>
    )
}

function StatusCard({ status, daysLeft, nextBillDate, cardLast4 }: {
    status: BillingStatus
    daysLeft?: number
    nextBillDate?: string
    cardLast4?: string
}) {
    const isActive = status === "ACTIVE"
    const isTrial = status === "TRIAL"
    const isPastDue = status === "PAST_DUE"
    const isSuspended = status === "SUSPENDED"
    const isCanceled = status === "CANCELED"
    return (
        <Card className={cn(
            "border-2",
            isActive && "border-success/40 bg-success/[0.03]",
            isTrial && (daysLeft != null && daysLeft <= 7 ? "border-warning/40 bg-warning/[0.04]" : "border-primary/40 bg-primary/[0.03]"),
            isPastDue && "border-warning/40 bg-warning/[0.05]",
            (isSuspended || isCanceled) && "border-destructive/50 bg-destructive/[0.05]",
        )}>
            <CardContent className="py-5 flex items-start gap-4">
                <span className={cn(
                    "grid place-items-center h-12 w-12 rounded-xl shrink-0",
                    isActive && "bg-success/15 text-success",
                    isTrial && "bg-primary/15 text-primary",
                    isPastDue && "bg-warning/15 text-warning",
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
                        <Badge variant={isSuspended || isCanceled ? "destructive" : "success"} className="text-[10px]">
                            {isSuspended || isCanceled ? "Billing blocked" : "Billing enabled"}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">Plans from $49 / month</Badge>
                    </div>
                    {isTrial && daysLeft != null && daysLeft > 0 && (
                        <p className="text-sm text-muted-foreground">
                            <span className="font-semibold text-foreground">{daysLeft} days</span> left.
                            {nextBillDate && <> Subscription begins on <span className="font-semibold text-foreground">{nextBillDate}</span>.</>}
                        </p>
                    )}
                    {isActive && nextBillDate && (
                        <p className="text-sm text-muted-foreground">
                            Next charge on <span className="font-semibold text-foreground">{nextBillDate}</span>
                            {cardLast4 ? <> from card ending in <span className="font-mono">{cardLast4}</span></> : null}.
                        </p>
                    )}
                    {isPastDue && (
                        <p className="text-sm text-muted-foreground flex items-start gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
                            Your last invoice failed. Stripe will retry automatically, but updating your card now avoids suspension.
                        </p>
                    )}
                    {isSuspended && (
                        <p className="text-sm">
                            <span className="font-semibold text-destructive">POS bill generation is paused.</span>{" "}
                            <span className="text-muted-foreground">Pay the outstanding invoice to re-enable billing.</span>
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}

const meta: Meta<typeof BillingScreenView> = {
    title: "Screens/Billing Settings",
    component: BillingScreenView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Billing settings page (`/settings/billing`). Composes the subscription StatusCard, the three-tier PlanPicker, and the payment-method UI (Stripe Card Element for non-India, invoice-based note for India). The PlanPicker has its own dedicated story; this screen story shows how the three blocks stack vertically and how the StatusCard's tone (info / warning / destructive) shifts with subscription state. Real page fetches `/api/billing/status` + `/api/billing/plan-overage` on mount.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof BillingScreenView>

/** Healthy trial, 18 days in. */
export const Trial: Story = {
    args: { status: "TRIAL", daysLeft: 18, nextBillDate: "Jun 17, 2026", isIndia: false, hasPaymentMethod: false },
}

/** Trial ending soon — banner-tone amber, OWNER nudged to add card. */
export const TrialEndingSoon: Story = {
    args: { status: "TRIAL", daysLeft: 3, nextBillDate: "May 21, 2026", isIndia: false, hasPaymentMethod: false },
}

/** Active subscription, card on file. */
export const Active: Story = {
    args: { status: "ACTIVE", nextBillDate: "Jun 17, 2026", cardLast4: "4242", isIndia: false, hasPaymentMethod: true },
}

/** Payment failed — Stripe still retrying. */
export const PastDue: Story = {
    args: { status: "PAST_DUE", cardLast4: "4242", isIndia: false, hasPaymentMethod: true },
}

/** Retries exhausted — bill generation blocked. */
export const Suspended: Story = {
    args: { status: "SUSPENDED", isIndia: false, hasPaymentMethod: true },
}

/** India tenant — invoice-based payment block instead of Stripe Card Element. */
export const India_Active: Story = {
    args: { status: "ACTIVE", nextBillDate: "Jun 17, 2026", isIndia: true, hasPaymentMethod: false },
}
