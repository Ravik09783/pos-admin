import { redirect } from "next/navigation"

import { getCurrentUserAndTenant } from "@/lib/auth/current-user"
import { DashboardClient } from "./dashboard-client"
import type { UserRole } from "@/types/database"

/**
 * Thin server shell — resolves who's looking (role) + the restaurant name
 * + first-time setup state, then hands off to the role-shaped client
 * dashboard which does the live data + realtime refresh.
 *
 * Performance: the auth + user-row lookup is shared with `(app)/layout.tsx`
 * via React `cache()` (see `lib/auth/current-user.ts`). Same request →
 * one round-trip total, not two. Saves ~150-300 ms per dashboard nav.
 */
export default async function DashboardPage() {
    const { user, appUser, supabase } = await getCurrentUserAndTenant()
    if (!user) redirect("/login")
    if (!appUser?.tenant_id) redirect("/onboarding")
    const role = (appUser.role as UserRole) ?? "CASHIER"

    // Three remaining queries are all genuinely dashboard-specific:
    // setup checks (menu / tables counts) and the tenant's payment
    // settings. Run them in parallel.
    const [{ count: menuCount }, { count: tableCount }, { data: tenant }] = await Promise.all([
        supabase.from("menu_items").select("id", { count: "exact", head: true }).is("deleted_at", null),
        supabase.from("dining_tables").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("tenants").select("name, upi_id, payment_gateway, country, currency").eq("id", appUser.tenant_id).maybeSingle(),
    ])
    const t = tenant as { name?: string; upi_id?: string | null; payment_gateway?: string; country?: string | null; currency?: string | null } | null

    return (
        <DashboardClient
            userId={user.id}
            role={role}
            firstName={(appUser.full_name ?? "").trim().split(" ")[0] ?? ""}
            tenantName={t?.name ?? "Your restaurant"}
            tenantCurrency={t?.currency ?? "INR"}
            tenantCountry={t?.country ?? null}
            profile={{
                full_name: appUser.full_name,
                email: appUser.email,
                dob: appUser.dob,
                phone: appUser.phone,
                avatar_url: appUser.avatar_url,
                joined_at: appUser.created_at,
            }}
            setup={{
                hasMenu: (menuCount ?? 0) > 0,
                hasTables: (tableCount ?? 0) > 0,
                hasPayment: !!(t?.upi_id || t?.payment_gateway === "phonepe"),
                menuCount: menuCount ?? 0,
                tableCount: tableCount ?? 0,
            }}
        />
    )
}
