/**
 * Aggregator catalog — branding, partner-program URLs, default commission
 * ranges and the integration playbook for each food-delivery aggregator
 * we support tagging at the POS. Used by:
 *
 *   - `/integrations/[aggregator]` page route (Swiggy + Zomato today)
 *   - The shared <AggregatorWorkbench> client component
 *   - The dashboard's existing AggregatorTeaserCard (long-term)
 *
 * The aggregator keys MUST match the orders.order_source enum values
 * defined in migration 04 (`SWIGGY`, `ZOMATO`, …) AND the check
 * constraint on `aggregator_integrations.aggregator` from migration 49.
 * If you add a new key here, add it to both SQL constraints too.
 */

export type AggregatorKey = "SWIGGY" | "ZOMATO" | "DOORDASH" | "UBER_EATS" | "MAGICPIN"

export interface AggregatorMeta {
    key: AggregatorKey
    /** Display name, branded. */
    label: string
    /** One-line elevator pitch shown under the page title. */
    blurb: string
    /** Two-letter tone class hint for the brand strip; we don't paste in
     *  their real logos to avoid trademark issues — a coloured tile + the
     *  first letter reads as their brand without ripping their mark. */
    brandColor: string
    brandTextColor: string
    /** Markets the aggregator actually operates in. We use this on the
     *  dashboard teaser to hide aggregators that don't make sense for
     *  the tenant's country. */
    countries: string[]
    /** Real partner-program URLs (not generic homepages). These are the
     *  ones an admin needs to bookmark + apply to. */
    partnerProgramUrl: string
    partnerPortalUrl: string
    /** Realistic onboarding time the admin should expect — drives the
     *  "what to expect" copy on the page header. */
    onboardingExpectation: string
    /** Typical commission band in India today (2026). Stored as a hint
     *  next to the commission input field — actual rate goes in the
     *  per-tenant aggregator_integrations row. */
    typicalCommissionPct: { low: number; high: number }
    /** Third-party POS-integration bridges that DO offer a paste-an-API-
     *  key flow today (because they have their own partner agreements
     *  with the aggregator). Most multi-outlet brands use one of these
     *  rather than apply for a direct POS Connect program. */
    bridges: { name: string; url: string; note: string }[]
}

export const AGGREGATORS: Record<AggregatorKey, AggregatorMeta> = {
    SWIGGY: {
        key: "SWIGGY",
        label: "Swiggy",
        blurb: "India's largest food-delivery platform. Track every Swiggy order alongside your direct sales, reconcile fortnightly payouts, and watch commission impact in real time.",
        brandColor: "#FC8019",     // Swiggy orange
        brandTextColor: "#ffffff",
        countries: ["IN"],
        partnerProgramUrl: "https://partner.swiggy.com",
        partnerPortalUrl:  "https://partner.swiggy.com",
        onboardingExpectation: "7–30 days for marketplace listing, 60–120 days for direct POS integration.",
        typicalCommissionPct: { low: 18, high: 30 },
        bridges: [
            { name: "UrbanPiper",      url: "https://urbanpiper.com",         note: "Most common Swiggy ↔ POS bridge in India. Per-outlet monthly fee." },
            { name: "Petpooja Bridge", url: "https://petpooja.com",            note: "Free for Petpooja POS users; can be used standalone too." },
            { name: "MagicPin Reach",  url: "https://magicpin.in/business",   note: "Aggregates multiple platforms into one feed." },
        ],
    },
    ZOMATO: {
        key: "ZOMATO",
        label: "Zomato",
        blurb: "Zomato Restaurant Partner — orders, menu sync, and payout reconciliation. Manage online + dine-in inventory from one POS.",
        brandColor: "#E23744",     // Zomato red
        brandTextColor: "#ffffff",
        countries: ["IN", "AE"],
        partnerProgramUrl: "https://restaurant.zomato.com",
        partnerPortalUrl:  "https://www.zomato.com/partners/restaurant-partner-portal",
        onboardingExpectation: "10–45 days for marketplace listing, partner-tier dependent for POS integration.",
        typicalCommissionPct: { low: 18, high: 28 },
        bridges: [
            { name: "UrbanPiper",      url: "https://urbanpiper.com",  note: "Industry-standard Zomato ↔ POS bridge." },
            { name: "Petpooja Bridge", url: "https://petpooja.com",     note: "Same bridge service as Swiggy; one contract covers both." },
            { name: "Limetray",        url: "https://www.limetray.com", note: "Aggregator + reservations bridge, India-focused." },
        ],
    },
    DOORDASH: {
        key: "DOORDASH",
        label: "DoorDash",
        blurb: "DoorDash Marketplace + Drive — US, Canada and Australia.",
        brandColor: "#FF3008",
        brandTextColor: "#ffffff",
        countries: ["US", "CA", "AU"],
        partnerProgramUrl: "https://get.doordash.com",
        partnerPortalUrl:  "https://merchant-portal.doordash.com",
        onboardingExpectation: "Under 7 days for self-serve onboarding in supported regions.",
        typicalCommissionPct: { low: 15, high: 30 },
        bridges: [
            { name: "Otter",     url: "https://www.tryotter.com",  note: "Most popular DoorDash ↔ POS bridge in the US." },
            { name: "Chowly",    url: "https://chowly.com",         note: "Order + menu sync. US + Canada." },
        ],
    },
    UBER_EATS: {
        key: "UBER_EATS",
        label: "Uber Eats",
        blurb: "Uber Eats Merchant — global delivery platform with self-serve onboarding in most markets.",
        brandColor: "#06C167",
        brandTextColor: "#ffffff",
        countries: ["US", "CA", "AU", "GB", "FR", "IN"],
        partnerProgramUrl: "https://merchants.ubereats.com",
        partnerPortalUrl:  "https://merchants.ubereats.com",
        onboardingExpectation: "1–7 days for marketplace, longer for API integration via Uber Direct.",
        typicalCommissionPct: { low: 15, high: 30 },
        bridges: [
            { name: "Otter",     url: "https://www.tryotter.com",  note: "Same Otter account works across Uber Eats + DoorDash." },
            { name: "Chowly",    url: "https://chowly.com",         note: "Multi-aggregator feed → POS." },
        ],
    },
    MAGICPIN: {
        key: "MAGICPIN",
        label: "MagicPin",
        blurb: "MagicPin — India-focused discovery + delivery. Lower commission than Swiggy/Zomato.",
        brandColor: "#8E44AD",
        brandTextColor: "#ffffff",
        countries: ["IN"],
        partnerProgramUrl: "https://magicpin.in/business",
        partnerPortalUrl:  "https://magicpin.in/business",
        onboardingExpectation: "Typically under 14 days for listing.",
        typicalCommissionPct: { low: 8, high: 18 },
        bridges: [
            { name: "Native API", url: "https://magicpin.in/business", note: "MagicPin has direct REST APIs without a third-party bridge for partners on their POS-Connect tier." },
        ],
    },
} as const

/** Status values stored on `aggregator_integrations.status`. */
export type AggregatorStatus = "NOT_CONNECTED" | "APPLICATION_PENDING" | "MANUAL_TRACKING" | "CONNECTED"

export const STATUS_LABELS: Record<AggregatorStatus, { label: string; description: string; tone: "muted" | "warning" | "primary" | "success" }> = {
    NOT_CONNECTED: {
        label: "Not connected",
        description: "No integration set up yet. Tag orders manually at the POS to start tracking.",
        tone: "muted",
    },
    APPLICATION_PENDING: {
        label: "Application pending",
        description: "Partner application submitted, awaiting approval from the aggregator.",
        tone: "warning",
    },
    MANUAL_TRACKING: {
        label: "Manual tracking",
        description: "Live: cashiers tag the order source at the POS so payouts reconcile cleanly.",
        tone: "primary",
    },
    CONNECTED: {
        label: "Connected (API)",
        description: "Live: orders flow into the KDS automatically, menus stay in sync, payouts auto-reconcile.",
        tone: "success",
    },
}
