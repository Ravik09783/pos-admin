"use client"

import { motion } from "framer-motion"

/**
 * Animated SVG line that "draws itself" between How-It-Works step cards.
 * Renders only on md+ (the cards stack vertically on mobile so the line
 * doesn't make sense). The path is drawn from left to right as the section
 * scrolls into view.
 */
export function StepConnectorLine() {
    return (
        <div aria-hidden className="hidden md:block absolute top-1/2 left-0 right-0 -translate-y-1/2 pointer-events-none">
            <svg
                className="w-full h-3 overflow-visible"
                viewBox="0 0 1200 12"
                preserveAspectRatio="none"
            >
                <defs>
                    <linearGradient id="step-line" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="hsl(var(--neon-cyan))" stopOpacity="0.7" />
                        <stop offset="50%" stopColor="hsl(var(--neon-magenta))" stopOpacity="0.7" />
                        <stop offset="100%" stopColor="hsl(var(--neon-cyan))" stopOpacity="0.7" />
                    </linearGradient>
                </defs>
                <motion.path
                    d="M 80 6 L 1120 6"
                    stroke="url(#step-line)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray="6 8"
                    fill="none"
                    initial={{ pathLength: 0, opacity: 0 }}
                    whileInView={{ pathLength: 1, opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.6, ease: "easeOut", delay: 0.3 }}
                />
            </svg>
        </div>
    )
}

/**
 * Portal-style accent for the final CTA. Three expanding rings ripple
 * outward forever from the center, giving a "doorway opening" sense.
 * Placed behind content with `pointer-events-none`.
 */
export function PortalRings() {
    return (
        <div aria-hidden className="absolute inset-0 grid place-items-center pointer-events-none -z-0">
            {[0, 1, 2].map((i) => (
                <motion.div
                    key={i}
                    className="absolute rounded-full border border-primary/30"
                    style={{ width: 200, height: 200 }}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: [0.6, 2.4], opacity: [0.5, 0] }}
                    transition={{
                        duration: 4,
                        delay: i * 1.3,
                        repeat: Infinity,
                        ease: "easeOut",
                    }}
                />
            ))}
        </div>
    )
}

/**
 * Small drifting accent dot used decoratively — placed inside section
 * headings, sparkles, etc. Doesn't take much space but adds life.
 */
export function PulseDot({ className = "" }: { className?: string }) {
    return (
        <motion.span
            aria-hidden
            className={`inline-block h-1.5 w-1.5 rounded-full bg-primary ${className}`}
            animate={{ scale: [1, 1.6, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            style={{ boxShadow: "0 0 12px hsl(var(--neon-cyan))" }}
        />
    )
}
