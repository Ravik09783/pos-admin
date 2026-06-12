"use client"

import { motion } from "framer-motion"
import { Heart, Sparkles, UtensilsCrossed } from "lucide-react"

import { formatCurrency } from "@/lib/utils"

/** One upsell pick, ready to render on the customer display. */
export interface RecSuggestion {
    id: string
    name: string
    price: number
    /** Pre-sale price when the item is discounted — rendered struck-through
     *  next to a "% OFF" pill so the deal is impossible to miss. */
    original_price?: number | null
    /** One-line menu description — the appetite copy that actually sells. */
    description?: string | null
    /** VEG / NON_VEG / EGG / VEGAN — renders the Indian-style diet mark. */
    food_type?: string | null
    image_url: string | null
    /** Why we're showing THIS item to THIS customer — the name of the
     *  cart item the admin paired it with. Surfaced on the card as
     *  "Pairs with <name>" so the suggestion reads honest and
     *  data-driven, not as a generic "Chef's pick" sticker. */
    pairedWith: string
}

/** A soft four-point sparkle — the motif that makes the card glitter.
 *  Size comes from `size` (px) when given, otherwise from `className`. */
export function Spark({ className, size }: { className?: string; size?: number }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
            className={className}
            width={size}
            height={size}
        >
            <path d="M12 .5c1 6.4 4.1 9.5 10.5 10.5C16.1 12 13 15.1 12 21.5 11 15.1 7.9 12 1.5 11 7.9 10 11 6.9 12 .5Z" />
        </svg>
    )
}

/** Indian FSSAI-style diet mark: a tiny rounded square with a dot —
 *  green = veg/vegan, red = non-veg, amber = egg. Nothing for unknown. */
function DietMark({ foodType }: { foodType?: string | null }) {
    const t = (foodType ?? "").toUpperCase()
    if (!t) return null
    const color =
        t === "NON_VEG" ? "border-red-500 text-red-500"
        : t === "EGG" ? "border-amber-400 text-amber-400"
        : "border-emerald-500 text-emerald-500" // VEG + VEGAN
    return (
        <span
            aria-label={t === "NON_VEG" ? "Non-vegetarian" : t === "EGG" ? "Contains egg" : "Vegetarian"}
            className={`inline-grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border-2 bg-black/40 backdrop-blur-sm ${color}`}
        >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
        </span>
    )
}

/**
 * The visual face of an upsell card — a 3:4 "treasure" card.
 *
 * Full-bleed food photography under a legibility scrim; the info layer
 * sells the dish: the honest "Pairs with <cart item>" chip, the diet
 * mark + dish name, one line of appetite copy from the menu description,
 * and the price block — struck-through original + "% OFF" pill when a
 * sale is running. The signature sparkling chase-light border (a slow
 * conic-gradient wheel clipped to a 3px rim) stays.
 *
 * This is purely the artwork. The treasure halo, the gentle float and
 * the twinkling sparkles live in `recommendation-treasure.tsx`.
 */
export function RecommendationCardFace({
    suggestion, currency,
}: {
    suggestion: RecSuggestion
    currency: string
}) {
    const orig = Number(suggestion.original_price ?? 0)
    const onSale = orig > 0 && orig > suggestion.price
    const pctOff = onSale ? Math.round(((orig - suggestion.price) / orig) * 100) : 0

    return (
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[1.7rem] p-[3px]">
            {/* Sparkling chase-light border — a conic gradient wheeling
                slowly behind the card, clipped to the 3px rim. */}
            <motion.div
                aria-hidden
                className="absolute inset-[-65%]"
                style={{
                    background:
                        "conic-gradient(from 0deg," +
                        " transparent 0deg, #fde68a 38deg, #ffffff 68deg, #fbcfe8 104deg," +
                        " transparent 150deg, transparent 212deg, #a5f3fc 250deg," +
                        " #ffffff 286deg, #fde68a 322deg, transparent 360deg)",
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: 7.5, repeat: Infinity, ease: "linear" }}
            />

            {/* The card body — opaque, so only the 3px rim of the wheel shows. */}
            <div className="relative h-full w-full overflow-hidden rounded-[calc(1.7rem-3px)] bg-neutral-950 ring-1 ring-white/10">
                {/* Food photography, full bleed */}
                {suggestion.image_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                        src={suggestion.image_url}
                        alt={suggestion.name}
                        className="absolute inset-0 h-full w-full object-cover"
                    />
                ) : (
                    <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-fuchsia-900 via-neutral-900 to-cyan-900">
                        <UtensilsCrossed className="h-16 w-16 text-white/25" />
                    </div>
                )}

                {/* Legibility scrim — dark at the foot, clear at the top. */}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

                {/* A glare that rakes across the photo every few seconds. */}
                <motion.div
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-2/5 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                    initial={{ x: "-130%", skewX: -12 }}
                    animate={{ x: ["-130%", "290%"] }}
                    transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 3.2, ease: "easeInOut" }}
                />

                {/* Top-right: % OFF when a sale runs, else "Chef's pick". */}
                {onSale ? (
                    <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-gradient-to-r from-rose-500 to-orange-500 px-2.5 py-1 shadow-[0_4px_14px_-2px_rgba(244,63,94,0.7)]">
                        <span className="text-[11px] font-extrabold uppercase tracking-wide text-white">
                            {pctOff}% off
                        </span>
                    </div>
                ) : (
                    <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 ring-1 ring-white/25 backdrop-blur-md">
                        <Sparkles className="h-3 w-3 text-amber-300" />
                        <span className="text-[10px] font-bold uppercase tracking-wide text-white">Chef&apos;s pick</span>
                    </div>
                )}

                {/* Reason · diet mark + name · appetite copy · price block,
                  * anchored to the foot. "Pairs with <X>" is the honest,
                  * data-driven hook (the admin curated this pairing in
                  * /menu-admin); the description line is the menu's own
                  * appetite copy; the price block leans on the sale
                  * strikethrough to close the sale. */}
                <div className="absolute inset-x-0 bottom-0 p-4">
                    <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-amber-400/20 px-2.5 py-1 ring-1 ring-amber-300/40 backdrop-blur-sm">
                        <Heart
                            className="h-3 w-3 shrink-0 text-amber-300"
                            fill="currentColor"
                            aria-hidden
                        />
                        <span className="truncate text-[11px] font-medium leading-none text-amber-50">
                            Pairs with{" "}
                            <span className="font-bold text-amber-100">{suggestion.pairedWith}</span>
                        </span>
                    </div>
                    <div className="mt-1.5 flex items-start gap-1.5">
                        <span className="mt-1"><DietMark foodType={suggestion.food_type} /></span>
                        <h3 className="line-clamp-2 text-xl font-bold leading-tight text-white drop-shadow-sm">
                            {suggestion.name}
                        </h3>
                    </div>
                    {suggestion.description && (
                        <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-white/75">
                            {suggestion.description}
                        </p>
                    )}
                    <div className="mt-2.5 flex items-center gap-2">
                        <span className="text-[11px] font-medium uppercase tracking-wide text-white/60">
                            Add for
                        </span>
                        <span className="rounded-lg bg-gradient-to-br from-amber-300 via-amber-400 to-amber-500 px-2.5 py-1 text-base font-extrabold tabular-nums text-amber-950 shadow-[0_4px_14px_-2px_rgba(251,191,36,0.6)]">
                            {formatCurrency(suggestion.price, currency)}
                        </span>
                        {onSale && (
                            <span className="text-sm font-semibold tabular-nums text-white/55 line-through decoration-white/50">
                                {formatCurrency(orig, currency)}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
