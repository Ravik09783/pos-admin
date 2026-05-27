import "server-only"

/**
 * Server-side wrapper around Gemini's vision API for menu
 * extraction. SERVER ONLY — the API key never leaves the server.
 *
 * Why Gemini specifically:
 *   • Free tier (no credit card): 1,500 req/day, 15 req/min — plenty
 *     for any restaurant's one-time menu setup
 *   • `gemini-1.5-flash` is vision-capable and supports structured
 *     JSON output via response_schema, so the prompt can't drift the
 *     return shape
 *   • Plain REST API — no SDK needed (smaller server bundle)
 *
 * The structured-output schema below mirrors our existing
 * `ParsedSection` shape so the client can drop the result straight
 * into the editable table.
 */

/** Default model — overridable via `GEMINI_MODEL` env var so future
 *  model deprecations are an env tweak instead of a code change.
 *  As of late-2025 the free-tier-friendly vision-capable choice is
 *  `gemini-2.5-flash` (the previous default `gemini-1.5-flash-latest`
 *  was removed from the v1beta API). */
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"

const SYSTEM_PROMPT = `You are extracting menu items from a restaurant menu image.

Output rules:
- Detect category / section headers (often in larger or bold text, banners, all-caps, or distinct colour)
- Extract every menu item under its correct category
- "price" is the base price as a plain number (no currency symbol). If unreadable, omit the item entirely.
- If an item lists multiple sizes / portions (Half/Full, S/M/L, Regular/Large, etc), emit one item PER price with a "(Half)" / "(Full)" / "(S)" suffix on the name
- "food_type": NON_VEG for chicken / mutton / lamb / beef / pork / fish / prawn / seafood; EGG for plain eggs / omelette / bhurji; otherwise VEG. Use VEGAN only if the menu explicitly labels something vegan.
- "description": ALWAYS provide a short customer-facing description (8-18 words, one sentence, no trailing period required).
   - If the menu itself prints a description line, use that verbatim (lightly cleaned of OCR/typography artefacts).
   - If the menu only shows the bare item name, write a concise description from common knowledge of the dish — key ingredients, cooking method, or flavour profile (e.g. "Slow-cooked black lentils in butter and cream" for Dal Makhani).
   - Stay strictly factual: do not invent chef names, awards, certifications, "house special" claims, or spice levels beyond the dish's typical preparation. When in doubt, keep it generic ("Classic North-Indian curry") rather than risk a wrong specific.
- Skip the restaurant name, address, page numbers, "menu" banners, contact details, and decorative ornaments.

Return ONLY the JSON array — no prose, no explanation, no markdown fence.`

export type GeminiFoodType = "VEG" | "NON_VEG" | "EGG" | "VEGAN"

export interface GeminiMenuItem {
    name: string
    description?: string | null
    price: number
    food_type?: GeminiFoodType
}

export interface GeminiMenuSection {
    category: string
    items: GeminiMenuItem[]
}

/**
 * Hand it the image bytes + a Gemini API key. Returns the parsed
 * sections or throws a human-readable Error.
 *
 * `mimeType` should be the original MIME — Gemini accepts image/jpeg,
 * image/png, image/webp, image/heic, image/heif.
 */
export async function extractMenuWithGemini(
    imageBase64: string,
    mimeType: string,
    apiKey: string,
): Promise<GeminiMenuSection[]> {
    const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`

    // The schema constrains the model to a JSON array of sections.
    // Gemini's schema dialect uses UPPERCASE type names and a subset
    // of OpenAPI 3.0; it doesn't support `nullable` so `description`
    // is just optional (omitted in practice when missing).
    const body = {
        contents: [
            {
                parts: [
                    { text: SYSTEM_PROMPT },
                    { inline_data: { mime_type: mimeType, data: imageBase64 } },
                ],
            },
        ],
        generationConfig: {
            // Temperature 0 — we want deterministic extraction, not
            // creative interpretation.
            temperature: 0,
            // gemini-2.5-flash is a "thinking" model — by default it
            // burns 10-30+ extra seconds on hidden reasoning tokens
            // before emitting the answer. Menu extraction is a
            // straight vision/OCR task with no chain-of-thought win,
            // so we hard-disable thinking to get 1.5-flash-class
            // latency (3-8 s) back. Without this, the request
            // routinely overshoots the AbortController timeout and
            // Vercel's serverless function timeout.
            thinkingConfig: { thinkingBudget: 0 },
            response_mime_type: "application/json",
            response_schema: {
                type: "ARRAY",
                items: {
                    type: "OBJECT",
                    properties: {
                        category: { type: "STRING" },
                        items: {
                            type: "ARRAY",
                            items: {
                                type: "OBJECT",
                                properties: {
                                    name: { type: "STRING" },
                                    description: { type: "STRING" },
                                    price: { type: "NUMBER" },
                                    food_type: {
                                        type: "STRING",
                                        enum: ["VEG", "NON_VEG", "EGG", "VEGAN"],
                                    },
                                },
                                required: ["name", "price"],
                            },
                        },
                    },
                    required: ["category", "items"],
                },
            },
        },
    }

    // 55s timeout — kept just under the route handler's
    // `maxDuration = 60` so Vercel doesn't kill the function mid-
    // fetch. Gemini Flash without thinking (see thinkingConfig above)
    // typically responds in 3-8 s on a menu image; the extra
    // headroom is for cold starts, large images, and occasional
    // upstream hiccups.
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 55_000)
    let r: Response
    try {
        r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: ac.signal,
        })
    } catch (e) {
        clearTimeout(timer)
        if (e instanceof Error && e.name === "AbortError") {
            throw new Error("Gemini timed out — try again, or use Local mode while we retry.")
        }
        throw new Error(e instanceof Error ? e.message : "Couldn't reach Gemini.")
    }
    clearTimeout(timer)

    if (!r.ok) {
        const txt = await r.text().catch(() => "")
        // Map common HTTP failures to actionable messages.
        if (r.status === 400) {
            throw new Error("Gemini rejected the request — check that the image is a real photo/scan (not an SVG / PDF).")
        }
        if (r.status === 401 || r.status === 403) {
            throw new Error("Gemini rejected the API key. Open .env, re-paste GEMINI_API_KEY from https://aistudio.google.com/apikey, restart the dev server.")
        }
        if (r.status === 429) {
            throw new Error("Gemini free-tier rate limit hit (15 req/min, 1500/day). Wait a minute and try again.")
        }
        if (r.status >= 500) {
            throw new Error(`Gemini server error (${r.status}). Retry in a moment.`)
        }
        throw new Error(`Gemini API error ${r.status}: ${txt.slice(0, 200)}`)
    }

    const data = await r.json().catch(() => null) as
        | { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; promptFeedback?: { blockReason?: string } }
        | null

    if (data?.promptFeedback?.blockReason) {
        throw new Error(`Gemini blocked the request (${data.promptFeedback.blockReason}) — try a different image.`)
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
        throw new Error("Gemini returned no extraction — try a clearer photo, or switch to Local mode.")
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        throw new Error("Gemini returned malformed JSON. Try again — Gemini's response_schema is usually deterministic.")
    }
    if (!Array.isArray(parsed)) {
        throw new Error("Gemini returned a non-array response.")
    }

    // Sanitise: drop entries missing required fields, coerce numbers.
    const out: GeminiMenuSection[] = []
    for (const raw of parsed) {
        if (!raw || typeof raw !== "object") continue
        const r = raw as Record<string, unknown>
        const category = typeof r.category === "string" ? r.category.trim() : ""
        if (!category) continue
        const rawItems = Array.isArray(r.items) ? r.items : []
        const items: GeminiMenuItem[] = []
        for (const rawItem of rawItems) {
            if (!rawItem || typeof rawItem !== "object") continue
            const ri = rawItem as Record<string, unknown>
            const name = typeof ri.name === "string" ? ri.name.trim() : ""
            if (!name) continue
            const priceNum = typeof ri.price === "number"
                ? ri.price
                : typeof ri.price === "string"
                    ? Number.parseFloat(ri.price)
                    : NaN
            if (!Number.isFinite(priceNum) || priceNum <= 0) continue
            const ft = ri.food_type
            const food_type: GeminiFoodType | undefined =
                ft === "NON_VEG" || ft === "EGG" || ft === "VEGAN" || ft === "VEG" ? ft : undefined
            items.push({
                name,
                description: typeof ri.description === "string" && ri.description.trim().length > 0
                    ? ri.description.trim()
                    : null,
                price: priceNum,
                food_type,
            })
        }
        if (items.length > 0) out.push({ category, items })
    }
    return out
}
