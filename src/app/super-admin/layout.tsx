import { redirect } from "next/navigation"
import { ShieldAlert } from "lucide-react"

import { ThemeToggle } from "@/components/app-shell/theme-toggle"
import { createClient } from "@/lib/supabase/server"
import { isSuperAdminFromAuth, superAdminFeatureConfigured } from "@/lib/super-admin/auth"

import { SuperAdminUserMenu } from "./user-menu"

/**
 * Route gate for the entire `/super-admin/*` tree.
 *
 * The super admin lives OUTSIDE the tenant model — we don't reuse the
 * `(app)` layout because that layout fetches `users.tenant_id` and
 * redirects to /onboarding when missing. A super-admin signed-in
 * account typically has NO tenant attached, so we'd loop. Instead this
 * layout does its own auth check + email-allow-list check, then
 * renders a minimal chrome (just a topbar with a Return-to-Dashboard
 * link).
 *
 * Authorization layers:
 *   1. Must be signed in (else /login)
 *   2. Either `public.users.role = 'SUPER_ADMIN'` (set in Supabase
 *      Studio by an operator — the recommended path) OR email is in
 *      `RESTOPOS_SUPER_ADMIN_EMAILS` (bootstrap / break-glass).
 *
 * We don't render a soft "permission denied" page on purpose — making
 * the existence of this route invisible to non-admins reduces the
 * attack surface for credential-stuffing attempts.
 */
export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/login?next=/super-admin")

    const isAdmin = await isSuperAdminFromAuth(user, supabase)
    if (!isAdmin) {
        // If there are NO super admins configured at all (no env entries
        // AND no SUPER_ADMIN rows in the DB), we still 404 — the URL
        // existence shouldn't leak to non-admins regardless. The setup
        // doc tells the operator how to create the first super-admin.
        return notFoundResponse()
    }
    void superAdminFeatureConfigured

    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="sticky top-0 z-30 border-b border-destructive/30 bg-destructive/[0.04] backdrop-blur">
                <div className="container mx-auto px-4 h-14 flex items-center gap-3">
                    <ShieldAlert className="h-5 w-5 text-destructive shrink-0" />
                    <div className="min-w-0">
                        <div className="text-sm font-semibold leading-tight">Super-admin console</div>
                        <div className="text-[11px] text-muted-foreground leading-tight truncate">
                            Signed in as <span className="font-mono">{user.email}</span> — actions here affect every tenant.
                        </div>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                        <ThemeToggle />
                        {/* Avatar-style dropdown with "Back to my
                          * dashboard", "My profile", and Sign out.
                          * Previously this slot was just a back-link
                          * button — a super-admin had no in-app way
                          * to drop their session. */}
                        <SuperAdminUserMenu email={user.email ?? ""} />
                    </div>
                </div>
            </header>
            <main>{children}</main>
        </div>
    )
}

function notFoundResponse(): React.ReactElement {
    // Next 16 doesn't expose `notFound()` from a server component to
    // produce a 404 inside a layout cleanly; redirecting to / is the
    // most honest non-leak alternative.
    redirect("/")
}
