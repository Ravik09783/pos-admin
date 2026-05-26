import { PermissionGuard } from "@/components/auth/permission-guard"

export default function Layout({ children }: { children: React.ReactNode }) {
    // Coupon CRUD is an admin decision — pricing concern. Gated on
    // settings.write so the same audience that owns tax + branding
    // owns discount catalogues.
    return <PermissionGuard permission="settings.write">{children}</PermissionGuard>
}
