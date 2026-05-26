import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { FlyOverlay, type FlyEvent } from "./fly-to-cart"

const meta: Meta<typeof FlyOverlay> = {
    title: "QR/FlyToCart",
    component: FlyOverlay,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Animates a small coloured pill flying from a source point (the 'Add' button on a menu tile) to the cart icon in the corner. Uses a curved Bezier arc so the motion feels real, not linear. The `useFlyToCart` hook is what consumers usually call; this story exercises the underlying `FlyOverlay` so designers can see the animation in isolation.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof FlyOverlay>

const COLORS = ["#06b6d4", "#a855f7", "#22c55e", "#f59e0b", "#ec4899"]

/** Interactive — click "Add" to fly a pill toward the cart. */
export const Interactive: Story = {
    render: () => {
        const [events, setEvents] = useState<FlyEvent[]>([])

        function fire(e: React.MouseEvent<HTMLButtonElement>) {
            const rect = e.currentTarget.getBoundingClientRect()
            const target = document.getElementById("story-cart")?.getBoundingClientRect()
            if (!target) return
            setEvents((prev) => [
                ...prev,
                {
                    id: Date.now() + Math.random(),
                    fromX: rect.left + rect.width / 2,
                    fromY: rect.top + rect.height / 2,
                    toX: target.left + target.width / 2,
                    toY: target.top + target.height / 2,
                    label: "+1",
                    color: COLORS[events.length % COLORS.length]!,
                },
            ])
        }

        return (
            <div className="relative min-h-[500px] bg-background">
                <div className="p-6 grid gap-4 grid-cols-2 sm:grid-cols-3 max-w-2xl">
                    <Button variant="neon" onClick={fire}>Add Pizza</Button>
                    <Button variant="neon" onClick={fire}>Add Coke</Button>
                    <Button variant="neon" onClick={fire}>Add Tiramisu</Button>
                    <Button variant="neon" onClick={fire}>Add Pasta</Button>
                    <Button variant="neon" onClick={fire}>Add Naan</Button>
                    <Button variant="neon" onClick={fire}>Add Lassi</Button>
                </div>
                <div
                    id="story-cart"
                    className="fixed top-4 right-4 h-14 w-14 rounded-full bg-primary text-primary-foreground grid place-items-center font-bold shadow-glow"
                >
                    🛒
                </div>
                <FlyOverlay
                    events={events}
                    onComplete={(id) => setEvents((p) => p.filter((e) => e.id !== id))}
                />
            </div>
        )
    },
}
