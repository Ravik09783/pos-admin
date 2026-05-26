"use client"

import { motion } from "framer-motion"
import {
    BookOpen, Building2, ChefHat, CreditCard, Globe, HelpCircle,
    Receipt, Shield, ShoppingBag, Store, Users, Wallet,
} from "lucide-react"

import { SetupGuideHero } from "../hero"
import { OutcomesSection, type Outcome } from "../outcomes"
import { StepCard } from "../step-card"
import { CelebrationFooter } from "../celebration-footer"

/**
 * International setup guide.
 *
 * Same rhythm as the India page (hero → outcomes → timeline →
 * celebration → help note), but with the INTL substitutions:
 *   - Tax-IDs step is generic (VAT/MWST/GST country code, no GSTIN/FSSAI)
 *   - Menu step calls out tax-inclusive pricing (regional default)
 *   - Payment-gateway step points at Stripe Connect (Apple Pay /
 *     Google Pay / Link / Card / Klarna auto-appear)
 *   - No CA Export step — that's India-only
 */
const OUTCOMES_INTL: Outcome[] = [
    { icon: ShoppingBag, title: "Menu is live", body: "Items, prices, tax rate per region — wired straight into POS + KDS.", tone: "primary" },
    { icon: Receipt, title: "Region-clean bills", body: "Every receipt shows the right VAT/MWST/GST label for your country.", tone: "magenta" },
    { icon: Wallet, title: "Stripe collecting", body: "Apple Pay, Google Pay, Link, card — settles to your bank T+2 (US) / T+7 (EU).", tone: "success" },
    { icon: Globe, title: "QR ordering on", body: "Customers scan their table QR and pay from their phone — zero counter friction.", tone: "warning" },
]

export default function InternationalSetupGuidePage() {
    return (
        <>
            <SetupGuideHero
                region="International"
                flag={Globe}
                stepCount={8}
                estimatedMinutes={25}
                headlineHighlight="goes live tonight."
                subtitle="Eight focused steps. Each one opens the right settings page so you act, not read. Your progress is saved as you go — leave and come back any time."
            />

            <OutcomesSection
                heading="When you finish, you'll have"
                outcomes={OUTCOMES_INTL}
            />

            <motion.h2
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.5 }}
                className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground mb-6 flex items-center gap-2"
            >
                <span className="h-px w-8 bg-border" />
                Step-by-step
                <span className="h-px flex-1 bg-border" />
            </motion.h2>

            <div className="space-y-8 md:space-y-10">
                <StepCard
                    n={1}
                    icon={Store}
                    tone="primary"
                    estMinutes={3}
                    title="Your restaurant profile"
                    body="Name, address, contact phone, logo, timezone, currency. The currency drives every price across the app — pick the one your customers actually pay in."
                    tip="Setting the currency to CHF / EUR / USD / etc. reformats all totals, bill copy, and reports."
                    href="/settings"
                    cta="Open Settings"
                />

                <StepCard
                    n={2}
                    icon={Shield}
                    tone="magenta"
                    estMinutes={2}
                    title="Tax ID & tax label"
                    body="Your country's tax ID (VAT / MWST / GST / Sales-Tax ID) prints on every bill. The tax label (MWST / VAT / etc.) auto-fills from country — no manual setup needed in most regions."
                    href="/settings"
                    cta="Add tax ID"
                />

                <StepCard
                    n={3}
                    icon={Building2}
                    tone="success"
                    estMinutes={2}
                    title="Branches & outlets"
                    body="Single outlet? Skip this. Multi-outlet? Add each as a branch — the topbar branch switcher then scopes orders, bills, and reports per outlet."
                    href="/settings/branches"
                    cta="Manage branches"
                />

                <StepCard
                    n={4}
                    icon={BookOpen}
                    tone="primary"
                    estMinutes={10}
                    title="Menu & pricing"
                    body="Categories → items. Set each item's price and tax rate (e.g. 7.7% MWST in Switzerland, 20% VAT in the UK). Most non-India regions price tax-inclusive — flip the toggle on each item."
                    tip="POS won't show items until at least one exists."
                    href="/menu-admin"
                    cta="Build menu"
                />

                <StepCard
                    n={5}
                    icon={Receipt}
                    tone="magenta"
                    estMinutes={5}
                    title="Tables for dine-in"
                    body="Add your floor plan numbered T1, T2, … . Customers scan a per-table QR to order; waiters tap tables on the POS to attach orders."
                    href="/tables"
                    cta="Add tables"
                />

                <StepCard
                    n={6}
                    icon={CreditCard}
                    tone="success"
                    estMinutes={4}
                    title="Stripe Connect"
                    body="Connect a Stripe Express account in one click. Stripe handles KYC, bank linking, and tax-form collection. Customers pay card / Apple Pay / Google Pay / Klarna / SEPA — Stripe auto-shows the methods enabled per region."
                    tip="A 1% platform fee + Stripe's processing fee come out of every charge. The rest auto-transfers to your bank — T+2 in the US, T+7 in most of Europe."
                    href="/settings/payments"
                    cta="Connect Stripe"
                />

                <StepCard
                    n={7}
                    icon={Users}
                    tone="warning"
                    estMinutes={2}
                    title="Invite your staff"
                    body="Send an email invite to each cashier, captain, kitchen, and manager. They set their own password; you can lock them to a branch if needed."
                    href="/settings/staff"
                    cta="Invite staff"
                />

                <StepCard
                    n={8}
                    icon={ChefHat}
                    tone="primary"
                    estMinutes={1}
                    isLast
                    title="First test bill"
                    body="Open the POS, add an item, generate a bill, take a cash payment. Walk through it once end-to-end so any missing step surfaces while the till is empty, not during a rush."
                    tip="Voided test bills don't affect your reports — safe to experiment."
                    href="/pos"
                    cta="Open POS"
                />
            </div>

            <CelebrationFooter />

            <motion.div
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.5 }}
                className="mt-6 rounded-2xl border border-dashed border-border/60 bg-muted/20 p-5 flex items-start gap-3"
            >
                <HelpCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                    <span className="font-semibold text-foreground">Stuck somewhere?</span>{" "}
                    This guide is updated whenever the setup flow changes. If a step&apos;s screen looks different from the copy here, the live screen is the source of truth — we&apos;ll refresh this page shortly after.
                </p>
            </motion.div>
        </>
    )
}
