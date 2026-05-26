"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarPlus, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { cn, formatDate } from "@/lib/utils"

/**
 * Push out a tenant's trial expiry from the super-admin tenant page.
 *
 * Two input modes — kept side-by-side because each is the obviously
 * right tool for a different request:
 *
 *   - Quick-add buttons (+7d, +30d, +90d, +1yr, +5yr) → most operator
 *     asks are "give them another month" or "give them forever for
 *     friends-and-family". Two clicks total.
 *
 *   - Custom date input → for an exact deadline like "extend until
 *     their Diwali launch on Nov 1". An ISO date is fed straight to
 *     the route, no anchor math.
 *
 * The dialog shows the current trial_ends_at + the resulting date for
 * each quick-add option so the operator can see the outcome before
 * clicking. After a successful extend it bounces a `router.refresh()`
 * so the surrounding detail page re-fetches and reflects the new date.
 */
const QUICK_OPTIONS: { label: string; days: number; tone?: "neon" }[] = [
    { label: "+7 days", days: 7 },
    { label: "+30 days", days: 30 },
    { label: "+90 days", days: 90 },
    { label: "+1 year", days: 365 },
    { label: "+5 years", days: 365 * 5, tone: "neon" },
]

export function ExtendTrialDialog({
    open,
    onClose,
    tenantId,
    tenantName,
    currentTrialEnd,
}: {
    open: boolean
    onClose: () => void
    tenantId: string
    tenantName: string
    currentTrialEnd: string | null
}) {
    const router = useRouter()
    const [busy, setBusy] = useState<number | "custom" | null>(null)
    const [customDate, setCustomDate] = useState("")

    // Reset state every time the dialog opens — leftover state from a
    // previous tenant on the same page would be confusing.
    useEffect(() => {
        if (open) {
            setBusy(null)
            setCustomDate("")
        }
    }, [open])

    async function extend(payload: { days?: number; trial_ends_at?: string }, busyKey: number | "custom") {
        setBusy(busyKey)
        try {
            const r = await fetch(`/api/super-admin/tenant/${tenantId}/extend-trial`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })
            const data = await r.json() as {
                ok?: boolean
                error?: string
                trial_ends_at?: string
                revived?: boolean
            }
            if (!r.ok || !data.ok) throw new Error(data.error ?? "Couldn't extend trial")
            toast.success(
                `${tenantName} · trial now ends ${data.trial_ends_at ? formatDate(data.trial_ends_at, { dateStyle: "long" }) : "later"}`,
                data.revived
                    ? { description: "Subscription status was CANCELED/SUSPENDED — flipped back to TRIAL." }
                    : undefined,
            )
            onClose()
            router.refresh()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't extend trial")
        } finally {
            setBusy(null)
        }
    }

    // Anchor used for "preview" — same math the server applies when
    // body.days is sent: max(now, currentTrialEnd).
    const nowMs = Date.now()
    const currentMs = currentTrialEnd ? new Date(currentTrialEnd).getTime() : nowMs
    const anchorMs = Math.max(nowMs, isFinite(currentMs) ? currentMs : nowMs)

    function previewFor(days: number): string {
        return formatDate(new Date(anchorMs + days * 24 * 3600 * 1000).toISOString(), {
            dateStyle: "medium",
        })
    }

    const todayIso = new Date().toISOString().slice(0, 10)
    const customDateValid = customDate.length > 0 && new Date(customDate).getTime() > nowMs

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v && busy == null) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <div className="flex items-center gap-2">
                        <span className="grid place-items-center h-8 w-8 rounded-lg bg-primary/15 text-primary shrink-0">
                            <CalendarPlus className="h-4 w-4" />
                        </span>
                        <DialogTitle>Extend free trial</DialogTitle>
                    </div>
                    <DialogDescription>
                        Push out the date <span className="font-semibold">{tenantName}</span>&apos;s trial ends. No
                        billing change — this just buys more free time before the
                        plan-cap gates kick in.
                    </DialogDescription>
                </DialogHeader>

                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs space-y-1">
                    <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Trial currently ends</span>
                        <span className="font-semibold">
                            {currentTrialEnd
                                ? formatDate(currentTrialEnd, { dateStyle: "long" })
                                : "— (no trial set)"}
                        </span>
                    </div>
                    {currentTrialEnd && nowMs > currentMs && (
                        <div className="text-warning text-[11px]">
                            Trial is already expired — extensions anchor on today, not the past date.
                        </div>
                    )}
                </div>

                <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                        Quick add
                    </Label>
                    <div className="grid grid-cols-1 gap-1.5">
                        {QUICK_OPTIONS.map((opt) => (
                            <Button
                                key={opt.days}
                                variant={opt.tone === "neon" ? "neon" : "outline"}
                                size="sm"
                                className="justify-between"
                                onClick={() => extend({ days: opt.days }, opt.days)}
                                disabled={busy != null}
                            >
                                <span className="inline-flex items-center gap-1.5">
                                    {opt.tone === "neon" && <Sparkles className="h-3 w-3" />}
                                    {opt.label}
                                </span>
                                <span className={cn(
                                    "text-[11px] tabular-nums",
                                    opt.tone === "neon" ? "" : "text-muted-foreground",
                                )}>
                                    {busy === opt.days
                                        ? <Loader2 className="h-3 w-3 animate-spin" />
                                        : `→ ${previewFor(opt.days)}`}
                                </span>
                            </Button>
                        ))}
                    </div>
                </div>

                <Separator />

                <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                        Or pick a specific date
                    </Label>
                    <div className="flex gap-2">
                        <Input
                            type="date"
                            min={todayIso}
                            value={customDate}
                            onChange={(e) => setCustomDate(e.target.value)}
                            disabled={busy != null}
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={!customDateValid || busy != null}
                            onClick={() => extend({ trial_ends_at: customDate }, "custom")}
                        >
                            {busy === "custom" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            Set date
                        </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                        Must be in the future. Cap is 20 years from today to catch typos.
                    </p>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={onClose} disabled={busy != null}>
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
