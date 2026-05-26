"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowRight, Clock, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Step card — the unit element of the guide timeline.
 *
 * Designed to be a destination, not a placeholder. The redesign added:
 *   - A vertical connector line on the left that "pours" from one step
 *     into the next, with a numbered badge anchored over it. Reads as
 *     a real timeline rather than a flat list.
 *   - Bigger icon panel (h-14, rounded, gradient-tinted, ring) on the
 *     right of the header so each step has a visual anchor scrolling
 *     past.
 *   - Optional "~X min" badge so the OWNER knows the size of the task.
 *   - Hover lift + glow.
 *   - Tone-driven palette (primary / magenta / success / warning) so
 *     consecutive steps don't blur visually.
 *
 * Animation:
 *   - Card fade-up on scroll-into-view (once).
 *   - Icon springs in with overshoot, slightly delayed from the card.
 *   - Number badge pops in with bounce.
 *
 * All animation respects `viewport={{ once: true }}` so scroll-back
 * doesn't restart the reveal. The card sits on a tall vertical
 * connector that visually links it to the previous and next step
 * (rendered by the surrounding `<Timeline>` wrapper).
 */
export interface StepCardProps {
    /** 1-based step number for the badge. */
    n: number
    /** Lucide icon shown in the right-side panel. */
    icon: LucideIcon
    title: string
    body: string
    /** Single-line "what to expect" hint. Optional. */
    tip?: string
    /** Where the CTA navigates. Use a relative app path. */
    href: string
    /** CTA button label. */
    cta: string
    /** Approximate time required. Renders as a small pill in the header. */
    estMinutes?: number
    /** Visual accent. Cycles by index to keep adjacent steps distinct. */
    tone?: "primary" | "magenta" | "success" | "warning"
    /** Suppresses the bottom half of the timeline connector — pass
     *  true for the last step so the line doesn't dangle. */
    isLast?: boolean
}

const TONES: Record<NonNullable<StepCardProps["tone"]>, {
    badge: string
    iconBg: string
    iconRing: string
    iconText: string
    border: string
    glow: string
    line: string
}> = {
    primary: {
        badge: "bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-[0_4px_18px_-4px_hsl(var(--primary)/0.6)] ring-2 ring-primary/30",
        iconBg: "bg-gradient-to-br from-primary/15 to-primary/5",
        iconRing: "ring-1 ring-primary/30",
        iconText: "text-primary",
        border: "border-primary/20",
        glow: "hover:shadow-[0_8px_36px_-12px_hsl(var(--primary)/0.4)]",
        line: "from-primary/60 to-primary/20",
    },
    magenta: {
        badge: "bg-gradient-to-br from-[hsl(var(--neon-magenta))] to-[hsl(var(--neon-magenta)/0.8)] text-primary-foreground shadow-[0_4px_18px_-4px_hsl(var(--neon-magenta)/0.6)] ring-2 ring-[hsl(var(--neon-magenta)/0.3)]",
        iconBg: "bg-gradient-to-br from-[hsl(var(--neon-magenta)/0.15)] to-[hsl(var(--neon-magenta)/0.05)]",
        iconRing: "ring-1 ring-[hsl(var(--neon-magenta)/0.3)]",
        iconText: "text-[hsl(var(--neon-magenta))]",
        border: "border-[hsl(var(--neon-magenta)/0.2)]",
        glow: "hover:shadow-[0_8px_36px_-12px_hsl(var(--neon-magenta)/0.4)]",
        line: "from-[hsl(var(--neon-magenta)/0.6)] to-[hsl(var(--neon-magenta)/0.2)]",
    },
    success: {
        badge: "bg-gradient-to-br from-success to-success/80 text-primary-foreground shadow-[0_4px_18px_-4px_hsl(var(--success)/0.6)] ring-2 ring-success/30",
        iconBg: "bg-gradient-to-br from-success/15 to-success/5",
        iconRing: "ring-1 ring-success/30",
        iconText: "text-success",
        border: "border-success/20",
        glow: "hover:shadow-[0_8px_36px_-12px_hsl(var(--success)/0.4)]",
        line: "from-success/60 to-success/20",
    },
    warning: {
        badge: "bg-gradient-to-br from-warning to-warning/80 text-primary-foreground shadow-[0_4px_18px_-4px_hsl(var(--warning)/0.6)] ring-2 ring-warning/30",
        iconBg: "bg-gradient-to-br from-warning/15 to-warning/5",
        iconRing: "ring-1 ring-warning/30",
        iconText: "text-warning",
        border: "border-warning/20",
        glow: "hover:shadow-[0_8px_36px_-12px_hsl(var(--warning)/0.4)]",
        line: "from-warning/60 to-warning/20",
    },
}

export function StepCard({
    n, icon: Icon, title, body, tip, href, cta, estMinutes, tone = "primary", isLast = false,
}: StepCardProps) {
    const t = TONES[tone]
    return (
        <div className="relative pl-14 md:pl-20">
            {/* ── Timeline connector ─────────────────────────────────
              * Vertical line behind the numbered badge. Top half feeds
              * IN from the previous step; bottom half feeds OUT to the
              * next. The gradient + fade gives "flow" rather than a
              * dead straight ruler. */}
            {!isLast && (
                <span
                    aria-hidden
                    className={cn(
                        "absolute left-4 md:left-6 top-12 bottom-[-2rem] w-px bg-gradient-to-b",
                        t.line,
                    )}
                />
            )}

            {/* Numbered badge — anchored over the connector line. */}
            <motion.span
                initial={{ scale: 0, opacity: 0 }}
                whileInView={{ scale: 1, opacity: 1 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
                className={cn(
                    "absolute left-0 md:left-2 top-2 grid place-items-center h-9 w-9 md:h-10 md:w-10 rounded-full font-bold tabular-nums text-sm",
                    t.badge,
                )}
            >
                {n}
            </motion.span>

            {/* Card body */}
            <motion.div
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                    "relative rounded-2xl border-2 bg-card/60 backdrop-blur-sm p-5 md:p-6 transition-all duration-300",
                    t.border,
                    t.glow,
                    "hover:-translate-y-0.5",
                )}
            >
                <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-lg md:text-xl font-extrabold tracking-tight leading-tight">
                                {title}
                            </h3>
                            {estMinutes != null && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    <Clock className="h-3 w-3" />
                                    ~{estMinutes} min
                                </span>
                            )}
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                    </div>

                    <motion.div
                        initial={{ scale: 0.6, rotate: -10, opacity: 0 }}
                        whileInView={{ scale: 1, rotate: 0, opacity: 1 }}
                        viewport={{ once: true, margin: "-50px" }}
                        transition={{ duration: 0.55, delay: 0.15, ease: [0.34, 1.56, 0.64, 1] }}
                        className={cn(
                            "grid place-items-center h-14 w-14 md:h-16 md:w-16 rounded-2xl shrink-0",
                            t.iconBg,
                            t.iconRing,
                            t.iconText,
                        )}
                    >
                        <Icon className="h-7 w-7 md:h-8 md:w-8" />
                    </motion.div>
                </div>

                {tip && (
                    <p className="mt-3 text-xs text-muted-foreground/90 italic border-l-2 border-border/60 pl-3 leading-relaxed">
                        {tip}
                    </p>
                )}

                <div className="mt-4">
                    <Button asChild variant="neon" size="sm" className="group">
                        <Link href={href}>
                            {cta}
                            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                    </Button>
                </div>
            </motion.div>
        </div>
    )
}
