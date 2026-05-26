"use client"

import { AnimatePresence, motion } from "framer-motion"
import { useEffect, useState } from "react"

export interface FlyEvent {
    id: number
    fromX: number
    fromY: number
    toX: number
    toY: number
    label: string
    color: string
}

/** Animates a small badge flying from a source point (Add button) to the cart icon
 *  using a curved Bezier path. */
export function FlyOverlay({ events, onComplete }: { events: FlyEvent[]; onComplete: (id: number) => void }) {
    return (
        <div className="fixed inset-0 pointer-events-none z-[100]">
            <AnimatePresence>
                {events.map((e) => {
                    const midX = (e.fromX + e.toX) / 2
                    const midY = Math.min(e.fromY, e.toY) - 120 // arc upward
                    return (
                        <motion.div
                            key={e.id}
                            initial={{ x: e.fromX - 24, y: e.fromY - 24, scale: 1, opacity: 1 }}
                            animate={{
                                x: [e.fromX - 24, midX - 24, e.toX - 24],
                                y: [e.fromY - 24, midY - 24, e.toY - 24],
                                scale: [1, 0.9, 0.4],
                                opacity: [1, 1, 0],
                                rotate: [0, 180, 360],
                            }}
                            transition={{ duration: 0.85, ease: [0.45, 0, 0.55, 1], times: [0, 0.5, 1] }}
                            onAnimationComplete={() => onComplete(e.id)}
                            className="absolute h-12 w-12 rounded-full grid place-items-center text-white font-bold shadow-2xl"
                            style={{
                                background: e.color,
                                boxShadow: `0 0 24px ${e.color}, 0 8px 32px rgba(0,0,0,0.4)`,
                            }}
                        >
                            {e.label}
                        </motion.div>
                    )
                })}
            </AnimatePresence>
        </div>
    )
}

/** Hook for triggering fly events. */
export function useFlyToCart() {
    const [events, setEvents] = useState<FlyEvent[]>([])
    const [bumpKey, setBumpKey] = useState(0)

    function fly(args: Omit<FlyEvent, "id">) {
        const id = Date.now() + Math.random()
        setEvents((p) => [...p, { ...args, id }])
        // The cart icon should bump when the animation lands.
        setTimeout(() => setBumpKey((k) => k + 1), 800)
    }

    function complete(id: number) {
        setEvents((p) => p.filter((e) => e.id !== id))
    }

    return { events, fly, complete, bumpKey }
}
