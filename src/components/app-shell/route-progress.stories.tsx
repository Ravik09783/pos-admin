import type { Meta, StoryObj } from "@storybook/react-vite"

/**
 * Storybook visual reference for `RouteProgress` — the YouTube-style top
 * progress bar that flashes during App Router navigation. The live
 * component (`src/components/app-shell/route-progress.tsx`) plumbs into
 * usePathname / useSearchParams, neither of which exist in Storybook;
 * here we render the bar at fixed widths so designers can see the look.
 */
function Bar({ width, fading = false }: { width: number; fading?: boolean }) {
    return (
        <div className="w-full max-w-2xl">
            <div className="relative h-12 bg-card border border-border rounded-md overflow-hidden flex items-center justify-center text-xs text-muted-foreground">
                Page content area
                <div
                    className="absolute top-0 left-0 h-0.5 transition-all duration-200"
                    style={{
                        width: `${width}%`,
                        background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--neon-magenta)))",
                        boxShadow: "0 0 8px hsl(var(--primary) / 0.6)",
                        opacity: fading ? 0 : 1,
                    }}
                />
            </div>
        </div>
    )
}

const meta = {
    title: "AppShell/RouteProgress",
    component: Bar,
    tags: ["autodocs"],
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Top-of-page progress bar that gives users 'something is happening' feedback during route changes. Lives once in `<body>` so it covers every page. Animates from 0 → ~85% on internal-link click, then jumps to 100% and fades when the new route lands.",
            },
        },
    },
} satisfies Meta<typeof Bar>
export default meta
type Story = StoryObj<typeof meta>

export const JustStarted: Story = { args: { width: 10 } }
export const MidNavigation: Story = { args: { width: 60 } }
export const AboutToComplete: Story = { args: { width: 85 } }
export const Finishing: Story = { args: { width: 100, fading: true } }
