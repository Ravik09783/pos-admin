import type { Meta, StoryObj } from "@storybook/react-vite"

import { Badge } from "./badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs"

const meta = {
    title: "UI/Tabs",
    component: Tabs,
    tags: ["autodocs"],
} satisfies Meta<typeof Tabs>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
    render: () => (
        <Tabs defaultValue="orders" className="w-[480px]">
            <TabsList>
                <TabsTrigger value="orders">Orders</TabsTrigger>
                <TabsTrigger value="bills">Bills</TabsTrigger>
                <TabsTrigger value="payments">Payments</TabsTrigger>
            </TabsList>
            <TabsContent value="orders" className="text-sm pt-4 text-muted-foreground">Open orders content.</TabsContent>
            <TabsContent value="bills" className="text-sm pt-4 text-muted-foreground">Bills content.</TabsContent>
            <TabsContent value="payments" className="text-sm pt-4 text-muted-foreground">Payments content.</TabsContent>
        </Tabs>
    ),
}

export const WithBadges: Story = {
    render: () => (
        <Tabs defaultValue="pending" className="w-[480px]">
            <TabsList>
                <TabsTrigger value="pending">
                    Pending <Badge variant="warning" className="ml-1.5 text-[10px]">3</Badge>
                </TabsTrigger>
                <TabsTrigger value="preparing">Preparing</TabsTrigger>
                <TabsTrigger value="ready">
                    Ready <Badge variant="success" className="ml-1.5 text-[10px]">2</Badge>
                </TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
        </Tabs>
    ),
    parameters: {
        docs: { description: { story: "The KDS pattern — live counts next to each tab." } },
    },
}
