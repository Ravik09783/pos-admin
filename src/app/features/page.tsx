import type { Metadata } from "next"
import Link from "next/link"

import {
    LandingShell, Features, HowItWorks, ComparisonTable, FinalCTA,
} from "@/app/_landing/landing"
import { CAExportShowcase } from "@/app/_landing/ca-export-showcase"
import { SectionHeading } from "@/app/_landing/section-heading"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowRight, Sparkles } from "lucide-react"
import { SITE_NAME } from "@/lib/site"

export const metadata: Metadata = {
    title: "Features — every tool a modern restaurant needs",
    description:
        "RestoPOS features: fast POS billing, realtime kitchen display, country-aware tax (GST/VAT/sales tax), "
        + "QR table ordering, PhonePe & Paytm UPI direct payments, multi-outlet management, customer-facing display, "
        + "Swiggy & Zomato settlement tracking, accounting + bank reconciliation, loyalty, gift cards, demand "
        + "forecasting, per-location reports in CSV/Excel/PDF, and one-click CA Export for India.",
    alternates: { canonical: "/features" },
    openGraph: {
        type: "website",
        url: "/features",
        siteName: SITE_NAME,
        title: `Features — ${SITE_NAME}`,
        description:
            "Every tool a modern restaurant needs — POS, KDS, QR ordering, country-aware tax, UPI payments, "
            + "CA-ready exports, loyalty and analytics.",
    },
}

export default function FeaturesPage() {
    return (
        <LandingShell>
            <section className="container mx-auto px-4 pt-12 md:pt-20 pb-4">
                <div className="max-w-3xl">
                    <Badge variant="neon" className="mb-4"><Sparkles className="h-3 w-3 mr-1" /> Product tour</Badge>
                    <SectionHeading
                        prefix="A complete look at"
                        highlight="what's in the box."
                        description="From billing and kitchen flow to country-aware tax, payments, loyalty and one-click accounting exports — every tool we ship, in one place."
                    />
                    <div className="mt-8 flex flex-wrap gap-3">
                        <Button asChild variant="neon" size="lg">
                            <Link href="/signup">Start 30-day free trial <ArrowRight className="h-4 w-4" /></Link>
                        </Button>
                        <Button asChild variant="outline" size="lg">
                            <Link href="/demo">Book a demo</Link>
                        </Button>
                    </div>
                </div>
            </section>

            <Features />
            <CAExportShowcase />
            <HowItWorks />
            <ComparisonTable />
            <FinalCTA />
        </LandingShell>
    )
}

