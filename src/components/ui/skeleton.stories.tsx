import type { Meta, StoryObj } from "@storybook/react-vite"

import { Skeleton } from "./skeleton"

const meta = {
    title: "UI/Skeleton",
    component: Skeleton,
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Loading placeholder. Match the shape of the content being loaded — never a generic spinner if the page can pre-shape what's coming.",
            },
        },
    },
} satisfies Meta<typeof Skeleton>
export default meta
type Story = StoryObj<typeof meta>

export const SingleLine: Story = { args: { className: "h-4 w-48" } }
export const Block: Story = { args: { className: "h-32 w-80" } }

export const RowList: Story = {
    render: () => (
        <div className="space-y-3 w-80">
            {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-2 flex-1">
                        <Skeleton className="h-3 w-2/3" />
                        <Skeleton className="h-3 w-1/3" />
                    </div>
                </div>
            ))}
        </div>
    ),
}

export const Card: Story = {
    render: () => (
        <div className="space-y-3 w-80 rounded-lg border border-border/40 p-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-10 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
        </div>
    ),
}
