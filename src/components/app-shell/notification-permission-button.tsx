"use client"

import { useEffect, useState } from "react"
import { Bell, BellOff } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { playOrderChime } from "@/lib/notifications/sound"
import { subscribeToWebPush } from "@/lib/notifications/client-subscribe"

/**
 * Topbar button for the OS notification permission state.
 *
 * Three states it renders:
 *   - "granted"  → nothing rendered (everything's working — no UI clutter)
 *   - "default"  → "Enable alerts" button. Clicking it calls
 *                  Notification.requestPermission() **from a user gesture**,
 *                  which Safari requires (Chrome/Firefox also accept the
 *                  auto-request in PaymentNotifier, but we belt-and-suspenders
 *                  it here).
 *   - "denied"   → a muted bell icon as a hint. Permission can only be
 *                  re-enabled via the browser's per-site settings; we link
 *                  to the help docs.
 *
 * Fires a test notification on first grant so the user sees what to expect.
 */
export function NotificationPermissionButton() {
    const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default")

    useEffect(() => {
        if (typeof window === "undefined") return
        if (!("Notification" in window)) {
            setPermission("unsupported")
            return
        }
        setPermission(Notification.permission)
        // If permission was granted in a previous session, make sure
        // this browser/device is subscribed to Web Push so closed-tab
        // notifications work. subscribeToWebPush is idempotent — it
        // reuses any existing PushSubscription.
        if (Notification.permission === "granted") {
            subscribeToWebPush().catch(() => {})
        }
    }, [])

    if (permission === "unsupported" || permission === "granted") return null

    async function requestPermission() {
        if (typeof window === "undefined" || !("Notification" in window)) return
        try {
            const result = await Notification.requestPermission()
            setPermission(result)
            if (result === "granted") {
                toast.success("Order alerts enabled", {
                    description: "You'll see a desktop notification + chime when a QR order arrives.",
                })
                // Fire one sample so the user knows what to expect, with
                // the audible chime so they can verify the sound works.
                playOrderChime()
                try {
                    const n = new Notification("🛎️ Order alerts enabled", {
                        body: "You'll get a notification like this when a new QR order arrives.",
                        icon: "/icon.svg",
                        badge: "/icon.svg",
                        tag: "notification-test",
                    })
                    setTimeout(() => { try { n.close() } catch { /* ignore */ } }, 6_000)
                } catch { /* some browsers block — silent fail is fine */ }

                // Subscribe this browser/device to Web Push too. This makes
                // notifications work even when the dashboard tab is closed
                // or the browser is in the background. Failures are non-
                // fatal — the in-tab notifier still works without it.
                subscribeToWebPush().then((sub) => {
                    if (sub.ok) {
                        toast.success("This device added to push notifications", {
                            description: "Alerts will fire even when the dashboard tab is closed.",
                        })
                    } else if (sub.reason === "no_vapid") {
                        // Quiet — site isn't configured for Web Push yet.
                    } else if (sub.reason === "unsupported") {
                        // Some browsers (very old, in-app webviews) lack Push API.
                    }
                    // Other failures: stay silent. The in-tab notifier
                    // still works, which is enough for most setups.
                })
            } else if (result === "denied") {
                toast.error("Order alerts blocked", {
                    description: "Enable notifications for this site in your browser settings to re-allow.",
                })
            }
        } catch {
            toast.error("Couldn't request permission — check your browser settings")
        }
    }

    if (permission === "denied") {
        return (
            <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                aria-label="Order alerts are blocked — enable in browser settings"
                title="Order alerts are blocked. Click your browser's address-bar lock icon → Notifications → Allow."
                onClick={() => toast.message("Order alerts are blocked", {
                    description: "Click your browser's lock icon next to the URL → Notifications → Allow.",
                })}
            >
                <BellOff className="h-4 w-4" />
            </Button>
        )
    }

    return (
        <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8"
            onClick={requestPermission}
        >
            <Bell className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Enable alerts</span>
        </Button>
    )
}
