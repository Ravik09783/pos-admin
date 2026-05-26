"use client"

import { motion } from "framer-motion"

import { RecommendationCardFace, Spark, type RecSuggestion } from "./recommendation-card"

/* Sparkle anchor points around the card rim — `top`/`left` as a
 * percentage of the card box (0% = top / left edge, 100% = bottom /
 * right edge). A few sit just outside so the glitter spills past the
 * border. */
const SPARKLES = [
    { top: "-4%",  left: "16%",  size: 22, delay: 0.0, dur: 2.6 },
    { top: "7%",   left: "100%", size: 16, delay: 0.9, dur: 3.0 },
    { top: "40%",  left: "-5%",  size: 24, delay: 1.5, dur: 2.8 },
    { top: "66%",  left: "103%", size: 18, delay: 0.5, dur: 3.2 },
    { top: "101%", left: "34%",  size: 20, delay: 1.1, dur: 2.7 },
    { top: "97%",  left: "82%",  size: 15, delay: 2.0, dur: 3.1 },
    { top: "-3%",  left: "68%",  size: 14, delay: 2.4, dur: 2.9 },
    { top: "24%",  left: "102%", size: 12, delay: 1.8, dur: 2.5 },
]

/**
 * The recommendation card, presented as a small treasure.
 *
 * No hand, no leap — the card simply *glows*. A warm halo breathes
 * behind it, it floats on a slow loop, sparkles twinkle around its rim,
 * and it reveals itself with a soft scale-and-unblur. The parent shows
 * one suggestion at a time (keyed inside <AnimatePresence>), so each
 * gets its moment as the centrepiece — the thing the guest shouldn't
 * miss.
 */
export function RecommendationTreasure({
    suggestion, currency,
}: {
    suggestion: RecSuggestion
    currency: string
}) {
    return (
        <motion.div
            className="relative"
            initial={{ opacity: 0, scale: 0.84, y: 18, filter: "blur(7px)" }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.9, y: -18, filter: "blur(7px)" }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
            {/* Warm treasure halo — breathes behind the card. */}
            <motion.div
                aria-hidden
                className="absolute -inset-7 -z-10 rounded-[2.6rem] blur-3xl"
                style={{
                    background:
                        "radial-gradient(60% 55% at 50% 48%, rgba(251,191,36,0.5)," +
                        " rgba(244,114,182,0.3) 55%, transparent 78%)",
                }}
                animate={{ opacity: [0.55, 1, 0.55], scale: [0.95, 1.06, 0.95] }}
                transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* The card itself, on a slow float. */}
            <motion.div
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }}
            >
                <RecommendationCardFace suggestion={suggestion} currency={currency} />
            </motion.div>

            {/* Twinkling sparkles around the rim. */}
            {SPARKLES.map((s, i) => (
                <div
                    key={i}
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ top: s.top, left: s.left }}
                >
                    <motion.div
                        initial={{ scale: 0, opacity: 0, rotate: 0 }}
                        animate={{ scale: [0, 1, 0], opacity: [0, 1, 0], rotate: [0, 130] }}
                        transition={{
                            duration: s.dur, delay: s.delay,
                            repeat: Infinity, repeatDelay: 1.1, ease: "easeInOut",
                        }}
                    >
                        <Spark
                            size={s.size}
                            className="text-amber-200 drop-shadow-[0_0_6px_rgba(251,191,36,0.9)]"
                        />
                    </motion.div>
                </div>
            ))}
        </motion.div>
    )
}
