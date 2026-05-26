import { PermissionGuard } from "@/components/auth/permission-guard"

export default function Layout({ children }: { children: React.ReactNode }) {
    // Vendors is part of the finance / purchases surface — anyone who
    // can record purchases or read reports needs to see the vendor list.
    return <PermissionGuard permission="purchase.write">{children}</PermissionGuard>
}
