import type { Meta, StoryObj } from "@storybook/react-vite"
import { Search } from "lucide-react"

import { Input } from "./input"
import { Label } from "./label"

const meta = {
    title: "UI/Input",
    component: Input,
    tags: ["autodocs"],
} satisfies Meta<typeof Input>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { placeholder: "Type here…" } }
export const WithValue: Story = { args: { defaultValue: "Margherita Pizza" } }
export const Disabled: Story = { args: { defaultValue: "Read only", disabled: true } }

export const WithLabel: Story = {
    render: () => (
        <div className="space-y-1.5 w-72">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="you@restaurant.com" />
        </div>
    ),
}

export const Money: Story = {
    render: () => (
        <div className="space-y-1.5 w-72">
            <Label htmlFor="amount">Amount</Label>
            <Input id="amount" type="number" step="0.01" min="0" placeholder="0.00" className="text-lg font-mono" />
            <p className="text-[11px] text-muted-foreground">Numbers use a monospace font for table alignment.</p>
        </div>
    ),
}

export const WithIconAffordance: Story = {
    render: () => (
        <div className="relative w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search menu" className="pl-8" />
        </div>
    ),
}
