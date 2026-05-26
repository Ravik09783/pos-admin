"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowRight, PartyPopper, Rocket } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Closing card under the step timeline. Echoes the hero's energy and
 * leaves the OWNER with a clear next action ("Open POS") rather than
 * dribbling out on a help block.
 *
 * Visual notes:
 *   - Same gradient blob ornaments as the hero so the page reads as
 *     one composition (open → bookend).
 *   - Spring-in "rocket" icon for delight.
 *   - Big neon CTA pulled straight to the POS.
 *
 * The "Stuck somewhere?" help line still lives below this — but it's
 * deliberately demoted to a small note so it doesn't kill the energy
 * the hero + celebration are trying to build.
 */
export function CelebrationFooter() {
    return (
        <section className="relative mt-14 rounded-3xl border-2 border-border/40 overflow-hidden">
            <div aria-hidden className="absolute inset-0 -z-10">
                <div
                    className="absolute -top-32 -right-20 h-[360px] w-[360px] rounded-full"
                    style={{
                        background:
                            "radial-gradient(circle at center, hsl(var(--primary)/0.35), transparent 65%)",
                    }}
                />
                <div
                    className="absolute -bottom-32 -left-20 h-[320px] w-[320px] rounded-full"
                    style={{
                        background:
                            "radial-gradient(circle at center, hsl(var(--neon-magenta)/0.35), transparent 65%)",
                    }}
                />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="relative px-6 md:px-10 py-10 md:py-12 text-center"
            >
                <motion.div
                    initial={{ scale: 0.6, rotate: -10, opacity: 0 }}
                    whileInView={{ scale: 1, rotate: 0, opacity: 1 }}
                    viewport={{ once: true, margin: "-80px" }}
                    transition={{ duration: 0.55, delay: 0.1, ease: [0.34, 1.56, 0.64, 1] }}
                    className="inline-grid place-items-center h-14 w-14 rounded-2xl bg-gradient-to-br from-primary to-[hsl(var(--neon-magenta))] text-primary-foreground shadow-[0_8px_36px_-8px_hsl(var(--primary)/0.55)]"
                >
                    <Rocket className="h-7 w-7" />
                </motion.div>

                <h2 className="mt-5 text-2xl md:text-3xl font-extrabold tracking-tight">
                    That&apos;s it.{" "}
                    <span className="bg-gradient-to-r from-primary to-[hsl(var(--neon-magenta))] bg-clip-text text-transparent">
                        Ready to ring up your first order?
                    </span>
                </h2>
                <p className="mt-2 text-sm md:text-base text-muted-foreground max-w-lg mx-auto">
                    Open the POS, add an item, and take payment — the rest of the app comes alive once you do.
                </p>

                <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
                    <Button asChild variant="neon" size="lg">
                        <Link href="/pos">
                            Open POS <ArrowRight className="h-4 w-4" />
                        </Link>
                    </Button>
                    <Button asChild variant="outline" size="lg">
                        <Link href="/dashboard">Back to dashboard</Link>
                    </Button>
                </div>

                <div className="mt-6 inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <PartyPopper className="h-3.5 w-3.5" />
                    Every checkout from here on is real revenue.
                </div>
            </motion.div>
        </section>
    )
}
