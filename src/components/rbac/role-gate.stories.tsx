import type { Meta, StoryObj } from "@storybook/react-vite"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

/**
 * Storybook reference for `RoleGate`. The live component reads the
 * signed-in user's role from Supabase, which isn't available in
 * Storybook. Here we show the two visual states (children rendered vs
 * fallback rendered) deterministically.
 */
function StaticGate({
    show, children, fallback,
}: { show: boolean; children: React.ReactNode; fallback?: React.ReactNode }) {
    return <>{show ? children : (fallback ?? null)}</>
}

const meta = {
    title: "RBAC/RoleGate",
    component: StaticGate,
    tags: ["autodocs"],
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "Hides a child element unless the signed-in user's role grants a given permission. **Don't rely on this for security** — the RLS policies on Postgres are the real authority. This just avoids surfacing buttons that would 403 anyway. The `useCan(permission)` hook is the same logic in inline-conditional form.",
            },
        },
    },
} satisfies Meta<typeof StaticGate>
export default meta
type Story = StoryObj<typeof meta>

/** Permission granted: children render. */
export const Allowed: Story = {
    args: {
        show: true,
        children: <Button variant="neon">Generate bill</Button>,
    },
}

/** Permission denied with no fallback: nothing visible. */
export const Denied_NoFallback: Story = {
    args: { show: false, children: <Button variant="neon">Generate bill</Button> },
    parameters: { docs: { description: { story: "Most common pattern: hide entirely from non-admins." } } },
}

/** Denied with a fallback label (upsell / "read-only" badge). */
export const Denied_WithFallback: Story = {
    args: {
        show: false,
        children: <Button variant="neon">Edit menu</Button>,
        fallback: <Badge variant="outline">Read-only</Badge>,
    },
    parameters: { docs: { description: { story: "Use the `fallback` prop when you want non-admins to see *something* — a badge, a paywall, a hint." } } },
}
