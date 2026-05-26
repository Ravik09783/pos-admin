import type { Meta, StoryObj } from "@storybook/react-vite"
import { CheckCircle2, CircleDollarSign } from "lucide-react"
import { toast } from "sonner"

import { Button } from "./button"
import { Toaster } from "./sonner"

const meta: Meta<typeof Toaster> = {
    title: "UI/Toaster",
    component: Toaster,
    tags: ["autodocs"],
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "Mounted once in the root `<body>`. Wraps Sonner's `<Toaster>` with the app's glass/glow styling so toasts pick up the active theme automatically. Use `toast(...)`, `toast.success(...)`, `toast.error(...)` from `sonner` anywhere in the app to fire one.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof Toaster>

/** Mount the Toaster + a panel of buttons that fire every common variant. */
export const Playground: Story = {
    render: () => (
        <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">
                Click a button — the toast appears in the corner of the viewport.
            </p>
            <div className="flex flex-wrap gap-2">
                <Button onClick={() => toast("New order placed", { description: "Table 4 · 3 items" })}>
                    Default
                </Button>
                <Button
                    variant="success"
                    onClick={() => toast.success("Payment received", {
                        icon: <CircleDollarSign className="h-4 w-4 text-success" />,
                        description: "₹787.50 via RAZORPAY",
                    })}
                >
                    Success
                </Button>
                <Button
                    variant="warning"
                    onClick={() => toast.warning("Stock low", { description: "Paneer — 0.5 kg remaining" })}
                >
                    Warning
                </Button>
                <Button
                    variant="destructive"
                    onClick={() => toast.error("Payment failed", { description: "Card declined — try another method" })}
                >
                    Error
                </Button>
                <Button
                    variant="outline"
                    onClick={() =>
                        toast("Send invite link?", {
                            description: "karan@example.com will get a sign-up link.",
                            action: {
                                label: "Send",
                                onClick: () =>
                                    toast.success("Invite sent", {
                                        icon: <CheckCircle2 className="h-4 w-4 text-success" />,
                                    }),
                            },
                        })
                    }
                >
                    With action
                </Button>
                <Button
                    variant="ghost"
                    onClick={() => {
                        const id = toast.loading("Syncing offline bills…")
                        setTimeout(() => toast.success("All caught up", { id }), 1500)
                    }}
                >
                    Loading → resolve
                </Button>
            </div>
            <Toaster />
        </div>
    ),
}
