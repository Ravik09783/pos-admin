import type { Meta, StoryObj } from "@storybook/react-vite"

import { FestivalAmbient } from "./festival-ambient"

/**
 * Story for the festival particle layer. Live behavior is driven by the
 * theme picker in the Storybook toolbar — pick a festival theme (Diwali,
 * Christmas, etc.) at the top and the right emoji rain appears.
 */
const meta = {
    title: "AppShell/FestivalAmbient",
    component: FestivalAmbient,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Pointer-events-none particle layer mounted once at the root. Reads the current theme — only the festival themes (Diwali, Holi, Dussehra, Onam, Eid, Christmas, New Year, Valentine, Halloween) spawn particles. Auto-disabled on screens narrower than 1024px and for users with `prefers-reduced-motion: reduce`.",
            },
        },
    },
} satisfies Meta<typeof FestivalAmbient>
export default meta
type Story = StoryObj<typeof meta>

/** The component itself — pick a festival theme from the toolbar to see particles. */
export const Default: Story = {
    render: () => (
        <div className="min-h-[80vh] grid place-items-center text-center text-muted-foreground text-sm">
            <div className="max-w-md space-y-2">
                <div className="text-foreground font-medium">Pick a festival theme in the toolbar ↑</div>
                <p>
                    Diwali, Holi, Christmas, Eid, Halloween, New Year etc. spawn
                    a different emoji ambience. Non-festival themes (Neon,
                    Cherry, Ocean, …) show nothing.
                </p>
                <p className="text-xs">
                    The ambience hides on screens narrower than 1024px and
                    when prefers-reduced-motion is on.
                </p>
            </div>
            <FestivalAmbient />
        </div>
    ),
}
