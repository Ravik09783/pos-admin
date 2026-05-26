"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight, Clock, ShieldAlert, Sparkles, X } from "lucide-react"

import { cn, formatDate } from "@/lib/utils"

/**
 * Compact billing-status banner mounted in the authenticated app
 * layout. Shows the OWNER (and only the OWNER) where their RestoPOS
 * subscription stands:
 *
 *   - TRIAL with ≤7 days left and no card  → amber: "Trial ends in N days, add card"
 *   - TRIAL ended, no card                  → red: "Trial ended — add card to keep selling"
 *   - PAST_DUE                              → amber: "Payment failed, update card"
 *   - SUSPENDED                             → red: "POS bill generation paused"
 *   - everything else (ACTIVE, India, etc.) → renders nothing
 *
 * The banner is dismissible per-session via sessionStorage so the OWNER
 * isn't nagged on every page navigation — but it comes back on the next
 * login and is non-dismissible when SUSPENDED (you can't ignore it).
 */
type BillingStatus = {
    status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED" | null
    is_billable: boolean
    is_india: boolean
    trial_ends_at: string | null
    current_period_end: string | null
    days_until_billing: number | null
    has_payment_method: boolean
}

const DISMISS_KEY = "restopos:billing-banner-dismissed"

export function BillingBanner({ role }: { role: string }) {
    const [status, setStatus] = useState<BillingStatus | null>(null)
    const [dismissed, setDismissed] = useState(false)

    // Only the OWNER sees billing prompts — managers/cashiers can't
    // act on them anyway and shouldn't have to think about it.
    const isOwner = role === "OWNER"

    useEffect(() => {
        if (!isOwner) return
        ;(async () => {
            try {
                // `dedupedFetch` collapses Strict-Mode double-invokes
                // and any concurrent callers into a single request.
                const { dedupedFetch } = await import("@/lib/fetch/deduped")
                const r = await dedupedFetch("/api/billing/status")
                if (!r.ok) return
                const data = await r.json() as BillingStatus
                setStatus(data)
            } catch { /* no banner if status unreachable */ }
        })()
    }, [isOwner])

    useEffect(() => {
        if (typeof window === "undefined") return
        setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1")
    }, [])

    if (!isOwner || !status || status.is_india) return null

    const banner = pickBanner(status)
    if (!banner) return null

    // SUSPENDED can't be dismissed — it's the literal block on billing,
    // OWNER must take action. Trial countdown / past-due CAN be dismissed
    // for the rest of the browser session.
    const allowDismiss = banner.tone !== "destructive"
    if (allowDismiss && dismissed) return null

    function dismiss() {
        if (typeof window === "undefined") return
        sessionStorage.setItem(DISMISS_KEY, "1")
        setDismissed(true)
    }

    const Icon = banner.tone === "destructive" ? ShieldAlert
        : banner.tone === "warning" ? AlertTriangle
        : banner.icon ?? Clock

    return (
        <div className={cn(
            "no-print border-b px-4 py-2.5 flex items-center gap-3 text-sm",
            banner.tone === "destructive" && "border-destructive/40 bg-destructive/10",
            banner.tone === "warning" && "border-warning/40 bg-warning/10",
            banner.tone === "info" && "border-primary/30 bg-primary/[0.04]",
        )}>
            <Icon className={cn(
                "h-4 w-4 shrink-0",
                banner.tone === "destructive" && "text-destructive",
                banner.tone === "warning" && "text-warning",
                banner.tone === "info" && "text-primary",
            )} />
            <div className="flex-1 min-w-0">
                <span className="font-semibold">{banner.title}</span>
                {banner.subtitle && <span className="text-muted-foreground ml-2">{banner.subtitle}</span>}
            </div>
            <Link
                href="/settings/billing"
                className={cn(
                    "inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium shrink-0 transition-colors",
                    banner.tone === "destructive" && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                    banner.tone === "warning" && "bg-warning text-warning-foreground hover:bg-warning/90",
                    banner.tone === "info" && "bg-primary text-primary-foreground hover:bg-primary/90",
                )}
            >
                {banner.cta} <ArrowRight className="h-3 w-3" />
            </Link>
            {allowDismiss && (
                <button
                    type="button"
                    onClick={dismiss}
                    aria-label="Dismiss"
                    className="text-muted-foreground hover:text-foreground h-6 w-6 grid place-items-center shrink-0"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    )
}

function pickBanner(status: BillingStatus): {
    tone: "info" | "warning" | "destructive"
    title: string
    subtitle?: string
    cta: string
    icon?: typeof Clock
} | null {
    if (status.status === "SUSPENDED") {
        return {
            tone: "destructive",
            title: "POS bill generation is suspended.",
            subtitle: "Pay the outstanding invoice to re-enable selling.",
            cta: "Pay now",
        }
    }
    if (status.status === "CANCELED") {
        return {
            tone: "destructive",
            title: "Your RestoPOS subscription is canceled.",
            subtitle: "POS bill generation is disabled.",
            cta: "Re-subscribe",
        }
    }
    if (status.status === "PAST_DUE") {
        return {
            tone: "warning",
            title: "Last payment failed.",
            subtitle: "Update your card before Stripe stops retrying.",
            cta: "Update card",
        }
    }
    if (status.status === "TRIAL") {
        const days = status.days_until_billing ?? 0
        if (days <= 0) {
            return {
                tone: "destructive",
                title: "Your trial has ended.",
                subtitle: "Add a payment method to keep using POS billing.",
                cta: "Add payment method",
            }
        }
        if (days <= 7 && !status.has_payment_method) {
            const endDate = status.trial_ends_at
                ? formatDate(status.trial_ends_at, { dateStyle: "medium" })
                : null
            return {
                tone: "warning",
                title: `Trial ends in ${days} day${days === 1 ? "" : "s"}.`,
                subtitle: endDate ? `Add a payment method before ${endDate} to avoid an interruption.` : "Add a payment method to keep selling.",
                cta: "Add payment method",
                icon: Sparkles,
            }
        }
        return null  // trial still has runway + (or) card on file
    }
    return null
}
