import { PermissionGuard } from "@/components/auth/permission-guard"

export default function Layout({ children }: { children: React.ReactNode }) {
    // QR pending orders — confirmed by whoever rings them up next.
    // Gated on bill.generate so a guest captain (who can take orders
    // but can't bill) doesn't see the confirm queue.
    return <PermissionGuard permission="bill.generate">{children}</PermissionGuard>
}
