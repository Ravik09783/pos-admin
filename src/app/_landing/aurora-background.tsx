"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"

/**
 * Living aurora — three giant blurred blobs that slowly drift and pulse in
 * the cyan→magenta brand palette. Replaces the static gradient orbs so the
 * background feels alive without competing for attention. Fixed positioning
 * means the aurora follows the user as they scroll.
 *
 * Mobile + reduced-motion: the animation is the expensive part (three
 * 120px-blurred layers tweening continuously eats GPU on mid-range phones
 * and was the main culprit behind the "scroll feels sluggish" report).
 *
 * Implementation note: we render the EXACT same DOM tree regardless of
 * whether animation is enabled — only the `animate` and `transition` props
 * on each motion.div get nulled out on mobile / reduced-motion. This way
 * the SSR HTML and the first client render are byte-identical, avoiding
 * any hydration mismatch (the previous version with two return branches
 * was triggering a runtime error in the route's error boundary).
 */
export function AuroraBackground() {
    const [doAnimate, setDoAnimate] = useState(false)

    useEffect(() => {
        if (typeof window === "undefined") return
        const isTouch = window.matchMedia("(hover: none)").matches
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        const isSmall = window.matchMedia("(max-width: 768px)").matches
        if (!isTouch && !reduced && !isSmall) setDoAnimate(true)
    }, [])

    // Static + animated branches share the same DOM — only `animate` /
    // `transition` differ. `undefined` disables the tween cleanly without
    // ripping the element out of the tree.
    const aurora1 = doAnimate
        ? { x: [0, 120, -40, 0], y: [0, 80, 40, 0], scale: [1, 1.15, 0.95, 1] }
        : undefined
    const aurora2 = doAnimate
        ? { x: [0, -100, 60, 0], y: [0, 60, -40, 0], scale: [1, 1.1, 1.05, 1] }
        : undefined
    const aurora3 = doAnimate
        ? { x: ["-50%", "-40%", "-60%", "-50%"], y: [0, -60, 30, 0], scale: [1, 1.12, 0.95, 1] }
        : undefined

    return (
        <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
            {/* Deep base wash so the blobs blend cleanly into the background. */}
            <div className="absolute inset-0 bg-background" />

            {/* Aurora #1 — primary cyan, top-left, slowest. */}
            <motion.div
                aria-hidden
                className="absolute h-[700px] w-[1200px] rounded-full blur-[120px]"
                style={{
                    background: "radial-gradient(circle, hsl(var(--neon-cyan) / 0.32), transparent 60%)",
                    top: "-200px",
                    left: "-200px",
                }}
                animate={aurora1}
                transition={doAnimate ? { duration: 28, repeat: Infinity, ease: "easeInOut" } : undefined}
            />

            {/* Aurora #2 — magenta, top-right, faster. */}
            <motion.div
                aria-hidden
                className="absolute h-[600px] w-[1000px] rounded-full blur-[120px]"
                style={{
                    background: "radial-gradient(circle, hsl(var(--neon-magenta) / 0.28), transparent 60%)",
                    top: "-100px",
                    right: "-200px",
                }}
                animate={aurora2}
                transition={doAnimate ? { duration: 22, repeat: Infinity, ease: "easeInOut", delay: 2 } : undefined}
            />

            {/* Aurora #3 — amber accent, bottom-center, slow drift. */}
            <motion.div
                aria-hidden
                className="absolute h-[500px] w-[900px] rounded-full blur-[120px]"
                style={{
                    background: "radial-gradient(circle, hsl(var(--neon-amber) / 0.12), transparent 60%)",
                    bottom: "-150px",
                    left: "50%",
                    translateX: "-50%",
                }}
                animate={aurora3}
                transition={doAnimate ? { duration: 32, repeat: Infinity, ease: "easeInOut", delay: 4 } : undefined}
            />

            {/* Faint grid mask overlay for that "blueprint of a new world" feel. */}
            <div className="absolute inset-0 grid-bg opacity-30" />
        </div>
    )
}
