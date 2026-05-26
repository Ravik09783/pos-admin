import { redirect } from "next/navigation"

import { getCurrentUserAndTenant } from "@/lib/auth/current-user"
import { getTaxConfig } from "@/lib/tax/locale-config"
import type { UserRole } from "@/types/database"

import { MenuExtractorClient } from "./menu-extractor"

/**
 * /ai — AI-assisted menu setup.
 *
 * The OWNER (or MANAGER) uploads a photo / scan of their printed
 * menu; Tesseract.js OCRs it client-side, our heuristic parser groups
 * the text into categories + items + prices, and the page renders the
 * result as an editable table — same field set as the manual "New
 * item" dialog. On Save, the items append into the existing
 * `menu_categories` / `menu_items` tables.
 *
 * Self-contained module — everything lives under this folder so the
 * existing /menu-admin code stays untouched.
 *
 * Auth: OWNER + MANAGER only. Staff don't manage the catalog.
 */
export default async function AiMenuPage() {
    const { user, appUser } = await getCurrentUserAndTenant()
    if (!user) redirect("/login")
    if (!appUser?.tenant_id) redirect("/onboarding")

    const role = (appUser.role as UserRole | null) ?? null
    if (role !== "OWNER" && role !== "MANAGER") {
        redirect("/dashboard")
    }

    const tenantCountry = appUser.tenant?.country ?? null
    const cfg = getTaxConfig(tenantCountry)
    // The page lets the owner pick between Local (Tesseract, offline)
    // and Enhanced (Gemini Vision, online) modes. Enhanced is only
    // selectable when the server has a Gemini API key. Reading the
    // env on the server keeps the key out of the client bundle.
    const geminiAvailable = Boolean(process.env.GEMINI_API_KEY?.trim())

    return (
        <MenuExtractorClient
            tenantId={appUser.tenant_id}
            tenantCountry={tenantCountry}
            currency={cfg.currency}
            taxShortName={cfg.taxShortName}
            countryCode={cfg.code}
            geminiAvailable={geminiAvailable}
        />
    )
}
