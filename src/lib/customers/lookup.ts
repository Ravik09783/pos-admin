import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Phone-shape gate used by every customer auto-lookup in the app.
 *
 * Returns true when the input looks plausibly like a phone number:
 * 7-15 digits, optional leading "+", spaces and hyphens stripped. The
 * minimum 7 is what keeps us from firing a Supabase query while the
 * cashier is still typing "9876".
 */
export function isPhoneShaped(raw: string): boolean {
    return /^\+?\d{7,15}$/.test(raw.replace(/[\s-]/g, ""))
}

/** Lightweight customer row returned by the lookup. Email is included
 *  so the checkout dialog can auto-fill the receipts/marketing
 *  email field too; loyalty fields stay on the POS-side find/add
 *  control which surfaces tier + points. */
export interface CustomerLookupResult {
    id: string
    name: string | null
    email: string | null
    loyalty_points: number
    loyalty_tier: string
}

/**
 * Read-only phone → customer lookup. Returns the matched row or null.
 * Never creates a row — every transient digit a cashier types would
 * otherwise pollute the customers table. Creation happens via the
 * explicit Find/Add button (POS) or the bill-generation upsert.
 *
 * Soft-deleted rows are excluded so a churned customer doesn't
 * silently re-attach to a new sale.
 */
export async function findCustomerByPhone(
    supabase: SupabaseClient,
    phone: string,
): Promise<CustomerLookupResult | null> {
    const trimmed = phone.trim()
    if (!trimmed) return null
    const { data } = await supabase
        .from("customers")
        .select("id, name, email, loyalty_points, loyalty_tier")
        .eq("phone", trimmed)
        .is("deleted_at", null)
        .maybeSingle()
    return (data as CustomerLookupResult | null) ?? null
}
