"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight, CreditCard, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Dashboard billing nag for the OWNER.
 *
 * Shows a banner when the subscription needs attention:
 *   - TRIAL ending + no plan/card chosen        → "choose a plan"
 *   - subscribed but the card was removed       → "add a payment method"
 *   - PAST_DUE / SUSPENDED / CANCELED            → "fix billing"
 *
 * Stays silent when the owner is fully set up — an ACTIVE subscription
 * with a card on file (or, during the trial, a card already saved so the
 * plan will auto-start).
 *
 * Reads `/api/billing/status` (the same endpoint the billing page uses).
 * Fire-and-forget — a failed fetch just renders nothing.
 */
interface BillingStatus {
    status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED" | null
    trial_ends_at: string | null
    days_until_billing: number | null
    has_payment_method: boolean
}

interface Banner {
    tone: "warning" | "danger"
    title: string
    message: string
    cta: string
}

function trialBanner(days: number | null): Banner {
    const ended = days != null && days <= 0
    return {
        tone: days != null && days <= 3 ? "danger" : "warning",
        title: ended ? "Your free trial has ended" : "Your free trial is ending",
        message: !ended && days != null
            ? `${days} day${days === 1 ? "" : "s"} left. Pick a plan and add a payment method to keep RestoPOS running.`
            : "Pick a plan and add a payment method to resume bill generation.",
        cta: "Choose a plan",
    }
}

function bannerFor(s: BillingStatus): Banner | null {
    const days = s.days_until_billing

    // Subscribed with a card on file → all good, no nag.
    if (s.status === "ACTIVE" && s.has_payment_method) return null

    // Subscribed but the card was removed → ask for one back.
    if (s.status === "ACTIVE" && !s.has_payment_method) {
        return {
            tone: "danger",
            title: "No payment method on file",
            message: "Your subscription has no active card. Add one so your next bill doesn't fail.",
            cta: "Add a payment method",
        }
    }

    if (s.status === "TRIAL") {
        // Card already saved during the trial → the plan auto-starts; no nag.
        if (s.has_payment_method) return null
        return trialBanner(days)
    }

    if (s.status === "PAST_DUE") {
        return {
            tone: "danger",
            title: "Payment failed",
            message: "Your last invoice didn't go through. Update your card to avoid suspension.",
            cta: "Update payment method",
        }
    }
    if (s.status === "SUSPENDED") {
        return {
            tone: "danger",
            title: "POS billing is suspended",
            message: "Pay the outstanding invoice to re-enable bill generation.",
            cta: "Fix billing now",
        }
    }
    if (s.status === "CANCELED") {
        return {
            tone: "danger",
            title: "Subscription canceled",
            message: "Add a payment method to start your subscription again.",
            cta: "Reactivate",
        }
    }
    return null
}

export function BillingWarningBanner() {
    const [banner, setBanner] = useState<Banner | null>(null)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                const r = await fetch("/api/billing/status")
                if (!r.ok) return
                const data = await r.json() as BillingStatus
                if (!cancelled) setBanner(bannerFor(data))
            } catch {
                /* a missing banner is harmless — stay silent */
            }
        })()
        return () => { cancelled = true }
    }, [])

    if (!banner) return null
    const danger = banner.tone === "danger"

    return (
        <div className={cn(
            "rounded-xl border-2 p-4 flex items-start gap-3 flex-wrap",
            danger ? "border-destructive/50 bg-destructive/[0.05]" : "border-warning/50 bg-warning/[0.06]",
        )}>
            <span className={cn(
                "grid place-items-center h-10 w-10 rounded-lg shrink-0",
                danger ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning",
            )}>
                {danger ? <CreditCard className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
            </span>
            <div className="flex-1 min-w-[200px] space-y-0.5">
                <div className="font-semibold flex items-center gap-1.5">
                    {danger && <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />}
                    {banner.title}
                </div>
                <p className="text-sm text-muted-foreground">{banner.message}</p>
            </div>
            <Button asChild variant={danger ? "destructive" : "neon"} size="sm" className="shrink-0">
                <Link href="/settings/billing">
                    {banner.cta}
                    <ArrowRight className="h-4 w-4" />
                </Link>
            </Button>
        </div>
    )
}
