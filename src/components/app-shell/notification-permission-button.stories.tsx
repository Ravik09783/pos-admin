import type { Meta, StoryObj } from "@storybook/react-vite"
import { Bell, BellOff } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Storybook can't actually flip browser `Notification.permission` state
 * (it's read-only and per-origin). So instead of importing the smart
 * component, we render presentation-only copies of each of its three
 * visual states. The real component lives at
 * `src/components/app-shell/notification-permission-button.tsx`.
 */
const meta = {
    title: "AppShell/NotificationPermissionButton",
    tags: ["autodocs"],
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "Topbar button that asks for browser notification permission so OS-level alerts fire when QR orders land. Renders nothing when permission is `granted` (no clutter), prompts when `default`, shows a muted bell when `denied`.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** Default state: permission not yet asked. The button prompts the user. */
export const Default_Prompt: Story = {
    render: () => (
        <Button variant="outline" size="sm" className="gap-1.5 h-8">
            <Bell className="h-3.5 w-3.5" />
            <span>Enable alerts</span>
        </Button>
    ),
}

/** Permission previously granted — button hides completely. */
export const Granted_Hidden: Story = {
    render: () => (
        <div className="text-xs text-muted-foreground">
            (Renders null — no button visible when permission is &quot;granted&quot;.)
        </div>
    ),
}

/** Permission denied — muted bell icon hints they can re-enable via browser settings. */
export const Denied: Story = {
    render: () => (
        <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            title="Order alerts are blocked. Click your browser's address-bar lock icon → Notifications → Allow."
        >
            <BellOff className="h-4 w-4" />
        </Button>
    ),
}
