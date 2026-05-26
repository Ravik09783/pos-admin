import { notFound } from "next/navigation"

import { getCurrentUserAndTenant } from "@/lib/auth/current-user"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { AggregatorWorkbench } from "../_components/aggregator-workbench"

/**
 * /integrations/zomato — Zomato partner workbench.
 *
 * Same shape as /integrations/swiggy; only the aggregator key + page-
 * resolved metadata differ. See <AggregatorWorkbench /> for the actual
 * surfaces (settings · KPIs · orders · settlements · guide).
 */
export default async function ZomatoIntegrationPage() {
    const { appUser, supabase } = await getCurrentUserAndTenant()
    if (!appUser?.tenant_id) notFound()

    const service = createServiceRoleClient()
    const { data: tenant } = await service
        .from("tenants")
        .select("currency")
        .eq("id", appUser.tenant_id)
        .maybeSingle()
    void supabase

    const currency = (tenant as { currency?: string | null } | null)?.currency ?? "INR"

    return <AggregatorWorkbench aggregator="ZOMATO" tenantCurrency={currency} />
}
