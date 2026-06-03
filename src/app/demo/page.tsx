import type { Metadata } from "next"
import { Check, Clock, MessageCircle, ShieldCheck } from "lucide-react"

import { LandingShell } from "@/app/_landing/landing"
import { DemoForm } from "@/app/_landing/demo-form"
import { SITE_NAME } from "@/lib/site"

export const metadata: Metadata = {
    title: "Book a free demo — see RestoPOS in 30 minutes",
    description:
        "Schedule a free 30-minute walkthrough of RestoPOS. We'll show you POS billing, the kitchen display, "
        + "QR table ordering, UPI payments, and (for India) the one-click CA Export — tailored to your restaurant.",
    alternates: { canonical: "/demo" },
    robots: { index: true, follow: true },
    openGraph: {
        type: "website",
        url: "/demo",
        siteName: SITE_NAME,
        title: `Book a free demo — ${SITE_NAME}`,
        description:
            "Schedule a free 30-minute walkthrough of RestoPOS, tailored to your restaurant.",
    },
}

const PERKS = [
    { icon: Clock, title: "30 minutes, fully tailored", desc: "We'll set up a sandbox shaped like your restaurant — your menu, your country's tax model, your currency." },
    { icon: MessageCircle, title: "Live Q&A with our team", desc: "Bring every question. Migrating from Petpooja / Posist? CA-friendly setup? Multi-outlet? We've got answers." },
    { icon: ShieldCheck, title: "No pushy sales", desc: "If RestoPOS isn't a fit, we'll say so. No follow-up spam, ever." },
]

const POINTS = [
    "POS billing on any tablet, phone or laptop",
    "Realtime kitchen display (KDS) and KOTs",
    "QR table ordering — guests scan, pay, order",
    "PhonePe UPI Direct — money lands in your bank",
    "CA-ready GST exports (India): GSTR-1, GSTR-3B, Tally",
    "Loyalty, gift cards, coupons & customer CRM",
]

export default function DemoPage() {
    return (
        <LandingShell>
            <section className="container mx-auto px-4 py-12 md:py-20">
                <div className="grid lg:grid-cols-[1fr_1.1fr] gap-10 lg:gap-16 items-start">
                    <div>
                        <h1 className="text-3xl md:text-5xl font-bold tracking-tight leading-[1.05] text-balance">
                            See RestoPOS,{" "}
                            <span className="text-gradient">tailored to your restaurant.</span>
                        </h1>
                        <p className="mt-5 text-muted-foreground max-w-lg">
                            Tell us a bit about your restaurant and we&apos;ll schedule a free 30-minute walkthrough. No prep
                            needed — show up, ask anything, leave with a clear plan.
                        </p>

                        <ul className="mt-8 space-y-3">
                            {PERKS.map((p) => (
                                <li key={p.title} className="flex gap-3">
                                    <div className="grid place-items-center h-9 w-9 rounded-lg bg-primary/15 shrink-0">
                                        <p.icon className="h-4 w-4 text-primary" />
                                    </div>
                                    <div>
                                        <div className="font-semibold">{p.title}</div>
                                        <div className="text-sm text-muted-foreground">{p.desc}</div>
                                    </div>
                                </li>
                            ))}
                        </ul>

                        <div className="mt-8 rounded-xl border border-border/50 bg-card/30 p-5">
                            <div className="text-sm font-semibold mb-3">What we&apos;ll cover</div>
                            <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm text-muted-foreground">
                                {POINTS.map((p) => (
                                    <li key={p} className="flex items-start gap-2">
                                        <Check className="h-4 w-4 text-success shrink-0 mt-0.5" />
                                        <span>{p}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    <DemoForm />
                </div>
            </section>
        </LandingShell>
    )
}
