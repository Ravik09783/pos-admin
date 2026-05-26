/**
 * Bill-format catalog.
 *
 * A restaurant picks a *format* (a named preset) for its printed bills. Each
 * format is a `BillTemplate` — a human label + category + a full `BillDesign`
 * config. Formats carry region metadata so the Bill Designer can:
 *   - show the ones that make sense in the restaurant's country (`regions`)
 *   - highlight the ones that are the natural default there (`recommendedFor`)
 *
 * The country-specific layouts (India GST, EU VAT, Gulf bilingual, US guest
 * check…) live in the `region` category. Everything else (`thermal`, `a4`,
 * `boutique`, `qsr`) is region-neutral and available everywhere.
 *
 * Stored in `tenants.settings.bill_design` (the resolved design) and
 * `tenants.settings.bill_template_id` (which preset they started from).
 */

export type BillLayout =
    | "thermal-classic"   // dashed rules, centered header — the familiar kirana/POS slip
    | "thermal-modern"    // clean rules, bold totals — sans by default
    | "invoice-a4"        // full-page tax invoice: "TAX INVOICE" banner, bordered item table
    | "invoice-grid"      // lighter A4/A5 invoice: hairline grid, seller/buyer blocks
    | "card-boutique"     // narrow elegant card — serif, accent rule — cafés & fine dining
    | "qsr-token"         // big order token up top — counter-service / kiosk / drive-thru

export type BillPaper = "58mm" | "80mm" | "A5" | "A4"
export type BillFont = "mono" | "sans" | "serif"
export type BillDensity = "compact" | "normal" | "roomy"

export interface BillDesign {
    layout: BillLayout
    width: BillPaper
    font: BillFont
    density: BillDensity
    /** Header band / accent-rule colour (hex). */
    accent_color: string
    show_logo: boolean
    /** Print the merchant's tax-registration number on the header (label is
     *  resolved from the country — GSTIN / VAT No. / TRN / EIN…). */
    show_tax_id: boolean
    /** India only — printed only when the tenant actually has an FSSAI. */
    show_fssai: boolean
    /** India only — HSN/SAC code per line. */
    show_hsn: boolean
    /** Line serial numbers (1, 2, 3…). */
    show_serial: boolean
    /** Per-line tax-rate column. */
    show_item_tax_col: boolean
    /** Whether to print any tax lines at all (off → tax-free / composition bill). */
    show_tax_breakup: boolean
    /** When tax is shown: split CGST+SGST (India intra-state) vs one combined line. */
    tax_breakup: "split" | "combined"
    /** Show the service-charge line when one applies. */
    show_service_charge_line: boolean
    /** Verification QR (links to the public bill page). */
    show_qr_verify: boolean
    /** India — a UPI "scan to pay" QR at the bottom. */
    show_qr_upi: boolean
    upi_id: string
    /** Mirror the header / key labels in Arabic (Gulf bilingual invoices). */
    bilingual_ar: boolean
    footer_message: string
}

export interface BillTemplate {
    id: string
    name: string
    /** One-line description shown under the name in the picker. */
    blurb: string
    category: BillCategory
    /** ISO-3166 alpha-2 codes where this format is appropriate, or "GLOBAL". */
    regions: "GLOBAL" | string[]
    /** ISO codes for which this is a *suggested* default (subset of regions). */
    recommendedFor: string[]
    design: BillDesign
}

export type BillCategory = "region" | "thermal" | "a4" | "boutique" | "qsr"

export const BILL_CATEGORIES: { key: BillCategory; label: string; blurb: string }[] = [
    { key: "region", label: "Country-specific layouts", blurb: "Built around the invoice rules & wording of a particular country." },
    { key: "thermal", label: "Thermal receipts (58 / 80 mm)", blurb: "For ESC/POS thermal printers — the slip your customer walks away with." },
    { key: "a4", label: "A4 / A5 tax invoices", blurb: "Full-page invoices for email, B2B customers or filing." },
    { key: "boutique", label: "Café & fine-dining", blurb: "Elegant, minimal, brand-forward — for cafés, bistros and upscale dining." },
    { key: "qsr", label: "Quick-service & kiosk", blurb: "Counter-service, drive-thru and self-order — big order token, fast to read." },
]

// ── Small builder so the 40+ presets stay readable. Everything not passed
//    falls back to a sensible base. ─────────────────────────────────────────
const BASE: BillDesign = {
    layout: "thermal-modern",
    width: "80mm",
    font: "sans",
    density: "normal",
    accent_color: "#1F4E78",
    show_logo: true,
    show_tax_id: true,
    show_fssai: false,
    show_hsn: false,
    show_serial: true,
    show_item_tax_col: false,
    show_tax_breakup: true,
    tax_breakup: "combined",
    show_service_charge_line: true,
    show_qr_verify: true,
    show_qr_upi: false,
    upi_id: "",
    bilingual_ar: false,
    footer_message: "Thank you — please visit again!",
}

function d(over: Partial<BillDesign>): BillDesign {
    return { ...BASE, ...over }
}

export const DEFAULT_DESIGN: BillDesign = d({})

// =========================================================================
//  THE CATALOG
// =========================================================================
export const BILL_TEMPLATES: BillTemplate[] = [
    // ── Country-specific layouts ───────────────────────────────────────────
    {
        id: "in-gst-thermal", name: "India · GST thermal slip", category: "region",
        blurb: "80 mm receipt with GSTIN, FSSAI, HSN and the CGST + SGST split — plus a UPI pay QR.",
        regions: ["IN"], recommendedFor: ["IN"],
        design: d({ layout: "thermal-classic", width: "80mm", font: "mono", show_tax_id: true, show_fssai: true, show_hsn: true, show_tax_breakup: true, tax_breakup: "split", show_item_tax_col: true, show_qr_upi: true, footer_message: "Thank you! GST included as shown above." }),
    },
    {
        id: "in-gst-a4", name: "India · GST A4 Tax Invoice", category: "region",
        blurb: "Full-page GST tax invoice — HSN-wise, CGST/SGST/IGST columns, ready for your CA.",
        regions: ["IN"], recommendedFor: ["IN"],
        design: d({ layout: "invoice-a4", width: "A4", font: "sans", show_tax_id: true, show_fssai: true, show_hsn: true, show_item_tax_col: true, tax_breakup: "split", footer_message: "This is a computer-generated GST invoice." }),
    },
    {
        id: "in-composition", name: "India · Composition-scheme bill", category: "region",
        blurb: "Bill of supply — no tax collected, with the mandatory composition-dealer declaration.",
        regions: ["IN"], recommendedFor: [],
        design: d({ layout: "thermal-classic", width: "80mm", font: "mono", show_tax_id: true, show_tax_breakup: false, show_item_tax_col: false, footer_message: "Composition taxable person — not eligible to collect tax on supplies." }),
    },
    {
        id: "eu-vat-invoice", name: "EU · VAT invoice", category: "region",
        blurb: "A4 invoice with sequential number, VAT number, per-line VAT rate and a VAT-rate summary.",
        regions: ["DE", "FR", "IT", "ES", "NL", "BE", "IE", "AT", "PT", "SE", "DK", "FI", "GR", "PL", "CZ", "HU"],
        recommendedFor: ["DE", "FR", "IT", "ES", "NL", "BE", "IE", "AT", "PT", "PL", "CZ", "HU", "GR", "SE", "DK", "FI"],
        design: d({ layout: "invoice-grid", width: "A4", font: "sans", show_tax_id: true, show_item_tax_col: true, tax_breakup: "combined", show_serial: true, footer_message: "VAT invoice — please retain for your records." }),
    },
    {
        id: "uk-vat-receipt", name: "UK · VAT receipt", category: "region",
        blurb: "80 mm receipt with your VAT number and the VAT total broken out — HMRC-friendly.",
        regions: ["GB", "IE"], recommendedFor: ["GB"],
        design: d({ layout: "thermal-modern", width: "80mm", font: "sans", show_tax_id: true, tax_breakup: "combined", show_item_tax_col: true, footer_message: "VAT receipt. Thank you for your custom." }),
    },
    {
        id: "gulf-bilingual-vat", name: "Gulf · Bilingual VAT invoice (AR / EN)", category: "region",
        blurb: "A4 tax invoice with Arabic + English header, TRN, and the 5% / 15% VAT line — UAE & KSA.",
        regions: ["AE", "SA"], recommendedFor: ["AE", "SA"],
        design: d({ layout: "invoice-a4", width: "A4", font: "sans", show_tax_id: true, bilingual_ar: true, tax_breakup: "combined", show_item_tax_col: true, footer_message: "Tax Invoice / فاتورة ضريبية" }),
    },
    {
        id: "us-guest-check", name: "US · Guest check (tip line)", category: "region",
        blurb: "80 mm check with a single Sales Tax line and a printed tip / total line for the guest.",
        regions: ["US"], recommendedFor: ["US"],
        design: d({ layout: "thermal-modern", width: "80mm", font: "sans", show_tax_id: false, tax_breakup: "combined", show_item_tax_col: false, show_qr_verify: false, footer_message: "Tip: __________   Total: __________\nThank you — see you soon!" }),
    },
    {
        id: "ca-bilingual-check", name: "Canada · Bilingual check (EN / FR)", category: "region",
        blurb: "80 mm receipt with one combined GST/HST line and English + French totals.",
        regions: ["CA"], recommendedFor: ["CA"],
        design: d({ layout: "thermal-modern", width: "80mm", font: "sans", show_tax_id: true, tax_breakup: "combined", show_item_tax_col: false, footer_message: "Merci / Thank you" }),
    },
    {
        id: "au-tax-invoice", name: "Australia / NZ · Tax invoice (GST)", category: "region",
        blurb: "A4 'Tax Invoice' with your ABN/GST number and the GST total — 10% AU / 15% NZ.",
        regions: ["AU", "NZ"], recommendedFor: ["AU", "NZ"],
        design: d({ layout: "invoice-grid", width: "A4", font: "sans", show_tax_id: true, tax_breakup: "combined", show_item_tax_col: true, footer_message: "Tax Invoice — total includes GST." }),
    },
    {
        id: "za-vat-invoice", name: "South Africa · VAT invoice", category: "region",
        blurb: "A4 VAT invoice with your VAT number and the 15% VAT line broken out.",
        regions: ["ZA"], recommendedFor: ["ZA"],
        design: d({ layout: "invoice-grid", width: "A4", font: "sans", show_tax_id: true, tax_breakup: "combined", show_item_tax_col: true, footer_message: "VAT Invoice. Thank you." }),
    },
    {
        id: "sg-gst-receipt", name: "Singapore / Malaysia · GST receipt (svc + tax)", category: "region",
        blurb: "80 mm receipt that lists the service charge first, then GST/SST on top — the local norm.",
        regions: ["SG", "MY"], recommendedFor: ["SG", "MY"],
        design: d({ layout: "thermal-modern", width: "80mm", font: "sans", show_tax_id: true, show_service_charge_line: true, tax_breakup: "combined", footer_message: "Prices subject to service charge & GST as shown." }),
    },
    {
        id: "generic-no-tax", name: "Tax-free receipt", category: "region",
        blurb: "Clean 80 mm receipt with no tax line — for no-VAT jurisdictions or unregistered sellers.",
        regions: "GLOBAL", recommendedFor: ["OTHER"],
        design: d({ layout: "thermal-modern", width: "80mm", font: "sans", show_tax_id: false, show_tax_breakup: false, show_item_tax_col: false, footer_message: "Thank you — please visit again!" }),
    },

    // ── Thermal receipts ───────────────────────────────────────────────────
    {
        id: "thermal-classic-80", name: "Classic 80 mm", category: "thermal",
        blurb: "The familiar POS slip — monospace, dashed dividers, centered header.",
        regions: "GLOBAL", recommendedFor: ["IN"],
        design: d({ layout: "thermal-classic", width: "80mm", font: "mono" }),
    },
    {
        id: "thermal-classic-58", name: "Classic 58 mm", category: "thermal",
        blurb: "Same classic look, squeezed onto a 58 mm roll for compact printers.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "thermal-classic", width: "58mm", font: "mono", density: "compact", show_serial: false }),
    },
    {
        id: "thermal-modern-80", name: "Modern 80 mm", category: "thermal",
        blurb: "Clean sans-serif, hairline rules, bold total — a contemporary receipt.",
        regions: "GLOBAL", recommendedFor: ["GB", "AE", "SA", "AU", "NZ", "SG", "MY", "ZA", "US", "CA"],
        design: d({ layout: "thermal-modern", width: "80mm", font: "sans" }),
    },
    {
        id: "thermal-modern-58", name: "Modern 58 mm", category: "thermal",
        blurb: "The modern receipt at 58 mm — tight, legible, no clutter.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "thermal-modern", width: "58mm", font: "sans", density: "compact" }),
    },
    {
        id: "thermal-minimal", name: "Minimalist 80 mm", category: "thermal",
        blurb: "No logo, no serials — just the essentials with generous spacing.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "thermal-modern", width: "80mm", font: "sans", density: "roomy", show_logo: false, show_serial: false }),
    },
    {
        id: "thermal-bold-totals", name: "Bold-totals 80 mm", category: "thermal",
        blurb: "Everything subdued except the grand total, which is impossible to miss.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "thermal-modern", width: "80mm", font: "sans", show_item_tax_col: false }),
    },
    {
        id: "thermal-detailed", name: "Detailed 80 mm (tax column)", category: "thermal",
        blurb: "Adds a per-line tax-rate column for customers who want the full breakdown.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "thermal-classic", width: "80mm", font: "mono", show_item_tax_col: true }),
    },
    {
        id: "thermal-eco-58", name: "Eco compact 58 mm", category: "thermal",
        blurb: "Shortest possible slip — no logo, no QR, compact spacing. Saves paper.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "thermal-modern", width: "58mm", font: "sans", density: "compact", show_logo: false, show_qr_verify: false }),
    },
    {
        id: "thermal-logo-banner", name: "Logo-banner 80 mm", category: "thermal",
        blurb: "Big centered logo and an accent rule under the restaurant name.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "thermal-modern", width: "80mm", font: "sans", show_logo: true, accent_color: "#0F766E" }),
    },
    {
        id: "thermal-accent-line", name: "Accent-line 80 mm", category: "thermal",
        blurb: "A thin colour rule frames the totals block — a touch of brand on a plain slip.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "thermal-modern", width: "80mm", font: "sans", accent_color: "#7C3AED" }),
    },
    {
        id: "thermal-cafe-slip", name: "Café slip 80 mm", category: "thermal",
        blurb: "Serif headings on a thermal slip — warmer than the usual receipt.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "thermal-modern", width: "80mm", font: "serif", density: "roomy", show_serial: false }),
    },
    {
        id: "thermal-simple-no-tax", name: "Simple receipt (no tax line)", category: "thermal",
        blurb: "Items, total, thank-you — nothing else. For tax-exempt sales.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "thermal-modern", width: "80mm", font: "sans", show_tax_breakup: false, show_item_tax_col: false }),
    },

    // ── A4 / A5 invoices ───────────────────────────────────────────────────
    {
        id: "a4-tax-invoice", name: "A4 Tax Invoice (classic)", category: "a4",
        blurb: "'TAX INVOICE' banner, bordered item table, totals block — the dependable default.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "invoice-a4", width: "A4", font: "sans", show_item_tax_col: true }),
    },
    {
        id: "a5-tax-invoice", name: "A5 Tax Invoice", category: "a4",
        blurb: "The classic tax invoice at A5 — half the paper, same information.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "invoice-a4", width: "A5", font: "sans", density: "compact", show_item_tax_col: true }),
    },
    {
        id: "a4-modern", name: "A4 Modern invoice", category: "a4",
        blurb: "Lighter hairline grid, seller & customer blocks side-by-side — a cleaner look.",
        regions: "GLOBAL", recommendedFor: ["GB", "DE", "FR", "IT", "ES", "NL", "BE", "IE", "AT", "CH", "SE", "DK", "NO", "FI", "GR", "PL", "CZ", "HU", "PT"],
        design: d({ layout: "invoice-grid", width: "A4", font: "sans", show_item_tax_col: true }),
    },
    {
        id: "a4-minimal", name: "A4 Minimal invoice", category: "a4",
        blurb: "No borders, lots of whitespace, type does the work — for design-led brands.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "invoice-grid", width: "A4", font: "sans", density: "roomy", show_logo: false }),
    },
    {
        id: "a4-detailed-tax", name: "A4 Detailed tax invoice", category: "a4",
        blurb: "Per-line tax-rate column plus a tax-rate summary table — maximum transparency.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "invoice-a4", width: "A4", font: "sans", show_item_tax_col: true, show_serial: true }),
    },
    {
        id: "a4-letterhead", name: "A4 with letterhead band", category: "a4",
        blurb: "A coloured band across the top with the restaurant name reversed out.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "invoice-grid", width: "A4", font: "sans", accent_color: "#1F4E78", show_logo: true }),
    },
    {
        id: "a4-itemized-check", name: "A4 itemized check", category: "a4",
        blurb: "Restaurant-style itemized check on a full page — single tax line, room for a tip.",
        regions: "GLOBAL", recommendedFor: ["US", "CA"],
        design: d({ layout: "invoice-grid", width: "A4", font: "sans", show_item_tax_col: false, tax_breakup: "combined", footer_message: "Gratuity not included." }),
    },
    {
        id: "a4-proforma", name: "A4 Pro-forma style", category: "a4",
        blurb: "An estimate-style layout — same grid, a 'PRO-FORMA' label, no payment block.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "invoice-grid", width: "A4", font: "sans", show_qr_verify: false }),
    },
    {
        id: "a5-compact-invoice", name: "A5 Compact invoice", category: "a4",
        blurb: "Tight A5 invoice — good when you print invoices in bulk to email.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "invoice-grid", width: "A5", font: "sans", density: "compact" }),
    },
    {
        id: "a4-serif-formal", name: "A4 Formal serif invoice", category: "a4",
        blurb: "Serif type, ruled table, restrained accent — reads like a proper letterhead invoice.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "invoice-a4", width: "A4", font: "serif", show_item_tax_col: true }),
    },

    // ── Café & fine-dining ─────────────────────────────────────────────────
    {
        id: "boutique-serif", name: "Boutique serif card", category: "boutique",
        blurb: "Narrow card, serif type, a single accent rule — the default for cafés & bistros.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "card-boutique", width: "80mm", font: "serif", density: "roomy", show_serial: false, footer_message: "With love — see you again soon." }),
    },
    {
        id: "boutique-elegant", name: "Elegant minimalist", category: "boutique",
        blurb: "No logo, hairline rules, lots of air — quietly upscale.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "card-boutique", width: "80mm", font: "serif", density: "roomy", show_logo: false, show_serial: false, show_qr_verify: false }),
    },
    {
        id: "boutique-bistro", name: "Bistro slip", category: "boutique",
        blurb: "A slim 58 mm-width card — handed over folded, just the basics, beautifully set.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "card-boutique", width: "58mm", font: "serif", density: "normal", show_serial: false }),
    },
    {
        id: "boutique-luxe", name: "Luxe accent block", category: "boutique",
        blurb: "A solid accent block behind the name and the grand total — confident and bold.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "card-boutique", width: "80mm", font: "serif", accent_color: "#111827", density: "roomy", show_serial: false }),
    },
    {
        id: "boutique-note", name: "With a personal note", category: "boutique",
        blurb: "Leaves a prominent space for a hand-style thank-you message to the guest.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "card-boutique", width: "80mm", font: "serif", density: "roomy", show_serial: false, footer_message: "Thank you for spending your evening with us. We can't wait to have you back." }),
    },
    {
        id: "boutique-monoline", name: "Mono-line café", category: "boutique",
        blurb: "Monospace on the boutique card — that indie-coffee-shop feel.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "card-boutique", width: "80mm", font: "mono", density: "normal", show_serial: false }),
    },
    {
        id: "boutique-photo-logo", name: "Photo-logo header", category: "boutique",
        blurb: "Big centered logo over a clean card — your mark front and centre.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "card-boutique", width: "80mm", font: "sans", density: "roomy", show_logo: true, show_serial: false }),
    },
    {
        id: "boutique-receipt-hybrid", name: "Receipt-card hybrid", category: "boutique",
        blurb: "Receipt-grade detail (serials, tax line) wrapped in the boutique card styling.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "card-boutique", width: "80mm", font: "sans", show_serial: true, show_item_tax_col: true }),
    },

    // ── Quick-service & kiosk ──────────────────────────────────────────────
    {
        id: "qsr-token", name: "QSR order token", category: "qsr",
        blurb: "Giant order number up top so the counter can call it out — then the item list.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "qsr-token", width: "80mm", font: "sans", show_serial: false }),
    },
    {
        id: "qsr-kiosk-slip", name: "Kiosk self-order slip", category: "qsr",
        blurb: "What pops out of a self-order kiosk — token, items, 'collect when called'.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "qsr-token", width: "80mm", font: "sans", show_serial: false, show_qr_verify: true, footer_message: "Please collect your order when your number is called." }),
    },
    {
        id: "qsr-drive-thru", name: "Drive-thru ticket", category: "qsr",
        blurb: "Compact, fast to scan at the window — token, items, total, go.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "qsr-token", width: "58mm", font: "sans", density: "compact", show_serial: false, show_logo: false }),
    },
    {
        id: "qsr-combo-highlight", name: "Combo-highlight receipt", category: "qsr",
        blurb: "Items grouped, combos called out — good for value-meal heavy menus.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "qsr-token", width: "80mm", font: "sans", show_serial: true }),
    },
    {
        id: "qsr-fast-58", name: "Fast 58 mm QSR", category: "qsr",
        blurb: "The token receipt on a 58 mm roll — the quickest print on the list.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "qsr-token", width: "58mm", font: "sans", density: "compact", show_serial: false }),
    },
    {
        id: "qsr-delivery-handoff", name: "Delivery hand-off slip", category: "qsr",
        blurb: "Stapled to the bag — order token, items to verify, customer name & total.",
        regions: "GLOBAL", recommendedFor: [],
        design: d({ layout: "qsr-token", width: "80mm", font: "sans", show_serial: true, show_qr_verify: false, footer_message: "Please check the bag against this slip before handing it over." }),
    },
]

// =========================================================================
//  Lookups
// =========================================================================
const _byId: Record<string, BillTemplate> = Object.fromEntries(BILL_TEMPLATES.map((t) => [t.id, t]))

export function getTemplate(id: string | null | undefined): BillTemplate | undefined {
    return id ? _byId[id] : undefined
}

/** Templates available to a country: region-neutral ones + any whose `regions`
 *  list includes this country code. */
export function templatesForCountry(countryCode: string): BillTemplate[] {
    const cc = countryCode.toUpperCase()
    return BILL_TEMPLATES.filter((t) => t.regions === "GLOBAL" || t.regions.includes(cc))
}

/** Templates that are a *suggested* default for this country, best first.
 *  Falls back to a small global set if the country has no explicit picks. */
export function recommendedTemplates(countryCode: string): BillTemplate[] {
    const cc = countryCode.toUpperCase()
    const picks = BILL_TEMPLATES.filter((t) => t.recommendedFor.includes(cc))
    if (picks.length) {
        // region-specific picks first, then general ones
        return picks.sort((a, b) => (a.category === "region" ? -1 : 0) - (b.category === "region" ? -1 : 0))
    }
    return ["thermal-modern-80", "a4-modern", "boutique-serif", "generic-no-tax"]
        .map((id) => _byId[id]!)
        .filter(Boolean)
}

/** The single best default format id for a country. */
export function defaultTemplateId(countryCode: string): string {
    return recommendedTemplates(countryCode)[0]?.id ?? "thermal-modern-80"
}

/** Resolve the `BillDesign` to use from a tenant's stored `settings`:
 *  the saved `bill_design` (migrating the old `show_gstin` key), else the
 *  picked template's design, else the global default. */
export function resolveBillDesign(
    settings: { bill_design?: Record<string, unknown> | null; bill_template_id?: string | null } | null | undefined,
): BillDesign {
    const stored = settings?.bill_design
    if (stored && typeof stored === "object" && Object.keys(stored).length > 0) {
        const showTaxId = (stored.show_tax_id as boolean | undefined) ?? (stored.show_gstin as boolean | undefined) ?? true
        return { ...DEFAULT_DESIGN, ...(stored as Partial<BillDesign>), show_tax_id: showTaxId }
    }
    return getTemplate(settings?.bill_template_id ?? undefined)?.design ?? DEFAULT_DESIGN
}

/** Group a template list by category, in `BILL_CATEGORIES` order. */
export function groupByCategory(templates: BillTemplate[]): { key: BillCategory; label: string; blurb: string; items: BillTemplate[] }[] {
    return BILL_CATEGORIES
        .map((c) => ({ ...c, items: templates.filter((t) => t.category === c.key) }))
        .filter((g) => g.items.length > 0)
}
