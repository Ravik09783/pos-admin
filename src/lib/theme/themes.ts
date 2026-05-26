/**
 * The theme catalog. Each entry maps to a `[data-theme="<id>"]` block in
 * `globals.css` that overrides the CSS variables for that look. The provider
 * applies `data-theme` to <html>, and also toggles the `.dark` class on/off
 * so shadcn's `dark:` Tailwind variants keep working for dark-mode themes.
 */

export type ThemeId =
    // Core
    | "neon"
    | "daylight"
    | "midnight"
    | "sunset"
    | "forest"
    | "mono"
    | "ocean"
    | "cherry"
    | "royal"
    | "volcano"
    | "galaxy"
    | "slate"
    | "pastel"
    | "sepia"
    | "bakery"
    // Festivals
    | "diwali"
    | "holi"
    | "dussehra"
    | "onam"
    | "eid"
    | "christmas"
    | "newyear"
    | "valentine"
    | "halloween"

/** Whether the theme is a regular pick or a seasonal celebration. Festivals
 *  are grouped separately in the picker so the catalog stays scannable. */
export type ThemeCategory = "core" | "festival"

export interface ThemeDef {
    id: ThemeId
    name: string
    blurb: string
    mode: "dark" | "light"
    category: ThemeCategory
    /** Three preview colours shown in the picker: background, primary, accent. */
    swatches: [string, string, string]
}

export const THEMES: ThemeDef[] = [
    // ── Core ────────────────────────────────────────────────────────────────
    { id: "neon",     name: "Neon",     blurb: "Electric cyan + magenta · the default",         mode: "dark",  category: "core",     swatches: ["#0a0e1a", "#22d3ee", "#e879f9"] },
    { id: "daylight", name: "Daylight", blurb: "Clean light mode",                              mode: "light", category: "core",     swatches: ["#ffffff", "#0891b2", "#0f172a"] },
    { id: "midnight", name: "Midnight", blurb: "Deep navy, indigo accents",                     mode: "dark",  category: "core",     swatches: ["#06061a", "#818cf8", "#c084fc"] },
    { id: "sunset",   name: "Sunset",   blurb: "Warm violet with amber & magenta",              mode: "dark",  category: "core",     swatches: ["#1a0a1f", "#fb923c", "#ec4899"] },
    { id: "forest",   name: "Forest",   blurb: "Deep green with lime accents",                  mode: "dark",  category: "core",     swatches: ["#04221a", "#84cc16", "#34d399"] },
    { id: "mono",     name: "Mono",     blurb: "Grayscale minimal · no neon",                   mode: "light", category: "core",     swatches: ["#fafafa", "#171717", "#737373"] },
    { id: "ocean",    name: "Ocean",    blurb: "Deep teal · aqua highlights",                   mode: "dark",  category: "core",     swatches: ["#03161e", "#06b6d4", "#5eead4"] },
    { id: "cherry",   name: "Cherry",   blurb: "Rose & pink · romantic dark",                   mode: "dark",  category: "core",     swatches: ["#1a0810", "#f43f5e", "#fb7185"] },
    { id: "royal",    name: "Royal",    blurb: "Deep purple with warm gold",                    mode: "dark",  category: "core",     swatches: ["#120822", "#a855f7", "#fbbf24"] },
    { id: "volcano",  name: "Volcano",  blurb: "Fiery red over charcoal",                       mode: "dark",  category: "core",     swatches: ["#160606", "#ef4444", "#f97316"] },
    { id: "galaxy",   name: "Galaxy",   blurb: "Cosmic violet, blue & pink stars",              mode: "dark",  category: "core",     swatches: ["#0a0824", "#7c3aed", "#f0abfc"] },
    { id: "slate",    name: "Slate",    blurb: "Neutral cool gray · professional",              mode: "dark",  category: "core",     swatches: ["#0f172a", "#94a3b8", "#cbd5e1"] },
    { id: "pastel",   name: "Pastel",   blurb: "Soft mint, peach & lavender (light)",           mode: "light", category: "core",     swatches: ["#fdf4ff", "#a78bfa", "#fb7185"] },
    { id: "sepia",    name: "Sepia",    blurb: "Warm sepia · easy reading (light)",             mode: "light", category: "core",     swatches: ["#f4ecd8", "#92400e", "#b45309"] },
    { id: "bakery",   name: "Bakery",   blurb: "Warm cream + bakery orange · airy POS look",    mode: "light", category: "core",     swatches: ["#f5f1ea", "#f97316", "#fb923c"] },

    // ── Festivals ───────────────────────────────────────────────────────────
    { id: "diwali",    name: "Diwali",    blurb: "Lamps glow · gold & magenta on indigo",       mode: "dark",  category: "festival", swatches: ["#1a0c2a", "#fbbf24", "#ec4899"] },
    { id: "holi",      name: "Holi",      blurb: "Colour-burst · magenta, lime, cyan, gold",    mode: "light", category: "festival", swatches: ["#fff7e0", "#ec4899", "#22d3ee"] },
    { id: "dussehra",  name: "Dussehra",  blurb: "Saffron & vermilion on deep maroon",          mode: "dark",  category: "festival", swatches: ["#2a0a0a", "#f97316", "#fbbf24"] },
    { id: "onam",      name: "Onam",      blurb: "Kerala white · pookalam green & gold",        mode: "light", category: "festival", swatches: ["#fbf6e9", "#15803d", "#ca8a04"] },
    { id: "eid",       name: "Eid",       blurb: "Emerald & gold · crescent night",             mode: "dark",  category: "festival", swatches: ["#04201a", "#10b981", "#facc15"] },
    { id: "christmas", name: "Christmas", blurb: "Evergreen, ruby red & gold trim",             mode: "dark",  category: "festival", swatches: ["#0a1f12", "#dc2626", "#fbbf24"] },
    { id: "newyear",   name: "New Year",  blurb: "Champagne gold & silver on midnight",         mode: "dark",  category: "festival", swatches: ["#070b22", "#fcd34d", "#e5e7eb"] },
    { id: "valentine", name: "Valentine", blurb: "Rose & red · soft romance",                   mode: "light", category: "festival", swatches: ["#fff1f2", "#e11d48", "#fb7185"] },
    { id: "halloween", name: "Halloween", blurb: "Pumpkin orange & witch violet on black",      mode: "dark",  category: "festival", swatches: ["#080503", "#f97316", "#a855f7"] },
]

export const DEFAULT_THEME: ThemeId = "neon"

export const THEME_STORAGE_KEY = "restopos:theme"

/**
 * Inline script injected into <head> so the theme applies BEFORE hydration —
 * no flash of the wrong theme.
 *
 * Resolution order:
 *   1. On a customer-display screen (`/display/...`) a `?theme=` query param
 *      — the URL the restaurant generated for that screen carries their
 *      chosen theme. A valid value is persisted to localStorage so the
 *      device keeps that look on later loads (even without the param).
 *   2. The value already saved in localStorage.
 *   3. The default theme.
 *
 * The dark-theme list and the valid-id list are generated from THEMES, so
 * they can never drift out of sync with the catalog above.
 */
export const themeInitScript = (() => {
    const darkIds = THEMES.filter((t) => t.mode === "dark").map((t) => t.id)
    const allIds = THEMES.map((t) => t.id)
    return `(function(){try{`
        + `var KEY=${JSON.stringify(THEME_STORAGE_KEY)},`
        + `DEF=${JSON.stringify(DEFAULT_THEME)},`
        + `DARK=${JSON.stringify(darkIds)},`
        + `VALID=${JSON.stringify(allIds)};`
        + `var t=null;`
        + `if(location.pathname.indexOf("/display/")===0){`
        +   `var m=/[?&]theme=([^&]+)/.exec(location.search);`
        +   `if(m){var q=decodeURIComponent(m[1]);`
        +     `if(VALID.indexOf(q)>-1){t=q;try{localStorage.setItem(KEY,q);}catch(e){}}}`
        + `}`
        + `if(!t){try{var s=localStorage.getItem(KEY);if(VALID.indexOf(s)>-1){t=s;}}catch(e){}}`
        + `if(!t){t=DEF;}`
        + `var h=document.documentElement;h.setAttribute("data-theme",t);`
        + `if(DARK.indexOf(t)>-1){h.classList.add("dark");h.classList.remove("light");}`
        + `else{h.classList.remove("dark");h.classList.add("light");}`
        + `}catch(e){}})();`
})()

export function isTheme(v: unknown): v is ThemeId {
    return typeof v === "string" && THEMES.some((t) => t.id === v)
}

/**
 * Append `?theme=<id>` to a URL so a customer-display screen opens in the
 * restaurant's current theme. Used when generating the display-screen URLs
 * in Settings → Customer display; the display page's pre-hydration script
 * (themeInitScript) reads the param back and persists it.
 */
export function withThemeParam(url: string, theme: ThemeId): string {
    try {
        const u = new URL(url)
        u.searchParams.set("theme", theme)
        return u.toString()
    } catch {
        // Relative or malformed URL — fall back to a manual append.
        const sep = url.includes("?") ? "&" : "?"
        return `${url}${sep}theme=${encodeURIComponent(theme)}`
    }
}
