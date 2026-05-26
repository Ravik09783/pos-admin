import { PermissionGuard } from "@/components/auth/permission-guard"

export default function Layout({ children }: { children: React.ReactNode }) {
    // Broadcast / campaign tools — owner/manager only. Sending mass
    // messages on behalf of the brand needs settings.write.
    return <PermissionGuard permission="settings.write">{children}</PermissionGuard>
}
