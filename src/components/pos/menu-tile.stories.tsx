import type { Meta, StoryObj } from "@storybook/react-vite"

import { Badge } from "@/components/ui/badge"
import { cn, formatCurrency } from "@/lib/utils"

/**
 * Storybook reference for the **menu tile** pattern used on the POS
 * (`/pos`) and the menu admin (`/menu`). It's not a standalone component
 * today — the JSX lives inline in `src/app/(app)/pos/page.tsx`. This
 * story mirrors that production layout exactly so designers can iterate
 * the pattern in isolation:
 *   - Fixed-height image strip (h-28)
 *   - Gradient + capital-letter placeholder when no image
 *   - Sale ribbon top-left, sold-out scrim across the image
 *   - Veg/non-veg/egg/vegan colour dot inline with the title
 *   - GST badge bottom-right
 * If we ever extract this into a real component, the props match this
 * story's shape one-to-one.
 */
interface MenuTileProps {
    name: string
    base_price: number
    sale_price?: number | null
    image_url?: string | null
    food_type: "VEG" | "NON_VEG" | "EGG" | "VEGAN"
    is_sold_out?: boolean
    gst_slab: number
}

function MenuTile(p: MenuTileProps) {
    const sale = p.sale_price != null && p.sale_price < p.base_price ? p.sale_price : null
    const pctOff = sale != null ? Math.round((1 - sale / p.base_price) * 100) : 0
    return (
        <button
            disabled={p.is_sold_out}
            className={cn(
                "group text-left rounded-xl border border-border/60 bg-card/60 transition-all relative overflow-hidden w-full max-w-[220px]",
                p.is_sold_out
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:border-primary/60 hover:bg-card/80 active:scale-[0.98]",
            )}
        >
            <div className="relative">
                {p.image_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                        src={p.image_url}
                        alt=""
                        className={cn("w-full h-28 object-cover", p.is_sold_out && "grayscale")}
                        loading="lazy"
                    />
                ) : (
                    <div className={cn(
                        "w-full h-28 grid place-items-center bg-gradient-to-br from-primary/15 via-card to-[hsl(var(--neon-magenta)/0.12)]",
                        p.is_sold_out && "grayscale",
                    )}>
                        <span className="text-4xl font-bold text-primary/40 select-none">
                            {p.name.charAt(0).toUpperCase()}
                        </span>
                    </div>
                )}
                {sale != null && !p.is_sold_out && (
                    <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-destructive text-destructive-foreground shadow-md">
                        -{pctOff}%
                    </div>
                )}
                {p.is_sold_out && (
                    <div className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-[1px]">
                        <Badge variant="destructive" className="text-[10px] px-2">SOLD OUT</Badge>
                    </div>
                )}
            </div>
            <div className="p-2.5 space-y-1.5">
                <div className="flex items-start gap-1.5">
                    <span
                        aria-label={p.food_type}
                        className={cn(
                            "mt-1 h-2.5 w-2.5 rounded-sm shrink-0 border",
                            p.food_type === "VEG" && "bg-success/80 border-success",
                            p.food_type === "NON_VEG" && "bg-destructive/80 border-destructive",
                            p.food_type === "EGG" && "bg-warning/80 border-warning",
                            p.food_type === "VEGAN" && "bg-success border-success",
                        )}
                    />
                    <span className={cn(
                        "font-medium text-sm leading-tight line-clamp-2 flex-1",
                        p.is_sold_out && "line-through opacity-60",
                    )}>
                        {p.name}
                    </span>
                </div>
                <div className="flex items-end justify-between gap-2">
                    {sale != null ? (
                        <div className="leading-tight">
                            <div className="text-lg font-bold text-primary tabular-nums">{formatCurrency(sale)}</div>
                            <div className="text-[11px] text-muted-foreground line-through tabular-nums">
                                {formatCurrency(p.base_price)}
                            </div>
                        </div>
                    ) : (
                        <div className="text-lg font-bold text-primary tabular-nums">
                            {formatCurrency(p.base_price)}
                        </div>
                    )}
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0">
                        {p.gst_slab}%
                    </Badge>
                </div>
            </div>
        </button>
    )
}

const meta: Meta<typeof MenuTile> = {
    title: "POS/Menu Card",
    component: MenuTile,
    tags: ["autodocs"],
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "Pixel-accurate copy of the menu tile used in the POS catalog (`src/app/(app)/pos/page.tsx`). Same h-28 image strip, same gradient-letter fallback, same sale ribbon, same SOLD OUT scrim, same colour-dot food-type pill, same GST badge. Iterate this pattern here, then port back to the page (or extract it as a shared component).",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof MenuTile>

export const Default_WithImage: Story = {
    args: {
        name: "Margherita Pizza",
        base_price: 320,
        food_type: "VEG",
        gst_slab: 5,
        image_url: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400&q=80",
    },
}

export const OnSale: Story = {
    args: {
        name: "Malai Chaap Tikka",
        base_price: 280,
        sale_price: 224,
        food_type: "VEG",
        gst_slab: 5,
        image_url: "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=400&q=80",
    },
}

export const NoImage_FallbackPlaceholder: Story = {
    args: {
        name: "Plain Lassi",
        base_price: 90,
        food_type: "VEG",
        gst_slab: 5,
        image_url: null,
    },
    parameters: { docs: { description: { story: "Gradient + capital-letter fallback. Production uses the same look so the catalog grid stays visually uniform even before all items have photos." } } },
}

export const SoldOut: Story = {
    args: {
        name: "Butter Chicken",
        base_price: 380,
        food_type: "NON_VEG",
        gst_slab: 5,
        is_sold_out: true,
        image_url: "https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=400&q=80",
    },
}

export const NonVeg: Story = {
    args: {
        name: "Tandoori Chicken Half",
        base_price: 380,
        food_type: "NON_VEG",
        gst_slab: 5,
        image_url: "https://images.unsplash.com/photo-1599043513900-ed6fe01d3833?w=400&q=80",
    },
}

export const Vegan: Story = {
    args: {
        name: "Vegan Buddha Bowl",
        base_price: 260,
        food_type: "VEGAN",
        gst_slab: 5,
        image_url: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&q=80",
    },
}

export const Egg: Story = {
    args: {
        name: "Egg Bhurji Pav",
        base_price: 140,
        food_type: "EGG",
        gst_slab: 5,
        image_url: "https://images.unsplash.com/photo-1604908554056-c7e0bf7d717b?w=400&q=80",
    },
}

/** A full POS-style grid — most realistic preview of how tiles sit together. */
export const Grid: Story = {
    render: () => (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-w-4xl">
            <MenuTile name="Margherita Pizza" base_price={320} food_type="VEG" gst_slab={5}
                image_url="https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=300&q=80" />
            <MenuTile name="Malai Chaap" base_price={280} sale_price={224} food_type="VEG" gst_slab={5}
                image_url="https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=300&q=80" />
            <MenuTile name="Butter Chicken" base_price={380} food_type="NON_VEG" gst_slab={5} is_sold_out
                image_url="https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=300&q=80" />
            <MenuTile name="Plain Lassi" base_price={90} food_type="VEG" gst_slab={5} image_url={null} />
            <MenuTile name="Espresso" base_price={90} food_type="VEG" gst_slab={12}
                image_url="https://images.unsplash.com/photo-1510972527921-ce03766a1cf1?w=300&q=80" />
            <MenuTile name="Vegan Bowl" base_price={260} food_type="VEGAN" gst_slab={5}
                image_url="https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=300&q=80" />
            <MenuTile name="Egg Bhurji" base_price={140} food_type="EGG" gst_slab={5}
                image_url="https://images.unsplash.com/photo-1604908554056-c7e0bf7d717b?w=300&q=80" />
            <MenuTile name="Tandoori Chicken" base_price={380} sale_price={342} food_type="NON_VEG" gst_slab={5}
                image_url="https://images.unsplash.com/photo-1599043513900-ed6fe01d3833?w=300&q=80" />
        </div>
    ),
}
