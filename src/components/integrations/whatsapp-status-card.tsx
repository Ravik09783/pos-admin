"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
    AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ExternalLink,
    Loader2, MessageCircle, ShieldCheck,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * WhatsApp + SMS messaging status surface.
 *
 * Drops in at the top of /marketing (and anywhere else that wants to nudge
 * the admin toward connecting their messaging provider). Two states:
 *
 *   - **Connected**: small green banner. Sender, "Open settings" link,
 *     and a quietly available "Show setup guide" toggle in case the
 *     admin wants to swap to a different sender.
 *   - **Not connected**: prominent yellow banner with a "Connect WhatsApp"
 *     CTA into Settings → Notifications, plus the setup guide expanded
 *     by default so the admin has the instructions in front of them.
 *
 * Fetches `/api/notifications/credentials` on mount. That endpoint never
 * returns the Twilio auth token — only `has_auth_token: boolean` plus the
 * `whatsapp_ready` / `sms_ready` derived flags. RLS gates writes to OWNER.
 */
export interface WhatsappCredentialsStatus {
    enabled: boolean
    has_auth_token: boolean
    whatsapp_from: string | null
    sms_from: string | null
    source: "tenant" | "env" | "none"
    whatsapp_ready: boolean
    sms_ready: boolean
}

export function WhatsappStatusCard({
    /** Show a denser version on the notifications settings page (where
     *  the full setup form is right below — we don't need to repeat the
     *  whole guide). */
    compact = false,
    /** Hide the "Open settings" button when rendered on the settings page
     *  itself (the admin is already there). */
    hideSettingsLink = false,
}: {
    compact?: boolean
    hideSettingsLink?: boolean
} = {}) {
    const [status, setStatus] = useState<WhatsappCredentialsStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [guideOpen, setGuideOpen] = useState(false)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                const r = await fetch("/api/notifications/credentials", { cache: "no-store" })
                if (!r.ok) throw new Error("status")
                const data = (await r.json()) as WhatsappCredentialsStatus
                if (!cancelled) {
                    setStatus(data)
                    // Auto-expand the guide when WhatsApp isn't ready —
                    // the admin almost certainly needs to see the steps.
                    if (!data.whatsapp_ready) setGuideOpen(true)
                }
            } catch { /* leave status null → renders a neutral skeleton */ }
            finally { if (!cancelled) setLoading(false) }
        })()
        return () => { cancelled = true }
    }, [])

    if (loading) {
        return (
            <Card>
                <CardContent className="py-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking messaging setup…
                </CardContent>
            </Card>
        )
    }

    const whatsappReady = !!status?.whatsapp_ready
    const smsReady = !!status?.sms_ready

    return (
        <Card
            className={cn(
                "border-l-4 transition-colors",
                whatsappReady
                    ? "border-l-success/70 bg-success/[0.04]"
                    : "border-l-warning/70 bg-warning/[0.05]",
            )}
        >
            <CardContent className="p-4 space-y-3">
                {/* ── Status row ──────────────────────────────────────── */}
                <div className="flex items-start gap-3 flex-wrap">
                    <span
                        className={cn(
                            "grid place-items-center h-9 w-9 rounded-lg shrink-0",
                            whatsappReady ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
                        )}
                    >
                        {whatsappReady ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                    </span>

                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">
                                {whatsappReady
                                    ? "WhatsApp connected"
                                    : "WhatsApp not connected yet"}
                            </span>
                            {smsReady && (
                                <Badge variant="outline" className="text-[10px]">SMS ready</Badge>
                            )}
                            {status?.source === "env" && (
                                <Badge variant="outline" className="text-[10px]">Platform default</Badge>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {whatsappReady ? (
                                <>
                                    Sending from <span className="font-mono">{status?.whatsapp_from}</span> via Twilio.
                                    {" "}Messages go out on your account &amp; your bill.
                                </>
                            ) : (
                                <>
                                    Connect your Twilio WhatsApp Business account to send WhatsApp
                                    campaigns from this page. SMS works with the same account.
                                </>
                            )}
                        </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setGuideOpen((v) => !v)}
                            className="text-xs"
                        >
                            {guideOpen ? "Hide" : "Show"} setup guide
                            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", guideOpen && "rotate-180")} />
                        </Button>
                        {!hideSettingsLink && (
                            <Button asChild size="sm" variant={whatsappReady ? "outline" : "neon"}>
                                <Link href="/settings/notifications">
                                    {whatsappReady ? "Edit in settings" : "Connect WhatsApp"}
                                    <ArrowRight className="h-3.5 w-3.5" />
                                </Link>
                            </Button>
                        )}
                    </div>
                </div>

                {/* ── Setup guide (collapsible) ───────────────────────── */}
                {guideOpen && <WhatsappSetupGuide compact={compact} />}
            </CardContent>
        </Card>
    )
}

/**
 * Step-by-step WhatsApp + SMS setup guide. Inlined inside the status card
 * but exported on its own too — easy to drop into other surfaces later
 * (e.g. the onboarding wizard or a help drawer).
 *
 * The numbers map 1:1 to the work a real admin does. Each step says
 * exactly what they'll click + where in our app the result lands, so a
 * non-technical restaurant owner can follow it without a developer.
 */
export function WhatsappSetupGuide({ compact = false }: { compact?: boolean } = {}) {
    return (
        <div className="rounded-md bg-card/40 border border-border/50 p-4 space-y-4">
            <div className="flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                    <strong className="text-foreground">Before you start:</strong> WhatsApp Business
                    messages must come from an approved sender. The fastest path is{" "}
                    <a href="https://www.twilio.com" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                        Twilio<ExternalLink className="h-2.5 w-2.5" />
                    </a>
                    {" "}— they handle the Meta / WhatsApp Business API onboarding for you.
                    Pricing is pay-as-you-go (~₹0.50–₹1 per conversation in India).
                </p>
            </div>

            <ol className="space-y-3">
                <Step
                    n={1}
                    title="Create a Twilio account"
                    body={
                        <>
                            Sign up at{" "}
                            <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                                twilio.com<ExternalLink className="h-2.5 w-2.5" />
                            </a>
                            . The trial gives you a few free messages so you can test
                            before you pay. Free trial is enough for the steps below.
                        </>
                    }
                />
                <Step
                    n={2}
                    title="Note your Account SID + Auth Token"
                    body={
                        <>
                            On the Twilio Console <strong>home page</strong>, both values are listed
                            under <em>Account Info</em>. The SID starts with <code className="text-[11px]">AC…</code>;
                            the Auth Token is hidden behind a &quot;Show&quot; button. Copy both — you&apos;ll paste them
                            into our Settings page in step 5.
                        </>
                    }
                />
                <Step
                    n={3}
                    title="Activate a WhatsApp sender"
                    body={
                        <>
                            <strong>Testing:</strong> use Twilio&apos;s WhatsApp Sandbox (no Meta approval
                            needed — guests just message a code once to opt in). Find it under{" "}
                            <em>Messaging → Try it out → Send a WhatsApp message</em>. The sandbox
                            sender is <code className="text-[11px]">whatsapp:+14155238886</code>.
                            <br />
                            <strong>Production:</strong> go to{" "}
                            <em>Messaging → Senders → WhatsApp senders → Request a sender</em> and
                            connect your real business number. Twilio walks you through the Meta
                            approval (Business Manager + display name + 2-factor).
                        </>
                    }
                />
                <Step
                    n={4}
                    title="(Promotions only) Submit message templates"
                    body={
                        <>
                            For <strong>marketing</strong> messages — birthday coupons, win-back
                            offers — WhatsApp requires every template to be Meta-approved before
                            it goes out (transactional bills + reservations don&apos;t need this).
                            Submit a template named e.g. <code className="text-[11px]">restopos_win_back</code>{" "}
                            from <em>Messaging → Content Template Builder → Create new</em>.
                            Approval usually takes a few minutes to a few hours.
                        </>
                    }
                />
                <Step
                    n={5}
                    title="Paste the credentials into RestoPOS"
                    body={
                        <>
                            Open{" "}
                            <Link href="/settings/notifications" className="text-primary hover:underline">
                                Settings &rarr; Notifications
                            </Link>
                            . In the <em>WhatsApp &amp; SMS provider</em> card, paste your{" "}
                            <strong>Account SID</strong>, <strong>Auth Token</strong>, and the{" "}
                            <strong>WhatsApp sender</strong> (e.g. <code className="text-[11px]">whatsapp:+14155238886</code>{" "}
                            for sandbox or your approved number). Toggle <em>Enable messaging</em> on
                            and click <em>Save credentials</em>. The Auth Token is stored
                            owner-only and never sent back to your browser.
                        </>
                    }
                />
                <Step
                    n={6}
                    title="Send a test"
                    body={
                        <>
                            On the same Settings page, drop your own number into{" "}
                            <em>Send a test message</em> and pick WhatsApp. If you used the
                            Sandbox in step 3, message <code className="text-[11px]">join &lt;your code&gt;</code>{" "}
                            to <code className="text-[11px]">+1 415 523 8886</code> first to opt in.
                            The test message lands within a few seconds.
                        </>
                    }
                />
                {!compact && (
                    <Step
                        n={7}
                        title="Come back to Marketing and send a campaign"
                        body={
                            <>
                                Now your Win-back / Birthday / Anniversary campaigns on this page
                                send over your WhatsApp sender. Customers see your restaurant name
                                — not RestoPOS — as the sender.
                            </>
                        }
                    />
                )}
            </ol>

            <div className="flex items-start gap-2 rounded-md bg-warning/10 border border-warning/30 px-3 py-2 text-xs">
                <MessageCircle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
                <p className="text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">India + SMS:</strong> sending promotional
                    SMS to Indian mobile numbers also needs a DLT-registered sender ID and
                    DLT-approved template, in addition to the Twilio account. Set those up in your
                    operator&apos;s DLT portal (Jio, Airtel, Vi, BSNL) and link them in your Twilio
                    Messaging Service.
                </p>
            </div>
        </div>
    )
}

function Step({ n, title, body }: { n: number; title: string; body: React.ReactNode }) {
    return (
        <li className="flex gap-3">
            <span className="grid place-items-center h-6 w-6 rounded-full bg-primary/15 text-primary text-xs font-bold shrink-0 mt-0.5">
                {n}
            </span>
            <div className="min-w-0 flex-1 text-xs">
                <div className="font-semibold text-sm text-foreground mb-0.5">{title}</div>
                <div className="text-muted-foreground leading-relaxed">{body}</div>
            </div>
        </li>
    )
}
