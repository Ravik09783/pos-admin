"use client"

import { useEffect } from "react"
import { motion } from "framer-motion"
import { Check, Sparkles, UtensilsCrossed } from "lucide-react"

/** A recommended item the cashier just rang up. */
export interface RecommendationWin {
    id: number
    name: string
    image: string | null
}

const HEADERS = [
    "Great choice!", "Lovely pick!", "Nice one!",
    "Good taste!", "Perfect add!",
]
const DISMISS_MS = 5200

/** Confetti pieces — a fixed spread + palette so the burst looks designed. */
const CONFETTI: Array<{ left: string; x: number; y: number; r: number; cls: string }> = [
    { left: "4%",  x: -54, y: -30, r: 200,  cls: "bg-amber-300" },
    { left: "19%", x: -30, y: -50, r: -220, cls: "bg-cyan-300" },
    { left: "34%", x: -10, y: -58, r: 160,  cls: "bg-white" },
    { left: "50%", x: 8,   y: -62, r: -150, cls: "bg-fuchsia-200" },
    { left: "66%", x: 26,  y: -54, r: 240,  cls: "bg-lime-300" },
    { left: "81%", x: 42,  y: -46, r: -190, cls: "bg-sky-200" },
    { left: "96%", x: 60,  y: -28, r: 170,  cls: "bg-rose-300" },
]

/**
 * Celebration toast — pops over the checkout stage when the cashier rings
 * up an item the customer was just being shown as a recommendation.
 *
 * Springs down from the top inside a slowly-rotating gradient ring, shows
 * the item that was added (thumbnail + a green "added" check), bursts a
 * little confetti, and dismisses itself on a visible countdown bar.
 */
export function RecommendationWinToast({
    win, onDone,
}: {
    win: RecommendationWin
    onDone: () => void
}) {
    const header = HEADERS[win.id % HEADERS.length] ?? HEADERS[0]!
    useEffect(() => {
        const t = window.setTimeout(onDone, DISMISS_MS)
        return () => window.clearTimeout(t)
        // keyed by win.id → fresh mount per win; run the timer once.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[70] -translate-x-1/2">
            <motion.div
                initial={{ opacity: 0, y: -38, scale: 0.82 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -26, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 360, damping: 22 }}
                className="relative"
            >
                {/* Confetti — behind the card, fanning outward */}
                {CONFETTI.map((c, i) => (
                    <motion.span
                        key={i}
                        aria-hidden
                        className={`absolute h-2 w-1.5 rounded-[1px] ${c.cls}`}
                        style={{ left: c.left, top: "62%" }}
                        initial={{ opacity: 0, x: 0, y: 0, scale: 0, rotate: 0 }}
                        animate={{
                            opacity: [0, 1, 1, 0],
                            x: c.x, y: c.y, rotate: c.r,
                            scale: [0, 1, 1, 0.5],
                        }}
                        transition={{ duration: 1.3, delay: 0.14 + i * 0.04, ease: "easeOut" }}
                    />
                ))}

                {/* Gradient-ring card */}
                <div className="relative overflow-hidden rounded-[20px] p-[1.6px] shadow-[0_22px_52px_-14px_rgba(192,38,211,0.7)]">
                    {/* slowly-rotating conic gradient = a living border */}
                    <div className="absolute left-1/2 top-1/2 h-[460px] w-[460px] -translate-x-1/2 -translate-y-1/2">
                        <motion.div
                            aria-hidden
                            className="h-full w-full bg-[conic-gradient(from_0deg,#8b5cf6,#ec4899,#f59e0b,#22d3ee,#8b5cf6)]"
                            animate={{ rotate: 360 }}
                            transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
                        />
                    </div>

                    {/* Inner surface */}
                    <div className="relative flex items-center gap-3.5 rounded-[18px] bg-[#1a1140] px-4 py-3">
                        {/* Item thumbnail + "added" check */}
                        <div className="relative shrink-0">
                            {win.image ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img
                                    src={win.image}
                                    alt={win.name}
                                    className="h-12 w-12 rounded-xl object-cover ring-2 ring-white/20"
                                />
                            ) : (
                                <div className="grid h-12 w-12 place-items-center rounded-xl bg-white/10 ring-2 ring-white/20">
                                    <UtensilsCrossed className="h-5 w-5 text-white/60" />
                                </div>
                            )}
                            <motion.span
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ type: "spring", stiffness: 500, damping: 14, delay: 0.2 }}
                                className="absolute -bottom-1.5 -right-1.5 grid h-6 w-6 place-items-center rounded-full bg-emerald-400 text-[#0c1320] ring-[3px] ring-[#1a1140]"
                            >
                                <Check className="h-3.5 w-3.5" strokeWidth={3.5} />
                            </motion.span>
                        </div>

                        {/* Copy */}
                        <div className="min-w-0 pr-1">
                            <div className="flex items-center gap-1.5">
                                <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                                <span className="text-sm font-bold text-white">{header}</span>
                            </div>
                            <div className="mt-0.5 text-xs leading-snug text-white/75">
                                <span className="font-semibold text-white">{win.name}</span>{" "}
                                added from our recommendations — thanks for taking our pick!
                            </div>
                        </div>
                    </div>

                    {/* Auto-dismiss countdown bar */}
                    <motion.div
                        aria-hidden
                        className="absolute bottom-0 left-0 h-[3px] rounded-full bg-gradient-to-r from-fuchsia-400 to-cyan-300"
                        initial={{ width: "100%" }}
                        animate={{ width: "0%" }}
                        transition={{ duration: DISMISS_MS / 1000, ease: "linear" }}
                    />
                </div>
            </motion.div>
        </div>
    )
}
