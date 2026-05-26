import { create } from "storybook/theming/create"

/**
 * RestoPOS Storybook chrome theme.
 *
 * Drives BOTH:
 *   • the manager UI (sidebar, top bar, addons panel) via `.storybook/manager.ts`
 *   • the autodocs page chrome (titles, prop tables, story labels) via the
 *     `parameters.docs.theme` setting in `.storybook/preview.tsx`.
 *
 * Colors are pinned to the same HSL values our **default Neon dark theme** in
 * `src/app/globals.css` (`:root, .dark`) uses, so opening a Docs page no
 * longer renders dark Storybook text on our dark `bg-background` — the
 * notorious "black screen" docs bug.
 *
 * If you change the default theme palette in globals.css, mirror the change
 * here so the docs chrome stays in lockstep with the canvas.
 */
export const restoposTheme = create({
    base: "dark",

    // Brand
    brandTitle: "RestoPOS UI",
    brandUrl: "/",
    brandTarget: "_self",

    // App chrome — matches globals.css `:root, .dark` palette in hex form.
    // (hsl values converted to hex; Storybook's theme API requires hex/named.)
    colorPrimary: "#22e0ff",      // hsl(187 100% 55%) — neon cyan
    colorSecondary: "#22e0ff",

    appBg: "#080d18",             // hsl(222 47% 5%)  — background
    appContentBg: "#0c1421",      // hsl(222 47% 7%)  — card
    appPreviewBg: "#080d18",      // canvas iframe background (matches app body)
    appBorderColor: "#1c2438",    // hsl(222 24% 14%) — border
    appBorderRadius: 10,

    // Type — light on dark for the docs page
    fontBase:
        '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    fontCode:
        '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    textColor: "#f0f4fb",         // hsl(210 40% 98%) — foreground
    textInverseColor: "#080d18",
    textMutedColor: "#9aa6bd",    // hsl(215 16% 65%) — muted-foreground

    // Top toolbar inside the manager
    barTextColor: "#9aa6bd",
    barHoverColor: "#22e0ff",
    barSelectedColor: "#22e0ff",
    barBg: "#0c1421",

    // Buttons / inputs in the addons panel
    buttonBg: "#0c1421",
    buttonBorder: "#1c2438",
    booleanBg: "#1c2438",
    booleanSelectedBg: "#22e0ff",
    inputBg: "#0c1421",
    inputBorder: "#1c2438",
    inputTextColor: "#f0f4fb",
    inputBorderRadius: 8,
})
