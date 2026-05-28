/**
 * Heuristic parser: raw OCR text → structured menu sections.
 *
 * Lives inside the `/ai` folder so the AI module is self-contained
 * (per the brief: "not dependent on any other component"). The parser
 * has zero runtime dependencies — pure string/regex over the OCR
 * output.
 *
 * The shape we produce:
 *
 *   [
 *     { category: "STARTERS", items: [
 *         { name: "Tomato Soup", description: null, price: 120, suggestedFoodType: "VEG" },
 *         { name: "Chicken Wings (Half)", description: null, price: 250, suggestedFoodType: "NON_VEG" },
 *         { name: "Chicken Wings (Full)", description: null, price: 450, suggestedFoodType: "NON_VEG" },
 *     ]},
 *   ]
 *
 * Heuristics in priority order:
 *  1. Split into lines, drop OCR junk (single chars, >80% punctuation,
 *     pure headers like "Page 1", lines that are mostly digits).
 *  2. Every line gets price extraction first. We look for **all**
 *     trailing prices so the very common "X/- Y/-" half/full pattern
 *     creates TWO items rather than one mangled "XY".
 *  3. If a line has a price → it's an item; the leading text is the
 *     name. Multi-price lines emit one item per price with `(Half)`
 *     / `(Full)` suffixes.
 *  4. Lines without prices: an ALL-CAPS line of reasonable length
 *     becomes the current category. Title-case short lines also
 *     count. Otherwise the line is treated as a description for the
 *     prior item (only the first orphan attaches).
 *  5. Items emitted before any category land under "Uncategorised".
 *  6. Food-type hint: dish names with chicken/mutton/fish/egg-style
 *     words get suggested as NON_VEG / EGG. Owner edits the final
 *     value on every row.
 */

/** Suggested food type, mirroring the menu_items.food_type enum. */
export type FoodType = "VEG" | "NON_VEG" | "EGG" | "VEGAN"

export interface ParsedItem {
    name: string
    description: string | null
    price: number | null
    /** Best-guess from the name. Owner edits the final value. */
    suggestedFoodType: FoodType
}

export interface ParsedSection {
    category: string
    items: ParsedItem[]
}

/** Words in a dish name that strongly suggest non-veg. */
const NON_VEG_HINTS = /\b(chicken|mutton|lamb|beef|pork|bacon|ham|fish|prawn|shrimp|crab|lobster|squid|tikka|kebab|kabab|tandoori|biryani|keema|seekh|gosht|murgh|machli)\b/i

/** Words that suggest egg-only (not full non-veg). */
const EGG_HINTS = /\b(egg|omelet|omelette|bhurji|akuri|frittata)\b/i

/** Lines we drop outright — OCR junk that almost certainly isn't a
 *  menu line. Single chars, mostly punctuation, page numbers, etc. */
function isJunkLine(line: string): boolean {
    const trimmed = line.trim()
    if (trimmed.length < 2) return true
    // 80%+ punctuation / digits = junk header rule, footer rule, table border, etc.
    const alpha = trimmed.replace(/[^a-zA-Z]/g, "").length
    if (alpha / trimmed.length < 0.2) return true
    // Common headers like "Page 1 of 3", "Menu", a bare year.
    if (/^\s*(page\s+\d+|menu|food menu|drinks menu)\s*$/i.test(trimmed)) return true
    return false
}

/**
 * Strip OCR noise from the start and end of a line.
 *
 * Real menus love putting a tick-box (☐) or bullet (•) before every
 * item; Tesseract's English language data has no idea what those are
 * and emits them as one or two stray capital letters — most often
 * `Q`, `QI`, `Q1`, `Ql`, `CI`, `C1`, `D1`, `O1`, `OI`, or a stray
 * `[`/`(`/`|`. These end up as the start of every dish name in the
 * editable table. We strip them only when the prefix is *short* AND
 * followed by an obvious capital-letter dish-name word, so a real
 * single-letter abbreviation like "Q-BBQ" stays intact.
 *
 * Trailing decorations (`>"`, stray quotes, brace marks coming from
 * column-edge ornaments) get the same treatment.
 */
function cleanLineNoise(line: string): string {
    let out = line
    // 1-2 char checkbox/bullet prefixes followed by space + uppercase.
    out = out.replace(/^([CDOQU][I1l0]?)\s+(?=[A-Z])/, "")
    // Stray opening brackets / pipes.
    out = out.replace(/^[[({|\\/]+\s*/, "")
    // Trailing quote-like / bracket-like decorations.
    out = out.replace(/[>"'<>[\]{}|\\]+\s*$/, "")
    return out.trim()
}

/**
 * Currency-symbol misread guard. Tesseract trained on plain English
 * doesn't know ₹, $, €, £ — they often drift into a leading "2" /
 * "S" / "5" digit prefix on the price (`₹30` → `230`, `₹65` → `265`).
 * Our char whitelist kills the ₹ at OCR time, but it can still slip
 * through when the symbol sits flush against the digits.
 *
 * Heuristic: if a price has an extra leading "2" AND dropping it
 * yields a plausible menu price (>= 10), prefer the shorter form.
 * Conservative — we only trigger when the WHOLE line otherwise looks
 * like a typical "Dish ₹XX" pattern, not when 200-range prices are
 * legit (Indian biryani / pizza prices easily hit 200-500).
 */
function isLikelyCurrencyArtifact(amount: number, line: string): boolean {
    if (amount < 200 || amount > 299) return false
    // Trigger when the line contains keywords typical of cheap dishes
    // and the corrected price would be 10-99 (the usual cheap range).
    const corrected = amount - 200
    if (corrected < 10) return false
    // If the line has a clear ₹ / Rs marker we shouldn't second-guess.
    // (After the whitelist these are rare in OCR text — only triggers
    // for menus where the user disabled the whitelist.)
    if (/[₹$€£]|rs\.?|inr/i.test(line)) return false
    // Cheap-dish vocabulary: tea, coffee, water, eggs, paratha, omelette.
    // If the line mentions any, a 200-range price is almost certainly a
    // misread of a 30-90 range price.
    if (/\b(tea|coffee|water|egg|paratha|omelet|omelette|chai|maggi|toast|bread|juice|lemon|soda|biscuit)\b/i.test(line)) {
        return true
    }
    return false
}

/**
 * Extract ALL prices that appear toward the END of a line, in order.
 *
 * Real menus do one of three things at the end of an item row:
 *   • single price       — "Tomato Soup ₹120"
 *   • half-full pair     — "Dal Makhni  110/-150/-"   or "Soup  90 / 120"
 *   • multi-portion      — "Veggies  100 200 300" (rare; first two used)
 *
 * We grab up to two prices and walk back through the line to find the
 * name. A line with no recognised price returns `null` so the caller
 * can treat it as a category header or description.
 */
/**
 * Fix the handful of letter↔digit confusions Tesseract makes in
 * price-shaped contexts. ONLY safe to run on the trailing portion
 * of a line we're already trying to parse as a price — never on
 * dish-name text, which legitimately contains lowercase l's and
 * uppercase O's.
 *
 *   O → 0    (common on round digits in stylised numerals)
 *   l → 1    (common on "1" in serif fonts)
 *   I → 1    (sans-serif "1" looks like an uppercase i)
 *   S → 5    (occasional on stylised "5")
 *   Z → 2    (rare but seen)
 *   B → 8    (rare)
 *
 * We run the fix per-character only against tokens that already
 * look mostly numeric (≥ 50 % digits) so a stray O inside a real
 * word doesn't get mangled.
 */
function fixPriceConfusions(token: string): string {
    const digitCount = (token.match(/\d/g) ?? []).length
    if (digitCount === 0) return token
    if (digitCount / token.length < 0.5) return token
    return token
        .replace(/O/g, "0")
        .replace(/o(?=\d)|(?<=\d)o/g, "0")
        .replace(/l/g, "1")
        .replace(/I/g, "1")
        .replace(/S(?=\d)|(?<=\d)S/g, "5")
        .replace(/Z(?=\d)|(?<=\d)Z/g, "2")
        .replace(/B(?=\d)|(?<=\d)B/g, "8")
}

function extractItemFromLine(line: string): { name: string; prices: number[] } | null {
    // Match a sequence of price tokens hugging the end. Each price
    // looks like: optional currency symbol, 1-5 digits (or near-digit
    // confusables like O/l/I/S/Z/B that we'll normalise below),
    // optional decimal, optional "/-" tail.
    const priceTokenRe = /([₹$€£]|rs\.?|inr|usd)?\s*([\dOolISZBs]{1,6}(?:[.,]\d{1,2})?)\s*\/?-?/gi
    // Walk from the end, collecting prices until we hit non-price text.
    const matches = [...line.matchAll(priceTokenRe)]
    if (matches.length === 0) return null

    // Take only the prices that form a contiguous tail of the line —
    // ones with no real text between them and the end. We rebuild the
    // line right-to-left from `matches`.
    const trailing: { amount: number; start: number; end: number }[] = []
    let cursor = line.length
    for (let i = matches.length - 1; i >= 0; i--) {
        const m = matches[i]!
        const start = m.index!
        const end = start + m[0].length
        // Whatever sits between this match's end and our cursor must
        // be pure whitespace / separators — anything else means this
        // price is embedded inside the name (e.g. "Coffee (250 ml)").
        const between = line.slice(end, cursor)
        if (between && !/^[\s/,\-–—.•·]*$/.test(between)) break
        const raw = fixPriceConfusions(m[2]!).replace(/,/g, ".")
        const amount = Number.parseFloat(raw)
        if (!Number.isFinite(amount) || amount < 1 || amount > 99_999) break
        trailing.unshift({ amount, start, end })
        cursor = start
        if (trailing.length === 2) break // cap at two for half/full
    }
    if (trailing.length === 0) return null

    // The name is everything before the first kept price.
    let name = line.slice(0, trailing[0]!.start)
    name = name.replace(/[.…\-—\s]+$/g, "").trim()
    if (!name || name.length < 2) return null

    // Sanity check on multi-prices: must be sorted ascending (Half <
    // Full). If they're not, OCR likely mis-grouped and the line has
    // one real price plus a stray digit. Fall back to single price.
    let prices = trailing.map((t) => t.amount)
    if (prices.length === 2 && prices[1]! < prices[0]!) {
        prices = [prices[0]!]
    }

    // Currency-symbol-misread correction. When the price is a 200-
    // range number on a line that's clearly a low-cost item (tea,
    // coffee, egg, paratha), the leading "2" is almost certainly
    // the curl of a ₹ symbol Tesseract emitted as a digit. Knock it
    // off the price. Only applies when there's a single price (the
    // half/full pattern has its own ordering check above).
    if (prices.length === 1 && isLikelyCurrencyArtifact(prices[0]!, line)) {
        prices = [prices[0]! - 200]
    }

    return { name, prices }
}

/** A category-header heuristic that is STRICT enough to keep the
 *  parser from labelling random ALL-CAPS dish names as categories. */
function looksLikeCategory(line: string): boolean {
    const trimmed = line.trim()
    if (trimmed.length < 3 || trimmed.length > 40) return false
    if (/\d/.test(trimmed)) return false // headers don't carry digits
    if (/:$/.test(trimmed)) return true   // "STARTERS:" definitely a header
    // ALL CAPS letters + maybe a few separator chars
    const letterCount = (trimmed.match(/[A-Z]/g) ?? []).length
    const lowerCount = (trimmed.match(/[a-z]/g) ?? []).length
    if (letterCount >= 3 && lowerCount === 0) return true
    // Title Case: every word capitalised. Conservative — only short
    // lines (so we don't promote a long dish name like
    // "Pan Seared Trout With Almond Crust" to a category).
    const words = trimmed.split(/\s+/)
    if (words.length > 4) return false
    const titleCase = words.every((w) => /^[A-Z][a-z'&]*$/.test(w) || w.length <= 2)
    return titleCase
}

function suggestFoodType(name: string): FoodType {
    if (EGG_HINTS.test(name) && !NON_VEG_HINTS.test(name)) return "EGG"
    if (NON_VEG_HINTS.test(name)) return "NON_VEG"
    return "VEG"
}

/** Main entry. Hand it the OCR's `data.text` string. */
export function parseMenuText(raw: string): ParsedSection[] {
    if (!raw) return []
    const lines = raw
        .split(/\r?\n/)
        .map((l) => l.replace(/\s+/g, " ").trim())
        // Strip the most common OCR-glyph mis-reads at start / end
        // BEFORE we look at the line. That way "Q COFFEE R/M 30"
        // becomes "COFFEE R/M 30" and isJunkLine / category-detection
        // see clean text.
        .map((l) => cleanLineNoise(l))
        .filter((l) => l.length > 0)
        .filter((l) => !isJunkLine(l))

    const sections: ParsedSection[] = []
    let currentCategory = "Uncategorised"
    let lastItemSeenInCategory = false
    // Buffer: lines that came right before a confirmed item, candidates
    // for description continuation.
    let descBuffer: string[] = []

    function ensureSection(name: string): ParsedSection {
        const last = sections[sections.length - 1]
        if (last && last.category.toLowerCase() === name.toLowerCase()) return last
        const fresh: ParsedSection = { category: name, items: [] }
        sections.push(fresh)
        return fresh
    }

    for (const line of lines) {
        const item = extractItemFromLine(line)

        if (item) {
            const description = descBuffer.length > 0 ? descBuffer.join(" ").trim() : null
            descBuffer = []
            const section = ensureSection(currentCategory)
            const ft = suggestFoodType(item.name)

            if (item.prices.length === 2) {
                // Half/Full pattern — emit TWO items so the owner can
                // keep both, delete one, or rename. The first price
                // is the smaller (Half), the second the larger (Full).
                section.items.push({
                    name: `${item.name} (Half)`,
                    description: description && description.length > 0 ? description : null,
                    price: item.prices[0]!,
                    suggestedFoodType: ft,
                })
                section.items.push({
                    name: `${item.name} (Full)`,
                    description: null,
                    price: item.prices[1]!,
                    suggestedFoodType: ft,
                })
            } else {
                section.items.push({
                    name: item.name,
                    description: description && description.length > 0 ? description : null,
                    price: item.prices[0]!,
                    suggestedFoodType: ft,
                })
            }
            lastItemSeenInCategory = true
            continue
        }

        if (looksLikeCategory(line)) {
            const cat = line.replace(/:$/, "").trim()
            // Normalise pure ALL-CAPS to Title Case for display — easier
            // to read in the editable table.
            const normalised = cat === cat.toUpperCase()
                ? cat.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
                : cat
            currentCategory = normalised
            lastItemSeenInCategory = false
            descBuffer = []
        } else if (lastItemSeenInCategory && descBuffer.length === 0) {
            descBuffer.push(line)
        } else {
            descBuffer = []
        }
    }

    // Drop empty sections + dedupe items within a section by exact
    // (name, price). The overlap added in the column splitter means
    // the same item can appear twice in adjacent column outputs.
    return sections
        .map((s) => ({
            category: s.category,
            items: s.items.filter((it, i, arr) =>
                arr.findIndex((x) => x.name === it.name && x.price === it.price) === i,
            ),
        }))
        .filter((s) => s.items.length > 0)
}
