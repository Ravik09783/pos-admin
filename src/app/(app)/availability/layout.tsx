import { PermissionGuard } from "@/components/auth/permission-guard"

export default function Layout({ children }: { children: React.ReactNode }) {
    return <PermissionGuard permission="menu.toggle_availability">{children}</PermissionGuard>
}