import { redirect } from "next/navigation"

import { AppShell } from "@/components/app-shell/app-shell"
import { BranchTransition } from "@/components/app-shell/branch-transition"
import { PaymentNotifier } from "@/components/app-shell/payment-notifier"
import { QrOrderNotifier } from "@/components/app-shell/qr-order-notifier"
import { WarmServiceWorker } from "@/components/app-shell/warm-service-worker"
import { TourProvider } from "@/components/tours/tour-provider"
import { planOverrideUnlimited } from "@/lib/billing/plans"
import { isSuperAdmin } from "@/lib/super-admin/auth"
import { getCurrentUserAndTenant } from "@/lib/auth/current-user"
import type { createClient } from "@/lib/supabase/server"
import type { UserRole } from "@/types/database"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
    // Cached per-request: any child server page calling
    // `getCurrentUserAndTenant()` shares THIS call's results instead of
    // refetching. The dashboard / bills / orders server pages all
    // benefit — page-change time was burning ~150-300 ms on duplicate
    // auth + users queries before this dedupe.
    const { user, appUser, userErr, supabase } = await getCurrentUserAndTenant()

    if (!user) redirect("/login")

    // Hard stop for deactivated staff. The admin-side ban + signOut should
    // already have kicked them, but a stale JWT could still let getUser()
    // succeed for up to the access-token TTL. Redirect to /login where the
    // client clears the cookie and shows the "deactivated" notice.
    if (appUser && (appUser as { is_active?: boolean | null }).is_active === false) {
        redirect("/login?inactive=1")
    }

    // Super-admin short-circuit. A user whose `role = 'SUPER_ADMIN'` is
    // not a tenant member — they shouldn't go through onboarding or
    // see the tenant-scoped app at all. Send them straight to the
    // platform console. Env-allow-listed super-admins land here too via
    // the SQL `is_super_admin()` predicate the migration adds.
    if (appUser && (appUser as { role?: string | null }).role === "SUPER_ADMIN") {
        redirect("/super-admin")
    }

    // Self-heal: if the public.users row is missing (the auth trigger
    // silently failed at some point), repair it before sending the user
    // to onboarding.
    if (!appUser && !userErr) {
        try {
            await supabase.rpc("repair_my_user_row" as never)
        } catch {
            /* if repair fails too, complete_onboarding will heal */
        }
        // Orphan with a pending invite? Send them to /invite — don't make
        // them onboard a new tenant by accident.
        const inviteToken = await getPendingInviteToken(supabase)
        if (inviteToken) redirect(`/invite/${inviteToken}`)
        redirect("/onboarding")
    }

    if (userErr) {
        // Transient DB error — bounce to login so the user can retry.
        redirect("/login")
    }

    if (!appUser?.tenant_id) {
        // Existing public.users row but no tenant — same logic: prefer invite
        // acceptance over creating a brand-new tenant.
        const inviteToken = await getPendingInviteToken(supabase)
        if (inviteToken) redirect(`/invite/${inviteToken}`)
        redirect("/onboarding")
    }

    // `tenant` is already collapsed to a single object by the cached
    // helper (PostgREST returns the FK embed as an array; the helper
    // unwraps it). No further casting needed here.
    const tenant = appUser.tenant

    // ── Plan-tier enforcement ───────────────────────────────────────────
    // Non-OWNER staff get locked out if their branch or seat is over the
    // plan caps. OWNER always passes (so they can still log in and pick
    // a higher plan to restore everyone's access). The global env override
    // `RESTOPOS_PLAN_OVERRIDE=unlimited` short-circuits the whole check.
    const role = appUser.role as UserRole
    if (role !== "OWNER" && !planOverrideUnlimited()) {
        try {
            const { data: allowed } = await supabase.rpc(
                "is_user_within_plan_limits" as never,
                { p_user_id: user.id } as never,
            )
            if (allowed === false) redirect("/locked")
        } catch {
            // DB unreachable / function missing (migration not yet applied):
            // fail open so the app still works rather than locking everyone
            // out. The owner-side banner is what really nudges the upgrade.
        }
    }

    return (
        <TourProvider role={appUser.role as UserRole}>
            {/* The shell switches between a normal Sidebar+Topbar layout
              * and a full-bleed "kiosk" layout (POS, KDS) based on the
              * current pathname. Notifiers + the branch transition live
              * OUTSIDE the shell so realtime events still fire even in
              * kiosk mode — cashier needs the QR-order ding regardless
              * of which screen they're on. */}
            <AppShell
                tenantId={appUser.tenant_id as string}
                tenantName={tenant?.name ?? "Your Restaurant"}
                tenantLogoUrl={tenant?.logo_url ?? null}
                userName={appUser.full_name ?? ""}
                userEmail={appUser.email ?? user.email ?? ""}
                userAvatarUrl={appUser.avatar_url ?? null}
                role={appUser.role as UserRole}
                isSuperAdmin={isSuperAdmin(user)}
            >
                {children}
            </AppShell>
            {/* Branch-switch visual cue. Fires the moment the topbar
             *  switcher dispatches a change so the admin sees "yes,
             *  the app is re-scoping" rather than a silent table refresh. */}
            <BranchTransition />
            {/* Ask the SW to pre-cache the heavy-use shift pages now that
             *  we know this user is authenticated — see the component for why. */}
            <WarmServiceWorker />
            {/* Toast staff when a new QR order lands, regardless of which
             *  page they're on. The sidebar badge already shows the count;
             *  this surfaces the event so it's hard to miss. */}
            <QrOrderNotifier tenantId={appUser.tenant_id as string} />
            {/* Toast on every online payment (PhonePe/Stripe/etc.) — the
             *  webhook inserts a payments row, this subscription picks it
             *  up in realtime so the dashboard "dings" when money arrives. */}
            <PaymentNotifier tenantId={appUser.tenant_id as string} />
        </TourProvider>
    )
}

type SupabaseLike = Awaited<ReturnType<typeof createClient>>

async function getPendingInviteToken(supabase: SupabaseLike): Promise<string | null> {
    try {
        const { data } = await supabase.rpc("pending_invite_for_email" as never)
        return typeof data === "string" && data.length > 0 ? data : null
    } catch {
        return null
    }
}
