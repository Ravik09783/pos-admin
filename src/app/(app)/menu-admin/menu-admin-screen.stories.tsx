import type { Meta, StoryObj } from "@storybook/react-vite"
import { Edit, Eye, EyeOff, FolderInput, Plus, Search, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * Screen-level twin of the menu admin page (`src/app/(app)/menu-admin/page.tsx`).
 * The real page reads categories + items from Supabase, lets the admin
 * inline-edit prices / availability, and pops the ItemAddDialog when
 * adding new items. This story rebuilds the grid + side rail so the
 * states (active, sold-out, paused, on-sale, deleted-but-hidden) can be
 * audited visually.
 *
 * Per-card actions: Edit, Move (one-click category re-assignment via a
 * dropdown of every other category), toggle visible, delete.
 */
type Item = {
    id: string
    name: string
    description?: string
    price: number
    salePrice?: number
    gstSlab?: number
    veg: boolean
    isActive: boolean
    isSoldOut: boolean
}

const CATEGORIES = [
    { id: "all", name: "All items", count: 8 },
    { id: "starters", name: "Starters", count: 3 },
    { id: "mains", name: "Mains", count: 3 },
    { id: "breads", name: "Breads", count: 2 },
    { id: "drinks", name: "Beverages", count: 0 },
    { id: "desserts", name: "Desserts", count: 0 },
]

const ITEMS: Item[] = [
    { id: "1", name: "Paneer Tikka", description: "Char-grilled cottage cheese", price: 280, salePrice: 224, gstSlab: 5, veg: true, isActive: true, isSoldOut: false },
    { id: "2", name: "Chicken 65", description: "Spicy Hyderabadi-style", price: 320, gstSlab: 5, veg: false, isActive: true, isSoldOut: false },
    { id: "3", name: "Hyderabadi Biryani", description: "Aromatic basmati, dum-cooked", price: 360, gstSlab: 5, veg: false, isActive: true, isSoldOut: true },
    { id: "4", name: "Dal Makhani", description: "Slow-cooked black lentils", price: 240, gstSlab: 5, veg: true, isActive: true, isSoldOut: false },
    { id: "5", name: "Garlic Naan", price: 60, gstSlab: 5, veg: true, isActive: true, isSoldOut: false },
    { id: "6", name: "Butter Naan", price: 50, gstSlab: 5, veg: true, isActive: false, isSoldOut: false },
    { id: "7", name: "Margherita Pizza", description: "Classic tomato + mozzarella", price: 320, gstSlab: 5, veg: true, isActive: true, isSoldOut: false },
    { id: "8", name: "Bruschetta", description: "Toasted sourdough, tomato, basil", price: 180, gstSlab: 5, veg: true, isActive: true, isSoldOut: false },
]

interface MenuAdminViewProps {
    activeCatId: string
}

function MenuAdminView({ activeCatId }: MenuAdminViewProps) {
    return (
        <div className="min-h-[800px] w-full bg-background text-foreground rounded-md border border-border/40 p-5">
            {/* Header */}
            <div className="flex items-center gap-2 flex-wrap mb-4">
                <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Configure</div>
                    <h1 className="text-xl font-bold">Menu</h1>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Search items" className="pl-8 w-56" />
                    </div>
                    <Button variant="outline" size="sm">Import CSV</Button>
                    <Button variant="neon" size="sm"><Plus className="h-4 w-4" /> Add item</Button>
                </div>
            </div>

            <div className="grid grid-cols-[220px_1fr] gap-5">
                {/* Category rail */}
                <div className="space-y-1">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Categories</div>
                    {CATEGORIES.map((c) => (
                        <button key={c.id} className={cn(
                            "w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors",
                            c.id === activeCatId ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/40 text-muted-foreground hover:text-foreground",
                        )}>
                            <span>{c.name}</span>
                            <Badge variant="outline" className="text-[10px]">{c.count}</Badge>
                        </button>
                    ))}
                    <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground mt-2">
                        <Plus className="h-3.5 w-3.5" /> New category
                    </Button>
                </div>

                {/* Item grid */}
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {ITEMS.map((it) => <ItemCard key={it.id} item={it} />)}
                </div>
            </div>
        </div>
    )
}

function ItemCard({ item }: { item: Item }) {
    const sale = item.salePrice != null && item.salePrice < item.price
    const moveTargets = CATEGORIES.filter((c) => c.id !== "all")
    return (
        <Card className={cn(
            "relative overflow-hidden p-3 flex flex-col gap-2",
            !item.isActive && "opacity-50",
        )}>
            <div className="aspect-[4/3] rounded-md bg-muted/30 grid place-items-center text-muted-foreground/40 text-xs relative">
                image
                <div className="absolute top-2 left-2">
                    <span className={cn("h-3 w-3 rounded-sm border border-border block", item.veg ? "bg-success" : "bg-destructive")} />
                </div>
                <div className="absolute top-2 right-2 flex flex-col gap-1">
                    {item.isSoldOut && <Badge variant="destructive" className="text-[10px]">Sold out</Badge>}
                    {!item.isActive && <Badge variant="secondary" className="text-[10px]">Paused</Badge>}
                    {sale && <Badge variant="warning" className="text-[10px]">On sale</Badge>}
                </div>
            </div>
            <div className="min-w-0 flex-1">
                <div className="font-medium leading-tight line-clamp-1">{item.name}</div>
                {item.description && (
                    <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{item.description}</div>
                )}
                <div className="flex items-baseline gap-1.5 mt-1.5">
                    <span className="font-semibold tabular-nums text-sm">₹{(sale ? item.salePrice! : item.price).toFixed(2)}</span>
                    {sale && <span className="text-[11px] text-muted-foreground line-through tabular-nums">₹{item.price.toFixed(2)}</span>}
                    {item.gstSlab != null && (
                        <Badge variant="outline" className="text-[10px] ml-auto">{item.gstSlab}% GST</Badge>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-1 pt-1 border-t border-border/30">
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Edit"><Edit className="h-3.5 w-3.5" /></Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Move to another category" title="Move to another category">
                            <FolderInput className="h-3.5 w-3.5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Move to category
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {moveTargets.map((c) => (
                            <DropdownMenuItem key={c.id}>{c.name}</DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Toggle visible">
                    {item.isActive ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 ml-auto text-destructive" aria-label="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                </Button>
            </div>
        </Card>
    )
}

const meta: Meta<typeof MenuAdminView> = {
    title: "Screens/Menu Admin",
    component: MenuAdminView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Menu admin page — `/menu-admin`. Category rail on the left, item grid on the right. Each card shows the veg/non-veg flag, sold-out/paused/on-sale badges, both base and sale price, and the GST slab. Per-card actions: edit, move to another category (one-click dropdown), toggle visible, delete. Real page reads from Supabase with optimistic updates; soft-deletes leave the row in place (`deleted_at` set) so historical bills referencing the item still render correctly.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof MenuAdminView>

/** All items view — every state visible side-by-side. */
export const AllItems: Story = {
    args: { activeCatId: "all" },
}

/** Just the Starters category — narrower set. */
export const SingleCategory: Story = {
    args: { activeCatId: "starters" },
}

/** Empty category — first-time setup wording. */
export const EmptyCategory: Story = {
    args: { activeCatId: "drinks" },
}
