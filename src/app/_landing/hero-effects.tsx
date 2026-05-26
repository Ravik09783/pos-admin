"use client"

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion"
import { useEffect, useRef } from "react"

/**
 * Word-by-word headline reveal. Splits the children string into words and
 * animates each one in sequence — gives the headline a cinematic, "the world
 * is speaking to you" cadence.
 *
 * The gradient suffix is rendered separately so it keeps its `text-gradient`
 * styling without breaking the word splitter.
 */
export function HeadlineReveal({
    prefix,
    highlight,
}: {
    prefix: string
    highlight: string
}) {
    const prefixWords = prefix.split(" ")
    const highlightWords = highlight.split(" ")

    return (
        <motion.h1
            initial="hidden"
            animate="visible"
            variants={{
                hidden: {},
                visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
            }}
            className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-balance leading-[1.05]"
        >
            {prefixWords.map((w, i) => (
                <RevealWord key={`p-${i}`}>{w}</RevealWord>
            ))}
            <span className="inline-block">&nbsp;</span>
            <span className="text-gradient">
                {highlightWords.map((w, i) => (
                    <RevealWord key={`h-${i}`}>{w}</RevealWord>
                ))}
            </span>
        </motion.h1>
    )
}

function RevealWord({ children }: { children: React.ReactNode }) {
    // No `filter: blur` here — it would break the parent's `bg-clip: text`
    // on the gradient highlight span. The y + opacity reveal is enough.
    return (
        <motion.span
            className="inline-block mr-[0.25em]"
            variants={{
                hidden: { opacity: 0, y: 24 },
                visible: {
                    opacity: 1,
                    y: 0,
                    transition: { duration: 0.65, ease: [0.16, 1, 0.3, 1] },
                },
            }}
        >
            {children}
        </motion.span>
    )
}

/**
 * Mouse-parallax wrapper. The wrapped children tilt and shift slightly with
 * the cursor for a 3D-depth effect on the hero device mockup. Disabled on
 * touch devices and when reduced-motion is requested.
 *
 * Implementation uses `useMotionValue` + `useSpring` so framer handles the
 * smoothing, and the parent never re-renders on mouse move.
 */
export function MouseParallax({ children }: { children: React.ReactNode }) {
    const ref = useRef<HTMLDivElement>(null)
    const x = useMotionValue(0)
    const y = useMotionValue(0)
    const sx = useSpring(x, { stiffness: 80, damping: 18, mass: 0.4 })
    const sy = useSpring(y, { stiffness: 80, damping: 18, mass: 0.4 })

    // Bound the rotation to a comfortable max so it never looks "off-axis".
    const rotateY = useTransform(sx, [-1, 1], [10, -10])
    const rotateX = useTransform(sy, [-1, 1], [-6, 6])
    const translateX = useTransform(sx, [-1, 1], [-12, 12])
    const translateY = useTransform(sy, [-1, 1], [-8, 8])

    useEffect(() => {
        const isTouch = window.matchMedia("(hover: none)").matches
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        if (isTouch || reduced) return

        const onMove = (e: MouseEvent) => {
            if (!ref.current) return
            const rect = ref.current.getBoundingClientRect()
            // -1..1 relative to the wrapper's center
            const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1
            const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1
            x.set(Math.max(-1, Math.min(1, nx)))
            y.set(Math.max(-1, Math.min(1, ny)))
        }
        const onLeave = () => { x.set(0); y.set(0) }

        window.addEventListener("mousemove", onMove, { passive: true })
        document.addEventListener("mouseleave", onLeave)
        return () => {
            window.removeEventListener("mousemove", onMove)
            document.removeEventListener("mouseleave", onLeave)
        }
    }, [x, y])

    return (
        <div ref={ref} className="relative" style={{ perspective: "1200px" }}>
            <motion.div
                style={{
                    rotateX,
                    rotateY,
                    x: translateX,
                    y: translateY,
                    transformStyle: "preserve-3d",
                }}
            >
                {children}
            </motion.div>
        </div>
    )
}
