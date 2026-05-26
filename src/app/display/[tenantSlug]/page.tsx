"use client"

import { useEffect, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { uniqueChannelName } from "@/lib/supabase/realtime"
import type { PosDisplaySession } from "@/types/database"
import { CustomerDisplayChrome, useSessionLiveness } from "./display-chrome"

/**
 * Legacy branch-/tenant-wide customer display.
 *
 *   /display/<tenant-slug>?branch=<branch-id>
 *
 * Shows whichever non-CLOSED session is the most recent across the
 * tenant (optionally narrowed by branch). Useful for restaurants that
 * have a single counter — one screen, one cashier, no per-user URL
 * juggling.
 *
 * The per-cashier route `/display/<slug>/<token>` should be preferred
 * for multi-counter shops — it scopes by `created_by` and never shows
 * the wrong staffer's cart.
 */
export default function CustomerDisplayPage() {
    const params = useParams<{ tenantSlug: string }>()
    const searchParams = useSearchParams()
    const branchFilter = searchParams.get("branch") ?? null
    const supabase = createClient()
    const [tenant, setTenant] = useState<{ id: string; name: string; logo_url: string | null; country: string | null } | null>(null)
    const [branchName, setBranchName] = useState<string | null>(null)
    const [session, setSession] = useState<PosDisplaySession | null>(null)
    const [lastSyncAt, setLastSyncAt] = useState<number>(0)
    const [loading, setLoading] = useState(true)
    // Skew-proof staleness gate (see useSessionLiveness) — shared by the
    // poll and realtime paths so both judge "live" the same way.
    const decideSession = useSessionLiveness()

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const { data } = await supabase
                .from("tenant_public")
                .select("id, name, logo_url, country")
                .eq("slug", params.tenantSlug)
                .maybeSingle()
            if (cancelled) return
            setTenant(data as { id: string; name: string; logo_url: string | null; country: string | null } | null)
            setLoading(false)
        })()
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params.tenantSlug])

    useEffect(() => {
        if (!tenant?.id || !branchFilter) {
            setBranchName(null)
            return
        }
        let cancelled = false
        ;(async () => {
            const { data } = await supabase
                .from("branch_public")
                .select("name")
                .eq("tenant_id", tenant.id)
                .eq("id", branchFilter)
                .maybeSingle()
            if (!cancelled) setBranchName((data as { name?: string } | null)?.name ?? null)
        })()
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tenant?.id, branchFilter])

    useEffect(() => {
        if (!tenant?.id) return
        const tenantId = tenant.id
        let cancelled = false

        const matchesBranch = (row: PosDisplaySession): boolean => {
            if (!branchFilter) return true
            return row.branch_id === branchFilter || row.branch_id === null
        }

        // Realtime + a 1.5s polling fallback together — the poll guarantees
        // the screen converges (cart, totals, payment method) even if a
        // realtime event is dropped.
        const fetchLatest = async () => {
            const { data, error } = await supabase
                .from("pos_display_sessions")
                .select("*")
                .eq("tenant_id", tenantId)
                .in("status", ["BUILDING_CART", "AWAITING_PAYMENT", "PROCESSING", "PAID"])
                .order("updated_at", { ascending: false })
                .limit(5)
            if (cancelled || error) return
            const rows = (data ?? []) as PosDisplaySession[]
            // Pick the most recent matching session, but only if the POS
            // is still heartbeating it — a stale cart reverts to idle.
            const match = rows.find(matchesBranch) ?? null
            setSession(decideSession(match))
            setLastSyncAt(Date.now())
        }

        void fetchLatest()
        const poll = window.setInterval(fetchLatest, 1500)

        const channel = supabase
            .channel(uniqueChannelName(`display-${tenantId}`))
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
                    if (!matchesBranch(row)) return
                    // A realtime event IS proof the POS just wrote this
                    // row — decideSession restarts the liveness window
                    // from its fresh `updated_at`, so the new checkout_url
                    // (a payment-method switch) is always applied, never
                    // dropped. It returns null only for CLOSED / no row.
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
    }, [tenant?.id, branchFilter])

    if (loading) {
        return (
            <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        )
    }
    if (!tenant) {
        return (
            <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">
                <p className="text-lg">Restaurant not found.</p>
            </div>
        )
    }

    return <CustomerDisplayChrome tenant={tenant} branchName={branchName} session={session} lastSyncAt={lastSyncAt} />
}
