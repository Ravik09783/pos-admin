"use client"

import { useEffect, useMemo, useState } from "react"
import QRCode from "qrcode"
import { Check, Copy, ExternalLink, Loader2, Monitor, Smartphone } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { useActiveBranch } from "@/lib/branch/active-branch"
import { useTheme } from "@/lib/theme/provider"
import { withThemeParam } from "@/lib/theme/themes"
import type { Branch, UserRole } from "@/types/database"
import { PersonalDisplayUrlSection } from "./personal-url-section"

/**
 * Customer display setup — merged surface.
 *
 * Two distinct mechanisms live here, top to bottom:
 *
 *  1. **Your personal URL** (every signed-in staff/admin user).
 *     Unique per-cashier URL backed by `users.display_token`. Each
 *     cashier mounts their own URL on their own counter's tablet;
 *     sessions are filtered by `created_by` so colleagues never see
 *     each other's carts. Useful for multi-counter shops.
 *
 *  2. **Branch display URLs** (OWNER + MANAGER only).
 *     Branch-wide URLs (`/display/<slug>?branch=<id>`) that mirror
 *     whichever cashier most recently started a session at that
 *     branch. Useful for single-counter shops or as an "overview"
 *     screen — admins can hide this from staff because it leaks
 *     cross-cashier activity.
 *
 * Both modes back the same `pos_display_sessions` table; they just
 * differ in the filter the display device applies. The cashier's
 * POS doesn't need to know which mode the customer-facing screen is
 * using — it writes one session row and both URLs subscribe.
 *
 * Replaces the previous split between this page and the now-deleted
 * `/settings/customer-display` route. Sidebar entry "My display URL"
 * was removed; everything lives here.
 */
export default function CustomerDisplaySetupPage() {
    // Memoize the client — createClient() returns a brand-new instance
    // every call, and a fresh reference on each render was retriggering
    // the auth/users/tenants/branches useEffect below on every paint.
    const supabase = useMemo(() => createClient(), [])
    const [tenantSlug, setTenantSlug] = useState<string>("")
    const [branches, setBranches] = useState<Branch[]>([])
    const [origin, setOrigin] = useState<string>("")
    const [role, setRole] = useState<UserRole | null>(null)

    // The topbar branch switcher is the source of truth for "which
    // outlet am I configuring right now". When the admin has a
    // specific branch selected, this page should only show THAT
    // branch's display URL — showing all of them was confusing
    // ("why am I seeing two QRs when I'm on Branch A?"). On the
    // "All branches" view we fall back to listing every branch so
    // a multi-outlet admin can still copy any URL.
    const { activeBranchId } = useActiveBranch()

    // The branch display URLs carry the admin's current theme (?theme=) so
    // the customer screen opens in the same look — see withThemeParam +
    // themeInitScript.
    const { theme } = useTheme()

    useEffect(() => {
        setOrigin(typeof window !== "undefined" ? window.location.origin : "")
    }, [])

    useEffect(() => {
        ;(async () => {
            const { data: u } = await supabase.auth.getUser()
            if (!u.user) return
            const { data: row } = await supabase
                .from("users").select("tenant_id, role").eq("id", u.user.id).maybeSingle()
            const r = row as { tenant_id?: string; role?: UserRole } | null
            if (!r?.tenant_id) return
            setRole(r.role ?? null)
            const [{ data: tenant }, { data: brs }] = await Promise.all([
                supabase.from("tenants").select("slug").eq("id", r.tenant_id).maybeSingle(),
                supabase.from("branches").select("*").eq("is_active", true).order("is_main", { ascending: false }).order("name"),
            ])
            setTenantSlug((tenant as { slug?: string } | null)?.slug ?? "")
            setBranches((brs ?? []) as Branch[])
        })()
    }, [supabase])

    const canSeeBranchSection = role === "OWNER" || role === "MANAGER"

    // Branch-wide URL targets. Driven by the topbar branch switcher:
    //   - Single-branch tenant     → one tenant-root URL
    //   - Multi-branch, branch X   → only branch X's URL
    //   - Multi-branch, "All"      → every branch
    //
    // The "show only the active branch" rule is the one the admin
    // asked for — they'd switched to "Jaspreet Resto" in the topbar
    // and still saw "BranchTwo" listed below, which felt like a bug.
    const targets: { label: string; branchId: string | null; url: string }[] = (() => {
        if (!tenantSlug || !origin) return []
        const base = `${origin}/display/${tenantSlug}`
        if (branches.length <= 1) {
            return [{ label: branches[0]?.name ?? "Main", branchId: null, url: withThemeParam(base, theme) }]
        }
        const scoped = activeBranchId
            ? branches.filter((b) => b.id === activeBranchId)
            : branches
        return scoped.map((b) => ({
            label: b.name + (b.is_main ? " (main)" : ""),
            branchId: b.id,
            url: withThemeParam(`${base}?branch=${b.id}`, theme),
        }))
    })()

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-4xl space-y-6">
            <PageHeader
                kicker="Configure"
                title="Customer display"
                highlight="2nd screen pairing"
                description="Connect a tablet or TV facing the customer to mirror the checkout in real time. Either a personal URL (your tablet, your POS only) or a branch-wide URL (one tablet catches every cashier at that branch)."
            />

            {/* ── How it works — primer card ─────────────────────────── */}
            <Card className="border-primary/30">
                <CardHeader className="flex-row items-start gap-3 space-y-0">
                    <span className="grid place-items-center h-10 w-10 rounded-lg bg-gradient-to-br from-primary/25 to-[hsl(var(--neon-magenta)/0.2)] shrink-0">
                        <Monitor className="h-5 w-5 text-primary" />
                    </span>
                    <div>
                        <CardTitle className="text-base">How it works</CardTitle>
                        <CardDescription className="mt-1 leading-relaxed">
                            Open one of the URLs below on a separate device (tablet, TV with a browser, an old phone — anything with a screen) and leave it on that page. Whenever a cashier rings up an order, this second screen lights up with the cart + payment QR. The customer scans, pays, and sees a &ldquo;Thank you&rdquo; screen when the bill lands.
                            <br /><br />
                            <strong>You don&apos;t need a second screen.</strong> If you only have one device, the cashier&apos;s POS already shows the same QR — just turn the screen toward the customer.
                        </CardDescription>
                    </div>
                </CardHeader>
            </Card>

            {/* ── 1. Personal URL (every staff member) ──────────────── */}
            <PersonalDisplayUrlSection />

            {/* ── 2. Branch-wide URLs (OWNER + MANAGER only) ────────── */}
            {canSeeBranchSection && (
                <>
                    <div className="flex items-center gap-2 pt-2">
                        <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                            Branch-wide display
                            {branches.length > 1 && activeBranchId && (
                                <span className="ml-2 normal-case tracking-normal text-muted-foreground/80">
                                    · for the outlet selected in the topbar
                                </span>
                            )}
                        </h2>
                        <span className="h-px flex-1 bg-border" />
                    </div>
                    <p className="text-xs text-muted-foreground -mt-3">
                        Optional — one URL that mirrors whichever cashier is currently active at this outlet. Best for single-counter shops or as an overview screen behind the counter.
                        {branches.length > 1 && activeBranchId && (
                            <> Switch outlets from the topbar to copy a different branch&apos;s URL.</>
                        )}
                        {" "}Each link opens the customer screen in your current theme.
                    </p>

                    {targets.length === 0 ? (
                        <Card>
                            <CardContent className="py-10 text-center text-muted-foreground">
                                Loading…
                            </CardContent>
                        </Card>
                    ) : (
                        targets.map((t) => <DisplayTarget key={t.branchId ?? "tenant"} target={t} />)
                    )}
                </>
            )}
        </div>
    )
}

function DisplayTarget({ target }: { target: { label: string; branchId: string | null; url: string } }) {
    const [qr, setQr] = useState("")
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        QRCode.toDataURL(target.url, {
            margin: 1,
            width: 280,
            errorCorrectionLevel: "M",
            color: { dark: "#0a0e1a", light: "#ffffff" },
        })
            .then(setQr)
            .catch(() => setQr(""))
    }, [target.url])

    async function copy() {
        try {
            await navigator.clipboard.writeText(target.url)
            setCopied(true)
            toast.success("URL copied")
            window.setTimeout(() => setCopied(false), 2000)
        } catch {
            toast.error("Couldn't copy — long-press the URL to copy manually")
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{target.label}</CardTitle>
                <CardDescription>
                    {target.branchId
                        ? "Shows checkouts from this branch only."
                        : "Single-branch shop — one display catches every checkout."}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid sm:grid-cols-[auto_1fr] gap-6 items-start">
                    <div className="rounded-xl bg-white p-3 border border-border/60 shadow-sm w-fit">
                        {qr ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={qr} alt={`QR for ${target.label}`} className="h-44 w-44" />
                        ) : (
                            <div className="h-44 w-44 grid place-items-center text-xs text-muted-foreground">
                                Generating…
                            </div>
                        )}
                    </div>

                    <div className="space-y-3 min-w-0">
                        <div>
                            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">URL</div>
                            <div className="font-mono text-xs break-all rounded-md border border-border/60 bg-muted/30 px-3 py-2 select-all">
                                {target.url}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={copy}>
                                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                                {copied ? "Copied" : "Copy URL"}
                            </Button>
                            <Button asChild variant="outline" size="sm">
                                <a href={target.url} target="_blank" rel="noopener">
                                    <ExternalLink className="h-3.5 w-3.5" /> Open in new tab
                                </a>
                            </Button>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-1.5 leading-relaxed pt-2">
                            <div className="flex items-start gap-2">
                                <Smartphone className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                <span><strong>From the second device:</strong> open its camera and scan the QR. Tap the link that pops up.</span>
                            </div>
                            <div className="flex items-start gap-2">
                                <Monitor className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                <span><strong>From a browser:</strong> paste the URL above. Bookmark so the screen comes back to it on reboot.</span>
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
