import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { DateRangePicker, type DateRange } from "./date-range"

const meta: Meta<typeof DateRangePicker> = {
    title: "Filters/DateRangePicker",
    component: DateRangePicker,
    tags: ["autodocs"],
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "Date range filter used on the Reports, Bills, Orders, and Purchases pages. Has 7 quick-pick presets (Today, Yesterday, Last 7 days, Last 30 days, This month, Last month, This FY) plus from/to date inputs for custom ranges.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof DateRangePicker>

function Demo({ initial }: { initial: DateRange }) {
    const [value, setValue] = useState<DateRange>(initial)
    return (
        <div className="flex flex-col items-start gap-3">
            <DateRangePicker value={value} onChange={setValue} />
            <div className="text-xs text-muted-foreground tabular-nums">
                value: <span className="font-mono">{value.from ?? "—"} → {value.to ?? "—"}</span>
            </div>
        </div>
    )
}

export const Empty: Story = {
    render: () => <Demo initial={{ from: null, to: null }} />,
}

export const TodayPreFilled: Story = {
    render: () => {
        const today = new Date().toISOString().slice(0, 10)
        return <Demo initial={{ from: today, to: today }} />
    },
}

export const ThisMonthPreFilled: Story = {
    render: () => {
        const now = new Date()
        const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
        return <Demo initial={{ from: first, to: now.toISOString().slice(0, 10) }} />
    },
}
