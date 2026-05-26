import { PermissionGuard } from "@/components/auth/permission-guard"

export default function Layout({ children }: { children: React.ReactNode }) {
    // End-of-shift cash reconciliation — anyone who can take payments
    // needs to see their own collections; RLS scopes the data per-user.
    return <PermissionGuard permission="payment.record">{children}</PermissionGuard>
}
