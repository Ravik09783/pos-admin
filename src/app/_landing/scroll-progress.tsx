"use client"

import { motion, useScroll, useSpring } from "framer-motion"

/**
 * Thin gradient bar pinned at the top of the viewport that tracks scroll
 * progress. Subtle but it nudges the user toward "you're on a journey" —
 * the page reveals as you move forward.
 *
 * Uses framer's `useSpring` on `scrollYProgress` so the bar smoothly chases
 * the scroll position instead of jittering.
 *
 * Note: on phones the visual cost is minimal (a 2px bar transformed via
 * scaleX) so we render it everywhere. Earlier attempts to gate this on
 * matchMedia tripped a hydration / render edge case — keeping it simple
 * is more reliable than the savings were worth.
 */
export function ScrollProgress() {
    const { scrollYProgress } = useScroll()
    const scaleX = useSpring(scrollYProgress, {
        stiffness: 140,
        damping: 22,
        mass: 0.25,
    })

    return (
        <motion.div
            aria-hidden
            className="fixed top-0 left-0 right-0 h-[2px] z-[60] origin-left"
            style={{
                scaleX,
                background:
                    "linear-gradient(90deg, hsl(var(--neon-cyan)), hsl(var(--neon-magenta)), hsl(var(--neon-cyan)))",
                boxShadow: "0 0 12px hsl(var(--neon-cyan) / 0.6)",
            }}
        />
    )
}
