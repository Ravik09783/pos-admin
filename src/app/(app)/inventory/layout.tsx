import { PermissionGuard } from "@/components/auth/permission-guard"

export default function Layout({ children }: { children: React.ReactNode }) {
    // Inventory is the stock + recipe surface — anyone with purchase
    // recording (which is what touches stock) needs to view it; the
    // AUDITOR role also reads inventory via reports, but they don't
    // record purchases, so they pick up access via reports.view above.
    return <PermissionGuard permission="purchase.write">{children}</PermissionGuard>
}
