"use client"

import { useEffect, useRef, useState } from "react"

/**
 * Cursor-following spotlight. A soft radial glow tracks the mouse on desktop,
 * giving the page a "the world reacts to you" feel without being distracting.
 * Disabled on touch devices (no cursor) and when the user prefers reduced
 * motion.
 *
 * Implementation: one fixed div, RAF-throttled mousemove handler, CSS
 * radial-gradient driven by inline style — zero re-renders per pointer event.
 */
export function CursorSpotlight() {
    const ref = useRef<HTMLDivElement>(null)
    const [enabled, setEnabled] = useState(false)

    useEffect(() => {
        const isTouch = window.matchMedia("(hover: none)").matches
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        if (isTouch || reduced) return
        setEnabled(true)

        let raf = 0
        let x = 0, y = 0
        const onMove = (e: MouseEvent) => {
            x = e.clientX
            y = e.clientY
            if (!raf) {
                raf = requestAnimationFrame(() => {
                    if (ref.current) {
                        ref.current.style.setProperty("--cx", `${x}px`)
                        ref.current.style.setProperty("--cy", `${y}px`)
                    }
                    raf = 0
                })
            }
        }
        window.addEventListener("mousemove", onMove, { passive: true })
        return () => {
            window.removeEventListener("mousemove", onMove)
            if (raf) cancelAnimationFrame(raf)
        }
    }, [])

    if (!enabled) return null

    return (
        <div
            ref={ref}
            aria-hidden
            className="fixed inset-0 pointer-events-none z-0 transition-opacity duration-700"
            style={{
                background:
                    "radial-gradient(600px circle at var(--cx, 50%) var(--cy, 50%), hsl(var(--neon-cyan) / 0.08), transparent 40%)",
            }}
        />
    )
}
