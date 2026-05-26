/**
 * Country-driven payment gateway selection.
 *
 * The platform supports one UPI gateway, one card gateway, and a manual
 * fallback:
 *
 *   - Paytm (UPI QR)    — India: the customer scans a Paytm dynamic UPI
 *                         QR and pays from ANY UPI app (Google Pay,
 *                         PhonePe, Paytm, BHIM); the Paytm webhook
 *                         auto-confirms. Each restaurant connects its OWN
 *                         Paytm for Business account, so money settles
 *                         straight to the restaurant's bank.
 *   - Stripe (Connect)  — best coverage everywhere else: cards in 135+
 *                         currencies, automatic FX, mature payouts.
 *   - Manual UPI        — Indian fallback for restaurants that haven't
 *                         connected Paytm; the customer pays to a plain
 *                         UPI ID and uploads a screenshot staff verifies.
 *
 * Rather than forcing each admin to pick the right one, we infer the
 * default from the restaurant's country. Indian restaurants → Paytm,
 * everyone else → Stripe. Indian admins can still opt into "manual" via
 * the settings page, but we don't expose a "use Stripe in India" or
 * "use Paytm outside India" choice because both would be expensive
 * footguns (FX losses + much higher fees).
 *
 * One helper, one source of truth, used by:
 *   - The QR menu API (decides which gateway to advertise to the customer page)
 *   - The QR place-order API (issues a Paytm UPI QR or a Stripe Checkout session)
 *   - The POS bill payment routes
 *   - The admin settings page (shows only the relevant section)
 */

import { getTaxConfig } from "@/lib/tax/locale-config"

/** What we route a given transaction through. */
export type PaymentGateway = "paytm" | "stripe" | "manual"

/**
 * The gateway a restaurant in this country should use by default.
 * Doesn't consider whether the restaurant has actually configured it —
 * that's the readiness check, done separately by the route.
 */
export function getGatewayForCountry(country: string | null | undefined): PaymentGateway {
    const cfg = getTaxConfig(country)
    // India is the only country where Paytm (UPI) is the right default.
    // We route by tax-locale code so any country-name string the
    // onboarding flow accepts ("India", "INDIA", "in") resolves correctly.
    return cfg.code === "IN" ? "paytm" : "stripe"
}

/**
 * Resolve the gateway a tenant actually wants to use this transaction.
 *
 * The tenant.payment_gateway column lets an Indian admin force "manual"
 * (plain UPI screenshot flow) instead of Paytm. Outside India the column
 * is ignored — there's no point letting a UK restaurant pick "manual
 * UPI". That's by design.
 */
export function resolveGateway(
    country: string | null | undefined,
    adminChoice: string | null | undefined,
): PaymentGateway {
    const def = getGatewayForCountry(country)
    // Indian restaurants can override Paytm → manual; everyone else gets
    // the auto-determined gateway regardless of what's in the column.
    // This prevents accidental misconfiguration (e.g. a UK restaurant
    // flipping to "paytm" — Paytm is India-only).
    if (def === "paytm" && adminChoice === "manual") return "manual"
    return def
}

/**
 * Human-readable label for the gateway. Used in admin UI.
 */
export function gatewayLabel(g: PaymentGateway): string {
    switch (g) {
        case "paytm":  return "Paytm UPI"
        case "stripe": return "Stripe"
        case "manual": return "Manual UPI"
    }
}
