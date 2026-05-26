import { notFound } from "next/navigation"

import { getCurrentUserAndTenant } from "@/lib/auth/current-user"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { AggregatorWorkbench } from "../_components/aggregator-workbench"

/**
 * /integrations/swiggy — Swiggy partner workbench.
 *
 * The actual UI lives in <AggregatorWorkbench /> (shared with /zomato);
 * this page just resolves the tenant currency on the server so currency
 * formatting doesn't flash. Permission gate comes from the surrounding
 * (app)/integrations/layout.tsx.
 */
export default async function SwiggyIntegrationPage() {
    const { appUser, supabase } = await getCurrentUserAndTenant()
    if (!appUser?.tenant_id) notFound()

    const service = createServiceRoleClient()
    const { data: tenant } = await service
        .from("tenants")
        .select("currency")
        .eq("id", appUser.tenant_id)
        .maybeSingle()
    void supabase // helper returns it but we use service-role for the tenant lookup

    const currency = (tenant as { currency?: string | null } | null)?.currency ?? "INR"

    return <AggregatorWorkbench aggregator="SWIGGY" tenantCurrency={currency} />
}
