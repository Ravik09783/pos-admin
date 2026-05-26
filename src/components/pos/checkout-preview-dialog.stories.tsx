import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { CheckoutPreviewDialog, type CheckoutCustomerDetails, type CheckoutPayment } from "./checkout-preview-dialog"
import { computeOrder } from "@/lib/gst/calculator"
import type { MenuItem } from "@/types/database"

// ── Mock cart + totals ───────────────────────────────────────────────
function mockItem(id: string, name: string, price: number, salePrice?: number): MenuItem {
    return {
        id, tenant_id: "t", category_id: null, name, description: null,
        base_price: price, sale_price: salePrice ?? null,
        food_type: "VEG", hsn_code: "996331", gst_slab: 5, is_tax_inclusive: false,
        sku: null, barcode: null, image_url: null,
        prep_time_minutes: 10, is_active: true, is_sold_out: false, sort_order: 0,
        deleted_at: null, created_at: "", updated_at: "",
    }
}

const SMALL_CART = [
    { item: mockItem("1", "Paneer Tikka", 280, 224), quantity: 1, notes: "Less spicy" },
    { item: mockItem("2", "Garlic Naan", 60), quantity: 2 },
    { item: mockItem("3", "Coke 500ml", 80), quantity: 1 },
]
const BIG_CART = [
    { item: mockItem("1", "Margherita Pizza", 320), quantity: 2 },
    { item: mockItem("2", "Pasta Arrabbiata", 290), quantity: 1 },
    { item: mockItem("3", "Tiramisu", 220), quantity: 2 },
    { item: mockItem("4", "Iced Latte", 150), quantity: 3 },
    { item: mockItem("5", "Bruschetta", 180), quantity: 1, notes: "No olives" },
    { item: mockItem("6", "Caesar Salad", 240), quantity: 1 },
]

function totals(cart: { item: MenuItem; quantity: number }[], noGst = false) {
    return computeOrder({
        lines: cart.map((c, i) => ({
            line_id: i,
            quantity: c.quantity,
            unit_price: Number(c.item.sale_price ?? c.item.base_price),
            gst_slab: Number(c.item.gst_slab),
            tax_inclusive: c.item.is_tax_inclusive,
        })),
        isInterState: false,
        taxModel: "split",
        serviceChargePercent: 0,
        orderDiscount: 0,
        roundToNearestRupee: true,
        noGst,
    })
}

interface DemoProps {
    cart: typeof SMALL_CART
    orderType?: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "QSR"
    tableNo?: string
    coupon?: { code: string; description: string | null } | null
}

function Demo({ cart, orderType = "DINE_IN", tableNo = "T3", coupon = null }: DemoProps) {
    const [open, setOpen] = useState(true)
    const [busy, setBusy] = useState(false)
    function handle(_noGst: boolean, _details: CheckoutCustomerDetails, payments: CheckoutPayment[]) {
        setBusy(true)
        // eslint-disable-next-line no-console
        console.log("[story] confirm", { payments })
        setTimeout(() => { setBusy(false); setOpen(false) }, 600)
    }
    return (
        <>
            {!open && <Button variant="neon" onClick={() => setOpen(true)}>Open checkout</Button>}
            <CheckoutPreviewDialog
                open={open}
                cart={cart}
                totals={totals(cart)}
                totalsNoGst={totals(cart, true)}
                coupon={coupon}
                customer={null}
                orderType={orderType}
                tableNo={tableNo}
                currency="INR"
                busy={busy}
                onClose={() => setOpen(false)}
                onConfirm={handle}
            />
        </>
    )
}

const meta: Meta<typeof CheckoutPreviewDialog> = {
    title: "POS/CheckoutPreviewDialog",
    component: CheckoutPreviewDialog,
    tags: ["autodocs"],
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "The single-screen checkout dialog used by the POS. Captures payment method (Cash / UPI / Card) plus customer details in one pass and atomically generates the bill + records the payment. UPI shows a dynamic QR scannable by any UPI app (Google Pay, PhonePe, Paytm, BHIM) and requires the cashier to paste the 12-digit UTR back to prove the payment landed — the Generate button stays locked until they do. Cash mode shows one-tap denomination chips and a prominent change-to-return display.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof CheckoutPreviewDialog>

/** Three-item dine-in checkout. Hit "Review & generate" to see the confirm stage. */
export const Default_DineIn: Story = {
    render: () => <Demo cart={SMALL_CART} />,
}

/** Bigger order — exercises the cart's scroll region. */
export const LargerCart: Story = {
    render: () => <Demo cart={BIG_CART} orderType="QSR" tableNo="" />,
}

/** Takeaway flow — no table number shown in the header. */
export const Takeaway: Story = {
    render: () => <Demo cart={SMALL_CART} orderType="TAKEAWAY" tableNo="" />,
}

/** With a coupon applied — the discount line shows in the totals breakdown. */
export const WithCoupon: Story = {
    render: () => (
        <Demo
            cart={SMALL_CART}
            coupon={{ code: "WELCOME20", description: "20% off your first order" }}
        />
    ),
}
