import type { Meta, StoryObj } from "@storybook/react-vite"
import { Plus, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"

import { PageHeader } from "./page-header"

const meta = {
    title: "App Shell/PageHeader",
    component: PageHeader,
    tags: ["autodocs"],
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The shared header used on every authenticated page. `kicker` + `title` + `highlight` give the same gradient + neon-badge motif as the marketing site.",
            },
        },
    },
} satisfies Meta<typeof PageHeader>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
    args: {
        kicker: "Operations",
        title: "Bills",
        highlight: "issued today",
        description: "Every invoice generated since midnight.",
    },
}

export const WithActions: Story = {
    args: {
        kicker: "Catalog",
        title: "Menu",
        highlight: "tax-ready",
        description: "Categories, items, GST rates and HSN codes.",
        actions: (
            <>
                <Button variant="outline"><Upload className="h-4 w-4" /> Import CSV</Button>
                <Button variant="neon"><Plus className="h-4 w-4" /> New item</Button>
            </>
        ),
    },
}

export const NoKicker: Story = {
    args: {
        title: "Reports",
        description: "Pick a date range to see revenue, top items and payment splits.",
    },
}

export const Compact: Story = {
    args: {
        kicker: "Configure",
        title: "Settings",
        highlight: "your restaurant",
        description: "Profile, tax IDs, invoicing, printed-bill details.",
        compact: true,
    },
}
