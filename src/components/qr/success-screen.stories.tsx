import type { Meta, StoryObj } from "@storybook/react-vite"

import { SuccessScreen } from "./success-screen"

const meta = {
    title: "QR/SuccessScreen",
    component: SuccessScreen,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Shown to the QR customer right after their payment captures. Fires a confetti burst on mount, lists what they ordered, shows the totals, and exposes a 'Download bill' button once the server has generated the bill row (the webhook does that after `confirm_qr_order_system` lands).",
            },
        },
    },
} satisfies Meta<typeof SuccessScreen>
export default meta
type Story = StoryObj<typeof meta>

const SAMPLE_SUMMARY = {
    items: [
        { item_name: "Margherita Pizza", quantity: 1, unit_price: 320, gst_slab: 5, line_total: 320 },
        { item_name: "Garlic Bread", quantity: 2, unit_price: 140, gst_slab: 5, line_total: 280 },
        { item_name: "Iced Latte", quantity: 1, unit_price: 150, gst_slab: 12, line_total: 150 },
    ],
    subtotal: 750,
    tax: 47.5,
    grand_total: 798,
    order_number: "QR-12345678",
    customer_name: "Priya",
    customer_phone: "+91 90000 11122",
    bill_url: "/b/spice-garden/INV-2025-26-00042",
    invoice_number: "INV-2025-26-00042",
}

/** Bill is ready — download button works. Most common state once the webhook has fired. */
export const BillReady: Story = {
    args: {
        orderNumber: "QR-12345678",
        summary: SAMPLE_SUMMARY,
        currency: "INR",
        taxLabel: "GST",
        onStartNew: () => {},
    },
}

/** Right after redirect from Stripe/Razorpay — bill row not yet created server-side. */
export const BillPending: Story = {
    args: {
        orderNumber: "QR-12345678",
        summary: { ...SAMPLE_SUMMARY, bill_url: null, invoice_number: null },
        currency: "INR",
        taxLabel: "GST",
    },
}

/** Foreign tenant (VAT not GST). */
export const ForeignTenant_VAT: Story = {
    args: {
        orderNumber: "QR-12345678",
        summary: { ...SAMPLE_SUMMARY, grand_total: 19.99, tax: 1.75, subtotal: 18.24 },
        currency: "USD",
        taxLabel: "Sales tax",
    },
}

/** Tiny order — single item only. */
export const SingleItem: Story = {
    args: {
        orderNumber: "QR-87654321",
        summary: {
            items: [{ item_name: "Espresso", quantity: 1, unit_price: 90, gst_slab: 12, line_total: 90 }],
            subtotal: 90,
            tax: 10.8,
            grand_total: 101,
            order_number: "QR-87654321",
            customer_name: null,
            customer_phone: null,
            bill_url: "/b/cafe/INV-2025-26-00099",
            invoice_number: "INV-2025-26-00099",
        },
    },
}
