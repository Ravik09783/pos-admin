"use client"

import { motion } from "framer-motion"
import {
    BookOpen, Building2, ChefHat, CreditCard, FileSpreadsheet, HelpCircle,
    Receipt, Rocket, Shield, ShieldCheck, ShoppingBag, Store, Users, Wallet,
} from "lucide-react"

import { SetupGuideHero } from "../hero"
import { OutcomesSection, type Outcome } from "../outcomes"
import { StepCard } from "../step-card"
import { CelebrationFooter } from "../celebration-footer"

/**
 * India setup guide.
 *
 * Page rhythm:
 *   Hero       — emotional anchor + concrete scope (9 steps, ~30 min)
 *   Outcomes   — what success looks like (live menu, GST-clean bills,
 *                Paytm collecting payments, CA Export ready)
 *   Timeline   — 9 step cards on a vertical visual timeline. Tone
 *                cycles so adjacent steps stay distinguishable.
 *   Celebration— "ready to ring up your first order?" CTA
 *   Help note  — quietly noted at the bottom; the energy stays up top.
 *
 * India-specific picks vs the INTL guide:
 *   - Tax-IDs step includes GSTIN + FSSAI + PAN
 *   - Payment gateway step points at Paytm (UPI scan-to-pay)
 *   - Menu step calls out HSN codes + GST slabs
 *   - 9th step: CA Export (the differentiator for accountants)
 */
const OUTCOMES_IN: Outcome[] = [
    { icon: ShoppingBag, title: "Menu is live", body: "Items, prices, GST slabs, HSN codes — all wired into POS + KDS.", tone: "primary" },
    { icon: Receipt, title: "GST-clean bills", body: "Every receipt prints with the right CGST/SGST split and your GSTIN.", tone: "magenta" },
    { icon: Wallet, title: "Paytm collecting", body: "Customers scan a UPI QR and pay from any app — money settles straight to your own bank.", tone: "success" },
    { icon: FileSpreadsheet, title: "CA Export ready", body: "Month-end ZIP for your accountant — sales register, GSTR-1, P&L, the lot.", tone: "warning" },
]

export default function IndiaSetupGuidePage() {
    return (
        <>
            <SetupGuideHero
                region="India"
                flag={ShieldCheck}
                stepCount={9}
                estimatedMinutes={30}
                headlineHighlight="goes live tonight."
                subtitle="Nine focused steps. Each one opens the right settings page so you act, not read. Your progress is saved as you go — leave and come back any time."
            />

            <OutcomesSection
                heading="When you finish, you'll have"
                outcomes={OUTCOMES_IN}
            />

            {/* ── The 9-step timeline ─────────────────────────────── */}
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
                    body="Name, address, contact phone, logo, timezone. This prints on every bill and shows on your QR-ordering page."
                    tip="Bills issued before you finish profile setup reprint with the latest details — nothing is locked retroactively."
                    href="/settings"
                    cta="Open Settings"
                />

                <StepCard
                    n={2}
                    icon={Shield}
                    tone="magenta"
                    estMinutes={3}
                    title="GSTIN, FSSAI, and PAN"
                    body="Your 15-character GSTIN drives intra-state CGST+SGST vs inter-state IGST automatically. FSSAI is mandatory on food bills; PAN is required for B2B invoices."
                    tip="Stamps every bill + drives the monthly GSTR-1 / GSTR-3B export."
                    href="/settings"
                    cta="Add tax IDs"
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
                    body="Categories → items. Set each item's price, GST slab (0 / 5 / 12 / 18 / 28), and HSN code. Mark prices as tax-inclusive if your sticker is the gross."
                    tip="Items can be branch-scoped or shared across all branches. POS won't show items until at least one exists."
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
                    title="Paytm UPI payments"
                    body="Connect your own Paytm for Business account. Customers scan a UPI QR — on the POS customer screen or the table QR page — and pay from any UPI app (Google Pay, PhonePe, Paytm, BHIM). Money settles straight to your bank; the platform never touches it."
                    tip="POS cash and plain UPI (no gateway) work the moment you finish step 4 — Paytm is only needed for automatic scan-to-pay confirmation."
                    href="/settings/payments"
                    cta="Connect Paytm"
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
                    title="First test bill"
                    body="Open the POS, add an item, generate a bill, take a cash payment. Walk through it once end-to-end so any missing step surfaces while the till is empty, not during a rush."
                    tip="Voided test bills are excluded from the CA export — safe to experiment."
                    href="/pos"
                    cta="Open POS"
                />

                <StepCard
                    n={9}
                    icon={FileSpreadsheet}
                    tone="magenta"
                    estMinutes={2}
                    isLast
                    title="CA Export · the differentiator"
                    body="At month-end, pick a month and hit Export. You get a ZIP with sales register, GSTR-1, GSTR-3B, P&L, and Balance Sheet inputs — Excel + Tally + GST-portal JSON."
                    href="/ca-export"
                    cta="Open CA Export"
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

            {/* Tiny rocket icon left visually anchored at end-of-page. */}
            <span aria-hidden className="sr-only"><Rocket /></span>
        </>
    )
}
