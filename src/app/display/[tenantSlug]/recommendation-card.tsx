"use client"

import { motion } from "framer-motion"
import { Plus, UtensilsCrossed } from "lucide-react"

import { formatCurrency } from "@/lib/utils"

/** One upsell pick, ready to render on the customer display. */
export interface RecSuggestion {
    id: string
    name: string
    price: number
    image_url: string | null
    tag: string
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

/**
 * The visual face of an upsell card — a 3:4 "treasure" card.
 *
 * Full-bleed food photography under a legibility scrim, the dish name
 * and an "Add for …" price anchored to the foot, and — the signature —
 * a sparkling chase-light border: a slow conic-gradient wheel clipped to
 * a 3px rim, so light keeps travelling around the edge.
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
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-transparent" />

                {/* A glare that rakes across the photo every few seconds. */}
                <motion.div
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-2/5 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                    initial={{ x: "-130%", skewX: -12 }}
                    animate={{ x: ["-130%", "290%"] }}
                    transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 3.2, ease: "easeInOut" }}
                />

                {/* "Add-on" marker, top-right */}
                <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 ring-1 ring-white/25 backdrop-blur-md">
                    <Plus className="h-3 w-3 text-white" strokeWidth={3} />
                    <span className="text-[10px] font-bold uppercase tracking-wide text-white">Add-on</span>
                </div>

                {/* Tag · name · price, anchored to the foot. */}
                <div className="absolute inset-x-0 bottom-0 p-4">
                    <div className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2 py-0.5 ring-1 ring-amber-300/40">
                        <Spark className="h-3 w-3 text-amber-300" />
                        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-200">
                            {suggestion.tag}
                        </span>
                    </div>
                    <h3 className="mt-1.5 line-clamp-2 text-xl font-bold leading-tight text-white drop-shadow-sm">
                        {suggestion.name}
                    </h3>
                    <div className="mt-2.5 flex items-center gap-2">
                        <span className="text-[11px] font-medium uppercase tracking-wide text-white/60">
                            Add for
                        </span>
                        <span className="rounded-lg bg-gradient-to-br from-amber-300 via-amber-400 to-amber-500 px-2.5 py-1 text-base font-extrabold tabular-nums text-amber-950 shadow-[0_4px_14px_-2px_rgba(251,191,36,0.6)]">
                            {formatCurrency(suggestion.price, currency)}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    )
}
