import type { Meta, StoryObj } from "@storybook/react-vite"

import { Badge } from "./badge"

const meta = {
    title: "UI/Badge",
    component: Badge,
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Compact status / category chip. Use **`success`** for PAID, **`warning`** for pending, **`destructive`** for VOID, **`outline`** for neutral info (B2B, FY label).",
            },
        },
    },
    argTypes: {
        variant: { control: "select", options: ["default", "secondary", "destructive", "success", "warning", "outline", "neon"] },
    },
} satisfies Meta<typeof Badge>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { children: "GENERATED" } }
export const Paid: Story = { args: { variant: "success", children: "PAID" } }
export const Unpaid: Story = { args: { variant: "warning", children: "UNPAID" } }
export const Void: Story = { args: { variant: "destructive", children: "VOID" } }
export const B2B: Story = { args: { variant: "outline", children: "B2B" } }
export const Neon: Story = { args: { variant: "neon", children: "★ Premium" } }

export const AllVariants: Story = {
    render: () => (
        <div className="flex flex-wrap items-center gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="destructive">Destructive</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="neon">Neon</Badge>
        </div>
    ),
}
