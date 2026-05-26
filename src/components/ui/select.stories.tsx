import type { Meta, StoryObj } from "@storybook/react-vite"

import { Label } from "./label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"

const meta = {
    title: "UI/Select",
    component: Select,
    tags: ["autodocs"],
} satisfies Meta<typeof Select>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
    render: () => (
        <div className="space-y-1.5 w-72">
            <Label>Country</Label>
            <Select defaultValue="IN">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="IN">India</SelectItem>
                    <SelectItem value="AE">United Arab Emirates</SelectItem>
                    <SelectItem value="GB">United Kingdom</SelectItem>
                    <SelectItem value="US">United States</SelectItem>
                </SelectContent>
            </Select>
        </div>
    ),
}

export const Channel: Story = {
    render: () => (
        <div className="space-y-1.5 w-72">
            <Label className="text-xs">Channel</Label>
            <Select defaultValue="ALL">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="ALL">All channels</SelectItem>
                    <SelectItem value="DIRECT">Direct only</SelectItem>
                    <SelectItem value="SWIGGY">Swiggy</SelectItem>
                    <SelectItem value="ZOMATO">Zomato</SelectItem>
                    <SelectItem value="PHONE">Phone</SelectItem>
                </SelectContent>
            </Select>
        </div>
    ),
}
