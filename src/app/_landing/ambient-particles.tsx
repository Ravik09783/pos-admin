"use client"

import { motion } from "framer-motion"
import { useEffect, useMemo, useState } from "react"

interface Particle {
    id: number
    left: number
    delay: number
    duration: number
    size: number
    color: string
    drift: number
}

/**
 * Drifting particle field — gives the hero a "stepping into space" feel. The
 * particles slowly float up, fade in and out, and wander horizontally a bit.
 *
 * Mobile + reduced-motion: 24 simultaneously-animated rounded spans with
 * box-shadow glow is genuinely expensive on phones (each is its own GPU
 * layer). We render zero particles in that case — the outer wrapper stays
 * for layout stability, so server-side HTML and first client render match.
 *
 * Generated once with `useMemo` so positions are stable across re-renders
 * but vary on each mount (good for "looks alive" without server/client
 * hydration mismatch issues — the random call only fires client-side, and
 * the parent is `"use client"`).
 */
export function AmbientParticles({ count = 24 }: { count?: number }) {
    const [shouldRender, setShouldRender] = useState(false)

    useEffect(() => {
        if (typeof window === "undefined") return
        const isTouch = window.matchMedia("(hover: none)").matches
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        const isSmall = window.matchMedia("(max-width: 768px)").matches
        if (isTouch || reduced || isSmall) return
        setShouldRender(true)
    }, [])

    const particles = useMemo<Particle[]>(() => {
        if (!shouldRender) return []
        return Array.from({ length: count }, (_, i) => ({
            id: i,
            left: Math.random() * 100,
            delay: Math.random() * 8,
            duration: 10 + Math.random() * 14,
            size: 2 + Math.random() * 3,
            color: Math.random() > 0.6 ? "hsl(var(--neon-magenta))" : "hsl(var(--neon-cyan))",
            drift: (Math.random() - 0.5) * 60,
        }))
    }, [count, shouldRender])

    // Always render the wrapper div so server and client first render match
    // byte-for-byte. The children are populated only after the matchMedia
    // probe says we're on a capable viewport — that's a normal re-render
    // post-hydration, not a hydration mismatch.
    return (
        <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
            {particles.map((p) => (
                <motion.span
                    key={p.id}
                    className="absolute rounded-full"
                    style={{
                        left: `${p.left}%`,
                        bottom: -20,
                        width: p.size,
                        height: p.size,
                        background: p.color,
                        boxShadow: `0 0 ${p.size * 4}px ${p.color}`,
                    }}
                    initial={{ opacity: 0, y: 0, x: 0 }}
                    animate={{
                        opacity: [0, 0.8, 0.6, 0],
                        y: [0, -600 - Math.random() * 200],
                        x: [0, p.drift],
                    }}
                    transition={{
                        duration: p.duration,
                        delay: p.delay,
                        repeat: Infinity,
                        ease: "linear",
                    }}
                />
            ))}
        </div>
    )
}
