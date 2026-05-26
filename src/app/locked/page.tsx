import Link from "next/link"
import { redirect } from "next/navigation"
import { Lock, MessageCircle } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { LockedSignOutButton } from "./signout-button"

/**
 * /locked — landing page for staff users whose login was blocked because
 * their restaurant's current plan doesn't have room for them (branch over
 * cap, or seat over per-branch cap).
 *
 * The page is intentionally outside the `(app)` route group so the layout
 * gate doesn't bounce them in a loop. It tells them what's wrong, names
 * the owner so they know who to call, and offers a single "Sign out"
 * action. There is no "request upgrade" CTA here on purpose — only the
 * owner can switch plans, and the cashier shouldn't be the one nudging
 * them via this UI.
 *
 * NOTE: the subscription paywall (trial over + unpaid) does NOT route
 * here — `proxy.ts` sends those users (owner and staff alike) to
 * /settings/billing so they can pay. This page is plan-cap only.
 */
export default async function LockedPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/login")

    const { data: me } = await supabase
        .from("users")
        .select("full_name, email, role, tenant_id, branch_id")
        .eq("id", user.id)
        .maybeSingle()

    // OWNERS should never land here — if somehow they do, send them to
    // the billing page where they can fix it.
    if ((me as { role?: string } | null)?.role === "OWNER") {
        redirect("/settings/billing?reason=plan_limit_exceeded")
    }

    const tenantId = (me as { tenant_id?: string } | null)?.tenant_id
    let ownerName: string | null = null
    let ownerEmail: string | null = null
    let tenantName: string | null = null

    if (tenantId) {
        const [{ data: ownerRow }, { data: tenantRow }] = await Promise.all([
            supabase
                .from("users")
                .select("full_name, email")
                .eq("tenant_id", tenantId)
                .eq("role", "OWNER")
                .limit(1)
                .maybeSingle(),
            supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
        ])
        ownerName = (ownerRow as { full_name?: string | null } | null)?.full_name ?? null
        ownerEmail = (ownerRow as { email?: string | null } | null)?.email ?? null
        tenantName = (tenantRow as { name?: string | null } | null)?.name ?? null
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
            <div className="w-full max-w-lg space-y-6 rounded-2xl border border-warning/30 bg-warning/[0.04] p-8 text-center">
                <div className="mx-auto grid place-items-center h-14 w-14 rounded-full bg-warning/15 text-warning">
                    <Lock className="h-7 w-7" />
                </div>

                <div className="space-y-2">
                    <h1 className="text-2xl font-bold">Access paused</h1>
                    <p className="text-sm text-muted-foreground">
                        Your account at <span className="font-semibold text-foreground">{tenantName ?? "this restaurant"}</span>
                        {" "}is currently outside the plan&apos;s seat or outlet limits, so it can&apos;t sign in.
                    </p>
                </div>

                {(ownerName || ownerEmail) && (
                    <div className="rounded-lg border border-border/60 bg-card/30 p-4 text-left text-sm">
                        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
                            <MessageCircle className="h-3 w-3" /> Ask your owner to upgrade
                        </div>
                        {ownerName && <div className="font-medium">{ownerName}</div>}
                        {ownerEmail && <div className="text-muted-foreground font-mono text-xs">{ownerEmail}</div>}
                    </div>
                )}

                <p className="text-xs text-muted-foreground">
                    Once the owner picks a higher plan or removes another seat, your account will work again automatically. Nothing has been deleted.
                </p>

                <LockedSignOutButton />

                <p className="text-xs text-muted-foreground">
                    <Link href="/login" className="hover:text-foreground transition-colors">Back to login</Link>
                </p>
            </div>
        </div>
    )
}
