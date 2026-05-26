import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { Pagination } from "./pagination"

const meta: Meta<typeof Pagination> = {
    title: "Filters/Pagination",
    component: Pagination,
    tags: ["autodocs"],
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Standard pagination strip used on the Bills, Orders, Customers, and Purchases lists. Shows 'Showing N-M of TOTAL', a page-size selector (25/50/100/250), and first / prev / next / last buttons.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof Pagination>

function Demo({ total }: { total: number }) {
    const [page, setPage] = useState(0)
    const [pageSize, setPageSize] = useState(50)
    return (
        <div className="border border-border rounded-md w-full max-w-3xl">
            <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
            />
        </div>
    )
}

/** First page of a large list. */
export const LargeList: Story = {
    render: () => <Demo total={4218} />,
}

/** Small list — single page, prev/next disabled. */
export const SinglePage: Story = {
    render: () => <Demo total={32} />,
}

/** Empty state — "0 results". */
export const Empty: Story = {
    render: () => <Demo total={0} />,
}

/** Exact page-boundary count — total = pageSize × N. */
export const ExactPageMultiple: Story = {
    render: () => <Demo total={200} />,
}
