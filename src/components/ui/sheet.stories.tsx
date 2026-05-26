import type { Meta, StoryObj } from "@storybook/react-vite"

import { Button } from "./button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "./sheet"

const meta = {
    title: "UI/Sheet",
    component: Sheet,
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Side-drawer overlay used for the table drill-in, the mobile nav, and other long-form inline detail. Default side is `right`.",
            },
        },
    },
} satisfies Meta<typeof Sheet>
export default meta
type Story = StoryObj<typeof meta>

export const RightSide: Story = {
    render: () => (
        <Sheet>
            <SheetTrigger asChild><Button variant="outline">Open right sheet</Button></SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-xl">
                <SheetTitle>Table T7 · Running order</SheetTitle>
                <p className="text-sm text-muted-foreground mt-2">All KOTs and items for this seating live here.</p>
            </SheetContent>
        </Sheet>
    ),
}

export const LeftSide: Story = {
    render: () => (
        <Sheet>
            <SheetTrigger asChild><Button variant="outline">Open left sheet</Button></SheetTrigger>
            <SheetContent side="left" className="w-64">
                <SheetTitle>Navigation</SheetTitle>
                <p className="text-sm text-muted-foreground mt-2">Mobile-nav pattern.</p>
            </SheetContent>
        </Sheet>
    ),
}
