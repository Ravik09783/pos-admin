"use client"

import { useEffect, useState } from "react"
import { Check, Minus, Plus } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn, formatCurrency } from "@/lib/utils"
import type { FoodType } from "@/types/database"

const FOOD_DOT: Record<FoodType, string> = {
    VEG: "#22c55e", NON_VEG: "#ef4444", EGG: "#f59e0b", VEGAN: "#10b981",
}

/** Minimal shape the dialog needs — both the POS `MenuItem` and the QR
 *  `MenuItemLite` satisfy it structurally. `sale_price` is optional so
 *  callers that don't have it (legacy / public-API minimal payload) work
 *  unchanged; when present and lower than base_price, it's the active price.
 *  `image_url` is optional — when set, the dialog shows the item picture at
 *  the top; otherwise a gradient-letter placeholder takes its place
 *  (matches the POS tile style). */
export interface AddableItem {
    id: string
    name: string
    description: string | null
    base_price: number
    sale_price?: number | null
    food_type: FoodType
    gst_slab: number
    image_url?: string | null
}

/** Active selling price — sale_price wins when set and lower than base_price. */
function priceOf(it: AddableItem): number {
    if (it.sale_price != null && Number(it.sale_price) > 0 && Number(it.sale_price) < Number(it.base_price)) {
        return Number(it.sale_price)
    }
    return Number(it.base_price)
}

/**
 * McDonald's-kiosk-style "add an item" sheet, shared by the POS and the
 * customer QR ordering page. Tap a menu tile → this opens with a big
 * quantity stepper, a special-instructions box, and the item's recommended
 * add-ons as one-tap cards. "Add to order" drops it in the cart.
 */
export function ItemAddDialog<T extends AddableItem>({
    item,
    recommended,
    inCartIds,
    currency = "INR",
    taxLabel = "GST",
    onClose,
    onAdd,
    onQuickAdd,
}: {
    item: T | null
    /** This item's curated add-on suggestions (already filtered for availability). */
    recommended: T[]
    /** Item ids currently in the cart — to show "added" on the add-on cards. */
    inCartIds: Set<string>
    /** ISO 4217 currency code for formatting. */
    currency?: string
    /** What this country calls its tax — "GST", "VAT", "Sales Tax"… (hidden when "" / no tax). */
    taxLabel?: string
    onClose: () => void
    /** Add the main item with the chosen quantity + notes. */
    onAdd: (item: T, quantity: number, notes: string) => void
    /** One-tap add of a recommended add-on (qty 1). */
    onQuickAdd: (item: T) => void
}) {
    const [qty, setQty] = useState(1)
    const [notes, setNotes] = useState("")
    const [justAdded, setJustAdded] = useState<Set<string>>(new Set())
    const money = (v: number) => formatCurrency(v, currency)

    // Reset when a different item opens.
    useEffect(() => {
        if (item) { setQty(1); setNotes(""); setJustAdded(new Set()) }
    }, [item])

    if (!item) return null
    const unitPrice = priceOf(item)
    const lineTotal = unitPrice * qty
    const onSale = item.sale_price != null && Number(item.sale_price) < Number(item.base_price)

    function quickAdd(r: T) {
        onQuickAdd(r)
        setJustAdded((prev) => new Set(prev).add(r.id))
    }

    return (
        <Dialog open={!!item} onOpenChange={(o) => { if (!o) onClose() }}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <span className="h-3 w-3 rounded-full shrink-0" style={{ background: FOOD_DOT[item.food_type] }} />
                        <span className="truncate">{item.name}</span>
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Item picture — fixed-height banner. Matches the POS tile
                     *  pattern: real photo when available, gradient + capital-
                     *  letter placeholder otherwise (so the dialog never has a
                     *  giant white gap when an item has no image yet). */}
                    <div className="relative -mt-1 rounded-lg overflow-hidden">
                        {item.image_url ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                                src={item.image_url}
                                alt=""
                                className="w-full h-40 object-cover"
                                loading="lazy"
                            />
                        ) : (
                            <div className="w-full h-40 grid place-items-center bg-gradient-to-br from-primary/15 via-card to-[hsl(var(--neon-magenta)/0.12)]">
                                <span className="text-6xl font-bold text-primary/40 select-none">
                                    {item.name.charAt(0).toUpperCase()}
                                </span>
                            </div>
                        )}
                    </div>
                    {item.description && <p className="text-sm text-muted-foreground break-words">{item.description}</p>}
                    {/* Wraps gracefully on narrow widths so a long price + sale
                     *  badge + tax badge never burst out of the dialog. */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
                        <span className="text-2xl font-bold text-primary tabular-nums">{money(unitPrice)}</span>
                        {onSale && (
                            <>
                                <span className="text-sm text-muted-foreground line-through tabular-nums">{money(item.base_price)}</span>
                                <Badge variant="destructive" className="text-[10px] shrink-0">
                                    {Math.round((1 - unitPrice / Number(item.base_price)) * 100)}% OFF
                                </Badge>
                            </>
                        )}
                        {taxLabel && <Badge variant="outline" className="text-[10px] shrink-0">{taxLabel} {item.gst_slab}%</Badge>}
                    </div>

                    {/* Quantity stepper — big touch targets that still fit on a 320px viewport. */}
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 p-2.5 sm:p-3">
                        <Label className="text-sm shrink-0">Quantity</Label>
                        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                            <Button
                                size="icon"
                                variant="outline"
                                className="h-10 w-10 sm:h-11 sm:w-11 rounded-full shrink-0"
                                onClick={() => setQty((q) => Math.max(1, q - 1))}
                                disabled={qty <= 1}
                            >
                                <Minus className="h-5 w-5" />
                            </Button>
                            <span className="w-8 sm:w-10 text-center text-xl sm:text-2xl font-bold tabular-nums">{qty}</span>
                            <Button
                                size="icon"
                                variant="outline"
                                className="h-10 w-10 sm:h-11 sm:w-11 rounded-full shrink-0"
                                onClick={() => setQty((q) => Math.min(99, q + 1))}
                            >
                                <Plus className="h-5 w-5" />
                            </Button>
                        </div>
                    </div>

                    {/* Special instructions */}
                    <div className="space-y-1.5">
                        <Label className="text-sm">Anything special? <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="e.g. less spicy, no onion, extra napkins"
                            className="min-h-[56px]"
                        />
                    </div>

                    {/* Recommended add-ons */}
                    {recommended.length > 0 && (
                        <div className="space-y-2">
                            <Label className="text-sm">Goes well with</Label>
                            <div className="grid grid-cols-2 gap-2">
                                {recommended.map((r) => {
                                    const added = justAdded.has(r.id) || inCartIds.has(r.id)
                                    return (
                                        <button
                                            key={r.id}
                                            type="button"
                                            onClick={() => !added && quickAdd(r)}
                                            className={cn(
                                                "flex items-center gap-2 rounded-lg border p-2.5 text-left text-sm transition-colors",
                                                added
                                                    ? "border-success/40 bg-success/10 text-success cursor-default"
                                                    : "border-border/60 hover:border-primary/50 hover:bg-card/60",
                                            )}
                                        >
                                            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: FOOD_DOT[r.food_type] }} />
                                            <span className="flex-1 min-w-0 truncate font-medium">{r.name}</span>
                                            {added
                                                ? <Check className="h-4 w-4 shrink-0" />
                                                : <span className="text-xs text-muted-foreground shrink-0">{money(priceOf(r))}</span>}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer — bullet-proof layout for narrow phones AND big totals.
                 *  • Stacks Cancel + Add on small screens (col), side-by-side on sm+ (row).
                 *  • Add button is `min-w-0 whitespace-normal h-auto` so it can
                 *    shrink below content width and wrap onto two lines when the
                 *    price is large (₹12,34,567.00) without bursting the dialog.
                 *  • Plus icon and price are `shrink-0` so neither gets squished. */}
                <DialogFooter className="gap-2 sm:gap-2 flex-col-reverse sm:flex-row">
                    <Button
                        variant="ghost"
                        onClick={onClose}
                        className="w-full sm:w-auto sm:flex-none"
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="neon"
                        size="lg"
                        className="w-full sm:flex-1 min-w-0 h-auto py-2.5 px-3 sm:px-5 whitespace-normal leading-tight"
                        onClick={() => { onAdd(item, qty, notes.trim()); onClose() }}
                    >
                        <Plus className="h-4 w-4 shrink-0" />
                        <span className="min-w-0">Add to order</span>
                        <span className="shrink-0 font-bold tabular-nums">— {money(lineTotal)}</span>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
