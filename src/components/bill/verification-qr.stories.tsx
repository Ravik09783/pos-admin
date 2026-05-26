import type { Meta, StoryObj } from "@storybook/react-vite"

import { VerificationQr } from "./verification-qr"

const meta = {
    title: "Bill/VerificationQr",
    component: VerificationQr,
    tags: ["autodocs"],
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "Small QR code printed on every bill that points to the public verified-bill page (e.g. `/b/<tenant-slug>/<invoice-no>`). Customers can scan it to confirm their bill is real and match line totals. Default size is 96px (fits comfortably on a 80mm thermal print).",
            },
        },
    },
    argTypes: {
        size: { control: { type: "range", min: 48, max: 256, step: 8 } },
    },
} satisfies Meta<typeof VerificationQr>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
    args: { url: "https://restopos.example.com/b/spice-garden/INV-2025-26-00042", size: 96 },
}

export const Large: Story = {
    args: { url: "https://restopos.example.com/b/spice-garden/INV-2025-26-00042", size: 192 },
}

export const Tiny: Story = {
    args: { url: "https://restopos.example.com/b/spice-garden/INV-2025-26-00042", size: 64 },
}
