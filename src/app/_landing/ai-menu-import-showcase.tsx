"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowRight, Camera, ScanLine, Sparkles, UploadCloud, Wand2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

/**
 * Marketing showcase for the /ai feature — upload a photo of a printed
 * menu, the system OCRs + parses it into structured categories +
 * items + prices, and the owner reviews and saves in one pass.
 *
 * Mirrors the visual structure of `CAExportShowcase`: copy + bullets +
 * CTAs on the left, an animated mock-up on the right. The right-hand
 * mock-up tells the "before / after" story in one card — top half is
 * a stylised paper-menu thumbnail (the input), bottom half is the
 * AI-extracted list with food-type dots and prices (the output).
 */

const EXTRACTED_ITEMS: {
    name: string
    price: string
    dot: string
    desc?: string
}[] = [
    { name: "Paneer Tikka",        price: "₹250", dot: "bg-green-500", desc: "Grilled cottage cheese, tandoori spices" },
    { name: "Chicken 65",          price: "₹220", dot: "bg-red-500"   },
    { name: "Veg Spring Rolls",    price: "₹180", dot: "bg-green-500" },
    { name: "Butter Chicken",      price: "₹380", dot: "bg-red-500"   },
    { name: "Dal Makhani",         price: "₹220", dot: "bg-green-500" },
    { name: "Paneer Butter Masala", price: "₹260", dot: "bg-green-500" },
]

export function AIMenuImportShowcase() {
    return (
        <section id="ai-menu" className="container mx-auto px-4 py-20 md:py-28">
            <div className="grid lg:grid-cols-[1fr_1.1fr] gap-10 lg:gap-16 items-center">
                {/* ─── COPY ─────────────────────────────────────────── */}
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6 }}
                >
                    <Badge variant="neon" className="mb-3">
                        <Sparkles className="h-3 w-3 mr-1" /> AI-powered onboarding
                    </Badge>
                    <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-balance leading-[1.05]">
                        Your menu, <span className="text-gradient">in a photo.</span>
                        <br className="hidden md:block" /> Live in 30 seconds.
                    </h2>
                    <p className="mt-5 text-lg text-muted-foreground max-w-xl text-balance">
                        Snap or upload a picture of your printed menu — our AI reads every category, every item, every price, and drops them straight into your catalog. No typing rows by hand on day one.
                    </p>

                    <ul className="mt-6 space-y-2.5 max-w-md">
                        {[
                            "Detects categories, items, prices and food type — vegetarian / non-veg / egg / vegan",
                            "Works on multi-column menus, stylised banners, half-and-full pricing",
                            "Review every row before it saves — fix any OCR slip in one click",
                            "Two modes: local in-browser OCR (no internet, no quota) or Google Gemini Vision for top-tier accuracy",
                            "Bulk-save everything, or step through item-by-item with a pre-filled form",
                        ].map((line) => (
                            <li key={line} className="flex items-start gap-2 text-sm">
                                <span className="grid place-items-center h-5 w-5 rounded-full bg-success/20 text-success shrink-0 mt-0.5">✓</span>
                                <span className="text-muted-foreground">{line}</span>
                            </li>
                        ))}
                    </ul>

                    <div className="mt-8 flex flex-wrap gap-3">
                        <Button asChild variant="neon" size="lg">
                            <Link href="/signup">Try AI menu import <ArrowRight className="h-4 w-4" /></Link>
                        </Button>
                        <Button asChild variant="outline" size="lg">
                            <Link href="/demo">See it on a demo</Link>
                        </Button>
                    </div>
                </motion.div>

                {/* ─── ANIMATED MOCK-UP ─────────────────────────────── */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.7 }}
                    className="relative"
                >
                    <div className="relative rounded-3xl glass-strong border border-border/60 p-5 md:p-7 shadow-glow-lg space-y-4">
                        {/* ── INPUT card: a stylised menu photo ────── */}
                        <div className="rounded-2xl border border-border/60 bg-card/60 overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-2 border-b border-border/60 bg-muted/30">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Camera className="h-3.5 w-3.5" />
                                    menu-page-1.jpg
                                </div>
                                <Badge variant="outline" className="text-[10px]">Uploaded</Badge>
                            </div>
                            <div className="relative p-5 md:p-6 font-serif text-foreground/90">
                                {/* Scan-line sweep that animates top → bottom
                                  * while the page is in view, visually
                                  * communicating "AI is reading this". */}
                                <motion.div
                                    aria-hidden
                                    initial={{ y: "-100%", opacity: 0 }}
                                    whileInView={{ y: "100%", opacity: [0, 1, 1, 0] }}
                                    viewport={{ once: false, margin: "-100px" }}
                                    transition={{ duration: 2.4, ease: "easeInOut", repeat: Infinity, repeatDelay: 1.2 }}
                                    className="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-border/60 from-transparent via-primary/25 to-transparent"
                                />
                                <div className="text-center text-xs uppercase tracking-[0.4em] text-muted-foreground mb-3">
                                    The Spice Junction
                                </div>
                                <div className="text-center text-[10px] uppercase tracking-widest text-primary mb-2 font-semibold">— Starters —</div>
                                <div className="space-y-1.5 text-sm">
                                    <div className="flex items-center justify-between gap-3">
                                        <span>Paneer Tikka</span>
                                        <span className="text-muted-foreground tabular-nums">250</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3">
                                        <span>Chicken 65</span>
                                        <span className="text-muted-foreground tabular-nums">220</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3">
                                        <span>Veg Spring Rolls</span>
                                        <span className="text-muted-foreground tabular-nums">180</span>
                                    </div>
                                </div>
                                <div className="text-center text-[10px] uppercase tracking-widest text-primary mt-4 mb-2 font-semibold">— Mains —</div>
                                <div className="space-y-1.5 text-sm">
                                    <div className="flex items-center justify-between gap-3">
                                        <span>Butter Chicken</span>
                                        <span className="text-muted-foreground tabular-nums">380</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3">
                                        <span>Dal Makhani</span>
                                        <span className="text-muted-foreground tabular-nums">220</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3">
                                        <span>Paneer Butter Masala</span>
                                        <span className="text-muted-foreground tabular-nums">260</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* ── DOWNWARD ARROW + status pill ────────── */}
                        <div className="flex items-center justify-center">
                            <motion.div
                                animate={{ y: [0, 4, 0] }}
                                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/15 border border-primary/30 text-primary text-xs font-semibold shadow-glow"
                            >
                                <ScanLine className="h-3.5 w-3.5" />
                                Reading menu… 6 items detected
                            </motion.div>
                        </div>

                        {/* ── OUTPUT card: extracted item list ────── */}
                        <div className="rounded-2xl border border-border/60 bg-background/60">
                            <div className="flex items-center justify-between px-4 py-2 border-b border-border/60">
                                <div className="flex items-center gap-2 text-xs">
                                    <Wand2 className="h-3.5 w-3.5 text-primary" />
                                    <span className="font-semibold">Extracted items</span>
                                </div>
                                <Badge variant="success" className="text-[10px]">Ready to save</Badge>
                            </div>
                            <ul className="divide-y divide-border/40">
                                {EXTRACTED_ITEMS.map((it, i) => (
                                    <motion.li
                                        key={it.name}
                                        initial={{ opacity: 0, x: 14 }}
                                        whileInView={{ opacity: 1, x: 0 }}
                                        viewport={{ once: true }}
                                        transition={{ delay: 0.15 + i * 0.08, duration: 0.4 }}
                                        className="flex items-center gap-3 px-4 py-2.5"
                                    >
                                        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${it.dot}`} aria-hidden />
                                        <div className="min-w-0 flex-1">
                                            <div className="text-sm font-medium truncate">{it.name}</div>
                                            {it.desc && <div className="text-[11px] text-muted-foreground truncate">{it.desc}</div>}
                                        </div>
                                        <span className="text-sm font-mono tabular-nums">{it.price}</span>
                                    </motion.li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    {/* Floating "30 s" speed badge */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.5 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.9, type: "spring" }}
                        className="absolute -top-4 -right-4 md:-right-8 rounded-2xl glass-strong border border-primary/40 p-3 shadow-glow text-center min-w-[110px]"
                    >
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Onboarding</div>
                        <div className="text-2xl font-bold text-gradient">~30s</div>
                        <div className="text-[10px] text-muted-foreground">vs. hours of typing</div>
                    </motion.div>

                    {/* Floating "Drop image" hint at the top-left */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.5 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.5, type: "spring" }}
                        className="absolute -top-4 -left-4 md:-left-6 rounded-full bg-card/95 backdrop-blur border border-border px-3 py-1.5 shadow-sm flex items-center gap-1.5 text-xs font-medium"
                    >
                        <UploadCloud className="h-3.5 w-3.5 text-primary" />
                        Drop or pick image
                    </motion.div>
                </motion.div>
            </div>
        </section>
    )
}
