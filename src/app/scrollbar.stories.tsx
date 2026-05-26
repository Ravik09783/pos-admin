import type { Meta, StoryObj } from "@storybook/react-vite"

import { Card, CardContent } from "@/components/ui/card"

/**
 * Visual reference for the app's three scrollbar treatments. Defined in
 * `src/app/globals.css` and applied site-wide via:
 *
 *   • the **global default** — every overflow surface on `pointer:fine`
 *     devices picks up a theme-aware thumb (muted resting, primary on hover).
 *   • **`.scrollbar-thin`** — slimmer 6px variant for tight surfaces
 *     (cart aside, category chip strip, dropdown menus).
 *   • **`.scrollbar-themed`** — chunkier 10px primary→neon-magenta
 *     gradient thumb. Applied to every Dialog and Sheet popup so the
 *     scrollbar pulls the popup's accent color out of the active theme.
 */
const meta: Meta = {
    title: "Foundations/Scrollbars",
    tags: ["autodocs"],
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Three scrollbar treatments, all driven by CSS custom properties so they re-skin automatically when the user picks a new theme (Neon, Cherry, Ocean, etc.) from the toolbar. The global default applies to anything that overflows on desktop. **Try the theme picker in the toolbar above — the gradient thumb tracks the theme.**",
            },
        },
    },
}
export default meta
type Story = StoryObj

const LOREM = Array.from({ length: 40 }, (_, i) => (
    <p key={i} className="text-sm leading-relaxed">
        <span className="font-mono text-xs text-muted-foreground mr-2">{String(i + 1).padStart(2, "0")}.</span>
        The quick brown fox jumps over the lazy dog. This is filler content so the
        scrollbar has room to live. Resize the panel to see how the thumb scales.
    </p>
))

function VerticalShowcase({ className, label }: { className: string; label: string }) {
    return (
        <Card className="w-72">
            <CardContent className="p-0">
                <div className="px-3 py-2 border-b border-border/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {label}
                </div>
                <div className={`h-64 overflow-y-auto p-3 space-y-2 ${className}`}>
                    {LOREM}
                </div>
            </CardContent>
        </Card>
    )
}

function HorizontalShowcase({ className, label }: { className: string; label: string }) {
    return (
        <Card className="w-96">
            <CardContent className="p-0">
                <div className="px-3 py-2 border-b border-border/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {label}
                </div>
                <div className={`overflow-x-auto p-3 ${className}`}>
                    <div className="flex gap-3 w-max">
                        {Array.from({ length: 20 }, (_, i) => (
                            <div key={i} className="shrink-0 h-20 w-32 rounded-md bg-gradient-to-br from-primary/15 via-card to-[hsl(var(--neon-magenta)/0.12)] border border-border/60 grid place-items-center text-sm font-medium text-muted-foreground">
                                Item {i + 1}
                            </div>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

/** Side-by-side comparison of all three vertical treatments. */
export const Vertical_AllThree: Story = {
    render: () => (
        <div className="flex flex-wrap gap-4">
            <VerticalShowcase
                label="Global default (no class)"
                className=""
            />
            <VerticalShowcase
                label=".scrollbar-thin (6px)"
                className="scrollbar-thin"
            />
            <VerticalShowcase
                label=".scrollbar-themed (10px gradient)"
                className="scrollbar-themed"
            />
        </div>
    ),
}

/** Same three on the horizontal axis. */
export const Horizontal_AllThree: Story = {
    render: () => (
        <div className="space-y-4">
            <HorizontalShowcase label="Global default" className="" />
            <HorizontalShowcase label=".scrollbar-thin" className="scrollbar-thin" />
            <HorizontalShowcase label=".scrollbar-themed" className="scrollbar-themed" />
        </div>
    ),
}

/** Just the themed variant — the look you get inside every dialog/sheet. */
export const ThemedVariant_DialogContext: Story = {
    render: () => (
        <div className="grid gap-4">
            <p className="text-sm text-muted-foreground max-w-md">
                This is what the vertical bar looks like inside every popup.
                The Dialog and Sheet primitives already apply{" "}
                <code className="text-foreground">scrollbar-themed</code>{" "}
                automatically — no extra work at call site.
            </p>
            <VerticalShowcase
                label="Inside a popup (e.g., Checkout, Item Add, Settings dialog)"
                className="scrollbar-themed"
            />
        </div>
    ),
}
