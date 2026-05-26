"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, CreditCard, Loader2, Plus, Star, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { AddCardModal } from "./add-card-modal"

interface PaymentMethod {
    id: string
    brand: string
    last4: string
    exp_month: number | null
    exp_year: number | null
    is_default: boolean
}

/**
 * Payment-methods management card for /settings/billing.
 *
 * Lists every card on the tenant's Stripe Customer, badges the default
 * one, and exposes:
 *   - "Set default" on each non-default card
 *   - "Remove" on each card (with server-side guards for the only-card
 *     + active-subscription edge cases)
 *   - "Add card" → opens the AddCardModal (Stripe Payment Element)
 *
 * Why we don't just send the OWNER to the Stripe Customer Portal: the
 * user explicitly asked for in-app card management. The portal is still
 * available from the main billing page for things we don't cover here
 * (cancel subscription, retry failed invoice, etc.).
 */
export function PaymentMethodsCard({
    hasSubscription,
    onChange,
}: {
    /** True once the tenant has an active or past-due subscription.
     *  Drives whether "add card" should also kick off start-subscription. */
    hasSubscription: boolean
    /** Bubble up so the parent can refresh its top status card too. */
    onChange?: () => void
}) {
    const [methods, setMethods] = useState<PaymentMethod[]>([])
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState<{ id: string; action: "default" | "remove" } | null>(null)
    const [modalOpen, setModalOpen] = useState(false)

    const refresh = useCallback(async () => {
        try {
            const r = await fetch("/api/billing/payment-methods")
            const data = await r.json() as { methods?: PaymentMethod[]; error?: string }
            if (!r.ok) throw new Error(data.error ?? "Failed to load payment methods")
            setMethods(data.methods ?? [])
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't load payment methods")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { refresh() }, [refresh])

    async function setDefault(pmId: string) {
        setBusy({ id: pmId, action: "default" })
        try {
            const r = await fetch("/api/billing/payment-methods/default", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ payment_method_id: pmId }),
            })
            const data = await r.json() as { ok?: boolean; warning?: string; error?: string }
            if (!r.ok || !data.ok) throw new Error(data.error ?? "Couldn't update default")
            if (data.warning) toast.warning(data.warning)
            else toast.success("Default payment method updated.")
            await refresh()
            onChange?.()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't update default")
        } finally {
            setBusy(null)
        }
    }

    async function remove(pmId: string) {
        // Two-step confirmation to avoid a single misclick deleting the
        // only card on file. Stripe's portal does the same.
        const ok = window.confirm("Remove this card from your account?")
        if (!ok) return
        setBusy({ id: pmId, action: "remove" })
        try {
            const r = await fetch(`/api/billing/payment-methods/${pmId}`, { method: "DELETE" })
            const data = await r.json() as { ok?: boolean; error?: string }
            if (!r.ok || !data.ok) throw new Error(data.error ?? "Couldn't remove card")
            toast.success("Card removed.")
            await refresh()
            onChange?.()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't remove card")
        } finally {
            setBusy(null)
        }
    }

    return (
        <>
            <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                    <div>
                        <CardTitle className="text-base flex items-center gap-2">
                            <CreditCard className="h-4 w-4" /> Payment methods
                        </CardTitle>
                        <CardDescription>
                            Cards on file with Stripe. The default card is charged on every renewal.
                        </CardDescription>
                    </div>
                    <Button size="sm" variant="neon" onClick={() => setModalOpen(true)}>
                        <Plus className="h-3.5 w-3.5" /> Add card
                    </Button>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading cards…
                        </div>
                    ) : methods.length === 0 ? (
                        <div className="rounded-md border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                            No cards on file yet. Add one to enable auto-renewal.
                        </div>
                    ) : (
                        <ul className="space-y-2">
                            {methods.map((pm) => (
                                <li
                                    key={pm.id}
                                    className={cn(
                                        "flex items-center gap-3 rounded-lg border px-4 py-3",
                                        pm.is_default
                                            ? "border-primary/40 bg-primary/[0.04]"
                                            : "border-border/60",
                                    )}
                                >
                                    <CreditCard className="h-5 w-5 text-primary shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-medium capitalize">{pm.brand}</span>
                                            <span className="font-mono text-sm text-muted-foreground">
                                                •••• {pm.last4}
                                            </span>
                                            {pm.is_default && (
                                                <Badge variant="default" className="text-[10px]">
                                                    <Star className="h-3 w-3 mr-0.5" /> Default
                                                </Badge>
                                            )}
                                        </div>
                                        {pm.exp_month && pm.exp_year && (
                                            <div className="text-[11px] text-muted-foreground mt-0.5">
                                                Expires {String(pm.exp_month).padStart(2, "0")}/{pm.exp_year}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        {!pm.is_default && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => setDefault(pm.id)}
                                                disabled={busy?.id === pm.id}
                                            >
                                                {busy?.id === pm.id && busy.action === "default"
                                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    : <Check className="h-3.5 w-3.5" />}
                                                Set default
                                            </Button>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                            onClick={() => remove(pm.id)}
                                            disabled={busy?.id === pm.id}
                                            aria-label="Remove card"
                                        >
                                            {busy?.id === pm.id && busy.action === "remove"
                                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                : <Trash2 className="h-3.5 w-3.5" />}
                                        </Button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            <AddCardModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                onSaved={() => {
                    refresh()
                    onChange?.()
                }}
                // First card on a no-subscription account → also start
                // the subscription right after the PM attaches. Any
                // subsequent "add card" just attaches a PM.
                startSubscriptionAfter={!hasSubscription && methods.length === 0}
            />
        </>
    )
}
