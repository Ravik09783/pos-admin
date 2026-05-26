import type { Meta, StoryObj } from "@storybook/react-vite"
import { Receipt, TrendingUp } from "lucide-react"

import { Badge } from "./badge"
import { Button } from "./button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card"

const meta = {
    title: "UI/Card",
    component: Card,
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "The base container for almost every dashboard / form / data panel in the app. Add `className=\"neon-border\"` for the brand-accented frame used on highlights.",
            },
        },
    },
} satisfies Meta<typeof Card>
export default meta
type Story = StoryObj<typeof meta>

export const Plain: Story = {
    render: () => (
        <Card className="w-80">
            <CardContent className="p-4">A plain card holds anything.</CardContent>
        </Card>
    ),
}

export const WithHeader: Story = {
    render: () => (
        <Card className="w-80">
            <CardHeader>
                <CardTitle className="text-base">Today&apos;s revenue</CardTitle>
                <CardDescription>Sum of paid bills in the current day</CardDescription>
            </CardHeader>
            <CardContent className="text-2xl font-bold tabular-nums">₹ 12,480</CardContent>
        </Card>
    ),
}

/** The brand-accented frame — used for dashboard heroes + headline cards. */
export const NeonBorder: Story = {
    render: () => (
        <Card className="neon-border w-80">
            <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                    <TrendingUp className="h-4 w-4 text-success" /> Revenue today
                </div>
                <div className="text-3xl font-bold tabular-nums text-success">₹ 12,480</div>
                <div className="text-xs text-muted-foreground">23 bills · avg ₹542</div>
            </CardContent>
        </Card>
    ),
}

export const KpiTile: Story = {
    render: () => (
        <div className="grid grid-cols-2 gap-3 w-[480px]">
            {[
                { label: "Bills", value: "23", accent: "primary" },
                { label: "Cash", value: "₹ 8,420", accent: "success" },
                { label: "Online", value: "₹ 4,060", accent: "primary" },
                { label: "Other", value: "₹ 0", accent: "neutral" },
            ].map((k) => (
                <Card key={k.label}>
                    <CardContent className="p-3">
                        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                            <Receipt className="h-3.5 w-3.5" /> {k.label}
                        </div>
                        <div className="text-2xl font-bold tabular-nums">{k.value}</div>
                    </CardContent>
                </Card>
            ))}
        </div>
    ),
}

export const Empty: Story = {
    render: () => (
        <Card className="w-80">
            <CardContent className="py-16 text-center text-muted-foreground">
                <p className="text-sm">No bills yet.</p>
                <Button variant="neon" size="sm" className="mt-3">Generate first bill</Button>
            </CardContent>
        </Card>
    ),
}

export const WithBadge: Story = {
    render: () => (
        <Card className="w-80">
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">Bill INV-2025-26-00042</CardTitle>
                    <Badge variant="success">PAID</Badge>
                </div>
                <CardDescription>11 May 2026 · Walk-in</CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
                Pizza × 1, Garlic bread × 2, Coke × 1
                <div className="mt-2 text-lg font-semibold tabular-nums">₹ 740</div>
            </CardContent>
        </Card>
    ),
}
