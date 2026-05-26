import { PermissionGuard } from "@/components/auth/permission-guard"

export default function Layout({ children }: { children: React.ReactNode }) {
    return <PermissionGuard permission="settings.write">{children}</PermissionGuard>
}