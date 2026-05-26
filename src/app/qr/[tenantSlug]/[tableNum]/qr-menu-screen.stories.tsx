import type { Meta, StoryObj } from "@storybook/react-vite"
import { ChevronRight, MinusCircle, PlusCircle, ShoppingBag, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * Screen-level twin of the customer-facing QR ordering menu
 * (`src/app/qr/[tenantSlug]/[tableNum]/page.tsx`). The real page is a
 * PWA that fetches the tenant's menu, manages a cart in localStorage,
 * calls `/api/public/qr/place-order`, and polls
 * `/api/public/qr/order-status/[id]` until the webhook confirms payment.
 *
 * This story rebuilds the visual structure from static data so designers
 * can iterate the customer flow without spinning up the backend:
 *
 *   - Branded header with tenant name + table chip
 *   - Sticky category strip
 *   - Item cards (image, name, price, +/- qty)
 *   - Sticky bottom cart bar (count + total + checkout CTA)
 *   - Checkout sheet with name / phone fields + tip selector
 *
 * Four stories cover the main states: browsing, items-in-cart, checkout
 * sheet open, and the post-payment "thank you" success screen.
 */
type Item = { id: string; name: string; description?: string; price: number; salePrice?: number; veg?: boolean; soldOut?: boolean }
type CartLine = { id: string; name: string; qty: number; price: number }

const CATS = ["Starters", "Mains", "Breads", "Beverages", "Desserts"]

const ITEMS: Record<string, Item[]> = {
    Starters: [
        { id: "1", name: "Paneer Tikka", description: "Char-grilled cottage cheese with mint chutney", price: 280, salePrice: 224, veg: true },
        { id: "2", name: "Chicken 65", description: "Spicy Hyderabadi-style fried chicken", price: 320, veg: false },
        { id: "3", name: "Bruschetta", description: "Toasted sourdough, tomato, basil", price: 180, veg: true },
    ],
    Mains: [
        { id: "4", name: "Dal Makhani", description: "Slow-cooked black lentils, butter, cream", price: 240, veg: true },
        { id: "5", name: "Hyderabadi Biryani", description: "Aromatic basmati, dum-cooked with meat", price: 360, veg: false, soldOut: true },
        { id: "6", name: "Margherita Pizza", price: 320, veg: true },
    ],
}

interface QrMenuScreenViewProps {
    tenantName: string
    tableNo: string
    activeCat: string
    cart: CartLine[]
    /** Drives which overlay shows. Default = browsing the menu. */
    overlay: "none" | "checkout" | "success"
    /** Total to display on the success screen. */
    paidInvoice?: string
}

function QrMenuScreenView({
    tenantName, tableNo, activeCat, cart, overlay, paidInvoice,
}: QrMenuScreenViewProps) {
    const subtotal = cart.reduce((s, c) => s + c.qty * c.price, 0)
    const cartCount = cart.reduce((s, c) => s + c.qty, 0)

    if (overlay === "success") {
        return (
            <div className="min-h-[800px] bg-background grid place-items-center p-6">
                <Card className="max-w-md w-full text-center p-6 space-y-3">
                    <div className="mx-auto h-14 w-14 grid place-items-center rounded-full bg-success/15 text-success">
                        <Sparkles className="h-7 w-7" />
                    </div>
                    <h2 className="text-2xl font-bold">Payment received</h2>
                    <p className="text-sm text-muted-foreground">
                        Thanks for ordering at <span className="font-medium text-foreground">{tenantName}</span>.
                        Your kitchen ticket is on its way.
                    </p>
                    <div className="rounded-md border border-success/30 bg-success/[0.05] p-3 text-sm space-y-1">
                        <div className="flex justify-between"><span className="text-muted-foreground">Invoice</span><span className="font-mono">{paidInvoice}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-semibold">₹{subtotal.toFixed(2)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Table</span><span className="font-medium">{tableNo}</span></div>
                    </div>
                    <Button variant="outline" className="w-full">Download bill</Button>
                </Card>
            </div>
        )
    }

    return (
        <div className="min-h-[800px] w-full bg-background text-foreground rounded-md border border-border/40 relative overflow-hidden">
            {/* Header */}
            <div className="px-4 pt-5 pb-3 bg-gradient-to-b from-primary/10 to-transparent">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <div className="text-xl font-bold tracking-tight">{tenantName}</div>
                        <div className="text-xs text-muted-foreground">Order from your table</div>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">Table {tableNo}</Badge>
                </div>
            </div>

            {/* Sticky category strip */}
            <div className="px-3 py-2 border-y border-border/40 bg-background sticky top-0 flex gap-2 overflow-x-auto">
                {CATS.map((c) => (
                    <button
                        key={c}
                        className={cn(
                            "px-3 py-1.5 rounded-full text-xs font-medium shrink-0 transition-colors",
                            c === activeCat ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground",
                        )}
                    >
                        {c}
                    </button>
                ))}
            </div>

            {/* Items list */}
            <div className="p-4 pb-32 space-y-3">
                {(ITEMS[activeCat] ?? []).map((it) => (
                    <ItemRow key={it.id} item={it} qty={cart.find((c) => c.id === it.id)?.qty ?? 0} />
                ))}
            </div>

            {/* Sticky bottom cart bar */}
            {cartCount > 0 && overlay === "none" && (
                <div className="absolute left-3 right-3 bottom-3 rounded-xl bg-primary text-primary-foreground shadow-lg p-3 flex items-center gap-3">
                    <div className="grid place-items-center h-9 w-9 rounded-md bg-white/15">
                        <ShoppingBag className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold leading-tight">
                            {cartCount} item{cartCount > 1 ? "s" : ""} · ₹{subtotal.toFixed(2)}
                        </div>
                        <div className="text-[11px] opacity-80">Tap to review &amp; pay</div>
                    </div>
                    <ChevronRight className="h-5 w-5" />
                </div>
            )}

            {/* Checkout sheet overlay */}
            {overlay === "checkout" && (
                <div className="absolute inset-x-0 bottom-0 bg-card border-t border-border/60 rounded-t-2xl p-4 space-y-3 shadow-2xl">
                    <div className="h-1 w-12 rounded-full bg-border mx-auto" />
                    <div className="text-base font-semibold">Review &amp; pay</div>
                    <div className="rounded-md border border-border/40 divide-y divide-border/30 text-sm">
                        {cart.map((c) => (
                            <div key={c.id} className="px-3 py-2 flex items-center justify-between gap-2">
                                <span><span className="font-mono text-xs text-muted-foreground">{c.qty}× </span>{c.name}</span>
                                <span className="tabular-nums">₹{(c.qty * c.price).toFixed(2)}</span>
                            </div>
                        ))}
                    </div>
                    <Input placeholder="Your name (optional)" />
                    <Input placeholder="Mobile number (for SMS receipt)" inputMode="tel" />
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Total</span>
                        <span className="text-xl font-bold tabular-nums">₹{subtotal.toFixed(2)}</span>
                    </div>
                    <Button variant="neon" size="lg" className="w-full">Pay with UPI / Card</Button>
                    <p className="text-[11px] text-center text-muted-foreground">
                        Powered by Razorpay · Money goes directly to the restaurant
                    </p>
                </div>
            )}
        </div>
    )
}

function ItemRow({ item, qty }: { item: Item; qty: number }) {
    const sale = item.salePrice != null && item.salePrice < item.price
    return (
        <Card className={cn("p-3 flex gap-3", item.soldOut && "opacity-40")}>
            <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                    <span className={cn(
                        "h-3 w-3 rounded-sm border border-border block mt-1 shrink-0",
                        item.veg ? "bg-success" : "bg-destructive",
                    )} />
                    <div className="min-w-0">
                        <div className="font-medium leading-tight">{item.name}</div>
                        {item.description && (
                            <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{item.description}</div>
                        )}
                        <div className="mt-1 flex items-baseline gap-1.5">
                            <span className="font-semibold tabular-nums">₹{(sale ? item.salePrice! : item.price).toFixed(2)}</span>
                            {sale && <span className="text-xs text-muted-foreground line-through tabular-nums">₹{item.price.toFixed(2)}</span>}
                            {item.soldOut && <Badge variant="destructive" className="text-[10px] ml-1">Sold out</Badge>}
                        </div>
                    </div>
                </div>
            </div>
            <div className="shrink-0 grid place-items-center">
                {item.soldOut ? null : qty === 0 ? (
                    <Button size="sm" variant="outline">
                        <PlusCircle className="h-4 w-4" /> Add
                    </Button>
                ) : (
                    <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/[0.06] px-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7"><MinusCircle className="h-4 w-4" /></Button>
                        <span className="font-bold tabular-nums w-4 text-center">{qty}</span>
                        <Button size="icon" variant="ghost" className="h-7 w-7"><PlusCircle className="h-4 w-4" /></Button>
                    </div>
                )}
            </div>
        </Card>
    )
}

const meta: Meta<typeof QrMenuScreenView> = {
    title: "Screens/QR Customer Menu",
    component: QrMenuScreenView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Customer-facing QR ordering screen. Scanned from a QR card on each table, lands on `/qr/[tenantSlug]/[tableNum]`. PWA — installable, works offline for browsing, falls back to manual UPI if the tenant hasn't connected Razorpay. Layout is mobile-first: branded header, sticky category strip, full-width item rows with quick add/remove, sticky cart bar at the bottom. The checkout sheet slides up from bottom; the success screen replaces the whole view once the webhook confirms payment. Real page polls `/api/public/qr/order-status/[id]` for status flips.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof QrMenuScreenView>

/** Empty cart — customer just opened the menu, browsing Mains. */
export const Browsing: Story = {
    args: {
        tenantName: "Bandra Bistro",
        tableNo: "12",
        activeCat: "Mains",
        cart: [],
        overlay: "none",
    },
}

/** Two items added — sticky bottom cart bar shows count + total + CTA. */
export const ItemsInCart: Story = {
    args: {
        tenantName: "Bandra Bistro",
        tableNo: "12",
        activeCat: "Starters",
        cart: [
            { id: "1", name: "Paneer Tikka", qty: 2, price: 224 },
            { id: "4", name: "Dal Makhani", qty: 1, price: 240 },
        ],
        overlay: "none",
    },
}

/** Bottom sheet open — review and pay. UPI / card CTA visible. */
export const CheckoutSheet: Story = {
    args: {
        tenantName: "Bandra Bistro",
        tableNo: "12",
        activeCat: "Starters",
        cart: [
            { id: "1", name: "Paneer Tikka", qty: 2, price: 224 },
            { id: "4", name: "Dal Makhani", qty: 1, price: 240 },
            { id: "6", name: "Margherita Pizza", qty: 1, price: 320 },
        ],
        overlay: "checkout",
    },
}

/** Post-payment "thank you" — the webhook has confirmed; bill is downloadable. */
export const PaymentSuccess: Story = {
    args: {
        tenantName: "Bandra Bistro",
        tableNo: "12",
        activeCat: "Starters",
        cart: [
            { id: "1", name: "Paneer Tikka", qty: 2, price: 224 },
        ],
        overlay: "success",
        paidInvoice: "INV-2026-27-00412",
    },
}
