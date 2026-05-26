"use client"

import { useState } from "react"
import { AlertTriangle, Ban, Loader2, RefreshCw, ShieldAlert } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { formatDate } from "@/lib/utils"

/**
 * Subscription action surface — the in-app way to cancel or reactivate.
 *
 * Two states:
 *
 *   1. NORMAL — subscription is ACTIVE, no pending cancellation. Shows
 *      a "Cancel subscription" button. Clicking it opens a themed
 *      confirmation dialog that spells out:
 *        - Access stays until current_period_end
 *        - No more charges
 *        - One click to reactivate
 *      Confirm hits /api/billing/cancel-subscription which sets
 *      cancel_at_period_end=true on the Stripe sub.
 *
 *   2. ENDING SOON — cancel_at_period_end was set previously. Shows a
 *      red banner with the end date and a "Reactivate subscription"
 *      button that flips cancel_at_period_end back to false.
 *
 * Why not "cancel immediately": the OWNER paid for the current period;
 * forfeiting it is hostile UX. The Stripe Customer Portal also defaults
 * to at-period-end for the same reason. If they actually want to nuke
 * it immediately, the Customer Portal button (in the main billing
 * page) still offers that path.
 *
 * Authorization is enforced server-side (OWNER only on both routes);
 * this component renders for everyone but the API will 403 a manager.
 */
export function SubscriptionActionsCard({
    hasSubscription,
    cancelAtPeriodEnd,
    cancelsOn,
    onChange,
}: {
    /** True only when a Stripe subscription actually exists. We don't
     *  render this card otherwise — there's nothing to cancel. */
    hasSubscription: boolean
    cancelAtPeriodEnd: boolean
    cancelsOn: string | null
    /** Refresh the parent's status payload after a cancel or
     *  reactivate so banners update without a full page reload. */
    onChange: () => void
}) {
    const [confirmOpen, setConfirmOpen] = useState(false)
    const [busy, setBusy] = useState<"cancel" | "reactivate" | null>(null)

    if (!hasSubscription) return null

    async function cancel() {
        setBusy("cancel")
        try {
            const r = await fetch("/api/billing/cancel-subscription", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
            })
            const data = await r.json() as { ok?: boolean; cancels_on?: string | null; error?: string }
            if (!r.ok || !data.ok) throw new Error(data.error ?? "Couldn't cancel subscription")
            toast.success(
                data.cancels_on
                    ? `Subscription will end on ${formatDate(data.cancels_on, { dateStyle: "medium" })}`
                    : "Subscription will end at the end of the current period",
            )
            setConfirmOpen(false)
            onChange()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't cancel subscription")
        } finally {
            setBusy(null)
        }
    }

    async function reactivate() {
        setBusy("reactivate")
        try {
            const r = await fetch("/api/billing/reactivate-subscription", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
            })
            const data = await r.json() as { ok?: boolean; error?: string }
            if (!r.ok || !data.ok) throw new Error(data.error ?? "Couldn't reactivate")
            toast.success("Subscription reactivated. Auto-renewal is back on.")
            onChange()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't reactivate subscription")
        } finally {
            setBusy(null)
        }
    }

    // ── State 2: subscription is already pending-cancel ─────────────
    if (cancelAtPeriodEnd) {
        return (
            <Card className="border-2 border-destructive/40 bg-destructive/[0.04]">
                <CardContent className="py-5 flex items-start gap-3 flex-wrap">
                    <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-[200px] space-y-1">
                        <div className="font-semibold text-sm">Subscription ends soon</div>
                        <p className="text-xs text-muted-foreground">
                            Your subscription was cancelled and will not renew. POS billing keeps working until{" "}
                            <span className="font-semibold text-foreground">
                                {cancelsOn ? formatDate(cancelsOn, { dateStyle: "long" }) : "the end of the current period"}
                            </span>
                            . After that, bill generation is paused until you reactivate or start a new subscription.
                        </p>
                    </div>
                    <Button
                        size="sm"
                        variant="neon"
                        onClick={reactivate}
                        disabled={busy != null}
                    >
                        {busy === "reactivate"
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <RefreshCw className="h-3.5 w-3.5" />}
                        Reactivate subscription
                    </Button>
                </CardContent>
            </Card>
        )
    }

    // ── State 1: normal subscription — show Cancel button ──────────
    return (
        <>
            <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                    <div>
                        <CardTitle className="text-base">Cancel subscription</CardTitle>
                        <CardDescription>
                            End auto-renewal. You keep access until the end of the current paid period.
                        </CardDescription>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/40"
                        onClick={() => setConfirmOpen(true)}
                        disabled={busy != null}
                    >
                        <Ban className="h-3.5 w-3.5" /> Cancel
                    </Button>
                </CardHeader>
            </Card>

            <Dialog open={confirmOpen} onOpenChange={(v) => { if (!v && busy == null) setConfirmOpen(false) }}>
                <DialogContent className="sm:max-w-md border-2 border-destructive/40">
                    <DialogHeader>
                        <div className="flex items-center gap-2">
                            <span className="grid place-items-center h-8 w-8 rounded-lg bg-destructive/15 text-destructive shrink-0">
                                <AlertTriangle className="h-4 w-4" />
                            </span>
                            <DialogTitle>Cancel your subscription?</DialogTitle>
                        </div>
                        <DialogDescription>
                            We&apos;ll cancel at the end of your current paid period — no surprise charges.
                        </DialogDescription>
                    </DialogHeader>

                    <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-5">
                        <li>You keep <span className="font-medium text-foreground">full POS access</span> until the period ends.</li>
                        <li><span className="font-medium text-foreground">No more charges</span> after that. Your card stays on file but won&apos;t be billed.</li>
                        <li>After the end date, <span className="font-medium text-foreground">bill generation pauses</span> until you reactivate.</li>
                        <li>You can <span className="font-medium text-foreground">reactivate one click</span> before the end date — nothing is deleted.</li>
                    </ul>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={busy != null}>
                            Keep subscription
                        </Button>
                        <Button
                            variant="outline"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/50"
                            onClick={cancel}
                            disabled={busy != null}
                        >
                            {busy === "cancel" && <Loader2 className="h-4 w-4 animate-spin" />}
                            Yes, cancel subscription
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
