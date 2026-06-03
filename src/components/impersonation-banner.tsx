"use client"

import { useEffect, useState } from "react"
import { Loader2, ShieldAlert, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"

/**
 * Banner that surfaces when the current session is the result of a
 * super-admin impersonation. The "impersonator-session" payload is
 * dropped into `localStorage` by `AuthHashHandler` right before it
 * calls `setSession` on the impersonated user's tokens — meaning we
 * still hold the super-admin's refresh token. Clicking **Return to
 * my account** calls `setSession` with that refresh token, hard-
 * navigates to `/super-admin`, and clears the saved payload.
 *
 * Why localStorage and not a cookie? Cookies for the same origin are
 * shared across every tab, but the super-admin's tokens should ONLY
 * be retrievable by the user who triggered the impersonation, on the
 * device they did it from. Persisting in localStorage (per-origin,
 * not transmitted) matches the existing supabase-js client storage
 * strategy and adds no new server-side exposure.
 *
 * Auto-expires after 4 hours so a forgotten payload doesn't grow
 * into a "stale token in storage" risk. The supabase refresh token
 * is normally good for ~weeks, so 4h is purely a UX/safety cap.
 */

const STORAGE_KEY = "restopos:impersonator-session"
const MAX_AGE_MS = 4 * 60 * 60 * 1000 // 4 hours

interface SavedImpersonatorSession {
    access_token: string
    refresh_token: string
    email: string
    savedAt: number
}

export function ImpersonationBanner() {
    const [saved, setSaved] = useState<SavedImpersonatorSession | null>(null)
    const [restoring, setRestoring] = useState(false)

    // Read the payload on mount + listen for storage changes so the
    // banner appears in OTHER tabs (the original super-admin tab is
    // already on a non-impersonated page; this picks up cross-tab).
    useEffect(() => {
        if (typeof window === "undefined") return
        const read = () => {
            const raw = window.localStorage.getItem(STORAGE_KEY)
            if (!raw) { setSaved(null); return }
            try {
                const parsed = JSON.parse(raw) as SavedImpersonatorSession
                if (
                    !parsed?.access_token ||
                    !parsed?.refresh_token ||
                    !parsed?.email ||
                    typeof parsed.savedAt !== "number"
                ) {
                    window.localStorage.removeItem(STORAGE_KEY)
                    setSaved(null)
                    return
                }
                if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
                    window.localStorage.removeItem(STORAGE_KEY)
                    setSaved(null)
                    return
                }
                setSaved(parsed)
            } catch {
                window.localStorage.removeItem(STORAGE_KEY)
                setSaved(null)
            }
        }
        read()
        const onStorage = (e: StorageEvent) => {
            if (e.key === STORAGE_KEY) read()
        }
        window.addEventListener("storage", onStorage)
        return () => window.removeEventListener("storage", onStorage)
    }, [])

    async function returnToSuperAdmin() {
        if (!saved) return
        setRestoring(true)
        try {
            const supabase = createClient()
            const { error } = await supabase.auth.setSession({
                access_token: saved.access_token,
                refresh_token: saved.refresh_token,
            })
            if (error) throw error
            window.localStorage.removeItem(STORAGE_KEY)
            // Hard navigation so proxy + RSC tree re-evaluate with the
            // super-admin cookies. Same reason AuthHashHandler uses
            // `window.location.replace` after a session swap.
            window.location.replace("/super-admin")
        } catch (e) {
            setRestoring(false)
            console.error("[impersonation-banner] couldn't restore super-admin session", e)
            toast.error(
                e instanceof Error
                    ? `Couldn't restore your account: ${e.message}`
                    : "Couldn't restore your account",
                {
                    description: "The saved session may have expired. Sign out and sign back in as super-admin.",
                },
            )
        }
    }

    function dismiss() {
        window.localStorage.removeItem(STORAGE_KEY)
        setSaved(null)
    }

    if (!saved) return null

    // Theme-agnostic design notes:
    //   - Background `bg-destructive/10` reads as a *visible* tinted
    //     strip on every theme (cream Atelier, black POS Pro, neon dark,
    //     etc.) — `/[0.06]` from the previous draft was nearly invisible.
    //   - Primary text uses the theme's `--foreground` so it's
    //     guaranteed-readable on whatever tint the background renders;
    //     the small label uses `--muted-foreground` for the right
    //     hierarchy without going low-contrast.
    //   - The "Return" button uses the solid `destructive` variant
    //     (white text on red bg) — high-contrast and unmistakable on
    //     every theme, much better than the outline + low-opacity hover
    //     state I had before.
    return (
        <div className="shrink-0 border-b border-destructive/30 bg-destructive/10">
            <div className="container mx-auto px-3 md:px-6 py-2 flex items-center gap-3 text-xs md:text-sm flex-wrap">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <ShieldAlert className="h-4 w-4 text-destructive shrink-0" />
                    <span className="text-foreground truncate">
                        Impersonating from{" "}
                        <span className="font-mono font-semibold">{saved.email}</span>
                        <span className="text-muted-foreground"> · super-admin</span>
                    </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={returnToSuperAdmin}
                        disabled={restoring}
                        className="h-8"
                    >
                        {restoring
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <ShieldAlert className="h-3.5 w-3.5" />}
                        Return to my account
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={dismiss}
                        title="Dismiss — saved session is forgotten and the banner won't return"
                        aria-label="Dismiss impersonation banner"
                    >
                        <X className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>
        </div>
    )
}
