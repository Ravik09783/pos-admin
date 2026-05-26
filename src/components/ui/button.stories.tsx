import type { Meta, StoryObj } from "@storybook/react-vite"
import { CheckCircle2, Plus, Trash2 } from "lucide-react"

import { Button } from "./button"

const meta = {
    title: "UI/Button",
    component: Button,
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "The primary action element. **`neon`** is the brand accent — reserve it for the single most important action on a screen (Generate bill, Submit). Use **`destructive`** for irreversible actions (Delete, Void). Everything else is variations on a less-loud theme.",
            },
        },
    },
    argTypes: {
        variant: {
            control: "select",
            options: ["default", "neon", "destructive", "outline", "secondary", "ghost", "link", "success", "warning"],
        },
        size: { control: "select", options: ["default", "sm", "lg", "xl", "icon"] },
        disabled: { control: "boolean" },
    },
} satisfies Meta<typeof Button>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { children: "Click me" } }
export const Neon: Story = { args: { variant: "neon", children: "Generate bill" } }
export const Destructive: Story = { args: { variant: "destructive", children: "Void bill" } }
export const Outline: Story = { args: { variant: "outline", children: "Cancel" } }
export const Ghost: Story = { args: { variant: "ghost", children: "Skip" } }
export const Disabled: Story = { args: { variant: "neon", children: "Saving…", disabled: true } }
export const WithIcon: Story = {
    args: { variant: "neon", children: (<><Plus className="h-4 w-4" /> Add item</>) as never },
}
export const IconOnly: Story = {
    args: { variant: "ghost", size: "icon", children: <Trash2 className="h-4 w-4" /> },
}

/** The full grid of variants × sizes, for visual review. */
export const AllVariants: Story = {
    render: () => (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
                <Button>Default</Button>
                <Button variant="neon">Neon</Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="link">Link</Button>
                <Button variant="success"><CheckCircle2 className="h-4 w-4" /> Success</Button>
                <Button variant="warning">Warning</Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
                <Button size="sm">Small</Button>
                <Button size="default">Default</Button>
                <Button size="lg">Large</Button>
                <Button size="xl">Extra large</Button>
                <Button size="icon"><Plus className="h-4 w-4" /></Button>
            </div>
        </div>
    ),
    parameters: { docs: { source: { state: "open" } } },
}
