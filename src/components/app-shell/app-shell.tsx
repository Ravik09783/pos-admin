"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { BillingBanner } from "./billing-banner"
import { PlanOverageBanner } from "./plan-overage-banner"
import { Topbar } from "./topbar"
import type { UserRole } from "@/types/database"

/**
 * App shell that switches between two layouts based on the current route:
 *
 *   - "Kiosk" routes (POS, KDS) → full-bleed, no sidebar, no topbar, no
 *     banners. Just the page + a small floating Exit button top-right.
 *     Built for the cashier who's standing at the till and doesn't want
 *     anything competing for screen real-estate.
 *
 *   - Everything else → normal Sidebar + Topbar + Billing banner.
 *
 * The list of kiosk routes is intentionally small — POS is the obvious
 * one; KDS is included because it's typically mounted on a kitchen TV
 * where chrome is also a distraction. Add more by extending KIOSK_ROUTES.
 *
 * Esc on the keyboard exits kiosk mode and routes to /dashboard — same
 * outcome as clicking the Exit button. Saves the cashier reaching for
 * the mouse on tablet keyboards.
 */
const KIOSK_ROUTES: ReadonlySet<string> = new Set([
    "/pos",
    "/kds",
])

interface AppShellProps {
    children: React.ReactNode
    tenantId: string
    tenantName: string
    tenantLogoUrl: string | null
    userName: string
    userEmail: string
    /** Optional avatar shown on the topbar trigger. Null = falls back
     *  to a generic User icon. Powered by `public.users.avatar_url`
     *  which the user updates via /settings/profile. */
    userAvatarUrl?: string | null
    role: UserRole
    /** True when the signed-in account's email is on the
     *  RESTOPOS_SUPER_ADMIN_EMAILS list. Used by the topbar to show a
     *  discreet link into `/super-admin` for platform operators. */
    isSuperAdmin?: boolean
}

export function AppShell(props: AppShellProps) {
    const pathname = usePathname()
    const router = useRouter()
    const isKiosk = pathname !== null && KIOSK_ROUTES.has(pathname)

    // Esc → exit kiosk. Only attached when in kiosk mode so we don't
    // surprise anyone on a normal page by hijacking Escape.
    useEffect(() => {
        if (!isKiosk) return
        function onKey(e: KeyboardEvent) {
            if (e.key !== "Escape") return
            // Don't fight a focused input — most modals/popups also catch
            // Esc to close themselves. Only fire when nothing else owns it.
            const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase()
            if (tag === "input" || tag === "textarea" || tag === "select") return
            router.push("/dashboard")
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [isKiosk, router])

    if (isKiosk) {
        return (
            <div className="min-h-screen bg-background relative">
                {/* Page content — full bleed, no chrome */}
                <main className="min-h-screen">{props.children}</main>

                {/* Floating exit button. Top-right, semi-translucent at
                  * rest so it doesn't compete with the menu grid; pops
                  * out on hover. Tooltip mentions the Esc shortcut. */}
                <button
                    type="button"
                    onClick={() => router.push("/dashboard")}
                    aria-label="Exit POS mode"
                    title="Exit POS mode (Esc) — return to dashboard"
                    className={cn(
                        "fixed top-3 right-3 z-50",
                        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full",
                        "bg-background/60 backdrop-blur border border-border/60",
                        "text-xs font-medium text-muted-foreground",
                        "hover:bg-background hover:text-foreground hover:border-border",
                        "transition-colors shadow-sm",
                    )}
                >
                    <X className="h-3.5 w-3.5" />
                    Exit POS
                </button>
            </div>
        )
    }

    // The sidebar is gone — navigation now lives in the topbar's "Menu"
    // launcher (a full-screen card grid). The shell is just topbar +
    // banners + the page itself, full-width.
    return (
        <div className="min-h-screen flex flex-col">
            <Topbar
                tenantId={props.tenantId}
                tenantName={props.tenantName}
                tenantLogoUrl={props.tenantLogoUrl}
                userName={props.userName}
                userEmail={props.userEmail}
                userAvatarUrl={props.userAvatarUrl ?? null}
                role={props.role}
                isSuperAdmin={props.isSuperAdmin}
            />
            {/* Subscription status banner — only renders when there's
              * something OWNER-actionable (trial ending, past due,
              * suspended). Silent on healthy ACTIVE / India tenants. */}
            <BillingBanner role={props.role} />
            {/* Plan-overage banner — fires when the tenant has more
              * branches or staff than their tier covers. OWNER-only. */}
            <PlanOverageBanner role={props.role} />
            <main className="flex-1 overflow-auto scrollbar-thin">{props.children}</main>
        </div>
    )
}
