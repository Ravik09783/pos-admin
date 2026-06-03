/**
 * Canonical site identity — the single source of truth for SEO metadata,
 * `robots.txt`, the sitemap, the OpenGraph image and JSON-LD structured
 * data. Only the public landing page (`/`) is indexed; everything else
 * is the authenticated app and is excluded in `robots.ts`.
 *
 * Set `NEXT_PUBLIC_APP_URL` to the real production domain (e.g.
 * `https://restopos.app`) so canonical / OG / sitemap URLs resolve to
 * the live site instead of localhost.
 */

/** Absolute origin of the deployed site, no trailing slash. */
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000")
    .replace(/\/+$/, "")

export const SITE_NAME = "RestoPOS"

/** The keyword-bearing one-liner used as the homepage title suffix. */
export const SITE_TAGLINE = "Cloud Restaurant POS & GST Billing Software"

/** ~160-char meta description — keyword-rich but readable. */
export const SITE_DESCRIPTION =
    "RestoPOS is a cloud restaurant POS & billing software — fast invoicing, "
    + "QR table ordering, a realtime kitchen display (KDS), GST / VAT / "
    + "sales-tax-ready bills, UPI & card payments, loyalty, gift cards and "
    + "AI-style analytics. Run one cafe or a whole chain. Start a free trial."

/**
 * Keyword set surfaced as `<meta name="keywords">` and reflected through
 * the JSON-LD. Search engines weight on-page content far more than this
 * tag, but it's a harmless, explicit signal for Bing and niche crawlers.
 */
export const SITE_KEYWORDS: string[] = [
    "restaurant POS", "restaurant point of sale", "cloud POS",
    "cloud restaurant POS", "restaurant billing software",
    "restaurant management software", "restaurant management system",
    "POS software", "POS system", "billing software for restaurants",
    "GST billing software", "GST POS", "GST invoice software",
    "tax invoice software", "VAT billing software", "sales tax POS",
    "restaurant POS India", "POS software for restaurants", "online POS",
    "web based POS", "browser POS", "POS billing", "billing machine for restaurant",
    "QR menu", "QR code menu", "QR table ordering", "scan to order",
    "contactless ordering", "kitchen display system", "KDS",
    "kitchen order ticket", "KOT", "restaurant invoicing",
    "UPI payments", "PhonePe POS", "PhonePe UPI", "card payments restaurant",
    "cafe POS", "bar POS", "QSR POS", "quick service restaurant software",
    "fine dining POS", "cloud kitchen software", "cloud kitchen POS",
    "dhaba billing software", "hotel POS", "takeaway POS", "food court POS",
    "multi branch restaurant software", "multi outlet POS",
    "restaurant chain software", "table management software",
    "restaurant CRM", "customer loyalty program", "loyalty and rewards",
    "gift card software", "coupon management", "restaurant analytics",
    "sales analytics", "demand forecasting", "restaurant inventory management",
    "stock management", "recipe management", "CA export", "accountant export",
    "offline billing POS", "Petpooja alternative", "restaurant software",
    "food business software", "multi country POS", "VAT POS",
]

/** The product capabilities — used in JSON-LD `featureList` and the OG image. */
export const SITE_FEATURES: string[] = [
    "Fast restaurant billing & tax invoices",
    "QR code table ordering — scan to order",
    "Realtime kitchen display system (KDS)",
    "Country-aware tax engine — GST, VAT & sales tax in 30+ countries",
    "PhonePe UPI, card & cash payments with auto-confirmation",
    "Multi-branch / multi-outlet management",
    "Loyalty, gift cards & coupons",
    "Sales analytics & AI-style demand forecasting",
    "Inventory & recipe management",
    "Offline-capable billing",
    "One-click CA / accountant export",
]

/**
 * Landing-page FAQ — the SINGLE source for both the visible FAQ section
 * (`_landing/landing.tsx`) and the `FAQPage` JSON-LD on `/`. Keeping them
 * in one place means the structured data always matches what's actually
 * on the page (a Google requirement) — edit a question here and both
 * update together.
 */
export const SITE_FAQ: ReadonlyArray<{ q: string; a: string }> = [
    { q: "Is there a free trial?", a: "Yes — 30 days, no credit card required. After the trial you can pick a plan or downgrade to a free read-only mode." },
    { q: "Does this work outside India?", a: "Yes. Pick your country at sign-up and we configure the tax model (GST, VAT, sales tax…), currency and fiscal year for you. We ship tax data for India, the US (all 50 states + DC), Canada, the UK, the EU (France, Germany, Italy, Spain, Netherlands and more), the Gulf, Australia, Singapore and others — bills and the customer QR menu use the right wording and currency automatically. The one-click CA Export bundle (GSTR-1/3B, Tally) is India-specific; everything else works everywhere." },
    { q: "Will my CA / accountant need to learn new software? (India)", a: "Nope. The CA Export gives them familiar Excel sheets, Tally-importable XML, and the GST portal JSON. They can use whatever tools they already use." },
    { q: "Can I use this on a phone?", a: "Yes. Every page is mobile-responsive. Some restaurants run their POS entirely off Android tablets and waiters take orders on phones." },
    { q: "What about hardware — printers, cash drawers?", a: "Standard ESC/POS thermal printers (58mm or 80mm) work via Web Bluetooth, USB, or LAN. Cash drawers connect via the printer." },
    { q: "Is my data safe?", a: "Yes. Multi-tenant isolation is enforced at the database level via Supabase RLS — staff can never see another restaurant's data, even via a malicious SQL query. All payments are via verified webhook signatures." },
    { q: "How do payments work — does the money come to me?", a: "Yes, directly. In India you connect your own PhonePe Business account (free) — paste your MID + Merchant Key into our settings, and customers pay you by UPI. Money lands in your bank account; we never touch the funds. UPI is 0% MDR (effectively free)." },
    { q: "What happens if my internet drops mid-shift?", a: "We're a PWA — recently-cached pages keep working. Orders queued offline sync when you reconnect. For real-money transactions you'll need internet, same as any UPI flow." },
    { q: "Can I export my data?", a: "Yes. Every list page has CSV export. The CA Export gives you bulk Excel/Tally/JSON for monthly filings. You own all your data; we'll never lock you in." },
]
