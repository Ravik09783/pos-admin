import type { Metadata } from "next"
import Link from "next/link"

import { LandingShell, Pricing, FAQ, FinalCTA } from "@/app/_landing/landing"
import { SectionHeading } from "@/app/_landing/section-heading"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sparkles } from "lucide-react"
import { SITE_NAME } from "@/lib/site"

export const metadata: Metadata = {
    title: "Pricing — simple plans for every restaurant",
    description:
        "RestoPOS pricing — three plans for India (₹3,500 / ₹5,000 / ₹10,000 per month) and the rest of the world "
        + "($49 / $99 / $199 per month). Every plan ships the full feature set. 30-day free trial, no credit card.",
    alternates: { canonical: "/pricing" },
    openGraph: {
        type: "website",
        url: "/pricing",
        siteName: SITE_NAME,
        title: `Pricing — ${SITE_NAME}`,
        description:
            "Three plans scaling on outlets and seats. 30-day free trial, no credit card, cancel anytime.",
    },
}

export default function PricingPage() {
    return (
        <LandingShell>
            <section className="container mx-auto px-4 pt-12 md:pt-20 pb-2">
                <div className="max-w-3xl">
                    <Badge variant="neon" className="mb-4"><Sparkles className="h-3 w-3 mr-1" /> Plans &amp; pricing</Badge>
                    <SectionHeading
                        prefix="Pick the size that fits."
                        highlight="Upgrade anytime."
                        description="Every plan ships the full RestoPOS feature set — the tier only changes how many outlets and staff seats you get."
                    />
                    <div className="mt-8 flex flex-wrap gap-3">
                        <Button asChild variant="neon" size="lg">
                            <Link href="/signup">Start 30-day free trial</Link>
                        </Button>
                        <Button asChild variant="outline" size="lg">
                            <Link href="/demo">Talk to us first</Link>
                        </Button>
                    </div>
                </div>
            </section>

            <Pricing />
            <FAQ />
            <FinalCTA />
        </LandingShell>
    )
}
