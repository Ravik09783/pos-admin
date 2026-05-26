"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Building2, Crown, Loader2, Lock, Sparkles, Users } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/** Inline progress bar — there's no shared Progress primitive in the UI
 *  kit. Two-tone: tinted at the warning threshold, primary otherwise. */
function CapacityBar({ pct, atCap }: { pct: number; atCap: boolean }) {
    return (
        <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
            <div
                className={cn(
                    "h-full rounded-full transition-[width] duration-300",
                    atCap ? "bg-warning" : pct >= 80 ? "bg-warning/80" : "bg-primary",
                )}
                style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
            />
        </div>
    )
}

/**
 * Plan-capacity meter — shows how much of the current tier's caps the
 * tenant is using. Drops onto `/settings/staff` (per-branch staff
 * usage) and `/settings/branches` (active branches usage).
 *
 * Driven by the `plan_capacity_summary(tenant_id)` SQL RPC (migration
 * 29). The RPC's `unlimited` flag flips the card into a TRIAL-style
 * "Unlimited seats during your free trial" callout — same component,
 * same data shape, just a different render branch.
 *
 *   <PlanCapacityCard mode="branches" />
 *   <PlanCapacityCard mode="staff" />
 *
 * The same data drives both: mode just decides which dimension is
 * front-and-centre.
 *
 * Inactive rows are EXCLUDED from the counter on purpose. The SQL
 * functions agree with the UI: deactivating a seat frees it up; the
 * OWNER can onboard a replacement under the same cap without an
 * upgrade. Reactivating an inactive row is the moment we'll re-check
 * the cap (done in /api/admin/staff/set-active for users, and inline
 * for branches via `can_reactivate_branch`).
 */
export interface PlanCapacityBranch {
    id: string
    name: string
    is_main: boolean
    is_active: boolean
    active_staff: number
    inactive_staff: number
    staff_at_cap: boolean
}

export interface PlanCapacitySummary {
    tier: string | null
    status: string                  // TRIAL / ACTIVE / etc.
    unlimited: boolean              // TRIAL or NULL caps
    max_branches: number | null     // NULL = unlimited
    active_branches: number
    inactive_branches: number
    max_staff_per_branch: number | null
    branches_at_cap: boolean
    branches: PlanCapacityBranch[]
}

export function PlanCapacityCard(props: {
    mode: "branches" | "staff"
    /** Pre-fetched summary from the parent. Omit the prop entirely
     *  (`<PlanCapacityCard mode="staff" />`) to let the card fetch
     *  its own data; pass it (even as `null` while loading) to
     *  signal "the parent owns the data lifecycle, just render".
     *  This split is what prevents the duplicate-fetch race we used
     *  to have on /settings/staff and /settings/branches, where the
     *  parent fetched the same endpoint at the same time as the
     *  card and the late return could clobber the early one. */
    summary?: PlanCapacitySummary | null
}) {
    const { mode } = props
    // `summary` being `undefined` means "prop not provided" — distinct
    // from `null` ("provided but still loading"). TypeScript's optional
    // marker (`?:`) preserves this at runtime even after destructuring.
    const parentManages = "summary" in props
    const externalSummary = props.summary ?? null

    const [internal, setInternal] = useState<PlanCapacitySummary | null>(null)
    const [loading, setLoading] = useState(!parentManages)

    useEffect(() => {
        if (parentManages) return
        let cancelled = false
        ;(async () => {
            try {
                const r = await fetch("/api/billing/plan-capacity")
                const data = await r.json() as PlanCapacitySummary | { error?: string }
                if (cancelled || !r.ok || "error" in data) return
                setInternal(data as PlanCapacitySummary)
            } catch { /* silent — card just stays in loading state */ }
            finally { if (!cancelled) setLoading(false) }
        })()
        return () => { cancelled = true }
    }, [parentManages])

    const effective = parentManages ? externalSummary : internal

    if ((parentManages && effective == null) || (!parentManages && loading)) {
        return (
            <Card>
                <CardContent className="py-4 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking plan capacity…
                </CardContent>
            </Card>
        )
    }
    if (!effective) return null

    // ── TRIAL / unlimited copy — same for both modes ────────────────────
    if (effective.unlimited) {
        return (
            <Card className="border-primary/30 bg-primary/[0.03]">
                <CardContent className="py-4 flex items-start gap-3">
                    <span className="grid place-items-center h-9 w-9 rounded-lg bg-primary/15 text-primary shrink-0">
                        <Sparkles className="h-4 w-4" />
                    </span>
                    <div className="flex-1 min-w-0 space-y-1">
                        <div className="text-sm font-semibold">
                            {effective.status === "TRIAL"
                                ? "Unlimited during your free trial"
                                : "Unlimited on this plan"}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            {mode === "branches"
                                ? "Add as many outlets as you need."
                                : "Add as many staff seats per outlet as you need."}{" "}
                            {effective.status === "TRIAL" && (
                                <Link href="/settings/billing" className="text-primary hover:underline inline-flex items-center gap-1">
                                    Pick a plan <ArrowRight className="h-3 w-3" />
                                </Link>
                            )}
                        </p>
                    </div>
                </CardContent>
            </Card>
        )
    }

    // ── Paid plan — render the actual meter ────────────────────────────
    return mode === "branches"
        ? <BranchesMeter summary={effective} />
        : <StaffMeter summary={effective} />
}

function BranchesMeter({ summary }: { summary: PlanCapacitySummary }) {
    const max = summary.max_branches ?? 0
    const used = summary.active_branches
    const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0
    const atCap = max > 0 && used >= max

    return (
        <Card className={cn(atCap && "border-warning/40 bg-warning/[0.04]")}>
            <CardContent className="py-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                        <span className={cn(
                            "grid place-items-center h-9 w-9 rounded-lg shrink-0",
                            atCap ? "bg-warning/15 text-warning" : "bg-primary/15 text-primary",
                        )}>
                            <Building2 className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                            <div className="text-sm font-semibold flex items-center gap-2">
                                Outlets {atCap && <Badge variant="warning" className="text-[10px]"><Lock className="h-3 w-3 mr-0.5" />At plan limit</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                <span className="font-semibold text-foreground">{used}</span> of {max} active outlets used
                                {summary.inactive_branches > 0 && (
                                    <> · <span className="text-muted-foreground/80">{summary.inactive_branches} inactive (not counted)</span></>
                                )}
                                {summary.tier && <> · <span className="capitalize">{summary.tier}</span> plan</>}
                            </p>
                        </div>
                    </div>
                    {atCap && (
                        <Link
                            href="/settings/billing"
                            className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
                        >
                            Upgrade plan <ArrowRight className="h-3 w-3" />
                        </Link>
                    )}
                </div>
                <CapacityBar pct={pct} atCap={atCap} />
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Deactivating an outlet frees its slot — you can swap which outlets are billed without an upgrade.
                </p>
            </CardContent>
        </Card>
    )
}

function StaffMeter({ summary }: { summary: PlanCapacitySummary }) {
    const max = summary.max_staff_per_branch ?? 0
    const active = summary.branches.filter((b) => b.is_active)

    return (
        <Card>
            <CardContent className="py-4 space-y-3">
                <div className="flex items-center gap-3">
                    <span className="grid place-items-center h-9 w-9 rounded-lg bg-primary/15 text-primary shrink-0">
                        <Users className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold flex items-center gap-2">
                            Staff seats per outlet
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {max > 0
                                ? <>Each outlet can have up to <span className="font-semibold text-foreground">{max} staff</span> (excluding the owner).</>
                                : <>Unlimited staff per outlet.</>}
                            {summary.tier && <> · <span className="capitalize">{summary.tier}</span> plan</>}
                        </p>
                    </div>
                </div>

                {active.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No active outlets yet.</p>
                ) : (
                    <ul className="space-y-2">
                        {active.map((b) => {
                            const pct = max > 0 ? Math.min(100, Math.round((b.active_staff / max) * 100)) : 0
                            return (
                                <li key={b.id} className={cn(
                                    "rounded-md border px-3 py-2 space-y-1.5",
                                    b.staff_at_cap ? "border-warning/40 bg-warning/[0.04]" : "border-border/60",
                                )}>
                                    <div className="flex items-center justify-between gap-2 text-xs">
                                        <span className="font-medium inline-flex items-center gap-1.5 min-w-0">
                                            {b.is_main && <Crown className="h-3 w-3 text-warning shrink-0" />}
                                            <span className="truncate">{b.name}</span>
                                            {b.staff_at_cap && (
                                                <Badge variant="warning" className="text-[10px]"><Lock className="h-3 w-3 mr-0.5" />Full</Badge>
                                            )}
                                        </span>
                                        <span className="tabular-nums text-muted-foreground shrink-0">
                                            {b.active_staff}{max > 0 ? <> / {max}</> : null}
                                            {b.inactive_staff > 0 && (
                                                <span className="ml-1 text-muted-foreground/70">(+{b.inactive_staff} inactive)</span>
                                            )}
                                        </span>
                                    </div>
                                    {max > 0 && <CapacityBar pct={pct} atCap={b.staff_at_cap} />}
                                </li>
                            )
                        })}
                    </ul>
                )}

                <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Deactivating a staff member frees their seat — onboard a replacement on the same plan without an upgrade.
                </p>
            </CardContent>
        </Card>
    )
}
