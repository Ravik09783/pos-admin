"use client"

import { Building2, Receipt, UserX, Users } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OrphanAccountsTable } from "./orphan-accounts-table"
import { TenantsTable } from "./tenants-table"
import type { OrphanAccount, TenantRow } from "./page"

/**
 * Two-tab shell for the super-admin dashboard:
 *   • "Restaurants" — every tenant, with the headline KPI tiles.
 *   • "Accounts without restaurant" — accounts that signed up but never
 *     completed restaurant setup (tenant_id IS NULL). Surfacing them
 *     separately keeps the restaurants list clean while still giving the
 *     operator visibility into stalled / failed sign-ups.
 *
 * Tabs (Radix) need a client component; the data itself is fetched on
 * the server in page.tsx and passed straight through as props.
 */
export function DashboardTabs({
    tenants,
    orphanAccounts,
}: {
    tenants: TenantRow[]
    orphanAccounts: OrphanAccount[]
}) {
    const totalRevenue = tenants.reduce((s, t) => s + Number(t.total_revenue ?? 0), 0)
    const totalBills = tenants.reduce((s, t) => s + Number(t.total_bills ?? 0), 0)
    const totalStaff = tenants.reduce((s, t) => s + Number(t.staff_count ?? 0), 0)

    return (
        <Tabs defaultValue="restaurants" className="space-y-4">
            <TabsList>
                <TabsTrigger value="restaurants">
                    Restaurants
                    <span className="ml-1.5 text-xs text-muted-foreground">{tenants.length}</span>
                </TabsTrigger>
                <TabsTrigger value="accounts">
                    Accounts without restaurant
                    <span className="ml-1.5 text-xs text-muted-foreground">{orphanAccounts.length}</span>
                </TabsTrigger>
            </TabsList>

            <TabsContent value="restaurants" className="space-y-6">
                {/* Headline totals across the platform */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <KpiTile label="Restaurants" value={tenants.length.toString()} icon={Building2} />
                    <KpiTile label="Staff users" value={totalStaff.toLocaleString()} icon={Users} />
                    <KpiTile label="Bills issued" value={totalBills.toLocaleString()} icon={Receipt} />
                    <KpiTile
                        label="Platform GMV (₹ + $)"
                        value={totalRevenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    />
                </div>

                <TenantsTable initialTenants={tenants} />
            </TabsContent>

            <TabsContent value="accounts" className="space-y-3">
                <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
                    <UserX className="h-4 w-4 shrink-0 mt-0.5" />
                    <p>
                        These accounts can sign in but haven&apos;t set up a restaurant yet — usually
                        a sign-up that stalled before onboarding finished. They don&apos;t appear in
                        the Restaurants tab because they have no tenant. (Super-admin accounts are
                        excluded.)
                    </p>
                </div>
                <OrphanAccountsTable accounts={orphanAccounts} />
            </TabsContent>
        </Tabs>
    )
}

function KpiTile({
    label,
    value,
    icon: Icon,
}: {
    label: string
    value: string
    icon?: typeof Building2
}) {
    return (
        <Card>
            <CardContent className="p-4 space-y-1">
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                    {Icon && <Icon className="h-3 w-3" />} {label}
                </div>
                <div className="text-2xl font-bold tabular-nums">{value}</div>
            </CardContent>
        </Card>
    )
}
