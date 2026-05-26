import { PermissionGuard } from "@/components/auth/permission-guard"

export default function Layout({ children }: { children: React.ReactNode }) {
    // Gated on `manage_users` — not `staff.manage` — so a delegated
    // manager (whose custom template includes manage_users) can ALSO
    // open this page to add staff and reassign templates. Actions
    // that go beyond manage_users (deactivate, reset password, edit
    // someone else's profile) stay gated server-side: the OWNER-only
    // RLS on `public.users` rejects writes from delegates, and the
    // /api/admin/staff/{set-active,reset-password} routes do their
    // own role check before mutating auth.users. So delegates can
    // add + reassign — exactly the scope the proposal called for.
    return <PermissionGuard permission="manage_users">{children}</PermissionGuard>
}
