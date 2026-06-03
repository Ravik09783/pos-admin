import { redirect } from "next/navigation"
import { CalendarDays, Mail, ShieldAlert, User as UserIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"
import { isSuperAdminFromAuth } from "@/lib/super-admin/auth"

import { ChangePasswordForm } from "./change-password-form"
import { SuperAdminProfileForm } from "./profile-form"

/**
 * Super-admin profile page. A super-admin lives outside the tenant
 * model so the regular `(app)/settings/profile` surface — which
 * assumes a `users.tenant_id` and exposes per-tenant fields like
 * avatar / full_name — doesn't apply to them and the `(app)` layout
 * even short-circuits them away from it.
 *
 * This page is intentionally lean: it shows the things a super-admin
 * actually needs to know about their own account (email, when they
 * joined, when they last signed in) and the one action they may need
 * to take inline (change their password).
 */
export default async function SuperAdminProfilePage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/login?next=/super-admin/profile")

    // Re-check super-admin status — the layout already guards this,
    // but the page-level check makes the security review trivial.
    const isAdmin = await isSuperAdminFromAuth(user, supabase)
    if (!isAdmin) redirect("/")

    // Pull the editable profile fields from `public.users`. RLS
    // `users_select_self` lets the row come back without any special
    // role check. Missing row is tolerated — the form will save it
    // back via the regular update path.
    const { data: meRow } = await supabase
        .from("users")
        .select("id, full_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle() as { data: { id: string; full_name: string | null; avatar_url: string | null } | null }

    const created = user.created_at ? new Date(user.created_at) : null
    const lastSignIn = user.last_sign_in_at ? new Date(user.last_sign_in_at) : null
    const fmt = (d: Date) => d.toLocaleString(undefined, {
        weekday: "short", year: "numeric", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit",
    })

    return (
        <div className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
            <div>
                <Badge variant="outline" className="mb-2 text-[10px] uppercase tracking-wider">
                    <ShieldAlert className="h-3 w-3 mr-1 text-destructive" />
                    Super-admin
                </Badge>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">My profile</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Your platform-operator account. Changes here only affect this account, not any tenant.
                </p>
            </div>

            {/* ── Display info (editable) ──────────────────────────
              * Photo + display name, the only profile fields that
              * actually show up elsewhere in the super-admin
              * console (avatar dropdown, audit log entries). Saved
              * back to `public.users` via the regular self-update
              * RLS — the dedicated upload-avatar API handles the
              * storage-bucket side which can't accept direct writes
              * from a tenant-less account. */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <UserIcon className="h-4 w-4 text-primary" /> Photo &amp; display name
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <SuperAdminProfileForm
                        userId={user.id}
                        initialFullName={meRow?.full_name ?? ""}
                        initialAvatarUrl={meRow?.avatar_url ?? null}
                    />
                </CardContent>
            </Card>

            {/* ── Account info ─────────────────────────────────────── */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Account</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Row
                        icon={<Mail className="h-4 w-4 text-muted-foreground" />}
                        label="Email"
                        value={<span className="font-mono">{user.email ?? "—"}</span>}
                    />
                    <Row
                        icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
                        label="Joined"
                        value={created ? fmt(created) : "—"}
                    />
                    <Row
                        icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
                        label="Last sign-in"
                        value={lastSignIn ? fmt(lastSignIn) : "—"}
                    />
                </CardContent>
            </Card>

            {/* ── Change password ──────────────────────────────────── */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Change password</CardTitle>
                </CardHeader>
                <CardContent>
                    <ChangePasswordForm />
                </CardContent>
            </Card>
        </div>
    )
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
    return (
        <div className="flex items-start gap-3">
            <div className="shrink-0 mt-0.5">{icon}</div>
            <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
                <div className="text-sm">{value}</div>
            </div>
        </div>
    )
}
