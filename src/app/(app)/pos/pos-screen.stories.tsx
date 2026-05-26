import type { Meta, StoryObj } from "@storybook/react-vite"
import { Plus, Search, ShoppingCart, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

/**
 * Screen-level twin of the POS page (`src/app/(app)/pos/page.tsx`). The
 * real page mounts Supabase realtime, the active-branch context, the
 * `usePendingCount` hook, and a few other side-effect things — none of
 * which run inside Storybook. This story rebuilds the same layout from
 * static fixtures so the kiosk-mode shell can be iterated on visually:
 *
 *   - Top toolbar    → order type tabs + table-no input + source select + search
 *   - Category rail  → scrollable horizontal chip strip
 *   - Menu grid      → cards with image, name, price, + button, qty badge
 *   - Cart drawer    → right-side column with rows + grand total + checkout CTA
 *
 * The two stories below show the typical full state and the empty/initial
 * state. The cashier exits kiosk mode via the X in the top-right.
 */
type CartLine = { id: string; name: string; qty: number; price: number }
type Tile = { id: string; name: string; price: number; salePrice?: number; soldOut?: boolean; veg?: boolean; qty?: number }

const TILES: Tile[] = [
    { id: "1", name: "Paneer Tikka", price: 280, salePrice: 224, veg: true, qty: 2 },
    { id: "2", name: "Chicken 65", price: 320, veg: false },
    { id: "3", name: "Garlic Naan", price: 60, veg: true, qty: 4 },
    { id: "4", name: "Butter Naan", price: 50, veg: true },
    { id: "5", name: "Dal Makhani", price: 240, veg: true },
    { id: "6", name: "Coke 500ml", price: 80, veg: true, qty: 1 },
    { id: "7", name: "Gulab Jamun (2 pc)", price: 90, veg: true },
    { id: "8", name: "Hyderabadi Biryani", price: 360, veg: false, soldOut: true },
]
const CART: CartLine[] = [
    { id: "1", name: "Paneer Tikka", qty: 2, price: 224 },
    { id: "3", name: "Garlic Naan", qty: 4, price: 60 },
    { id: "6", name: "Coke 500ml", qty: 1, price: 80 },
]
const CATS = ["ALL", "Starters", "Mains", "Breads", "Beverages", "Desserts"]

function money(v: number) { return `₹${v.toFixed(2)}` }

interface PosScreenViewProps {
    cart: CartLine[]
    tableNo: string
    activeCat: string
    /** True = kiosk mode (full-bleed, X to exit). False would show the
     *  sidebar, but Storybook always shows kiosk because that's the live
     *  default for /pos. */
    kiosk: boolean
}

function PosScreenView({ cart, tableNo, activeCat, kiosk }: PosScreenViewProps) {
    const subtotal = cart.reduce((s, c) => s + c.qty * c.price, 0)
    const tax = subtotal * 0.05
    const grand = subtotal + tax

    return (
        <div className="h-[800px] w-full bg-background text-foreground overflow-hidden rounded-md border border-border/40 flex">
            {/* MAIN: toolbar + categories + grid */}
            <div className="flex-1 min-w-0 flex flex-col">
                {/* Top toolbar */}
                <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2 flex-wrap">
                    <Tabs value="DINE_IN">
                        <TabsList>
                            <TabsTrigger value="DINE_IN">Dine-in</TabsTrigger>
                            <TabsTrigger value="TAKEAWAY">Takeaway</TabsTrigger>
                            <TabsTrigger value="DELIVERY">Delivery</TabsTrigger>
                            <TabsTrigger value="QSR">QSR</TabsTrigger>
                        </TabsList>
                    </Tabs>
                    <Input placeholder="Table no." value={tableNo} readOnly className="max-w-[120px]" />
                    <div className="h-9 px-3 rounded-md border border-border/60 text-xs flex items-center text-muted-foreground">Direct</div>
                    <div className="ml-auto relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Search menu" className="pl-8 w-56" />
                    </div>
                    {kiosk && (
                        <Button variant="ghost" size="icon" aria-label="Exit kiosk">
                            <X className="h-4 w-4" />
                        </Button>
                    )}
                </div>

                {/* Category chips */}
                <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-border/40">
                    {CATS.map((c) => (
                        <button
                            key={c}
                            className={cn(
                                "px-3 py-1.5 rounded-md text-sm transition-colors",
                                c === activeCat ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {c}
                        </button>
                    ))}
                </div>

                {/* Menu grid */}
                <div className="flex-1 overflow-y-auto p-4">
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                        {TILES.map((t) => (
                            <MenuTile key={t.id} tile={t} />
                        ))}
                    </div>
                </div>
            </div>

            {/* CART drawer */}
            <div className="w-80 shrink-0 border-l border-border/40 flex flex-col bg-muted/10">
                <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2">
                    <ShoppingCart className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-sm">Cart</span>
                    <Badge variant="secondary" className="ml-auto text-[10px]">{cart.length} items</Badge>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {cart.length === 0 ? (
                        <div className="text-center text-sm text-muted-foreground py-10">
                            Empty cart. Tap an item to add it.
                        </div>
                    ) : cart.map((c) => (
                        <Card key={c.id} className="p-2.5">
                            <div className="flex items-start gap-2">
                                <span className="font-mono text-xs text-muted-foreground pt-0.5">{c.qty}×</span>
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-sm leading-tight truncate">{c.name}</div>
                                    <div className="text-[11px] text-muted-foreground">{money(c.price)} each</div>
                                </div>
                                <div className="font-semibold text-sm tabular-nums">{money(c.qty * c.price)}</div>
                            </div>
                        </Card>
                    ))}
                </div>
                {cart.length > 0 && (
                    <div className="border-t border-border/40 p-3 space-y-2 text-sm">
                        <Row label="Subtotal" value={money(subtotal)} />
                        <Row label="Tax (5%)" value={money(tax)} />
                        <div className="border-t border-border/30 pt-2">
                            <Row label="Grand total" value={money(grand)} bold />
                        </div>
                        <Button variant="neon" className="w-full" size="lg">
                            Review &amp; checkout
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}

function MenuTile({ tile }: { tile: Tile }) {
    const sale = tile.salePrice != null && tile.salePrice < tile.price
    return (
        <Card className={cn(
            "relative overflow-hidden p-3 flex flex-col gap-2",
            tile.qty && tile.qty > 0 && "ring-2 ring-primary/50",
            tile.soldOut && "opacity-40",
        )}>
            <div className="absolute top-2 left-2">
                <span className={cn(
                    "h-3 w-3 rounded-sm border border-border block",
                    tile.veg ? "bg-success" : "bg-destructive",
                )} />
            </div>
            {tile.soldOut && (
                <Badge variant="destructive" className="absolute top-2 right-2 text-[10px]">Sold out</Badge>
            )}
            <div className="aspect-[4/3] rounded-md bg-muted/30 grid place-items-center text-muted-foreground/40 text-xs">
                image
            </div>
            <div className="min-w-0">
                <div className="font-medium text-sm leading-tight line-clamp-2">{tile.name}</div>
                <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="font-semibold tabular-nums text-sm">{money(sale ? tile.salePrice! : tile.price)}</span>
                    {sale && (
                        <span className="text-[11px] text-muted-foreground line-through tabular-nums">{money(tile.price)}</span>
                    )}
                </div>
            </div>
            <div className="flex items-center justify-between mt-auto">
                {tile.qty && tile.qty > 0 ? (
                    <Badge variant="default" className="text-[10px]">In cart · {tile.qty}</Badge>
                ) : <span />}
                <Button size="icon" variant="neon" className="h-7 w-7 ml-auto" disabled={tile.soldOut}>
                    <Plus className="h-3.5 w-3.5" />
                </Button>
            </div>
        </Card>
    )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
    return (
        <div className={cn("flex items-center justify-between", bold && "font-bold text-base")}>
            <span className="text-muted-foreground">{label}</span>
            <span className="tabular-nums">{value}</span>
        </div>
    )
}

const meta: Meta<typeof PosScreenView> = {
    title: "Screens/POS",
    component: PosScreenView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Point-of-sale screen — the cashier's primary surface. Mounts in **kiosk mode** (no sidebar, exit-X top-right) so the cashier doesn't accidentally navigate away mid-order. Top toolbar carries order-type tabs (Dine-in / Takeaway / Delivery / QSR), table-number input, channel-source select (Direct / Swiggy / Zomato / Phone …), and a search box. The category chip row scrolls horizontally on overflow. The cart drawer on the right stays sticky — its Review & Checkout CTA opens the `CheckoutPreviewDialog`. Real page reads Supabase realtime + active-branch context; this story stubs everything.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof PosScreenView>

/** Typical lunch-rush state — three items in cart, "Mains" category active. */
export const Default: Story = {
    args: {
        cart: CART,
        tableNo: "T7",
        activeCat: "Mains",
        kiosk: true,
    },
}

/** Empty cart — first tap of the shift. The cart drawer shows the empty hint
 *  and the checkout CTA isn't rendered. */
export const EmptyCart: Story = {
    args: {
        cart: [],
        tableNo: "",
        activeCat: "ALL",
        kiosk: true,
    },
}

/** QSR / counter mode — no table number. Same layout, the cashier just rings
 *  through items as the customer hands them across the counter. */
export const QsrMode: Story = {
    args: {
        cart: CART.slice(0, 2),
        tableNo: "",
        activeCat: "Starters",
        kiosk: true,
    },
}
