import type { Preview } from "@storybook/react-vite"
import { useEffect } from "react"

import { ThemeProvider, useTheme } from "@/lib/theme/provider"
import { THEMES, type ThemeId } from "@/lib/theme/themes"

// Load the same Tailwind globals + theme variables the real app uses, so
// stories look pixel-identical to what users see.
import "../src/app/globals.css"

// Storybook Docs-page overrides. Forces autodocs `.sbdocs` surfaces to use
// our theme tokens so descriptions, prop tables, and headings stay readable
// on top of our dark `bg-background` body. Re-skins automatically with the
// toolbar theme picker.
import "./docs.css"

import { restoposTheme } from "./restopos-theme"

/** Bridges the Storybook toolbar theme picker → our ThemeProvider. */
function ThemeSync({ theme, children }: { theme: string; children: React.ReactNode }) {
    const { setTheme } = useTheme()
    useEffect(() => { setTheme(theme as ThemeId) }, [theme, setTheme])
    return <>{children}</>
}

const preview: Preview = {
    parameters: {
        controls: {
            matchers: { color: /(background|color)$/i, date: /Date$/i },
        },
        layout: "centered",
        backgrounds: { disable: true }, // we use the app's themed background instead
        docs: {
            // Dark autodocs page chrome that matches our default Neon canvas.
            // Without this, Storybook ships a white-page docs theme and its
            // dark text lands on our dark `bg-background` body → the entire
            // Docs tab renders as a black screen.
            theme: restoposTheme,
        },
    },
    globalTypes: {
        theme: {
            description: "Restaurant POS theme — drives the same CSS variables real users see.",
            defaultValue: "neon",
            toolbar: {
                title: "Theme",
                icon: "paintbrush",
                // Derived from the single source of truth so adding a theme
                // to THEMES auto-shows in Storybook without a second edit.
                items: THEMES.map((t) => ({ value: t.id, title: t.name })),
                dynamicTitle: true,
            },
        },
    },
    decorators: [
        (Story, context) => (
            <ThemeProvider>
                <ThemeSync theme={(context.globals.theme as string) ?? "neon"}>
                    <div className="bg-background text-foreground min-h-[200px] p-6">
                        <Story />
                    </div>
                </ThemeSync>
            </ThemeProvider>
        ),
    ],
}

export default preview
