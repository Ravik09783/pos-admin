"use client"

import { motion } from "framer-motion"
import { Clock, Sparkles, type LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"

/**
 * Setup-guide hero — the first impression on the page.
 *
 * Goals:
 *   - Anchor the user emotionally ("you're about to go live")
 *   - Communicate scope ("X steps, ~Y minutes")
 *   - Set regional context (India / International) so the page doesn't
 *     feel generic — the OWNER reads it as "this was written for me"
 *
 * Visual layers (back to front):
 *   - Two soft radial gradient blobs that drift on a long loop
 *   - Subtle grid overlay for depth without busyness
 *   - Floating sparkle particles that fan out on load
 *   - Centered content stack: badge → headline (mixed weights + gradient
 *     accent) → subtitle → meta-strip (step count + time + region)
 *
 * All ornament is `aria-hidden` so screen readers get the clean content
 * stack only.
 */
export function SetupGuideHero({
    region,
    flag,
    stepCount,
    estimatedMinutes,
    headlineHighlight,
    subtitle,
}: {
    region: string                    // "India" / "International"
    /** Lucide icon used as the region marker — Globe for INTL,
     *  ShieldCheck for India (GST/FSSAI flavour), etc. Caller picks. */
    flag: LucideIcon
    stepCount: number
    estimatedMinutes: number
    /** The gradient-highlighted phrase inside the headline. */
    headlineHighlight: string
    subtitle: string
}) {
    const Flag = flag
    return (
        <section className="relative overflow-hidden rounded-3xl border-2 border-border/40 mb-10">
            {/* ── Background ornaments ───────────────────────────────── */}
            <BackgroundLayer />

            <div className="relative px-6 md:px-12 py-12 md:py-16 text-center">
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                >
                    <Badge variant="neon" className="mb-5 px-3 py-1 text-xs">
                        <Sparkles className="h-3 w-3 mr-1.5" />
                        {region} · setup guide
                    </Badge>
                </motion.div>

                {/* Headline — split into normal + gradient highlight so
                  * the gradient is reserved for the emotional payoff
                  * phrase rather than the whole sentence. */}
                <motion.h1
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                    className="text-4xl md:text-6xl font-extrabold tracking-tight leading-[1.05]"
                >
                    Your restaurant
                    <br />
                    <span className="text-primary inline-block">
                        {headlineHighlight}
                    </span>
                </motion.h1>

                <motion.p
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.55, delay: 0.25 }}
                    className="mt-5 text-base md:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed"
                >
                    {subtitle}
                </motion.p>

                {/* Meta strip — step count + estimated time + region.
                  * Sets concrete expectations: "I know exactly how big a
                  * task this is before I commit." */}
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.55, delay: 0.4 }}
                    className="mt-7 flex items-center justify-center gap-3 flex-wrap"
                >
                    <MetaChip icon={Sparkles} label={`${stepCount} steps`} />
                    <MetaChip icon={Clock} label={`~${estimatedMinutes} min total`} />
                    <MetaChip icon={Flag} label={region} />
                </motion.div>
            </div>
        </section>
    )
}

function MetaChip({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 backdrop-blur px-3 py-1.5 text-xs font-medium">
            <Icon className="h-3 w-3 text-primary" />
            {label}
        </span>
    )
}

function BackgroundLayer() {
    return (
        <div aria-hidden className="absolute inset-0 -z-10">
            {/* Grid texture */}
            <div
                className="absolute inset-0 opacity-[0.08]"
                style={{
                    backgroundImage:
                        "linear-gradient(to right, hsl(var(--foreground)/0.4) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--foreground)/0.4) 1px, transparent 1px)",
                    backgroundSize: "32px 32px",
                    maskImage: "radial-gradient(circle at center, black, transparent 70%)",
                    WebkitMaskImage: "radial-gradient(circle at center, black, transparent 70%)",
                }}
            />

            {/* Drifting gradient blob 1 — primary */}
            <motion.div
                className="absolute -top-32 -left-20 h-[480px] w-[480px] rounded-full"
                style={{
                    background:
                        "radial-gradient(circle at center, hsl(var(--primary)/0.45), transparent 65%)",
                }}
                animate={{ x: [0, 30, 0], y: [0, 20, 0] }}
                transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Drifting gradient blob 2 — magenta */}
            <motion.div
                className="absolute -bottom-32 -right-20 h-[420px] w-[420px] rounded-full"
                style={{
                    background:
                        "radial-gradient(circle at center, hsl(var(--neon-magenta)/0.45), transparent 65%)",
                }}
                animate={{ x: [0, -25, 0], y: [0, -20, 0] }}
                transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Sparkle particles — fan out from center on entrance,
             *  then settle. Subtle but adds depth. */}
            <SparkleField />
        </div>
    )
}

function SparkleField() {
    const particles = Array.from({ length: 10 })
    return (
        <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
            {particles.map((_, i) => {
                const left = 10 + ((i * 73) % 80)
                const top = 10 + ((i * 41) % 75)
                const delay = i * 0.15
                return (
                    <motion.span
                        key={i}
                        className="absolute h-1.5 w-1.5 rounded-full bg-primary/60"
                        style={{
                            left: `${left}%`,
                            top: `${top}%`,
                            boxShadow: "0 0 12px 2px hsl(var(--primary)/0.4)",
                        }}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: [0, 1, 0.7], opacity: [0, 1, 0.5] }}
                        transition={{
                            duration: 2.4,
                            delay,
                            repeat: Infinity,
                            repeatType: "reverse",
                            ease: "easeInOut",
                        }}
                    />
                )
            })}
        </div>
    )
}
