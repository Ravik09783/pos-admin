/**
 * Country-driven payment gateway selection.
 *
 * The platform supports one UPI gateway, one card gateway, and a manual
 * fallback:
 *
 *   - PhonePe (UPI QR)  — India: the customer scans a PhonePe dynamic UPI
 *                         QR or taps an intent link that opens any UPI
 *                         app (Google Pay, PhonePe, PhonePe, BHIM); the
 *                         PhonePe webhook auto-confirms. Each restaurant
 *                         connects its OWN PhonePe Business account, so
 *                         money settles straight to the restaurant's
 *                         bank. (Phase 2 of the gateway rework — until
 *                         PhonePe is wired up, this slot effectively
 *                         falls through to `manual`.)
 *   - Stripe (Connect)  — best coverage everywhere else: cards in 135+
 *                         currencies, automatic FX, mature payouts.
 *   - Manual UPI        — Indian fallback for restaurants that haven't
 *                         connected PhonePe; the customer pays to a plain
 *                         UPI ID and uploads a screenshot staff verifies.
 *
 * Rather than forcing each admin to pick the right one, we infer the
 * default from the restaurant's country. Indian restaurants → PhonePe,
 * everyone else → Stripe. Indian admins can still opt into "manual" via
 * the settings page, but we don't expose a "use Stripe in India" or
 * "use PhonePe outside India" choice because both would be expensive
 * footguns (FX losses + much higher fees).
 *
 * One helper, one source of truth, used by:
 *   - The QR menu API (decides which gateway to advertise to the customer page)
 *   - The QR place-order API (issues a PhonePe UPI QR or a Stripe Checkout session)
 *   - The POS bill payment routes
 *   - The admin settings page (shows only the relevant section)
 */

import { getTaxConfig } from "@/lib/tax/locale-config"

/** What we route a given transaction through. */
export type PaymentGateway = "phonepe" | "paytm" | "stripe" | "manual"

/**
 * The gateway a restaurant in this country should use by default.
 * Doesn't consider whether the restaurant has actually configured it —
 * that's the readiness check, done separately by the route.
 */
export function getGatewayForCountry(country: string | null | undefined): PaymentGateway {
    const cfg = getTaxConfig(country)
    // India is the only country where PhonePe (UPI) is the right default.
    // We route by tax-locale code so any country-name string the
    // onboarding flow accepts ("India", "INDIA", "in") resolves correctly.
    return cfg.code === "IN" ? "phonepe" : "stripe"
}

/**
 * Resolve the gateway a tenant actually wants to use this transaction.
 *
 * The tenant.payment_gateway column lets an Indian admin force "manual"
 * (plain UPI screenshot flow) instead of PhonePe. Outside India the
 * column is ignored — there's no point letting a UK restaurant pick
 * "manual UPI". That's by design.
 */
export function resolveGateway(
    country: string | null | undefined,
    adminChoice: string | null | undefined,
): PaymentGateway {
    const def = getGatewayForCountry(country)
    // Indian restaurants pick exactly ONE of the India methods — PhonePe
    // (auto), Paytm (auto), or manual UPI. The admin's stored choice is the
    // single source of truth; we only constrain it to the valid India set so
    // a bad value can't route a UK restaurant through PhonePe.
    if (def === "phonepe") {
        if (adminChoice === "manual") return "manual"
        if (adminChoice === "paytm") return "paytm"
        return "phonepe"
    }
    // Outside India the column is ignored — Stripe is the only sane option.
    return def
}

/**
 * Human-readable label for the gateway. Used in admin UI.
 */
export function gatewayLabel(g: PaymentGateway): string {
    switch (g) {
        case "phonepe": return "PhonePe UPI"
        case "paytm":   return "Paytm UPI"
        case "stripe":  return "Stripe"
        case "manual":  return "Manual UPI"
    }
}
