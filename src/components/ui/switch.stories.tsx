import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { Label } from "./label"
import { Switch } from "./switch"

const meta = {
    title: "UI/Switch",
    component: Switch,
    tags: ["autodocs"],
} satisfies Meta<typeof Switch>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: {} }
export const Checked: Story = { args: { defaultChecked: true } }
export const Disabled: Story = { args: { disabled: true, defaultChecked: true } }

export const WithLabel: Story = {
    render: function ToggleStory() {
        const [on, setOn] = useState(true)
        return (
            <div className="flex items-center justify-between rounded-md border border-border/60 p-3 w-72">
                <Label htmlFor="qr-on">QR ordering enabled</Label>
                <Switch id="qr-on" checked={on} onCheckedChange={setOn} />
            </div>
        )
    },
}
