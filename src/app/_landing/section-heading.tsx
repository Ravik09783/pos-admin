"use client"

import { motion } from "framer-motion"

import { Badge } from "@/components/ui/badge"

/**
 * Section heading that mirrors the cinematic hero treatment: kicker badge
 * pops in, then each word of the title fades-up + un-blurs in sequence as
 * the section scrolls into view. The gradient suffix keeps `text-gradient`.
 *
 * Usage:
 *   <SectionHeading
 *       kicker="FEATURES"
 *       prefix="Everything a modern restaurant needs."
 *       highlight="Nothing it doesn't."
 *       description="…"
 *   />
 */
export function SectionHeading({
    kicker,
    prefix,
    highlight,
    description,
    align = "left",
    className = "",
}: {
    kicker?: string
    prefix: string
    highlight?: string
    description?: React.ReactNode
    align?: "left" | "center"
    className?: string
}) {
    const prefixWords = prefix.split(" ")
    const highlightWords = (highlight ?? "").split(" ").filter(Boolean)

    return (
        <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={{
                hidden: {},
                visible: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
            }}
            className={`${align === "center" ? "text-center mx-auto" : ""} ${className}`}
        >
            {kicker && (
                <motion.div
                    variants={{
                        hidden: { opacity: 0, scale: 0.9 },
                        visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
                    }}
                >
                    <Badge variant="outline" className="mb-3 text-[10px] uppercase tracking-wider">
                        {kicker}
                    </Badge>
                </motion.div>
            )}
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-balance leading-[1.05]">
                {prefixWords.map((w, i) => (
                    <RevealWord key={`p-${i}`}>{w}</RevealWord>
                ))}
                {highlight && (
                    <>
                        <span className="inline-block">&nbsp;</span>
                        <span className="text-gradient">
                            {highlightWords.map((w, i) => (
                                <RevealWord key={`h-${i}`}>{w}</RevealWord>
                            ))}
                        </span>
                    </>
                )}
            </h2>
            {description && (
                <motion.p
                    variants={{
                        hidden: { opacity: 0, y: 12 },
                        visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
                    }}
                    className="mt-4 text-muted-foreground text-lg max-w-2xl"
                >
                    {description}
                </motion.p>
            )}
        </motion.div>
    )
}

function RevealWord({ children }: { children: React.ReactNode }) {
    // No `filter: blur` here — combining it with `background-clip: text` on
    // an ancestor breaks the gradient (filter creates a new compositing layer
    // that isolates the inner span from the parent's bg-clip painting).
    return (
        <motion.span
            className="inline-block mr-[0.25em]"
            variants={{
                hidden: { opacity: 0, y: 20 },
                visible: {
                    opacity: 1,
                    y: 0,
                    transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] },
                },
            }}
        >
            {children}
        </motion.span>
    )
}
