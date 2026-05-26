import type { Meta, StoryObj } from "@storybook/react-vite"
import Link from "next/link"
import { AlertTriangle, ArrowRight, Clock, ShieldAlert, Sparkles, X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Story-only twin of `BillingBanner`. The live component fetches the
 * subscription status from `/api/billing/status` inside `useEffect`,
 * which Storybook doesn't have. Here we re-render the same JSX from
 * static props so designers can audit every state without spinning up
 * the full app.
 *
 * Real component: `src/components/app-shell/billing-banner.tsx`.
 */
interface BillingBannerViewProps {
    tone: "info" | "warning" | "destructive"
    title: string
    subtitle?: string
    cta: string
    /** Icon override — defaults are picked from the tone. */
    icon?: typeof Clock
    /** SUSPENDED / CANCELED banners hide the dismiss control on purpose
     *  (the owner can't pretend the problem isn't there). */
    allowDismiss?: boolean
}

function BillingBannerView({
    tone, title, subtitle, cta, icon, allowDismiss = true,
}: BillingBannerViewProps) {
    const Icon = icon ?? (tone === "destructive" ? ShieldAlert : tone === "warning" ? AlertTriangle : Clock)
    return (
        <div className={cn(
            "no-print border-b px-4 py-2.5 flex items-center gap-3 text-sm",
            tone === "destructive" && "border-destructive/40 bg-destructive/10",
            tone === "warning" && "border-warning/40 bg-warning/10",
            tone === "info" && "border-primary/30 bg-primary/[0.04]",
        )}>
            <Icon className={cn(
                "h-4 w-4 shrink-0",
                tone === "destructive" && "text-destructive",
                tone === "warning" && "text-warning",
                tone === "info" && "text-primary",
            )} />
            <div className="flex-1 min-w-0">
                <span className="font-semibold">{title}</span>
                {subtitle && <span className="text-muted-foreground ml-2">{subtitle}</span>}
            </div>
            <Link
                href="/settings/billing"
                className={cn(
                    "inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium shrink-0 transition-colors",
                    tone === "destructive" && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                    tone === "warning" && "bg-warning text-warning-foreground hover:bg-warning/90",
                    tone === "info" && "bg-primary text-primary-foreground hover:bg-primary/90",
                )}
            >
                {cta} <ArrowRight className="h-3 w-3" />
            </Link>
            {allowDismiss && (
                <button
                    type="button"
                    aria-label="Dismiss"
                    className="text-muted-foreground hover:text-foreground h-6 w-6 grid place-items-center shrink-0"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    )
}

const meta: Meta<typeof BillingBannerView> = {
    title: "AppShell/BillingBanner",
    component: BillingBannerView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "OWNER-only banner that surfaces actionable subscription state at the top of the app shell: trial ending in ≤7 days, trial ended, payment failed (PAST_DUE), bill generation suspended, or subscription canceled. Silent on healthy ACTIVE / India tenants. Dismissible per session except for SUSPENDED / CANCELED — those are non-actionable-by-ignoring so the X is hidden. Real component reads `/api/billing/status` in `useEffect`; this story stubs the picked variant statically.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof BillingBannerView>

/** Trial ends in 3 days, no card on file yet — amber, with a Sparkles icon
 *  to keep the trial vibe positive rather than alarming. */
export const TrialEndingSoon: Story = {
    args: {
        tone: "warning",
        title: "Trial ends in 3 days.",
        subtitle: "Add a payment method before May 21 to avoid an interruption.",
        cta: "Add payment method",
        icon: Sparkles,
        allowDismiss: true,
    },
}

/** Trial fully expired and still no card. Red — the next attempted bill
 *  generation will be blocked. */
export const TrialEnded: Story = {
    args: {
        tone: "destructive",
        title: "Your trial has ended.",
        subtitle: "Add a payment method to keep using POS billing.",
        cta: "Add payment method",
        allowDismiss: true,
    },
}

/** Stripe's last attempt failed. Amber — still inside the grace period
 *  while Smart Retries are running. */
export const PastDue: Story = {
    args: {
        tone: "warning",
        title: "Last payment failed.",
        subtitle: "Update your card before Stripe stops retrying.",
        cta: "Update card",
        allowDismiss: true,
    },
}

/** Retries exhausted — bill generation is blocked at the DB level. Red
 *  banner with NO dismiss control (the owner must act). */
export const Suspended: Story = {
    args: {
        tone: "destructive",
        title: "POS bill generation is suspended.",
        subtitle: "Pay the outstanding invoice to re-enable selling.",
        cta: "Pay now",
        allowDismiss: false,
    },
}

/** Canceled subscription — terminal state. Owner has to re-subscribe. */
export const Canceled: Story = {
    args: {
        tone: "destructive",
        title: "Your RestoPOS subscription is canceled.",
        subtitle: "POS bill generation is disabled.",
        cta: "Re-subscribe",
        allowDismiss: false,
    },
}
