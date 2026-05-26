"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowRight, FileJson, FileSpreadsheet, FileText, Package, Sparkles, Wrench } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const FILES = [
    { icon: FileSpreadsheet, label: "GST_Filing.xlsx", desc: "Sales register · GSTR-1 · GSTR-3B · P&L · BS · 9 sheets", color: "from-emerald-500/30 to-emerald-700/10" },
    { icon: Wrench, label: "Tally_Vouchers.xml", desc: "Tally Prime / ERP 9 import — sales + purchase vouchers", color: "from-amber-500/30 to-amber-700/10" },
    { icon: FileJson, label: "GSTR1_Portal.json", desc: "GSTR-1 in offline-utility schema (v3.0.4)", color: "from-blue-500/30 to-blue-700/10" },
    { icon: FileText, label: "Filing_Summary.pdf", desc: "Human-readable filing summary, ready to print", color: "from-rose-500/30 to-rose-700/10" },
]

export function CAExportShowcase() {
    return (
        <section id="ca-export" className="container mx-auto px-4 py-20 md:py-28">
            <div className="grid lg:grid-cols-[1fr_1.1fr] gap-10 lg:gap-16 items-center">
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6 }}
                >
                    <Badge variant="neon" className="mb-3"><Sparkles className="h-3 w-3 mr-1" /> For Indian restaurants</Badge>
                    <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-balance leading-[1.05]">
                        Cut your CA bill <span className="text-gradient">in half.</span>
                    </h2>
                    <p className="mt-5 text-lg text-muted-foreground max-w-xl text-balance">
                        Running in India? Pick a month. Hit one button. You get a ZIP with everything your CA needs — Excel,
                        Tally XML, GST portal JSON, and a PDF summary. They <em>file</em> instead of
                        <em> re-enter data</em>. <span className="text-foreground/70">(Outside India, your bills still carry the right VAT / sales-tax breakdown for your local accountant.)</span>
                    </p>

                    <ul className="mt-6 space-y-2.5 max-w-md">
                        {[
                            "Sales register with HSN, CGST, SGST, IGST — every line",
                            "GSTR-1 working with B2B, B2C-Large, B2C-Small + HSN summary",
                            "GSTR-3B summary with net tax payable",
                            "P&L statement + Balance Sheet inputs ready for review",
                            "Tally-importable XML — drop into Tally and go",
                        ].map((line) => (
                            <li key={line} className="flex items-start gap-2 text-sm">
                                <span className="grid place-items-center h-5 w-5 rounded-full bg-success/20 text-success shrink-0 mt-0.5">✓</span>
                                <span className="text-muted-foreground">{line}</span>
                            </li>
                        ))}
                    </ul>

                    <div className="mt-8 flex flex-wrap gap-3">
                        <Button asChild variant="neon" size="lg">
                            <Link href="/signup">Try the CA Export <ArrowRight className="h-4 w-4" /></Link>
                        </Button>
                        <Button asChild variant="outline" size="lg">
                            <Link href="#pricing">See pricing</Link>
                        </Button>
                    </div>
                </motion.div>

                {/* The animated ZIP */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.7 }}
                    className="relative"
                >
                    <div className="relative rounded-3xl glass-strong border border-border/60 p-6 md:p-8 shadow-glow-lg">
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-card border border-border text-xs font-mono">
                            spice-junction_2025-26_04_CA_Bundle.zip
                        </div>

                        <div className="flex items-center gap-3 mb-5 mt-2">
                            <motion.div
                                animate={{ rotate: [0, -8, 8, 0] }}
                                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                                className="grid place-items-center h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-[hsl(var(--neon-magenta))] shadow-glow shrink-0"
                            >
                                <Package className="h-6 w-6 text-primary-foreground" />
                            </motion.div>
                            <div>
                                <div className="font-bold">CA Bundle · April 2025</div>
                                <div className="text-xs text-muted-foreground">5 files · ~280 KB · Ready to email</div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            {FILES.map((f, i) => (
                                <motion.div
                                    key={f.label}
                                    initial={{ opacity: 0, x: 20 }}
                                    whileInView={{ opacity: 1, x: 0 }}
                                    viewport={{ once: true }}
                                    transition={{ delay: 0.2 + i * 0.1 }}
                                    className={`flex items-center gap-3 rounded-lg bg-gradient-to-r ${f.color} border border-border/40 p-3 group hover:border-primary/40 transition-colors`}
                                >
                                    <f.icon className="h-5 w-5 text-foreground/80 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-mono text-xs font-semibold truncate">{f.label}</div>
                                        <div className="text-[10px] text-muted-foreground truncate">{f.desc}</div>
                                    </div>
                                </motion.div>
                            ))}
                        </div>

                        {/* Net GST highlight */}
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: 0.7 }}
                            className="mt-5 rounded-lg border border-warning/40 bg-warning/5 p-3"
                        >
                            <div className="flex items-center justify-between text-xs mb-1">
                                <span className="text-muted-foreground">Net GST payable</span>
                                <Badge variant="warning" className="text-[10px]">to file by 20th</Badge>
                            </div>
                            <div className="text-2xl font-bold text-warning">₹ 47,328.00</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">Output tax ₹84,500 − ITC ₹37,172</div>
                        </motion.div>
                    </div>

                    {/* Floating savings badge */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.5 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.9, type: "spring" }}
                        className="absolute -top-4 -right-4 md:-right-8 rounded-2xl glass-strong border border-success/40 p-3 shadow-glow"
                    >
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">CA fee savings</div>
                        <div className="text-2xl font-bold text-success">~₹6,000<span className="text-xs">/mo</span></div>
                        <div className="text-[10px] text-muted-foreground">vs. typical data-entry charges</div>
                    </motion.div>
                </motion.div>
            </div>
        </section>
    )
}
