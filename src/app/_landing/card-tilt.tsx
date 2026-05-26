"use client"

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion"
import { useEffect, useRef, useState } from "react"

/**
 * 3D card tilt on hover — subtle, premium-feeling. The card tracks the
 * cursor's position within its bounding box and rotates a few degrees on
 * the X and Y axes. The page-level `CursorSpotlight` already handles the
 * glow that follows the cursor, so this just does the tilt.
 *
 * Disabled on touch + reduced-motion.
 *
 * `intensity` ranges 0..1 — defaults to 0.6 (~5° max rotation).
 */
export function CardTilt({
    children,
    intensity = 0.6,
    className = "",
}: {
    children: React.ReactNode
    intensity?: number
    className?: string
}) {
    const ref = useRef<HTMLDivElement>(null)
    const [enabled, setEnabled] = useState(false)

    const x = useMotionValue(0)
    const y = useMotionValue(0)
    const sx = useSpring(x, { stiffness: 220, damping: 22, mass: 0.3 })
    const sy = useSpring(y, { stiffness: 220, damping: 22, mass: 0.3 })

    const maxDeg = 8 * intensity
    const rotateY = useTransform(sx, [-1, 1], [maxDeg, -maxDeg])
    const rotateX = useTransform(sy, [-1, 1], [-maxDeg, maxDeg])

    useEffect(() => {
        const isTouch = window.matchMedia("(hover: none)").matches
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        if (!isTouch && !reduced) setEnabled(true)
    }, [])

    function onMove(e: React.MouseEvent<HTMLDivElement>) {
        if (!enabled || !ref.current) return
        const rect = ref.current.getBoundingClientRect()
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1
        const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1
        x.set(nx)
        y.set(ny)
    }
    function onLeave() { x.set(0); y.set(0) }

    return (
        <div
            ref={ref}
            onMouseMove={onMove}
            onMouseLeave={onLeave}
            style={{ perspective: enabled ? "1200px" : undefined }}
            className={className}
        >
            <motion.div
                style={enabled ? { rotateX, rotateY, transformStyle: "preserve-3d" } : undefined}
                className="relative will-change-transform h-full"
            >
                {children}
            </motion.div>
        </div>
    )
}
