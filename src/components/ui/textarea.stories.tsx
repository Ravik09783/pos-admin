import type { Meta, StoryObj } from "@storybook/react-vite"

import { Label } from "./label"
import { Textarea } from "./textarea"

const meta = {
    title: "UI/Textarea",
    component: Textarea,
    tags: ["autodocs"],
} satisfies Meta<typeof Textarea>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
    render: () => (
        <div className="space-y-1.5 w-80">
            <Label>Anything special?</Label>
            <Textarea placeholder="e.g. less spicy, no onion, extra napkins" />
        </div>
    ),
}

export const Filled: Story = {
    args: { defaultValue: "Customer is allergic to peanuts — please double-check.", rows: 3 },
}
