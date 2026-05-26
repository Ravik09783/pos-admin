import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { ItemAddDialog, type AddableItem } from "./item-add-dialog"

const margherita: AddableItem = {
    id: "1",
    name: "Margherita Pizza",
    description: "Hand-stretched 10\" base, San Marzano tomatoes, fresh mozzarella, basil.",
    base_price: 320,
    food_type: "VEG",
    gst_slab: 5,
    image_url: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&q=80",
}
const malai: AddableItem = {
    id: "2",
    name: "Malai Chaap Tikka",
    description: "Slow-marinated soy chunks, charred in the tandoor.",
    base_price: 280,
    sale_price: 224,
    food_type: "VEG",
    gst_slab: 5,
    image_url: "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=600&q=80",
}
const recommended: AddableItem[] = [
    { id: "r1", name: "Garlic Bread", description: null, base_price: 140, food_type: "VEG", gst_slab: 5,
      image_url: "https://images.unsplash.com/photo-1573140247632-f8fd74997d5c?w=200&q=80" },
    { id: "r2", name: "Coke 500ml", description: null, base_price: 80, food_type: "VEG", gst_slab: 12,
      image_url: null },
    { id: "r3", name: "Tiramisu", description: null, base_price: 220, food_type: "EGG", gst_slab: 5,
      image_url: "https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=200&q=80" },
    { id: "r4", name: "Espresso", description: null, base_price: 90, food_type: "VEG", gst_slab: 5,
      image_url: "https://images.unsplash.com/photo-1510972527921-ce03766a1cf1?w=200&q=80" },
]

const meta: Meta<typeof ItemAddDialog<AddableItem>> = {
    title: "POS/ItemAddDialog",
    component: ItemAddDialog<AddableItem>,
    tags: ["autodocs"],
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "McDonald's-kiosk-style 'add to cart' sheet shared by the POS and the customer QR ordering page. **Item picture at the top** (gradient + capital-letter placeholder if no image), big quantity stepper, special-instructions box, recommended add-ons as one-tap cards. The footer button shows the live line total and is **bulletproof on narrow viewports** — content wraps onto two lines if a long price plus an icon would overflow, so 'Add to order — ₹12,34,567.00' on a 320px phone doesn't burst out of the dialog.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof ItemAddDialog<AddableItem>>

/** Wrapper that lets the dialog open/close from a trigger so the story is interactive. */
function Demo({ item, recommended: recs }: { item: AddableItem; recommended: AddableItem[] }) {
    const [open, setOpen] = useState<AddableItem | null>(item)
    return (
        <div className="grid gap-4 place-items-center min-h-[100px]">
            {!open && <Button variant="neon" onClick={() => setOpen(item)}>Open dialog</Button>}
            <ItemAddDialog
                item={open}
                recommended={recs}
                inCartIds={new Set()}
                currency="INR"
                taxLabel="GST"
                onClose={() => setOpen(null)}
                onAdd={() => setOpen(null)}
                onQuickAdd={() => {}}
            />
        </div>
    )
}

/** Standard veg item, no sale price, full recommended-add-ons rail. */
export const Default: Story = {
    render: () => <Demo item={margherita} recommended={recommended} />,
}

/** Sale-price variant — original price struck through, % off badge. */
export const OnSale: Story = {
    render: () => <Demo item={malai} recommended={recommended} />,
}

/** No description and no add-ons — minimum-content rendering. */
export const Minimal: Story = {
    render: () => (
        <Demo
            item={{
                id: "x", name: "Plain Lassi", description: null, base_price: 90,
                food_type: "VEG", gst_slab: 5,
                image_url: "https://images.unsplash.com/photo-1638176067000-9e2c1ad2cd5d?w=600&q=80",
            }}
            recommended={[]}
        />
    ),
}

/** No image — exercises the gradient + capital-letter placeholder. */
export const NoImage_FallbackPlaceholder: Story = {
    render: () => (
        <Demo
            item={{
                id: "x", name: "Kerala Sadhya Thali",
                description: "Traditional banana-leaf platter with 12 sides — rice, sambar, rasam, avial, thoran, payasam.",
                base_price: 420, food_type: "VEG", gst_slab: 5,
                image_url: null,
            }}
            recommended={[]}
        />
    ),
    parameters: { docs: { description: { story: "When `image_url` is null, the dialog shows a gradient with the item's first letter — same fallback the POS tile uses, so the look stays consistent end-to-end." } } },
}

/** Stress-test the footer wrap with a huge unit price. */
export const BulletproofLongPrice: Story = {
    render: () => (
        <Demo
            item={{ id: "x", name: "Family Feast (24 items)", description: "Catering package for 20 guests.", base_price: 1234567, food_type: "NON_VEG", gst_slab: 18 }}
            recommended={[]}
        />
    ),
    parameters: { docs: { description: { story: "Footer button shrinks + wraps cleanly. No overflow." } } },
}

/** Long description renders inside the scrollable dialog body. */
export const VerboseDescription: Story = {
    render: () => (
        <Demo
            item={{
                id: "x",
                name: "Wagyu Beef Burger",
                description: "150g hand-pressed A5 Wagyu patty cooked medium-rare on a brioche bun, layered with smoked Gouda, caramelised onions, applewood bacon, butter-leaf lettuce, beefsteak tomato, and our house-made truffle aioli. Served with shoestring fries and pickled gherkins.",
                base_price: 950,
                food_type: "NON_VEG",
                gst_slab: 18,
            }}
            recommended={recommended.slice(0, 2)}
        />
    ),
}
