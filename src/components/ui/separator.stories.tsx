import type { Meta, StoryObj } from "@storybook/react-vite"

import { Separator } from "./separator"

const meta = {
    title: "UI/Separator",
    component: Separator,
    tags: ["autodocs"],
} satisfies Meta<typeof Separator>
export default meta
type Story = StoryObj<typeof meta>

export const Horizontal: Story = {
    render: () => (
        <div className="w-80 space-y-3">
            <div className="text-sm">Above the line.</div>
            <Separator />
            <div className="text-sm">Below the line.</div>
        </div>
    ),
}

export const Vertical: Story = {
    render: () => (
        <div className="flex h-12 items-center gap-3 text-sm">
            <span>Left</span>
            <Separator orientation="vertical" />
            <span>Right</span>
        </div>
    ),
}
