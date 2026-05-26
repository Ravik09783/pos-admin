import type { Meta, StoryObj } from "@storybook/react-vite"

import { ThemeToggle } from "./theme-toggle"

const meta = {
    title: "App Shell/ThemeToggle",
    component: ThemeToggle,
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "The palette dropdown that swaps between Neon / Daylight / Midnight / Sunset / Forest / Mono. The Storybook toolbar's own theme switcher is wired to the same `setTheme()` — open the toggle and pick a theme to see it sync.",
            },
        },
    },
} satisfies Meta<typeof ThemeToggle>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const InHeader: Story = {
    render: () => (
        <div className="flex items-center justify-between rounded-md border border-border/60 px-4 py-2 w-[480px]">
            <span className="text-sm font-semibold">My Restaurant</span>
            <ThemeToggle />
        </div>
    ),
}
