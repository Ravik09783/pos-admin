import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { getTaxConfig } from "@/lib/tax/locale-config"

/**
 * `/setup-guide` — country router. Reads the calling tenant's
 * `country` and forwards to the matching guide. Indian tenants land
 * on the GST + Paytm path; everyone else lands on the Stripe
 * Connect path. The two guide pages themselves remain directly
 * addressable (`/setup-guide/india`, `/setup-guide/international`)
 * for support links, screenshots, and the "I want to see the other
 * region" case.
 *
 * Server-side decision so the user never sees a flash of the wrong
 * page — the redirect happens before any HTML ships.
 */
export default async function SetupGuideIndexPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/login")

    const { data } = await supabase
        .from("users")
        .select("tenant:tenants(country)")
        .eq("id", user.id)
        .maybeSingle()

    const country = ((data as { tenant?: { country?: string } | { country?: string }[] } | null)?.tenant)
    const c = Array.isArray(country) ? country[0]?.country : country?.country
    const region = getTaxConfig(c ?? null).code === "IN" ? "india" : "international"
    redirect(`/setup-guide/${region}`)
}
