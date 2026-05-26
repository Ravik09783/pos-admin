"use client"

import { useCallback, useEffect, useState } from "react"
import QRCode from "qrcode"
import {
    AlertTriangle, Check, Copy, ExternalLink, Loader2, RefreshCw,
    ShieldAlert, Smartphone, User,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { useTheme } from "@/lib/theme/provider"
import { withThemeParam } from "@/lib/theme/themes"

/**
 * "Your personal display URL" — the per-cashier section of the
 * merged Customer display page.
 *
 * Every staff/admin user has a unique opaque token that forms a URL
 * `/display/<tenant-slug>/<token>`. Mount it on the tablet at THEIR
 * counter: it streams only their own POS sessions, never anyone
 * else's. The branch-wide URLs (below this section) are a separate
 * mechanism for single-counter shops.
 *
 * Backed by `/api/customer-display/me` (read) and
 * `/api/customer-display/regenerate` (rotate). The token rotation
 * invalidates the old URL the moment it succeeds — any tablet still
 * on the old URL goes blank until re-mounted with the new one.
 *
 * No PII in the URL or QR — the token is random and can't be
 * reverse-mapped to a user. The display only shows non-sensitive
 * cart-in-progress data.
 */
interface DisplayInfo {
    token: string
    url: string
    tenant_slug: string
    user_name: string | null
}

export function PersonalDisplayUrlSection() {
    const [info, setInfo] = useState<DisplayInfo | null>(null)
    const [qr, setQr] = useState<string>("")
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [confirmRotate, setConfirmRotate] = useState(false)
    const [rotating, setRotating] = useState(false)

    // The customer screen opens in the restaurant's current theme: we append
    // `?theme=` to the URL, and the display page's pre-hydration script reads
    // it back and saves it to that device's localStorage.
    const { theme, themes } = useTheme()
    const themedUrl = info?.url ? withThemeParam(info.url, theme) : ""
    const themeName = themes.find((t) => t.id === theme)?.name ?? theme

    const fetchInfo = useCallback(async () => {
        setError(null)
        try {
            const r = await fetch("/api/customer-display/me")
            const data = await r.json() as DisplayInfo & { error?: string }
            if (!r.ok || data.error) throw new Error(data.error ?? "Couldn't load display URL")
            setInfo(data)
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Couldn't load display URL"
            setError(msg)
            // No toast — the inline error state below is more discoverable
            // and lasts longer than a toast for a setup-incomplete issue.
        } finally {
            setLoading(false)
        }
    }, [])
    useEffect(() => { fetchInfo() }, [fetchInfo])

    // Detect the most common setup-incomplete cause so we can show a
    // very specific remediation instead of a generic error.
    const isMissingMigration = error != null && /migration 27|display token/i.test(error)

    useEffect(() => {
        if (!themedUrl) { setQr(""); return }
        QRCode.toDataURL(themedUrl, {
            margin: 1,
            width: 280,
            errorCorrectionLevel: "H",
            color: { dark: "#0a0e1a", light: "#ffffff" },
        })
            .then(setQr)
            .catch(() => setQr(""))
    }, [themedUrl])

    async function copyUrl() {
        if (!themedUrl) return
        try {
            await navigator.clipboard.writeText(themedUrl)
            setCopied(true)
            toast.success("URL copied")
            window.setTimeout(() => setCopied(false), 1500)
        } catch {
            toast.error("Couldn't copy — select the URL manually.")
        }
    }

    async function rotate() {
        setRotating(true)
        try {
            const r = await fetch("/api/customer-display/regenerate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
            })
            const data = await r.json() as { ok?: boolean; token?: string; error?: string }
            if (!r.ok || !data.ok) throw new Error(data.error ?? "Couldn't rotate token")
            toast.success("New URL generated — re-mount your tablet.")
            setConfirmRotate(false)
            await fetchInfo()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't rotate token")
        } finally {
            setRotating(false)
        }
    }

    return (
        <>
            <Card className="border-primary/30">
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <User className="h-4 w-4" /> Your personal display URL
                    </CardTitle>
                    <CardDescription className="leading-relaxed">
                        Each cashier gets a unique URL. Open YOUR URL on the tablet at YOUR counter, and the tablet streams only YOUR POS — never a colleague&apos;s. Different cashiers at different counters can run their own customer screens at the same time with zero overlap.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                        </div>
                    ) : error ? (
                        <SetupIncompleteCard
                            isMissingMigration={isMissingMigration}
                            message={error}
                            onRetry={() => { setLoading(true); fetchInfo() }}
                        />
                    ) : (
                        <>
                            <div className="grid sm:grid-cols-[auto_1fr] gap-6 items-start">
                                {qr ? (
                                    <div className="rounded-xl bg-white p-3 border border-border/60 shadow-sm w-fit">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={qr} alt="QR for personal display URL" className="h-44 w-44" />
                                    </div>
                                ) : (
                                    <div className="h-44 w-44 rounded-xl bg-muted grid place-items-center text-muted-foreground">
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                    </div>
                                )}

                                <div className="space-y-3 min-w-0">
                                    <div>
                                        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                                            URL · for {info?.user_name ?? "you"}
                                        </div>
                                        {/* break-all + select-all matches the branch URL block below — staff can
                                          * see the full URL at a glance instead of a truncated single line, and
                                          * tap-and-hold on mobile selects the whole thing for copying. */}
                                        <div className="font-mono text-xs break-all rounded-md border border-border/60 bg-muted/30 px-3 py-2 select-all">
                                            {themedUrl}
                                        </div>
                                        <p className="text-[11px] text-muted-foreground mt-1">
                                            Opens the customer screen in your current theme ({themeName}). Pick a
                                            different theme and re-copy this URL to change it.
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Button variant="outline" size="sm" onClick={copyUrl} disabled={!info}>
                                            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                                            {copied ? "Copied" : "Copy URL"}
                                        </Button>
                                        <Button asChild variant="outline" size="sm">
                                            <a href={themedUrl || "#"} target="_blank" rel="noopener noreferrer">
                                                <ExternalLink className="h-3.5 w-3.5" /> Open in new tab
                                            </a>
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
                                            onClick={() => setConfirmRotate(true)}
                                        >
                                            <RefreshCw className="h-3.5 w-3.5" /> Regenerate
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {/* "How to use" mini-guide — sits inside the
                              * card so it appears WITH the URL the first
                              * time the user lands here. Three concrete
                              * steps written in active voice ("Open …",
                              * "Place …", "Done"). */}
                            <div className="mt-5 rounded-lg border border-border/50 bg-muted/30 p-4 space-y-2.5">
                                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                    <Smartphone className="h-3 w-3" /> How to use this URL
                                </div>
                                <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal pl-5 leading-relaxed">
                                    <li>Open the URL above on the tablet/TV facing your customer (scan the QR with the tablet&apos;s camera or paste the link in its browser).</li>
                                    <li>Place that tablet at your counter and leave it on the page. It shows a welcome screen until you start ringing up an order.</li>
                                    <li>The moment you add an item on your POS, the tablet flips to a live cart for your customer. They see it update in real time, and the payment QR appears when you hit Review &amp; checkout.</li>
                                </ol>
                                <p className="text-[11px] text-muted-foreground/80 pt-1">
                                    Rotate the token if you ever leave a tablet at a venue or share the URL by mistake — the old URL stops working the moment you confirm.
                                </p>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            <Dialog open={confirmRotate} onOpenChange={(v) => { if (!v && !rotating) setConfirmRotate(false) }}>
                <DialogContent className="sm:max-w-md border-2 border-destructive/40">
                    <DialogHeader>
                        <div className="flex items-center gap-2">
                            <span className="grid place-items-center h-8 w-8 rounded-lg bg-destructive/15 text-destructive">
                                <ShieldAlert className="h-4 w-4" />
                            </span>
                            <DialogTitle>Generate a new display URL?</DialogTitle>
                        </div>
                        <DialogDescription>
                            Your old URL stops working the moment you confirm. Any tablet still on it will go blank until you re-mount the new URL.
                        </DialogDescription>
                    </DialogHeader>
                    <Separator />
                    <p className="text-xs text-muted-foreground">
                        This only affects your display tablet — POS, bills, and signed-in sessions are unchanged.
                    </p>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="ghost" onClick={() => setConfirmRotate(false)} disabled={rotating}>
                            Cancel
                        </Button>
                        <Button
                            variant="outline"
                            className="text-destructive border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                            onClick={rotate}
                            disabled={rotating}
                        >
                            {rotating && <Loader2 className="h-4 w-4 animate-spin" />}
                            Yes, generate new URL
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}

/**
 * Inline error card shown when /api/customer-display/me fails. The most
 * common cause on a brand-new install is that migration 27 (which adds
 * `users.display_token`) hasn't been applied yet — when we detect that,
 * we tell the user exactly which file to apply instead of dumping a
 * raw "column does not exist" message.
 */
function SetupIncompleteCard({
    isMissingMigration,
    message,
    onRetry,
}: {
    isMissingMigration: boolean
    message: string
    onRetry: () => void
}) {
    return (
        <div className="rounded-lg border-2 border-warning/40 bg-warning/5 p-4 space-y-3">
            <div className="flex items-start gap-3">
                <span className="grid place-items-center h-9 w-9 rounded-lg bg-warning/15 text-warning shrink-0">
                    <AlertTriangle className="h-4 w-4" />
                </span>
                <div className="space-y-1 min-w-0 flex-1">
                    <div className="text-sm font-semibold">
                        {isMissingMigration
                            ? "Customer-display feature isn't set up yet"
                            : "Couldn't load your display URL"}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        {isMissingMigration ? (
                            <>
                                The database needs one final migration to issue per-cashier display URLs. Ask your admin (or whoever runs the DB) to apply{" "}
                                <code className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded border border-border/60">
                                    supabase/migrations/27_per_user_display_tokens.sql
                                </code>
                                . Until then, you can still use the branch-wide URLs further down this page.
                            </>
                        ) : (
                            message
                        )}
                    </p>
                </div>
            </div>
            <div className="flex flex-wrap gap-2 pl-12">
                <Button variant="outline" size="sm" onClick={onRetry}>
                    <RefreshCw className="h-3.5 w-3.5" /> Try again
                </Button>
                {isMissingMigration && (
                    <Button asChild variant="ghost" size="sm">
                        <a
                            href="https://supabase.com/docs/guides/cli/local-development#database-migrations"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <ExternalLink className="h-3.5 w-3.5" /> How to apply migrations
                        </a>
                    </Button>
                )}
            </div>
        </div>
    )
}
