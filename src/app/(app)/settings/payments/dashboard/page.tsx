"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { loadConnectAndInitialize, type StripeConnectInstance } from "@stripe/connect-js"
import {
    ConnectAccountManagement,
    ConnectBalances,
    ConnectComponentsProvider,
    ConnectNotificationBanner,
    ConnectPayments,
    ConnectPayouts,
} from "@stripe/react-connect-js"
import { AlertTriangle, ChevronLeft, Loader2, RotateCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/app-shell/page-header"
import { cn } from "@/lib/utils"

/**
 * Stripe Connect embedded dashboard — the in-app live payments view for
 * non-India restaurants. Each component below is a Stripe-hosted iframe
 * (rendered as if it's part of our app via the React provider).
 *
 *   - <ConnectNotificationBanner /> → Stripe-side alerts ("verify your
 *     account", failed payouts, action required)
 *   - <ConnectBalances />           → live available + pending balance
 *   - <ConnectPayments />           → searchable list of every charge
 *                                     with dispute + refund deep-links
 *   - <ConnectPayouts />            → upcoming + historical bank payouts
 *   - <ConnectAccountManagement />  → self-serve bank account / tax-ID
 *                                     update (OWNER only — gated server-
 *                                     side by the account-session route)
 *
 * The `client_secret` powering these is minted by /api/payments/stripe/
 * connect/account-session, scoped to THIS tenant's acct_*. Sessions
 * auto-refresh on expiry via the fetchClientSecret callback.
 */
export default function PaymentsDashboardPage() {
    const [error, setError] = useState<string | null>(null)
    /** Kind of error so we can show a specific CTA — "setup" sends them
     *  to the onboarding page, "config" tells the OWNER to set an env
     *  var, "transient" offers a retry button. */
    const [errorKind, setErrorKind] = useState<"setup" | "config" | "transient" | null>(null)
    const [canManageAccount, setCanManageAccount] = useState(false)
    const [connectInstance, setConnectInstance] = useState<StripeConnectInstance | null>(null)
    const [loading, setLoading] = useState(true)
    const [retryNonce, setRetryNonce] = useState(0)

    /** Stripe calls this whenever it needs a (fresh) client_secret. We
     *  proxy to our server which mints one against the tenant's acct_*.
     *  Throws a tagged Error so the caller can decide which empty-state
     *  CTA to render (setup-required vs. transient vs. config). */
    const fetchClientSecret = useCallback(async (): Promise<string> => {
        const r = await fetch("/api/payments/stripe/connect/account-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        })
        const data = await r.json().catch(() => ({ error: "Bad response" })) as { error?: string; client_secret?: string; can_manage_account?: boolean }
        if (!r.ok || !data.client_secret) {
            const err = new Error(data.error ?? "Couldn't mint Stripe account session") as Error & { kind?: "setup" | "config" | "transient" }
            if (r.status === 400 && /Connect a Stripe account/.test(data.error ?? "")) err.kind = "setup"
            else if (r.status === 500 && /Stripe not configured/.test(data.error ?? "")) err.kind = "config"
            else err.kind = "transient"
            throw err
        }
        setCanManageAccount(Boolean(data.can_manage_account))
        return data.client_secret
    }, [])

    useEffect(() => {
        // Stripe's publishable key — same key used everywhere else on the
        // platform. NOT the secret key (that stays server-side).
        const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
        if (!publishableKey) {
            setError("Stripe publishable key isn't set on the server. Add NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to your environment and restart the app.")
            setErrorKind("config")
            setLoading(false)
            return
        }

        // First call to fetchClientSecret will fail if the tenant hasn't
        // connected Stripe yet — surface that gracefully.
        let cancelled = false
        setError(null)
        setErrorKind(null)
        setLoading(true)
        ;(async () => {
            try {
                await fetchClientSecret() // smoke-test
                if (cancelled) return
                const instance = loadConnectAndInitialize({
                    publishableKey,
                    fetchClientSecret,
                    // Match the rest of the app's neon dark theme. Stripe's
                    // theme tokens are limited to colors + border-radius;
                    // they handle typography + spacing internally.
                    appearance: {
                        overlays: "dialog",
                        variables: {
                            colorPrimary: "#7c5cff",
                            colorBackground: "transparent",
                            borderRadius: "8px",
                        },
                    },
                })
                setConnectInstance(instance)
            } catch (e: unknown) {
                if (cancelled) return
                const err = e as Error & { kind?: "setup" | "config" | "transient" }
                setError(err.message ?? "Couldn't load Stripe dashboard")
                setErrorKind(err.kind ?? "transient")
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => { cancelled = true }
        // retryNonce → bumping it re-runs the whole effect; that's how
        // the "Try again" button on the transient error card recovers.
    }, [fetchClientSecret, retryNonce])

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-6xl space-y-6">
            <PageHeader
                kicker="Finance"
                title="Payments dashboard"
                highlight="live Stripe data"
                description="Balance, every charge, payouts to your bank, and any action-required alerts from Stripe. Live, scoped to this restaurant."
                actions={
                    <Button asChild variant="outline" size="sm">
                        <Link href="/settings/payments">
                            <ChevronLeft className="h-3.5 w-3.5" /> Back to settings
                        </Link>
                    </Button>
                }
            />

            {error ? (
                <Card className={errorKind === "setup" ? "border-primary/40 bg-primary/5" : "border-destructive/40 bg-destructive/5"}>
                    <CardContent className="py-6 flex items-start gap-3">
                        <AlertTriangle className={cn("h-5 w-5 shrink-0 mt-0.5", errorKind === "setup" ? "text-primary" : "text-destructive")} />
                        <div className="space-y-3 flex-1">
                            <div className="font-semibold">
                                {errorKind === "setup"
                                    ? "Connect a Stripe account to see live data"
                                    : errorKind === "config"
                                        ? "Stripe isn't fully configured"
                                        : "Couldn't load the dashboard"}
                            </div>
                            <p className="text-sm text-muted-foreground">{error}</p>
                            <div className="flex flex-wrap gap-2 pt-1">
                                {errorKind === "setup" ? (
                                    <Button asChild variant="neon" size="sm">
                                        <Link href="/settings/payments">Connect with Stripe</Link>
                                    </Button>
                                ) : (
                                    <Button asChild variant="outline" size="sm">
                                        <Link href="/settings/payments">Go to payment settings</Link>
                                    </Button>
                                )}
                                {errorKind === "transient" && (
                                    <Button variant="outline" size="sm" onClick={() => setRetryNonce((n) => n + 1)}>
                                        <RotateCw className="h-3.5 w-3.5" /> Try again
                                    </Button>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ) : loading || !connectInstance ? (
                <Card>
                    <CardContent className="py-12 grid place-items-center text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span className="text-xs mt-2">Loading live Stripe data…</span>
                    </CardContent>
                </Card>
            ) : (
                <ConnectComponentsProvider connectInstance={connectInstance}>
                    {/* Stripe's notification banner — surfaces "action
                      * required" callouts (verify your account, dispute
                      * filed, payout failed). Always visible, but only
                      * actually renders pixels when Stripe has something
                      * to say. */}
                    <ConnectNotificationBanner />

                    <div className="grid lg:grid-cols-[2fr_1fr] gap-6 items-start">
                        <div className="space-y-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-base">Payments</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <ConnectPayments />
                                </CardContent>
                            </Card>
                        </div>
                        <div className="space-y-6">
                            <Card>
                                <CardHeader><CardTitle className="text-base">Balance</CardTitle></CardHeader>
                                <CardContent>
                                    <ConnectBalances />
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader><CardTitle className="text-base">Bank payouts</CardTitle></CardHeader>
                                <CardContent>
                                    <ConnectPayouts />
                                </CardContent>
                            </Card>
                            {canManageAccount && (
                                <Card>
                                    <CardHeader><CardTitle className="text-base">Account management</CardTitle></CardHeader>
                                    <CardContent>
                                        <ConnectAccountManagement />
                                    </CardContent>
                                </Card>
                            )}
                        </div>
                    </div>
                </ConnectComponentsProvider>
            )}
        </div>
    )
}
