import { PermissionGuard } from "@/components/auth/permission-guard"

export default function Layout({ children }: { children: React.ReactNode }) {
    // Aggregator integrations carry commercial contract numbers
    // (commission %, partner IDs, settlements) — same audience that
    // owns the rest of restaurant configuration.
    return <PermissionGuard permission="settings.write">{children}</PermissionGuard>
}
