"use client"

import { useEffect, useRef } from "react"
import { motion } from "framer-motion"
import confetti from "canvas-confetti"
import { CheckCircle2, Download, Receipt, Sparkles, Utensils } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/utils"

interface SuccessLine {
    item_name: string
    quantity: number
    unit_price: number
    gst_slab: number
    line_total: number
}

interface SuccessSummary {
    items: SuccessLine[]
    subtotal: number
    tax: number
    grand_total: number
    order_number: string | null
    customer_name: string | null
    customer_phone: string | null
    /** Public bill URL (set once the server generates the bill after
     *  payment captures). When null, the download button stays disabled
     *  with "Bill is being prepared…". */
    bill_url?: string | null
    invoice_number?: string | null
}

export function SuccessScreen({
    orderNumber,
    summary,
    onStartNew,
    currency = "INR",
    taxLabel = "GST",
}: {
    orderNumber: string | null
    summary?: SuccessSummary | null
    onStartNew?: () => void
    /** ISO 4217 currency for formatting. */
    currency?: string
    /** What this country calls its tax — "GST", "VAT", "Sales Tax", "TVA"… */
    taxLabel?: string
}) {
    const fired = useRef(false)
    const money = (v: number) => formatCurrency(v, currency)

    useEffect(() => {
        if (fired.current) return
        fired.current = true
        const colors = ["#22d3ee", "#a855f7", "#22c55e", "#f59e0b", "#ec4899"]
        const burst = (origin: { x: number; y: number }) =>
            confetti({
                particleCount: 90,
                spread: 75,
                startVelocity: 45,
                origin,
                colors,
                ticks: 200,
                scalar: 1.1,
            })
        burst({ x: 0.15, y: 0.6 })
        burst({ x: 0.85, y: 0.6 })
        const t = setTimeout(() => {
            confetti({
                particleCount: 50,
                spread: 360,
                startVelocity: 25,
                origin: { x: 0.5, y: 0.5 },
                colors,
                ticks: 150,
            })
        }, 350)
        return () => clearTimeout(t)
    }, [])

    return (
        <div className="min-h-screen grid place-items-center p-6 relative overflow-hidden">
            {/* Animated background orbs */}
            <motion.div
                aria-hidden
                className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-success/20 blur-3xl"
                animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0.7, 0.4] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
                aria-hidden
                className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-primary/20 blur-3xl"
                animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0.7, 0.4] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            />

            <motion.div
                className="max-w-md w-full glass-strong rounded-3xl p-8 text-center relative z-10 neon-border"
                initial={{ opacity: 0, scale: 0.85, y: 30 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
                {/* Animated checkmark */}
                <motion.div
                    className="mx-auto mb-6 relative"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: "spring", stiffness: 220, damping: 15 }}
                >
                    <div className="grid place-items-center h-24 w-24 mx-auto rounded-full bg-gradient-to-br from-success/30 to-primary/30 backdrop-blur">
                        <motion.div
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ delay: 0.5, duration: 0.7, ease: "easeOut" }}
                        >
                            <CheckCircle2 className="h-14 w-14 text-success" strokeWidth={2.4} />
                        </motion.div>
                    </div>
                    {[0, 1, 2, 3].map((i) => (
                        <motion.div
                            key={i}
                            className="absolute top-1/2 left-1/2"
                            initial={{ x: "-50%", y: "-50%", scale: 0 }}
                            animate={{ scale: [0, 1, 0], rotate: i * 90 }}
                            transition={{ delay: 0.7 + i * 0.1, duration: 1.5, repeat: Infinity, repeatDelay: 1 }}
                        >
                            <Sparkles className="h-5 w-5 text-primary" style={{ transform: `rotate(${i * 90}deg) translateY(-60px)` }} />
                        </motion.div>
                    ))}
                </motion.div>

                <motion.h1
                    className="text-3xl font-bold tracking-tight"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.7 }}
                >
                    <span className="text-gradient">Order confirmed!</span>
                </motion.h1>
                <motion.p
                    className="text-muted-foreground mt-3 text-sm text-balance"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.85 }}
                >
                    Your food is being prepared with love. The waiter will bring it to your table shortly.
                </motion.p>

                <motion.div
                    className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary/10 border border-primary/30 px-4 py-2"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 1, type: "spring", stiffness: 200 }}
                >
                    <Utensils className="h-4 w-4 text-primary" />
                    <span className="text-sm font-mono">{summary?.order_number ?? orderNumber ?? "—"}</span>
                </motion.div>

                {summary && summary.items.length > 0 && (
                    <motion.div
                        className="mt-5 text-left rounded-xl bg-card/60 border border-border/50 p-4 space-y-2"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 1.1 }}
                    >
                        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                            <Receipt className="h-3.5 w-3.5" /> Receipt
                        </div>
                        <ul className="space-y-1">
                            {summary.items.map((it, idx) => (
                                <li key={idx} className="flex justify-between gap-2 text-sm">
                                    <div className="min-w-0 flex-1 truncate">
                                        <span className="font-mono text-muted-foreground mr-2">{it.quantity}×</span>{it.item_name}
                                    </div>
                                    <div className="font-medium tabular-nums shrink-0">{money(it.line_total)}</div>
                                </li>
                            ))}
                        </ul>
                        <div className="border-t border-border/40 pt-2 space-y-0.5 text-sm">
                            <div className="flex justify-between text-muted-foreground text-xs">
                                <span>Subtotal</span>
                                <span>{money(summary.subtotal)}</span>
                            </div>
                            {Number(summary.tax) > 0 && (
                                <div className="flex justify-between text-muted-foreground text-xs">
                                    <span>{taxLabel}</span>
                                    <span>{money(summary.tax)}</span>
                                </div>
                            )}
                            <div className="flex justify-between font-semibold pt-1 border-t border-border/40">
                                <span>Total paid</span>
                                <span>{money(summary.grand_total)}</span>
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* Download bill — only enabled once the server has actually
                 *  generated the bill row (poller picks this up via the
                 *  order-status API). Opens the canonical /b/<slug>/<invoice>
                 *  page in a new tab; that page already supports printing /
                 *  saving as PDF via the browser's "Print to PDF". */}
                {summary?.bill_url && (
                    <motion.div
                        className="mt-5"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 1.15 }}
                    >
                        <Button asChild variant="outline" className="w-full">
                            <a href={summary.bill_url} target="_blank" rel="noopener noreferrer">
                                <Download className="h-4 w-4" />
                                Download bill {summary.invoice_number ? `· ${summary.invoice_number}` : ""}
                            </a>
                        </Button>
                    </motion.div>
                )}

                <motion.div
                    className="mt-6 flex justify-center gap-1.5"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1.2 }}
                >
                    {[0, 1, 2].map((i) => (
                        <motion.div
                            key={i}
                            className="h-2 w-2 rounded-full bg-primary"
                            animate={{ scale: [1, 1.4, 1], opacity: [0.4, 1, 0.4] }}
                            transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.2 }}
                        />
                    ))}
                </motion.div>
                <p className="text-xs text-muted-foreground mt-3">Cooking now…</p>

                {onStartNew && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="mt-4 text-xs text-muted-foreground hover:text-foreground"
                        onClick={onStartNew}
                    >
                        Start a new order
                    </Button>
                )}
            </motion.div>
        </div>
    )
}
