"use client"

import { motion } from "framer-motion"
import { CheckCircle2, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * "When you finish, you'll have…" outcomes strip.
 *
 * Sits between the hero and the step timeline. Its job is emotional:
 * tell the OWNER what success looks like BEFORE they read 8-9 setup
 * steps. The visual rhythm is "outcome → outcome → outcome → outcome"
 * which reads as a promise, not as work.
 *
 * Each card has:
 *   - An icon with a soft tinted background
 *   - A bold one-line outcome ("Live menu", "Take card payments", etc.)
 *   - One supporting sentence
 *   - A small check-mark stamp suggesting "this will be DONE"
 *
 * Cards stagger-fade in as the strip enters the viewport.
 */
export interface Outcome {
    icon: LucideIcon
    title: string
    body: string
    tone?: "primary" | "magenta" | "success" | "warning"
}

const TONES: Record<NonNullable<Outcome["tone"]>, string> = {
    primary: "bg-primary/10 text-primary border-primary/30",
    magenta: "bg-[hsl(var(--neon-magenta)/0.1)] text-[hsl(var(--neon-magenta))] border-[hsl(var(--neon-magenta)/0.3)]",
    success: "bg-success/10 text-success border-success/30",
    warning: "bg-warning/10 text-warning border-warning/30",
}

export function OutcomesSection({ heading, outcomes }: { heading: string; outcomes: Outcome[] }) {
    return (
        <section className="mb-14">
            <motion.h2
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.5 }}
                className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground mb-5 flex items-center gap-2"
            >
                <span className="h-px w-8 bg-border" />
                {heading}
                <span className="h-px flex-1 bg-border" />
            </motion.h2>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {outcomes.map((o, i) => {
                    const Icon = o.icon
                    return (
                        <motion.div
                            key={o.title}
                            initial={{ opacity: 0, y: 16 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: "-50px" }}
                            transition={{ duration: 0.5, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                            className="group relative rounded-2xl border border-border/50 bg-card/40 backdrop-blur-sm p-4 hover:border-primary/40 hover:shadow-glow transition-all"
                        >
                            {/* Check stamp in the top-right — implies
                              * "this is achievable". Fades in slightly
                              * later than the card body. */}
                            <motion.span
                                aria-hidden
                                initial={{ scale: 0, rotate: -20 }}
                                whileInView={{ scale: 1, rotate: 0 }}
                                viewport={{ once: true, margin: "-50px" }}
                                transition={{ duration: 0.45, delay: 0.3 + i * 0.08, ease: [0.34, 1.56, 0.64, 1] }}
                                className="absolute top-3 right-3 text-success/70"
                            >
                                <CheckCircle2 className="h-4 w-4" />
                            </motion.span>

                            <div className={cn(
                                "inline-grid place-items-center h-10 w-10 rounded-xl border mb-3",
                                TONES[o.tone ?? "primary"],
                            )}>
                                <Icon className="h-5 w-5" />
                            </div>
                            <div className="font-bold text-sm leading-tight">{o.title}</div>
                            <p className="text-xs text-muted-foreground leading-relaxed mt-1">{o.body}</p>
                        </motion.div>
                    )
                })}
            </div>
        </section>
    )
}
