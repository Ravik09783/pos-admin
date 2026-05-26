import type { Meta, StoryObj } from "@storybook/react-vite"

import { Input } from "./input"
import { Label } from "./label"

const meta = {
    title: "UI/Label",
    component: Label,
    tags: ["autodocs"],
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "Form label primitive. Wraps Radix `<Label.Root>` so clicking the label focuses its `htmlFor` input. Used on every form across the app.",
            },
        },
    },
} satisfies Meta<typeof Label>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
    args: { children: "Customer name" },
}

export const PairedWithInput: Story = {
    render: () => (
        <div className="space-y-1.5 w-72">
            <Label htmlFor="phone">Phone *</Label>
            <Input id="phone" placeholder="+91 99000 11122" />
        </div>
    ),
}

export const RequiredMarker: Story = {
    render: () => (
        <Label>
            GSTIN <span className="text-destructive">*</span>
        </Label>
    ),
}
