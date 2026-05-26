"use client"

/**
 * Friendly "you can't do this" screen.
 *
 * Instead of bouncing a staffer back to the dashboard with no explanation,
 * we show them:
 *   1. What they were trying to do, in plain language.
 *   2. The exact people who CAN do it — with phone + email — so they can
 *      ask whoever is on shift directly.
 *
 * Data sources:
 *   - `public.users` for names / phones / emails (RLS allows tenant read).
 *   - `users_with_permission(p)` RPC (migration 47) — returns the ids of
 *     users in the caller's tenant whose ASSIGNED ROLE TEMPLATE includes
 *     the permission. Authoritative source post-templates.
 *
 * We intersect those two on the client to render the final list.
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2, Lock, Mail, Phone } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/client"
import {
    PERMISSION_META, ROLE_LABELS, type Permission,
} from "@/lib/rbac/permissions"
import type { UserRole } from "@/types/database"

interface Helper {
    id: string
    name: string
    role: UserRole
    phone: string | null
    email: string | null
}

const ROLE_PRIORITY: Record<UserRole, number> = {
    OWNER: 0, MANAGER: 1, AUDITOR: 2, CASHIER: 3, CAPTAIN: 4, KITCHEN: 5, DELIVERY: 6,
}

export function NoPermissionScreen({ permission }: { permission: Permission }) {
    const meta = PERMISSION_META[permission]
    const [helpers, setHelpers] = useState<Helper[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const supabase = createClient()
        let cancelled = false
        ;(async () => {
            // The RPC returns user ids that have the permission via their
            // assigned template. Anyone-tenant-member callable thanks to
            // SECURITY DEFINER + scoping to public.current_tenant_id().
            const { data: idsRaw } = await supabase.rpc(
                "users_with_permission" as never,
                { p_permission: permission } as never,
            )
            const allowedIds = new Set(
                ((idsRaw ?? []) as { user_id: string }[]).map((r) => r.user_id),
            )
            if (cancelled) return

            if (allowedIds.size === 0) {
                setHelpers([])
                setLoading(false)
                return
            }

            const { data: usersRaw } = await supabase
                .from("users")
                .select("id, full_name, email, phone, role, is_active")
                .eq("is_active", true)
                .in("id", Array.from(allowedIds))
            if (cancelled) return

            const list: Helper[] = []
            for (const u of (usersRaw ?? []) as {
                id: string; full_name: string | null; email: string | null
                phone: string | null; role: UserRole; is_active: boolean
            }[]) {
                list.push({
                    id: u.id,
                    name: u.full_name || u.email || "Staff",
                    role: u.role,
                    phone: u.phone,
                    email: u.email,
                })
            }
            list.sort((a, b) => {
                const pa = ROLE_PRIORITY[a.role] ?? 9
                const pb = ROLE_PRIORITY[b.role] ?? 9
                return pa - pb || a.name.localeCompare(b.name)
            })
            setHelpers(list)
            setLoading(false)
        })()
        return () => { cancelled = true }
    }, [permission])

    return (
        <div className="container mx-auto py-8 md:py-12 px-4 max-w-xl">
            <Card className="border-warning/40 shadow-lg">
                <CardHeader className="text-center pt-8 pb-2">
                    <div className="mx-auto h-14 w-14 rounded-full bg-warning/15 text-warning grid place-items-center mb-3">
                        <Lock className="h-6 w-6" />
                    </div>
                    <CardTitle className="text-xl">You don&apos;t have permission</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1 px-2">
                        Your account isn&apos;t allowed to{" "}
                        <strong className="text-foreground">{meta.label.toLowerCase()}</strong>.
                    </p>
                </CardHeader>

                <CardContent className="space-y-5 pt-3">
                    {/* What this permission lets people do — same plain
                      * language the OWNER reads in the permissions editor. */}
                    <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs leading-relaxed">
                        <div className="font-medium text-foreground mb-1">What this means</div>
                        <span className="text-muted-foreground">{meta.description}</span>
                    </div>

                    {/* Helpers list — the whole point of the screen. */}
                    <div>
                        <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground mb-2">
                            Ask one of these people
                        </div>
                        {loading ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                            </div>
                        ) : helpers.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-4 text-center">
                                No one currently has this permission. Contact your restaurant owner.
                            </p>
                        ) : (
                            <ul className="space-y-2">
                                {helpers.map((h) => (
                                    <HelperRow key={h.id} helper={h} />
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="flex justify-center pt-2">
                        <Button asChild variant="ghost">
                            <Link href="/dashboard">
                                <ArrowLeft className="h-4 w-4" /> Back to dashboard
                            </Link>
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

function HelperRow({ helper }: { helper: Helper }) {
    const initials = helper.name
        .split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()
    return (
        <li className="rounded-lg border border-border/60 p-3 flex items-center gap-3 hover:border-border transition-colors">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/25 to-[hsl(var(--neon-magenta)/0.25)] grid place-items-center text-xs font-semibold shrink-0">
                {initials || "?"}
            </div>
            <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{helper.name}</div>
                <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="outline" className="text-[10px]">{ROLE_LABELS[helper.role]}</Badge>
                    {helper.phone && (
                        <span className="text-[11px] text-muted-foreground font-mono">{helper.phone}</span>
                    )}
                </div>
            </div>
            <div className="flex gap-1 shrink-0">
                {helper.phone && (
                    <Button asChild variant="outline" size="icon" className="h-8 w-8" title={`Call ${helper.name}`}>
                        <a href={`tel:${helper.phone}`} aria-label={`Call ${helper.name}`}>
                            <Phone className="h-3.5 w-3.5" />
                        </a>
                    </Button>
                )}
                {helper.email && (
                    <Button asChild variant="outline" size="icon" className="h-8 w-8" title={`Email ${helper.name}`}>
                        <a href={`mailto:${helper.email}`} aria-label={`Email ${helper.name}`}>
                            <Mail className="h-3.5 w-3.5" />
                        </a>
                    </Button>
                )}
            </div>
        </li>
    )
}
