"use client"

import { motion } from "framer-motion"
import { CheckCircle2, Plus, Receipt, ShoppingBag, Sparkles, Utensils, Zap } from "lucide-react"

/**
 * Hero illustration: a phone with the QR menu floating in front of a tablet
 * showing the POS screen. Pure CSS — no images required.
 */
export function HeroDevices() {
    return (
        <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative h-[480px] md:h-[540px]"
        >
            {/* glowing backdrop */}
            <div className="absolute inset-0 -z-10">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-80 w-80 rounded-full bg-border/60r from-primary/40 to-[hsl(var(--neon-magenta)/0.4)] blur-3xl opacity-50" />
            </div>

            {/* TABLET (POS) */}
            <motion.div
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                className="absolute right-0 top-8 w-[78%] aspect-[4/3] rounded-2xl bg-card/80 backdrop-blur-xl border border-border/60 shadow-glow-lg overflow-hidden"
            >
                {/* tablet bezel */}
                <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-2xl pointer-events-none" />

                <div className="absolute inset-2 rounded-xl bg-background/95 overflow-hidden">
                    {/* Topbar */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 text-xs">
                        <div className="flex items-center gap-1.5">
                            <span className="grid place-items-center h-5 w-5 rounded bg-border/60r from-primary to-[hsl(var(--neon-magenta))]">
                                <Sparkles className="h-2.5 w-2.5 text-primary-foreground" />
                            </span>
                            <span className="font-semibold">Spice Junction</span>
                        </div>
                        <div className="flex gap-1">
                            <span className="h-2 w-2 rounded-full bg-success" />
                            <span className="h-2 w-2 rounded-full bg-warning" />
                            <span className="h-2 w-2 rounded-full bg-destructive" />
                        </div>
                    </div>

                    <div className="grid grid-cols-[1fr_140px] h-[calc(100%-32px)]">
                        {/* Menu grid */}
                        <div className="p-3 grid grid-cols-3 gap-2 content-start">
                            {[
                                { name: "Paneer Tikka", price: "₹280", c: "from-amber-500/30" },
                                { name: "Butter Naan", price: "₹60", c: "from-yellow-500/30" },
                                { name: "Dal Makhani", price: "₹320", c: "from-orange-500/30" },
                                { name: "Veg Biryani", price: "₹240", c: "from-rose-500/30" },
                                { name: "Mango Lassi", price: "₹120", c: "from-green-500/30" },
                                { name: "Gulab Jamun", price: "₹100", c: "from-purple-500/30" },
                            ].map((it, i) => (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, scale: 0.85 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ delay: 0.4 + i * 0.05 }}
                                    className={`rounded-md ${it.c} bg-border/60r to-card/40 border border-border/40 p-2 text-[10px]`}
                                >
                                    <div className="font-semibold leading-tight">{it.name}</div>
                                    <div className="text-primary mt-1 text-xs font-bold">{it.price}</div>
                                </motion.div>
                            ))}
                        </div>
                        {/* Cart */}
                        <div className="border-l border-border/40 bg-card/40 p-2 flex flex-col text-[10px]">
                            <div className="font-semibold mb-1">Cart · 3 items</div>
                            <div className="space-y-1 flex-1">
                                {[
                                    { n: "Paneer Tikka", q: 1, a: "₹280" },
                                    { n: "Butter Naan", q: 2, a: "₹120" },
                                    { n: "Dal Makhani", q: 1, a: "₹320" },
                                ].map((l, i) => (
                                    <motion.div
                                        key={i}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: 0.7 + i * 0.1 }}
                                        className="flex justify-between"
                                    >
                                        <span className="truncate">×{l.q} {l.n}</span>
                                        <span className="font-medium ml-1">{l.a}</span>
                                    </motion.div>
                                ))}
                            </div>
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 1.2 }}
                                className="border-t border-border/40 pt-1 mt-2 space-y-0.5"
                            >
                                <div className="flex justify-between text-muted-foreground"><span>GST 5%</span><span>₹36</span></div>
                                <div className="flex justify-between font-bold text-[11px]"><span>Total</span><span className="text-gradient">₹756</span></div>
                            </motion.div>
                            <motion.div
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 1.4, type: "spring" }}
                                className="mt-2 rounded bg-primary py-1.5 text-center font-bold text-primary-foreground text-[10px] flex items-center justify-center gap-1"
                            >
                                <Receipt className="h-2.5 w-2.5" /> Generate bill
                            </motion.div>
                        </div>
                    </div>
                </div>
            </motion.div>

            {/* PHONE (QR menu) */}
            <motion.div
                animate={{ y: [0, 6, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                className="absolute left-0 bottom-0 w-[44%] aspect-[9/16] rounded-[28px] bg-card/90 backdrop-blur-xl border border-border/60 shadow-glow-lg overflow-hidden"
            >
                <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-[28px] pointer-events-none" />
                {/* notch */}
                <div className="absolute top-1.5 left-1/2 -translate-x-1/2 h-3 w-16 rounded-full bg-background z-10" />

                <div className="absolute inset-1 rounded-[24px] bg-background/95 overflow-hidden flex flex-col">
                    {/* status bar */}
                    <div className="h-5" />

                    {/* header */}
                    <div className="px-3 pb-2 border-b border-border/40">
                        <div className="flex items-center gap-1.5">
                            <span className="grid place-items-center h-5 w-5 rounded bg-border/60r from-primary to-[hsl(var(--neon-magenta))]">
                                <Sparkles className="h-2.5 w-2.5 text-primary-foreground" />
                            </span>
                            <div className="text-xs font-bold leading-tight">Spice Junction</div>
                        </div>
                        <div className="text-[9px] text-muted-foreground mt-0.5 flex items-center gap-1">
                            <span className="px-1 py-0 rounded bg-muted">Table T7</span>
                            <span className="px-1 py-0 rounded bg-primary/20 text-primary inline-flex items-center gap-0.5"><Zap className="h-2 w-2" />Instant</span>
                        </div>
                    </div>

                    {/* menu items */}
                    <div className="flex-1 p-2 space-y-1.5 overflow-hidden">
                        {[
                            { name: "Paneer Tikka", price: "₹280", veg: "veg" },
                            { name: "Butter Naan", price: "₹60", veg: "veg" },
                            { name: "Dal Makhani", price: "₹320", veg: "veg" },
                        ].map((it, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.9 + i * 0.12 }}
                                className="flex items-center gap-2 rounded-lg bg-card/60 border border-border/40 p-1.5"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1">
                                        <span className="h-2 w-2 rounded-sm border border-green-500 grid place-items-center">
                                            <span className="h-0.5 w-0.5 rounded-full bg-green-500" />
                                        </span>
                                        <div className="text-[10px] font-semibold truncate">{it.name}</div>
                                    </div>
                                    <div className="text-[10px] text-gradient font-bold">{it.price}</div>
                                </div>
                                <motion.div
                                    whileTap={{ scale: 0.85 }}
                                    className="grid place-items-center h-6 w-6 rounded bg-primary text-primary-foreground"
                                >
                                    <Plus className="h-3 w-3" />
                                </motion.div>
                            </motion.div>
                        ))}
                    </div>

                    {/* cart pill */}
                    <motion.div
                        initial={{ y: 50, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 1.6, type: "spring" }}
                        className="m-2 rounded-xl bg-primary p-2 flex items-center gap-2 text-primary-foreground"
                    >
                        <span className="grid place-items-center h-6 w-6 rounded-full bg-white/20">
                            <ShoppingBag className="h-3 w-3" />
                        </span>
                        <div className="flex-1 text-[9px]">
                            <div className="opacity-80">3 items</div>
                            <div className="font-bold">₹756 · Pay via UPI</div>
                        </div>
                    </motion.div>
                </div>
            </motion.div>

            {/* Floating "PAID" badge */}
            <motion.div
                initial={{ opacity: 0, scale: 0.5, rotate: -10 }}
                animate={{ opacity: 1, scale: 1, rotate: 8 }}
                transition={{ delay: 2, type: "spring", stiffness: 180 }}
                className="absolute -right-2 top-2 rounded-xl bg-success/20 backdrop-blur-md border-2 border-success/40 px-3 py-2 shadow-glow"
            >
                <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    <div>
                        <div className="text-[9px] font-bold text-success uppercase tracking-wider">PAID</div>
                        <div className="text-[9px] text-foreground/70">via UPI</div>
                    </div>
                </div>
            </motion.div>

            {/* Floating order indicator */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 2.4 }}
                className="absolute right-8 bottom-8 rounded-xl glass-strong border border-border/60 p-2.5 shadow-glow flex items-center gap-2 max-w-[180px]"
            >
                <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="grid place-items-center h-7 w-7 rounded-md bg-warning/20 text-warning shrink-0"
                >
                    <Utensils className="h-3.5 w-3.5" />
                </motion.div>
                <div className="text-[10px]">
                    <div className="font-semibold">Kitchen alert</div>
                    <div className="text-muted-foreground">QR-T7 · 3 new items</div>
                </div>
            </motion.div>
        </motion.div>
    )
}
