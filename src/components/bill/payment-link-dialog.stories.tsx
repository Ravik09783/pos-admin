import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { PaymentLinkDialog } from "./payment-link-dialog"
import type { Bill, Tenant } from "@/types/database"

const bill: Bill = {
    id: "b1",
    tenant_id: "t1",
    order_id: "o1",
    branch_id: null,
    invoice_number: "INV-2025-26-00042",
    fy_label: "2025-26",
    bill_status: "GENERATED",
    subtotal: 750,
    item_discount: 0,
    order_discount: 0,
    taxable_amount: 750,
    cgst_amount: 18.75,
    sgst_amount: 18.75,
    igst_amount: 0,
    service_charge: 0,
    round_off: 0,
    grand_total: 787.5,
    is_inter_state: false,
    gst_excluded: false,
    customer_name: "Priya",
    customer_phone: "+919000011122",
    customer_gstin: null,
    customer_state_code: null,
    client_request_id: null,
    void_reason: null,
    voided_at: null,
    paid_at: null,
    billed_at: null,
    billed_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
} as unknown as Bill

const tenant: Tenant = {
    id: "t1",
    name: "Spice Garden Bistro",
    slug: "spice-garden",
    plan: "growth",
    plan_expires_at: null,
    gstin: "29ABCDE1234F1Z5",
    fssai: "12345678901234",
    pan: null,
    phone: "+91 99000 11122",
    email: null,
    website: null,
    logo_url: null,
    address_line1: "12 MG Road",
    address_line2: null,
    city: "Bengaluru",
    state: "Karnataka",
    state_code: "29",
    pincode: "560001",
    country: "India",
    currency: "INR",
    timezone: "Asia/Kolkata",
    fy_start_month: 4,
    invoice_prefix: "INV",
    service_charge_percent: 0,
    settings: {},
    qr_card_settings: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
} as Tenant

const meta: Meta<typeof PaymentLinkDialog> = {
    title: "Bill/PaymentLinkDialog",
    component: PaymentLinkDialog,
    tags: ["autodocs"],
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "Two-tab modal for collecting payment on an existing bill. **Online checkout** opens the Razorpay popup (or Stripe Checkout outside India). **Send link** copies the public bill URL or shoots it to the customer's phone via WhatsApp / SMS. Live API calls fail inside Storybook — use this view only to inspect the UI.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof PaymentLinkDialog>

function Demo() {
    const [open, setOpen] = useState(true)
    return (
        <>
            {!open && <Button variant="neon" onClick={() => setOpen(true)}>Open payment dialog</Button>}
            <PaymentLinkDialog
                bill={bill}
                tenant={tenant}
                open={open}
                onOpenChange={setOpen}
                onPaid={() => setOpen(false)}
            />
        </>
    )
}

export const Default: Story = {
    args: { bill, tenant, open: true, onOpenChange: () => {}, onPaid: () => {} },
    render: () => <Demo />,
}
