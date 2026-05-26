import Link from "next/link"
import { MailOpen, Megaphone } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { CreateAccountButton } from "./create-account-dialog"
import { DashboardTabs } from "./dashboard-tabs"

/**
 * Super-admin dashboard — lists every restaurant on the platform plus,
 * in a second tab, every account that signed up but has no restaurant.
 *
 * Auth is already enforced by `super-admin/layout.tsx`. We use the
 * service-role client here to read the data (regular RLS would scope to
 * the super-admin's nonexistent tenant).
 */
export default async function SuperAdminDashboardPage() {
    const service = createServiceRoleClient()

    const { data: rows, error } = await service.rpc("super_admin_tenant_overview" as never)
    if (error) {
        return (
            <div className="container mx-auto px-4 py-8">
                <Card className="border-destructive/40 bg-destructive/[0.04]">
                    <CardContent className="py-6 text-sm">
                        <div className="font-semibold mb-1">Couldn&apos;t load tenants.</div>
                        <p className="text-muted-foreground">{error.message}</p>
                        <p className="text-muted-foreground mt-2 text-xs">
                            Most common cause: migration 20 hasn&apos;t been applied yet. Run{" "}
                            <code>supabase/migrations/20_super_admin.sql</code> on your DB.
                        </p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    const tenants = (rows ?? []) as TenantRow[]

    // Accounts that signed up but never got a restaurant attached
    // (tenant_id IS NULL). Excludes super-admins — they're platform
    // operators and have no tenant by design, so they'd be noise here.
    const { data: orphanRows } = await service
        .from("users")
        .select("id, email, full_name, role, is_active, created_at")
        .is("tenant_id", null)
        .neq("role", "SUPER_ADMIN")
        .order("created_at", { ascending: false })

    const orphanAccounts = (orphanRows ?? []) as OrphanAccount[]

    return (
        <div className="container mx-auto px-4 py-8 space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">All restaurants</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Every tenant signed up on the platform. Click a row to expand actions.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button asChild variant="outline">
                        <Link href="/super-admin/demo-requests">
                            <MailOpen className="h-4 w-4" />
                            Demo requests
                        </Link>
                    </Button>
                    <Button asChild variant="outline">
                        <Link href="/super-admin/posts">
                            <Megaphone className="h-4 w-4" />
                            Announcements
                        </Link>
                    </Button>
                    <CreateAccountButton />
                </div>
            </div>

            <DashboardTabs tenants={tenants} orphanAccounts={orphanAccounts} />
        </div>
    )
}

export interface TenantRow {
    id: string
    name: string | null
    slug: string | null
    country: string | null
    currency: string | null
    plan_tier: string | null
    subscription_status: string | null
    trial_ends_at: string | null
    current_period_end: string | null
    created_at: string
    owner_email: string | null
    owner_full_name: string | null
    branch_count: number
    staff_count: number
    total_bills: number
    total_revenue: number
    last_activity_at: string | null
}

export interface OrphanAccount {
    id: string
    email: string | null
    full_name: string | null
    role: string | null
    is_active: boolean | null
    created_at: string
}
