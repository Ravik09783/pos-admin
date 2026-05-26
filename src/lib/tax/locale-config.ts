/**
 * Per-country (and, where it matters, per-state) tax & locale configuration.
 *
 * This is the single source of truth for "how does tax work where this
 * restaurant operates":
 *   - taxModel  — "split" (India: CGST+SGST within a state, IGST across),
 *                 "single" (one combined rate: VAT / Sales Tax / GST elsewhere),
 *                 or "none".
 *   - rates     — the tax %s a merchant can pick from when creating menu items.
 *   - currency / locale — for money formatting (Intl.NumberFormat).
 *   - serviceChargeAllowed — e.g. India: false (CCPA guidelines make it
 *                 non-enforceable); most others: true.
 *   - taxIdLabel — "GSTIN" / "VAT Number" / "TRN" / "EIN" …
 *   - fiscalYearStartMonth — India & UK: 4 (April); Australia: 7; most: 1.
 *   - stateMatters / states — sub-region tax data (India needs state codes for
 *                 the split; US/Canada sales tax varies by state/province).
 *
 * Stored as plain data so it could just as well live in a .json file — kept in
 * TypeScript only so consumers get type-checking.
 */

import { INDIAN_STATES } from "@/lib/indian-states"

export type TaxModel = "split" | "single" | "none"

export interface StateTaxConfig {
    /** Code stamped onto bills (e.g. India GST state code "29", US "CA"). */
    code: string
    name: string
    /** Suggested default tax rate for this sub-region (a starting point — the
     *  merchant can still set per-item rates). Omit to use the country default. */
    defaultRate?: number
    /** Tax rates available in this sub-region. Omit to use the country rates. */
    rates?: number[]
}

export interface CountryTaxConfig {
    /** ISO 3166-1 alpha-2. */
    code: string
    name: string
    /** ISO 4217 currency code. */
    currency: string
    /** BCP-47 locale for Intl.NumberFormat. */
    locale: string
    taxModel: TaxModel
    /** Display labels for the tax components. "single" uses `single`; "split"
     *  uses `cgst` / `sgst` / `igst`. */
    taxLabels: { single?: string; cgst?: string; sgst?: string; igst?: string }
    /** A short generic name for the tax — "GST", "VAT", "Sales Tax". */
    taxShortName: string
    /** Tax rates a merchant can pick from for menu items. */
    rates: number[]
    /** Default rate for a new menu item. */
    defaultRate: number
    /** Whether a service / gratuity charge may be applied to bills. */
    serviceChargeAllowed: boolean
    /** Label for the merchant's tax-registration number. */
    taxIdLabel: string
    /** Is that registration number legally required for the merchant? */
    taxIdRequired: boolean
    /** Fiscal-year start month (1–12). */
    fiscalYearStartMonth: number
    /** True if tax differs by state/province (drives the state picker). */
    stateMatters: boolean
    /** Sub-region tax data. For India this is sourced from INDIAN_STATES;
     *  for US/Canada a representative set is bundled here. */
    states?: StateTaxConfig[]
    /** A note shown in Settings about this country's tax rules. */
    note?: string
}

// ── US states + DC (statewide base sales-tax rate; counties / cities add their
//    own on top, so the merchant can still override per item). Rates current as
//    of 2025. AK/DE/MT/NH/OR have no statewide sales tax. ──────────────────────
const US_STATES: StateTaxConfig[] = [
    { code: "AL", name: "Alabama", defaultRate: 4 },
    { code: "AK", name: "Alaska", defaultRate: 0 },
    { code: "AZ", name: "Arizona", defaultRate: 5.6 },
    { code: "AR", name: "Arkansas", defaultRate: 6.5 },
    { code: "CA", name: "California", defaultRate: 7.25 },
    { code: "CO", name: "Colorado", defaultRate: 2.9 },
    { code: "CT", name: "Connecticut", defaultRate: 6.35 },
    { code: "DE", name: "Delaware", defaultRate: 0 },
    { code: "DC", name: "District of Columbia", defaultRate: 6 },
    { code: "FL", name: "Florida", defaultRate: 6 },
    { code: "GA", name: "Georgia", defaultRate: 4 },
    { code: "HI", name: "Hawaii", defaultRate: 4 },
    { code: "ID", name: "Idaho", defaultRate: 6 },
    { code: "IL", name: "Illinois", defaultRate: 6.25 },
    { code: "IN", name: "Indiana", defaultRate: 7 },
    { code: "IA", name: "Iowa", defaultRate: 6 },
    { code: "KS", name: "Kansas", defaultRate: 6.5 },
    { code: "KY", name: "Kentucky", defaultRate: 6 },
    { code: "LA", name: "Louisiana", defaultRate: 5 },
    { code: "ME", name: "Maine", defaultRate: 5.5 },
    { code: "MD", name: "Maryland", defaultRate: 6 },
    { code: "MA", name: "Massachusetts", defaultRate: 6.25 },
    { code: "MI", name: "Michigan", defaultRate: 6 },
    { code: "MN", name: "Minnesota", defaultRate: 6.875 },
    { code: "MS", name: "Mississippi", defaultRate: 7 },
    { code: "MO", name: "Missouri", defaultRate: 4.225 },
    { code: "MT", name: "Montana", defaultRate: 0 },
    { code: "NE", name: "Nebraska", defaultRate: 5.5 },
    { code: "NV", name: "Nevada", defaultRate: 6.85 },
    { code: "NH", name: "New Hampshire", defaultRate: 0 },
    { code: "NJ", name: "New Jersey", defaultRate: 6.625 },
    { code: "NM", name: "New Mexico", defaultRate: 4.875 },
    { code: "NY", name: "New York", defaultRate: 4 },
    { code: "NC", name: "North Carolina", defaultRate: 4.75 },
    { code: "ND", name: "North Dakota", defaultRate: 5 },
    { code: "OH", name: "Ohio", defaultRate: 5.75 },
    { code: "OK", name: "Oklahoma", defaultRate: 4.5 },
    { code: "OR", name: "Oregon", defaultRate: 0 },
    { code: "PA", name: "Pennsylvania", defaultRate: 6 },
    { code: "RI", name: "Rhode Island", defaultRate: 7 },
    { code: "SC", name: "South Carolina", defaultRate: 6 },
    { code: "SD", name: "South Dakota", defaultRate: 4.2 },
    { code: "TN", name: "Tennessee", defaultRate: 7 },
    { code: "TX", name: "Texas", defaultRate: 6.25 },
    { code: "UT", name: "Utah", defaultRate: 6.1 },
    { code: "VT", name: "Vermont", defaultRate: 6 },
    { code: "VA", name: "Virginia", defaultRate: 5.3 },
    { code: "WA", name: "Washington", defaultRate: 6.5 },
    { code: "WV", name: "West Virginia", defaultRate: 6 },
    { code: "WI", name: "Wisconsin", defaultRate: 5 },
    { code: "WY", name: "Wyoming", defaultRate: 4 },
]

// ── Canadian provinces/territories (combined GST + PST/HST rate). ─────────────
const CA_PROVINCES: StateTaxConfig[] = [
    { code: "AB", name: "Alberta", defaultRate: 5 },
    { code: "BC", name: "British Columbia", defaultRate: 12 },
    { code: "MB", name: "Manitoba", defaultRate: 12 },
    { code: "NB", name: "New Brunswick", defaultRate: 15 },
    { code: "NL", name: "Newfoundland and Labrador", defaultRate: 15 },
    { code: "NS", name: "Nova Scotia", defaultRate: 14 },
    { code: "NT", name: "Northwest Territories", defaultRate: 5 },
    { code: "NU", name: "Nunavut", defaultRate: 5 },
    { code: "ON", name: "Ontario", defaultRate: 13 },
    { code: "PE", name: "Prince Edward Island", defaultRate: 15 },
    { code: "QC", name: "Quebec", defaultRate: 14.975 },
    { code: "SK", name: "Saskatchewan", defaultRate: 11 },
    { code: "YT", name: "Yukon", defaultRate: 5 },
]

// ── Spain — most of the country uses IVA (hospitality reduced rate 10%), but
//    the Canary Islands use IGIC and Ceuta/Melilla use IPSI instead. ──────────
const ES_REGIONS: StateTaxConfig[] = [
    { code: "ES-PEN", name: "Mainland & Balearic Islands (IVA)", defaultRate: 10, rates: [0, 4, 10, 21] },
    { code: "ES-CN", name: "Canary Islands (IGIC)", defaultRate: 7, rates: [0, 3, 7, 9.5, 15] },
    { code: "ES-CE", name: "Ceuta (IPSI)", defaultRate: 10, rates: [0, 0.5, 1, 2, 3, 4, 8, 10] },
    { code: "ES-ML", name: "Melilla (IPSI)", defaultRate: 10, rates: [0, 1, 2, 3, 4, 8, 10] },
]

// ── Portugal — the mainland and the two autonomous regions run different VAT
//    rate scales (Madeira and the Azores are lower). ───────────────────────────
const PT_REGIONS: StateTaxConfig[] = [
    { code: "PT-CO", name: "Mainland (Continente)", defaultRate: 13, rates: [0, 6, 13, 23] },
    { code: "PT-30", name: "Madeira", defaultRate: 12, rates: [0, 5, 12, 22] },
    { code: "PT-20", name: "Azores", defaultRate: 9, rates: [0, 4, 9, 16] },
]

export const TAX_CONFIGS: Record<string, CountryTaxConfig> = {
    IN: {
        code: "IN", name: "India", currency: "INR", locale: "en-IN",
        taxModel: "split", taxShortName: "GST",
        taxLabels: { cgst: "CGST", sgst: "SGST", igst: "IGST" },
        rates: [0, 5, 12, 18, 28], defaultRate: 5,
        serviceChargeAllowed: false,
        taxIdLabel: "GSTIN", taxIdRequired: false,
        fiscalYearStartMonth: 4, stateMatters: true,
        // states injected from INDIAN_STATES by getTaxConfig() to avoid duplication
        note: "GST is split CGST + SGST within a state and charged as IGST across states. A service charge is not legally enforceable in India (CCPA guidelines) — leave it at 0.",
    },
    AE: {
        code: "AE", name: "United Arab Emirates", currency: "AED", locale: "en-AE",
        taxModel: "single", taxShortName: "VAT", taxLabels: { single: "VAT" },
        rates: [0, 5], defaultRate: 5, serviceChargeAllowed: true,
        taxIdLabel: "TRN", taxIdRequired: true, fiscalYearStartMonth: 1, stateMatters: false,
        note: "Standard VAT is 5%. A service charge / gratuity may be added; many venues add 10%.",
    },
    SA: {
        code: "SA", name: "Saudi Arabia", currency: "SAR", locale: "ar-SA",
        taxModel: "single", taxShortName: "VAT", taxLabels: { single: "VAT" },
        rates: [0, 15], defaultRate: 15, serviceChargeAllowed: true,
        taxIdLabel: "VAT Number", taxIdRequired: true, fiscalYearStartMonth: 1, stateMatters: false,
        note: "Standard VAT is 15%.",
    },
    GB: {
        code: "GB", name: "United Kingdom", currency: "GBP", locale: "en-GB",
        taxModel: "single", taxShortName: "VAT", taxLabels: { single: "VAT" },
        rates: [0, 5, 20], defaultRate: 20, serviceChargeAllowed: true,
        taxIdLabel: "VAT Number", taxIdRequired: false, fiscalYearStartMonth: 4, stateMatters: false,
        note: "Standard VAT is 20% (reduced 5% for some items). Discretionary service charge is common.",
    },
    US: {
        code: "US", name: "United States", currency: "USD", locale: "en-US",
        taxModel: "single", taxShortName: "Sales Tax", taxLabels: { single: "Sales Tax" },
        rates: [0, 4, 5, 6, 6.25, 7, 7.25, 8, 8.25, 8.875, 9, 10], defaultRate: 7,
        serviceChargeAllowed: true,
        taxIdLabel: "EIN", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: true,
        states: US_STATES,
        note: "Sales tax varies by state and locality — pick your state for a default rate, then fine-tune per item. Auto-gratuity on large parties is common.",
    },
    CA: {
        code: "CA", name: "Canada", currency: "CAD", locale: "en-CA",
        taxModel: "single", taxShortName: "GST/HST", taxLabels: { single: "GST/HST" },
        rates: [0, 5, 11, 12, 13, 14, 15], defaultRate: 13, serviceChargeAllowed: true,
        taxIdLabel: "Business Number", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: true,
        states: CA_PROVINCES,
        note: "Combined GST + provincial tax (or HST) ranges 5–15% by province. Auto-gratuity on large parties is common.",
    },
    AU: {
        code: "AU", name: "Australia", currency: "AUD", locale: "en-AU",
        taxModel: "single", taxShortName: "GST", taxLabels: { single: "GST" },
        rates: [0, 10], defaultRate: 10, serviceChargeAllowed: true,
        taxIdLabel: "ABN", taxIdRequired: false, fiscalYearStartMonth: 7, stateMatters: false,
        note: "GST is a flat 10%. A Sunday / public-holiday surcharge is widely used.",
    },
    NZ: {
        code: "NZ", name: "New Zealand", currency: "NZD", locale: "en-NZ",
        taxModel: "single", taxShortName: "GST", taxLabels: { single: "GST" },
        rates: [0, 15], defaultRate: 15, serviceChargeAllowed: true,
        taxIdLabel: "GST Number", taxIdRequired: false, fiscalYearStartMonth: 4, stateMatters: false,
        note: "GST is a flat 15%. Public-holiday surcharges are common.",
    },
    SG: {
        code: "SG", name: "Singapore", currency: "SGD", locale: "en-SG",
        taxModel: "single", taxShortName: "GST", taxLabels: { single: "GST" },
        rates: [0, 9], defaultRate: 9, serviceChargeAllowed: true,
        taxIdLabel: "GST Reg. No.", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "GST is 9% (from 2024). A 10% service charge is the norm and is itself GST-able — set the service charge, then GST applies on top.",
    },
    MY: {
        code: "MY", name: "Malaysia", currency: "MYR", locale: "ms-MY",
        taxModel: "single", taxShortName: "Service Tax", taxLabels: { single: "Service Tax" },
        rates: [0, 6, 8], defaultRate: 8, serviceChargeAllowed: true,
        taxIdLabel: "SST Reg. No.", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "Service Tax for F&B is 8% (from 2024). A 10% service charge is common.",
    },
    ID: {
        code: "ID", name: "Indonesia", currency: "IDR", locale: "id-ID",
        taxModel: "single", taxShortName: "PB1/VAT", taxLabels: { single: "PB1" },
        rates: [0, 10, 11], defaultRate: 10, serviceChargeAllowed: true,
        taxIdLabel: "NPWP", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "Restaurant tax (PB1) is typically 10%. A 5–10% service charge is common.",
    },
    TH: {
        code: "TH", name: "Thailand", currency: "THB", locale: "th-TH",
        taxModel: "single", taxShortName: "VAT", taxLabels: { single: "VAT" },
        rates: [0, 7], defaultRate: 7, serviceChargeAllowed: true,
        taxIdLabel: "Tax ID", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "VAT is 7%. A 10% service charge is common.",
    },
    DE: {
        code: "DE", name: "Germany", currency: "EUR", locale: "de-DE",
        taxModel: "single", taxShortName: "USt.", taxLabels: { single: "USt." },
        rates: [0, 7, 19], defaultRate: 19, serviceChargeAllowed: true,
        taxIdLabel: "USt-IdNr.", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "VAT (USt.) is 19% standard, 7% reduced (e.g. eat-in vs takeaway rules apply). Service is usually included; tips are extra.",
    },
    FR: {
        code: "FR", name: "France", currency: "EUR", locale: "fr-FR",
        taxModel: "single", taxShortName: "TVA", taxLabels: { single: "TVA" },
        rates: [0, 2.1, 5.5, 10, 20], defaultRate: 10, serviceChargeAllowed: false,
        taxIdLabel: "N° TVA", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "TVA is 10% on dine-in food and 20% on alcohol. Service is included in the price by law (« service compris ») — don't add a separate service charge.",
    },
    IT: {
        code: "IT", name: "Italy", currency: "EUR", locale: "it-IT",
        taxModel: "single", taxShortName: "IVA", taxLabels: { single: "IVA" },
        rates: [0, 4, 5, 10, 22], defaultRate: 10, serviceChargeAllowed: true,
        taxIdLabel: "Partita IVA", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "IVA is 10% on restaurant services, 22% standard. A cover charge (« coperto ») is common instead of a percentage service charge.",
    },
    ES: {
        code: "ES", name: "Spain", currency: "EUR", locale: "es-ES",
        taxModel: "single", taxShortName: "IVA", taxLabels: { single: "IVA" },
        rates: [0, 4, 10, 21], defaultRate: 10, serviceChargeAllowed: true,
        taxIdLabel: "NIF / CIF", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: true,
        states: ES_REGIONS,
        note: "Hospitality IVA is 10% on the mainland & Balearics. The Canary Islands use IGIC (7%) and Ceuta/Melilla use IPSI — pick your region.",
    },
    PT: {
        code: "PT", name: "Portugal", currency: "EUR", locale: "pt-PT",
        taxModel: "single", taxShortName: "IVA", taxLabels: { single: "IVA" },
        rates: [0, 4, 5, 6, 9, 12, 13, 16, 22, 23], defaultRate: 13, serviceChargeAllowed: true,
        taxIdLabel: "NIF", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: true,
        states: PT_REGIONS,
        note: "Restaurant IVA on the mainland is 13% (food) / 23% (drinks & alcohol). Madeira and the Azores have their own lower rate scales — pick your region.",
    },
    NL: {
        code: "NL", name: "Netherlands", currency: "EUR", locale: "nl-NL",
        taxModel: "single", taxShortName: "BTW", taxLabels: { single: "BTW" },
        rates: [0, 9, 21], defaultRate: 9, serviceChargeAllowed: true,
        taxIdLabel: "BTW-nummer", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "BTW on food & restaurant service is 9%; 21% on alcohol. Service is normally included; tips are extra.",
    },
    BE: {
        code: "BE", name: "Belgium", currency: "EUR", locale: "nl-BE",
        taxModel: "single", taxShortName: "BTW / TVA", taxLabels: { single: "BTW / TVA" },
        rates: [0, 6, 12, 21], defaultRate: 12, serviceChargeAllowed: true,
        taxIdLabel: "BTW-nummer", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "VAT on restaurant service is 12% (food) / 21% (drinks). Service is usually included.",
    },
    IE: {
        code: "IE", name: "Ireland", currency: "EUR", locale: "en-IE",
        taxModel: "single", taxShortName: "VAT", taxLabels: { single: "VAT" },
        rates: [0, 4.8, 9, 13.5, 23], defaultRate: 13.5, serviceChargeAllowed: true,
        taxIdLabel: "VAT Number", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "VAT on restaurant / catering is 13.5%; 23% on alcohol & soft drinks. A discretionary service charge is common.",
    },
    AT: {
        code: "AT", name: "Austria", currency: "EUR", locale: "de-AT",
        taxModel: "single", taxShortName: "USt.", taxLabels: { single: "USt." },
        rates: [0, 10, 13, 20], defaultRate: 10, serviceChargeAllowed: true,
        taxIdLabel: "UID-Nummer", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "USt. on food is 10%, 13% on most drinks, 20% on spirits. Service is usually included; rounding up is customary.",
    },
    CH: {
        code: "CH", name: "Switzerland", currency: "CHF", locale: "de-CH",
        taxModel: "single", taxShortName: "MWST", taxLabels: { single: "MWST" },
        rates: [0, 2.6, 3.8, 8.1], defaultRate: 8.1, serviceChargeAllowed: true,
        taxIdLabel: "MWST-Nr.", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "MWST on dine-in is 8.1%; takeaway food is 2.6%. Service is included by law; rounding up is customary.",
    },
    SE: {
        code: "SE", name: "Sweden", currency: "SEK", locale: "sv-SE",
        taxModel: "single", taxShortName: "Moms", taxLabels: { single: "Moms" },
        rates: [0, 6, 12, 25], defaultRate: 12, serviceChargeAllowed: true,
        taxIdLabel: "Momsregnr.", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "Moms on restaurant food is 12%; 25% on alcohol. Service is included; tips are discretionary.",
    },
    DK: {
        code: "DK", name: "Denmark", currency: "DKK", locale: "da-DK",
        taxModel: "single", taxShortName: "Moms", taxLabels: { single: "Moms" },
        rates: [0, 25], defaultRate: 25, serviceChargeAllowed: true,
        taxIdLabel: "CVR / SE-nr.", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "Denmark has a single 25% Moms rate with no reduced band. Service is included; tips are discretionary.",
    },
    NO: {
        code: "NO", name: "Norway", currency: "NOK", locale: "nb-NO",
        taxModel: "single", taxShortName: "MVA", taxLabels: { single: "MVA" },
        rates: [0, 12, 15, 25], defaultRate: 25, serviceChargeAllowed: true,
        taxIdLabel: "Org.nr. (MVA)", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "MVA on dine-in is 25%; takeaway food is 15%. Service is included; tips are discretionary.",
    },
    FI: {
        code: "FI", name: "Finland", currency: "EUR", locale: "fi-FI",
        taxModel: "single", taxShortName: "ALV", taxLabels: { single: "ALV" },
        rates: [0, 10, 14, 25.5], defaultRate: 14, serviceChargeAllowed: true,
        taxIdLabel: "ALV-numero", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "ALV on restaurant food is 14%; 25.5% on alcohol. Service is included; tips are discretionary.",
    },
    GR: {
        code: "GR", name: "Greece", currency: "EUR", locale: "el-GR",
        taxModel: "single", taxShortName: "ΦΠΑ", taxLabels: { single: "ΦΠΑ" },
        rates: [0, 6, 13, 24], defaultRate: 13, serviceChargeAllowed: true,
        taxIdLabel: "ΑΦΜ (VAT)", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "ΦΠΑ on restaurant / catering is 13%; 24% on alcohol. A service charge is sometimes added on larger tables.",
    },
    PL: {
        code: "PL", name: "Poland", currency: "PLN", locale: "pl-PL",
        taxModel: "single", taxShortName: "VAT (PTU)", taxLabels: { single: "VAT" },
        rates: [0, 5, 8, 23], defaultRate: 8, serviceChargeAllowed: true,
        taxIdLabel: "NIP", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "VAT on catering / restaurant service is 8%; 23% on most drinks. Service is sometimes added on larger groups.",
    },
    CZ: {
        code: "CZ", name: "Czech Republic", currency: "CZK", locale: "cs-CZ",
        taxModel: "single", taxShortName: "DPH", taxLabels: { single: "DPH" },
        rates: [0, 12, 21], defaultRate: 12, serviceChargeAllowed: true,
        taxIdLabel: "DIČ", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "DPH on food & non-alcoholic catering is 12%; 21% on alcohol. Tipping ~10% is customary.",
    },
    HU: {
        code: "HU", name: "Hungary", currency: "HUF", locale: "hu-HU",
        taxModel: "single", taxShortName: "ÁFA", taxLabels: { single: "ÁFA" },
        rates: [0, 5, 18, 27], defaultRate: 5, serviceChargeAllowed: true,
        taxIdLabel: "Adószám", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "ÁFA on dine-in restaurant service is 5%; 27% standard on most drinks. A service charge is often shown separately.",
    },
    ZA: {
        code: "ZA", name: "South Africa", currency: "ZAR", locale: "en-ZA",
        taxModel: "single", taxShortName: "VAT", taxLabels: { single: "VAT" },
        rates: [0, 15], defaultRate: 15, serviceChargeAllowed: true,
        taxIdLabel: "VAT Number", taxIdRequired: false, fiscalYearStartMonth: 3, stateMatters: false,
        note: "VAT is a flat 15%. Auto-gratuity on large tables is common.",
    },
    OTHER: {
        code: "OTHER", name: "Other / no tax", currency: "USD", locale: "en-US",
        taxModel: "none", taxShortName: "Tax", taxLabels: {},
        rates: [0], defaultRate: 0, serviceChargeAllowed: true,
        taxIdLabel: "Tax ID", taxIdRequired: false, fiscalYearStartMonth: 1, stateMatters: false,
        note: "No automatic tax. Add a service charge if you wish.",
    },
}

/** The list shown in pickers, India first, then alphabetical, "Other" last. */
export const COUNTRY_OPTIONS: { code: string; name: string }[] = [
    { code: "IN", name: "India" },
    ...Object.values(TAX_CONFIGS)
        .filter((c) => c.code !== "IN" && c.code !== "OTHER")
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ code: c.code, name: c.name })),
    { code: "OTHER", name: "Other / no tax" },
]

// India's states aren't duplicated in TAX_CONFIGS.IN — they're injected here
// once at module load from the canonical INDIAN_STATES list.
const _indiaWithStates: CountryTaxConfig = {
    ...TAX_CONFIGS.IN!,
    states: INDIAN_STATES.map((s) => ({ code: s.code, name: s.name })),
}

/**
 * Look up a country's config. Accepts the ISO code ("IN") or the full name
 * ("India") — the `tenants.country` column stores the name.
 */
export function getTaxConfig(countryCodeOrName: string | null | undefined): CountryTaxConfig {
    if (!countryCodeOrName) return _indiaWithStates
    const key = countryCodeOrName.trim()
    const byCode = TAX_CONFIGS[key.toUpperCase()]
    if (byCode) return byCode.code === "IN" ? _indiaWithStates : byCode
    const byName = Object.values(TAX_CONFIGS).find(
        (c) => c.name.toLowerCase() === key.toLowerCase(),
    )
    if (byName) return byName.code === "IN" ? _indiaWithStates : byName
    return _indiaWithStates
}

/** The state config for a given state code within a country, if any. */
export function getStateConfig(cfg: CountryTaxConfig, stateCode: string | null | undefined): StateTaxConfig | null {
    if (!stateCode || !cfg.states) return null
    return cfg.states.find((s) => s.code === stateCode) ?? null
}

/** Tax rates available for a country (optionally narrowed by state). */
export function taxRatesFor(cfg: CountryTaxConfig, stateCode?: string | null): number[] {
    const st = getStateConfig(cfg, stateCode)
    if (st?.rates && st.rates.length) return st.rates
    // Make sure the state's default rate is selectable even if not in the base list.
    if (st?.defaultRate != null && !cfg.rates.includes(st.defaultRate)) {
        return [...cfg.rates, st.defaultRate].sort((a, b) => a - b)
    }
    return cfg.rates
}

/** Default tax rate for a new menu item (state default wins if present). */
export function defaultRateFor(cfg: CountryTaxConfig, stateCode?: string | null): number {
    return getStateConfig(cfg, stateCode)?.defaultRate ?? cfg.defaultRate
}

/**
 * Every tax rate a merchant may pick for a menu item:
 *   - the jurisdiction's official slabs (optionally narrowed by state), PLUS
 *   - any `customRates` the restaurant added in Settings → Tax, PLUS
 *   - any `include` extras (e.g. an existing item's stored rate, so it stays
 *     selectable even after the official slab list changes).
 * De-duplicated and sorted ascending. Negative / non-finite values are dropped.
 *
 * This is the single place that fuses the developer-maintained slab list
 * (TAX_CONFIGS) with the tenant's own `tenants.custom_tax_rates`, so a future
 * rate change is either a one-line edit here in code (whole country) or a
 * dashboard entry by the restaurant (just them).
 */
export function mergedTaxRates(
    cfg: CountryTaxConfig,
    opts?: { stateCode?: string | null; customRates?: number[] | null; include?: Array<number | null | undefined> },
): number[] {
    const all = new Set<number>(taxRatesFor(cfg, opts?.stateCode))
    const add = (r: number | null | undefined) => {
        if (typeof r === "number" && Number.isFinite(r) && r >= 0) all.add(r)
    }
    ;(opts?.customRates ?? []).forEach(add)
    ;(opts?.include ?? []).forEach(add)
    return Array.from(all).sort((a, b) => a - b)
}
