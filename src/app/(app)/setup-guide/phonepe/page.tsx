"use client"

import { motion } from "framer-motion"
import {
    CheckCircle2,
    Globe,
    Key,
    Link2,
    Rocket,
    ShieldCheck,
    Smartphone,
    UserPlus,
    Wallet,
    Webhook,
    Zap,
} from "lucide-react"

import { SetupGuideHero } from "../hero"
import { OutcomesSection, type Outcome } from "../outcomes"
import { StepCard } from "../step-card"
import { CelebrationFooter } from "../celebration-footer"

/**
 * PhonePe Business onboarding guide — how a restaurant in India
 * connects their own PhonePe merchant account to RestoPOS so customer
 * UPI payments auto-confirm into bills.
 *
 * The whole onboarding is split into eight steps. Each card opens the
 * right destination (PhonePe's business portal, our Settings page) so
 * the OWNER is acting, not just reading.
 *
 * The OWNER can complete sandbox steps (1–5) tonight with PhonePe's
 * public test credentials, then come back when production approval
 * lands to flip the env toggle.
 */
const OUTCOMES_PP: Outcome[] = [
    { icon: Smartphone, title: "Dynamic UPI QR", body: "Bills generate a fresh QR per sale — customers scan and pay from any UPI app.", tone: "primary" },
    { icon: Zap, title: "Auto-confirmed", body: "Webhook flips the bill to PAID the instant the customer's payment lands. Zero cashier verification.", tone: "magenta" },
    { icon: Globe, title: "QR-ordering ready", body: "Self-ordering customers tap once to open any UPI app, pay, and the order moves to the kitchen automatically.", tone: "success" },
    { icon: ShieldCheck, title: "Client Secret hidden", body: "Stored encrypted at rest. Only your OWNER role can read it back through Settings.", tone: "warning" },
]

export default function PhonePeSetupGuidePage() {
    return (
        <>
            <SetupGuideHero
                region="PhonePe"
                flag={Wallet}
                stepCount={8}
                estimatedMinutes={20}
                headlineHighlight="UPI on autopilot."
                subtitle="Eight focused steps. Sandbox first to prove the flow, then flip to production once PhonePe approves your account. Test credentials are public — you can complete the sandbox loop in twenty minutes."
            />

            <OutcomesSection
                heading="When you finish, you'll have"
                outcomes={OUTCOMES_PP}
            />

            {/* ── The 8-step timeline ─────────────────────────────── */}
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
                    icon={UserPlus}
                    tone="primary"
                    estMinutes={5}
                    title="Sign up for PhonePe Business"
                    body="Create a free PhonePe Business account using your business name, registered mobile and email. You'll verify the mobile via OTP and confirm your email link."
                    tip="If you already accept PhonePe via the consumer app's UPI handle, you still need a separate Business account — that's the one that issues API credentials."
                    href="https://business.phonepe.com/register"
                    cta="Open PhonePe Business"
                />

                <StepCard
                    n={2}
                    icon={ShieldCheck}
                    tone="magenta"
                    estMinutes={5}
                    title="Complete KYC + bank details"
                    body="Upload your PAN, GST certificate, business proof and the bank account where settlements will land. PhonePe approves most kits in 1–3 business days."
                    tip="You can complete sandbox testing while you wait for KYC approval — only flip the env toggle to Production once PhonePe emails you the green light."
                    href="https://business.phonepe.com/kyc"
                    cta="Resume KYC"
                />

                <StepCard
                    n={3}
                    icon={Key}
                    tone="success"
                    estMinutes={2}
                    title="Generate your API keys"
                    body="In Developer Settings → API Keys, click Generate. PhonePe shows you a Client Id, Client Secret and Client Version. Copy all three — the Client Secret is only shown once."
                    tip="Don't paste the Client Secret into chat, email or a public doc — it signs every request and verifies every webhook. Treat it like a database password."
                    href="https://business.phonepe.com/developer-settings/api-keys"
                    cta="Open API Keys"
                />

                <StepCard
                    n={4}
                    icon={Webhook}
                    tone="warning"
                    estMinutes={2}
                    title="Register the webhook URL"
                    body="In Developer Settings → Webhooks → Create New Webhook. Webhook URL: https://yourdomain.com/api/webhooks/phonepe. Authentication Type: HMAC (Shared secret key) — copy the secret. Active Events: pick pg.order.completed (this is the event that confirms a paid bill). Save."
                    tip="Ignore PAYMENT_SUCCESS / PAYMENT_FAILED — those are the old v1 event names and don't exist in the new dashboard. The new equivalent is pg.order.completed. Sandbox and production webhooks are separate; register both with the same URL."
                    href="https://business.phonepe.com/developer-settings/webhooks"
                    cta="Configure webhooks"
                />

                <StepCard
                    n={5}
                    icon={Link2}
                    tone="primary"
                    estMinutes={2}
                    title="Paste credentials into RestoPOS"
                    body="In Settings → Payments, choose the Sandbox tab. Toggle Test Mode ON in your PhonePe Business dashboard (top-right Developer Settings) — PhonePe shows your test Client Id, Client Secret and Client Version. Paste all three. Save."
                    tip="The Settings page splits Sandbox and Production credentials so you can prove the flow end-to-end before going live without re-pasting. Toggle Test Mode OFF in PhonePe to see your live keys."
                    href="/settings/payments"
                    cta="Open Settings → Payments"
                />

                <StepCard
                    n={6}
                    icon={CheckCircle2}
                    tone="magenta"
                    estMinutes={1}
                    title="Test the connection"
                    body="Hit Test connection in Settings → Payments. We send a signed request to PhonePe's status endpoint with a deliberately-bogus transaction id. PhonePe responds — if the signature checks out you get a green tick."
                    tip="If you see 'PhonePe rejected the signature', the Client Secret was pasted wrong or doesn't match the Client Version. Re-paste both and try again — there's nothing to undo on PhonePe's side."
                    href="/settings/payments"
                    cta="Run the test"
                />

                <StepCard
                    n={7}
                    icon={Zap}
                    tone="success"
                    estMinutes={3}
                    title="Run one end-to-end sandbox sale"
                    body="From POS, generate a small test bill (₹1 is fine) and pick UPI. The customer screen shows a sandbox QR. Scan it with PhonePe's test simulator and watch the bill flip to PAID automatically."
                    tip="Sandbox payments don't move real money. PhonePe's simulator at developer.phonepe.com/testing lets you mark any test transaction as successful or failed."
                    href="/pos"
                    cta="Open POS"
                />

                <StepCard
                    n={8}
                    icon={Rocket}
                    tone="warning"
                    estMinutes={1}
                    title="Flip to production"
                    body="Once KYC is approved + the sandbox loop worked, turn Test Mode OFF in PhonePe Business → copy the live Client Id + Client Secret + Client Version → paste into the Production tab in RestoPOS. Switch the Active environment to Production. Save. Real customers can now pay you."
                    tip="The toggle is fully reversible — flip back to Sandbox any time you want to retest, in-flight production transactions still resolve under the production key pair."
                    href="/settings/payments"
                    cta="Go live"
                />
            </div>

            <CelebrationFooter />
        </>
    )
}
