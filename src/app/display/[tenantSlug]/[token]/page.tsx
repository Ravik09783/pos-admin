"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Loader2 } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { uniqueChannelName } from "@/lib/supabase/realtime"
import type { PosDisplaySession } from "@/types/database"
import { CustomerDisplayChrome, useSessionLiveness } from "../display-chrome"

/**
 * Per-user customer-display screen.
 *
 *   /display/<tenant-slug>/<display-token>
 *
 * Resolves the token to a `(tenant, user)` pair via the
 * `resolve_display_user` RPC (anon-callable, see migration 27). Once
 * resolved, subscribes to `pos_display_sessions` filtered by both
 * `tenant_id` AND `created_by = user.id`. That last filter is the
 * difference from the legacy `/display/<slug>` route — it isolates
 * THIS staffer's POS sessions from everyone else's.
 *
 * The render chrome is shared with the legacy route via
 * `<CustomerDisplayChrome>` so both URLs look identical to the
 * customer; only the filter changes.
 */
type ResolvedUser = {
    tenant: { id: string; name: string; slug: string; country: string | null; logo_url: string | null }
    user: { id: string; name: string | null; branch_id: string | null }
}

export default function PerCashierDisplayPage() {
    const params = useParams<{ tenantSlug: string; token: string }>()
    const supabase = createClient()

    const [resolved, setResolved] = useState<ResolvedUser | null>(null)
    const [resolveError, setResolveError] = useState<string | null>(null)
    const [session, setSession] = useState<PosDisplaySession | null>(null)
    /** Epoch ms of the last successful realtime event or poll. Feeds
     *  the "live" indicator in the chrome so staff can see the screen
     *  is connected and syncing. */
    const [lastSyncAt, setLastSyncAt] = useState<number>(0)
    // Skew-proof staleness gate (see useSessionLiveness) — shared by the
    // poll and realtime paths so both judge "live" the same way.
    const decideSession = useSessionLiveness()

    // Resolve the token once on mount. RPC is `stable` and the URL
    // doesn't change for the lifetime of the page so we don't bother
    // polling — if the OWNER rotates the token mid-shift, the cashier
    // just re-mounts the new URL.
    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const { data, error } = await supabase.rpc(
                "resolve_display_user" as never,
                {
                    p_tenant_slug: params.tenantSlug,
                    p_token: params.token,
                } as never,
            )
            if (cancelled) return
            if (error) {
                setResolveError(error.message)
                return
            }
            const r = data as ResolvedUser | { error?: string } | null
            if (!r || "error" in r) {
                setResolveError(
                    (r as { error?: string })?.error === "invalid_token"
                        ? "This display URL is no longer valid. Ask the staff member to regenerate it in Settings."
                        : "Couldn't open this display URL.",
                )
                return
            }
            setResolved(r as ResolvedUser)
        })()
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params.tenantSlug, params.token])

    // Live session for this cashier. TWO sync mechanisms run together:
    //   • Realtime postgres_changes — instant updates when they arrive.
    //   • A 1.5-second polling fallback — guarantees the screen converges
    //     even if a realtime event is dropped, or the channel happened
    //     to connect before the table joined the publication. Both
    //     paths write the same state, so a cart change or a payment-
    //     method switch shows within ~1.5s even with realtime down.
    //     `lastSyncAt` feeds the live dot.
    useEffect(() => {
        if (!resolved) return
        const tenantId = resolved.tenant.id
        const userId = resolved.user.id
        let cancelled = false

        // STRICT per-cashier scope: this customer screen shows ONLY the
        // session of the staffer its URL token belongs to — never another
        // staffer's. Each counter's screen stays isolated.
        const fetchLatest = async () => {
            const { data, error } = await supabase
                .from("pos_display_sessions")
                .select("*")
                .eq("tenant_id", tenantId)
                .eq("created_by", userId)
                .in("status", ["BUILDING_CART", "AWAITING_PAYMENT", "PROCESSING", "PAID"])
                .order("updated_at", { ascending: false })
                .limit(1)
            if (cancelled || error) return
            const row = ((data ?? [])[0] ?? null) as PosDisplaySession | null
            // Drop a stale cart — if the POS stopped heartbeating, the
            // session's `updated_at` stops advancing and decideSession
            // lets it expire. The POS screen is the source of truth.
            setSession(decideSession(row))
            setLastSyncAt(Date.now())
        }

        void fetchLatest()
        const poll = window.setInterval(fetchLatest, 1500)

        // postgres_changes can take ONE eq.<col>.<val> filter today.
        // We filter on tenant_id (the more selective key) and double-
        // check `created_by` in the handler — cheap and bullet-proof.
        const channel = supabase
            .channel(uniqueChannelName(`display-user-${userId}`))
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "pos_display_sessions",
                    filter: `tenant_id=eq.${tenantId}`,
                },
                (payload) => {
                    const row = (payload.new ?? payload.old) as PosDisplaySession | null
                    if (!row) return
                    // STRICT scope — only this staffer's own session.
                    if (row.created_by !== userId) return
                    // A realtime event IS proof the POS just wrote this
                    // row — decideSession restarts the liveness window
                    // from its fresh `updated_at`, so the new checkout_url
                    // (a payment-method switch) is always applied, never
                    // dropped. It returns null only for CLOSED.
                    setSession(decideSession(row))
                    setLastSyncAt(Date.now())
                },
            )
            .subscribe()

        return () => {
            cancelled = true
            window.clearInterval(poll)
            supabase.removeChannel(channel)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resolved?.tenant.id, resolved?.user.id])

    if (resolveError) {
        return (
            <div className="min-h-screen grid place-items-center bg-background text-center px-6">
                <div className="max-w-md">
                    <h1 className="text-2xl font-bold mb-2">Display unavailable</h1>
                    <p className="text-muted-foreground text-sm">{resolveError}</p>
                </div>
            </div>
        )
    }
    if (!resolved) {
        return (
            <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        )
    }

    return (
        <CustomerDisplayChrome
            tenant={resolved.tenant}
            branchName={null}
            // Surface the staffer's name so the customer can confirm
            // they're at the right counter ("Karan's counter").
            stafferName={resolved.user.name}
            session={session}
            lastSyncAt={lastSyncAt}
        />
    )
}
