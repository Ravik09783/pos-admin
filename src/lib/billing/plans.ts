/**
 * Plan / tier catalog — single source of truth for what RestoPOS charges,
 * what each tier includes, what limits the tier enforces, and which Stripe
 * Price ID maps to which tier.
 *
 * Two regions, three tiers each.
 *   region: "IN" | "INTL"
 *   tier:   "starter" | "growth" | "scale"
 *
 * ──── Edit this file to change pricing or limits ─────────────────────────
 * Want a Starter plan with 5 branches? Bump `maxBranches`. Want one tier
 * to be unlimited? Set the cap to `UNLIMITED`. Want a new "Enterprise"
 * tier? Append a fourth PlanDefinition — the landing pricing grid and
 * /settings/billing picker pick it up automatically.
 *
 * On plan switch, /api/billing/set-plan resolves the chosen tier from
 * this file and mirrors `maxBranches` + `maxStaffPerBranch` to numeric
 * columns on `tenants` so the SQL enforcement function can read them
 * without re-importing TypeScript. `UNLIMITED` becomes SQL NULL.
 *
 * ──── Bypass for self-hosted / dev ───────────────────────────────────────
 * Set env var `RESTOPOS_PLAN_OVERRIDE=unlimited` to skip ALL plan
 * enforcement globally. Useful for self-hosted deployments, dev,
 * staging. See `effectivePlanOverride()` below.
 */

/** Sentinel value for "no cap" in a plan limit. Stored as SQL NULL on the
 *  tenant row, treated as "always passes" by the enforcement function. */
export const UNLIMITED = Number.POSITIVE_INFINITY

export type PlanRegion = "IN" | "INTL"
export type PlanTier   = "starter" | "growth" | "scale"

export interface PlanDefinition {
    tier: PlanTier
    /** Human label shown on the marketing card. */
    name: string
    /** Localized price prefix — "₹" or "$". */
    currencySymbol: string
    /** Monthly amount as a plain number. Render with the prefix. */
    monthlyAmount: number
    /** Hard cap on branches/outlets. Use `UNLIMITED` for no cap. */
    maxBranches: number
    /** Staff accounts per branch. As of migration 59 every tier ships
     *  `UNLIMITED` — staff seats are never capped; plans differentiate on
     *  branches/features only. The field (and its tenants mirror column)
     *  stays so a future tier could reintroduce a cap. */
    maxStaffPerBranch: number
    /** Bullet-list features for the pricing card. Region-specific where it matters. */
    features: string[]
    /** Stripe Price ID env var name. For INTL this is the recurring USD
     *  price; on India tenants we don't currently mint a Stripe sub here,
     *  so the var is still optional. */
    stripePriceIdEnvVar: string
    /** True for the middle tier — gets the highlighted card / "Most popular" badge. */
    highlight: boolean
}

const COMMON_FEATURES = [
    "Tax-compliant invoicing",
    "Realtime KDS via WebSockets",
    "QR table ordering + offline-capable POS",
    "Reports + CSV / PDF export",
] as const

export const PLANS_IN: PlanDefinition[] = [
    {
        tier: "starter",
        name: "Starter",
        currencySymbol: "₹",
        monthlyAmount: 3500,
        maxBranches: 1,
        maxStaffPerBranch: UNLIMITED,
        features: [
            "1 outlet · Unlimited staff",
            ...COMMON_FEATURES,
            "PhonePe UPI payments — money straight to your bank",
            "One-click CA Export (GSTR-1 + 3B + P&L + BS)",
            "Email support (48h)",
        ],
        stripePriceIdEnvVar: "STRIPE_PLATFORM_PRICE_ID_IN_STARTER",
        highlight: false,
    },
    {
        tier: "growth",
        name: "Growth",
        currencySymbol: "₹",
        monthlyAmount: 5000,
        maxBranches: 3,
        maxStaffPerBranch: UNLIMITED,
        features: [
            "3 outlets · Unlimited staff",
            ...COMMON_FEATURES,
            "PhonePe UPI payments — money straight to your bank",
            "One-click CA Export (GSTR-1 + 3B + P&L + BS)",
            "Swiggy / Zomato channel tagging",
            "WhatsApp + SMS alerts",
            "Chat + email support (12h)",
        ],
        stripePriceIdEnvVar: "STRIPE_PLATFORM_PRICE_ID_IN_GROWTH",
        highlight: true,
    },
    {
        tier: "scale",
        name: "Scale",
        currencySymbol: "₹",
        monthlyAmount: 10000,
        maxBranches: 10,
        maxStaffPerBranch: UNLIMITED,
        features: [
            "10 outlets · Unlimited staff",
            ...COMMON_FEATURES,
            "PhonePe UPI payments — money straight to your bank",
            "One-click CA Export (GSTR-1 + 3B + P&L + BS)",
            "Multi-branch consolidated reports",
            "Priority WhatsApp + phone support",
            "Onboarding assistance",
        ],
        stripePriceIdEnvVar: "STRIPE_PLATFORM_PRICE_ID_IN_SCALE",
        highlight: false,
    },
]

export const PLANS_INTL: PlanDefinition[] = [
    {
        tier: "starter",
        name: "Starter",
        currencySymbol: "$",
        monthlyAmount: 49,
        maxBranches: 1,
        maxStaffPerBranch: UNLIMITED,
        features: [
            "1 outlet · Unlimited staff",
            ...COMMON_FEATURES,
            "Stripe Connect — cards in 135+ currencies",
            "Live payments dashboard, payouts, disputes",
            "Email support (48h)",
        ],
        stripePriceIdEnvVar: "STRIPE_PLATFORM_PRICE_ID_INTL_STARTER",
        highlight: false,
    },
    {
        tier: "growth",
        name: "Growth",
        currencySymbol: "$",
        monthlyAmount: 99,
        maxBranches: 3,
        maxStaffPerBranch: UNLIMITED,
        features: [
            "3 outlets · Unlimited staff",
            ...COMMON_FEATURES,
            "Stripe Connect — cards in 135+ currencies",
            "Live payments dashboard, payouts, disputes",
            "Multi-currency reports",
            "Chat + email support (12h)",
        ],
        stripePriceIdEnvVar: "STRIPE_PLATFORM_PRICE_ID_INTL_GROWTH",
        highlight: true,
    },
    {
        tier: "scale",
        name: "Scale",
        currencySymbol: "$",
        monthlyAmount: 199,
        maxBranches: 10,
        maxStaffPerBranch: UNLIMITED,
        features: [
            "10 outlets · Unlimited staff",
            ...COMMON_FEATURES,
            "Stripe Connect — cards in 135+ currencies",
            "Live payments dashboard, payouts, disputes",
            "Multi-branch consolidated reports",
            "Priority email + chat support",
            "Onboarding assistance",
        ],
        stripePriceIdEnvVar: "STRIPE_PLATFORM_PRICE_ID_INTL_SCALE",
        highlight: false,
    },
]

export function getPlans(region: PlanRegion): PlanDefinition[] {
    return region === "IN" ? PLANS_IN : PLANS_INTL
}

export function findPlan(region: PlanRegion, tier: PlanTier): PlanDefinition {
    const plan = getPlans(region).find((p) => p.tier === tier)
    if (!plan) throw new Error(`Unknown plan: ${region}/${tier}`)
    return plan
}

/** Format a plan price for display. Renders "₹3,500" or "$49" — no decimals. */
export function formatPlanPrice(plan: PlanDefinition): string {
    if (plan.currencySymbol === "₹") {
        return `₹${plan.monthlyAmount.toLocaleString("en-IN")}`
    }
    return `${plan.currencySymbol}${plan.monthlyAmount}`
}

/** The Starter price used as the default "starts at" copy when we don't
 *  yet know which tier a tenant has selected. */
export function startingPrice(region: PlanRegion): string {
    return formatPlanPrice(findPlan(region, "starter"))
}

/**
 * Resolve the Stripe Price ID for a given tier by reading the env var
 * named in the plan definition. Returns `null` when the operator hasn't
 * configured a Price ID for that tier yet (e.g. a fresh deploy that
 * hasn't created Stripe products) — callers should treat that as a
 * configuration error, not a "free tier".
 */
export function getStripePriceIdForPlan(plan: PlanDefinition): string | null {
    const val = process.env[plan.stripePriceIdEnvVar]
    return val && val.trim().length > 0 ? val : null
}

/**
 * Reverse-lookup: given a Stripe Price ID we just saw in a webhook event,
 * find the matching tier in our catalog. Used by the subscription.updated
 * handler to mirror a portal-side plan change back into our DB.
 *
 * Returns `null` when no tier in either region maps to the given price —
 * which means the operator either hasn't set the matching env var, or
 * the Price ID belongs to a plan we don't sell anymore. In both cases
 * the webhook should log + skip the tier update (status still applies).
 */
export function findTierByPriceId(priceId: string): { region: PlanRegion; plan: PlanDefinition } | null {
    if (!priceId) return null
    for (const region of ["IN", "INTL"] as const) {
        for (const plan of getPlans(region)) {
            if (getStripePriceIdForPlan(plan) === priceId) {
                return { region, plan }
            }
        }
    }
    return null
}

/** True when this plan limit is configured as unlimited (UNLIMITED sentinel). */
export function isUnlimited(value: number): boolean {
    return !Number.isFinite(value)
}

/** Coerce a plan limit to the value we store in the DB. UNLIMITED → NULL. */
export function toDbLimit(value: number): number | null {
    return isUnlimited(value) ? null : value
}

/** Subscription states that map to "give them full access" — used to
 *  determine whether a tenant is on the implicit "trial = unlimited" tier
 *  or actually constrained by the plan they picked. */
type SubscriptionStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED" | null

/**
 * Resolve the limits that should apply to a tenant RIGHT NOW.
 *
 * Rules:
 *   1. If env `RESTOPOS_PLAN_OVERRIDE=unlimited` → unlimited everywhere.
 *   2. If on TRIAL → unlimited (trial users get max access regardless of
 *      what tier they later pick).
 *   3. Else: use the named tier from this file.
 *   4. If no tier is set yet (legacy / pre-migration tenant) → fall back
 *      to Starter caps so we never silently grant access we shouldn't.
 *
 * Returns the resolved {maxBranches, maxStaffPerBranch} as raw numbers
 * (UNLIMITED = Infinity, kept as a number on purpose so callers can do
 * `count < cap` and it just works).
 */
export function effectivePlanLimits(
    region: PlanRegion,
    tier: PlanTier | null,
    status: SubscriptionStatus,
): { maxBranches: number; maxStaffPerBranch: number; sourceTier: PlanTier | "trial" | "override" } {
    if (planOverrideUnlimited()) {
        return { maxBranches: UNLIMITED, maxStaffPerBranch: UNLIMITED, sourceTier: "override" }
    }
    if (status === "TRIAL") {
        return { maxBranches: UNLIMITED, maxStaffPerBranch: UNLIMITED, sourceTier: "trial" }
    }
    const plan = tier ? getPlans(region).find((p) => p.tier === tier) : null
    if (plan) {
        return { maxBranches: plan.maxBranches, maxStaffPerBranch: plan.maxStaffPerBranch, sourceTier: plan.tier }
    }
    // Defensive default: never grant more than Starter when state is unclear.
    const starter = findPlan(region, "starter")
    return { maxBranches: starter.maxBranches, maxStaffPerBranch: starter.maxStaffPerBranch, sourceTier: "starter" }
}

/** Is the global env override in effect? Read once per request — this
 *  flips the entire enforcement off, including the SQL gate (because
 *  /api/billing/set-plan + the layout pre-flight both bail out earlier).
 *  Useful for self-hosted instances where the operator wants no caps. */
export function planOverrideUnlimited(): boolean {
    return (process.env.RESTOPOS_PLAN_OVERRIDE ?? "").toLowerCase() === "unlimited"
}
