"use client"

import { useEffect, useState } from "react"
import { Download, Wifi, WifiOff, X } from "lucide-react"

import { Button } from "@/components/ui/button"

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export function ServiceWorkerRegistrar() {
    const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
    const [showOffline, setShowOffline] = useState(false)
    const [installable, setInstallable] = useState(false)

    useEffect(() => {
        if (typeof window === "undefined") return
        if ("serviceWorker" in navigator) {
            if (process.env.NODE_ENV === "production") {
                navigator.serviceWorker.register("/sw.js").catch(() => {})
            } else {
                // Dev: tear down any SW that's still registered from a prior
                // production-mode visit or a previous dev session. Without
                // this, the SW's cache-first /_next/static handler serves
                // stale chunks during Turbopack HMR and the page reloads in
                // a loop until the bundler dies. Also drop caches it owns.
                navigator.serviceWorker.getRegistrations().then((regs) => {
                    regs.forEach((r) => r.unregister())
                }).catch(() => {})
                if ("caches" in window) {
                    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {})
                }
            }
        }

        const onBeforeInstall = (e: Event) => {
            e.preventDefault()
            setInstallPrompt(e as BeforeInstallPromptEvent)
            setInstallable(true)
        }
        const onOnline = () => setShowOffline(false)
        const onOffline = () => setShowOffline(true)
        if (typeof navigator !== "undefined" && !navigator.onLine) setShowOffline(true)

        window.addEventListener("beforeinstallprompt", onBeforeInstall)
        window.addEventListener("online", onOnline)
        window.addEventListener("offline", onOffline)
        return () => {
            window.removeEventListener("beforeinstallprompt", onBeforeInstall)
            window.removeEventListener("online", onOnline)
            window.removeEventListener("offline", onOffline)
        }
    }, [])

    async function install() {
        if (!installPrompt) return
        await installPrompt.prompt()
        const choice = await installPrompt.userChoice
        if (choice.outcome === "accepted") setInstallable(false)
        setInstallPrompt(null)
    }

    return (
        <>
            {installable && (
                <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-primary/40 bg-card/95 backdrop-blur-xl px-3 py-2 shadow-glow no-print">
                    <Download className="h-4 w-4 text-primary" />
                    <span className="text-xs">Install RestoPOS</span>
                    <Button size="sm" variant="neon" onClick={install} className="h-7">Install</Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setInstallable(false)}><X className="h-3.5 w-3.5" /></Button>
                </div>
            )}
            {showOffline && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full border border-warning/40 bg-warning/15 backdrop-blur-xl px-3 py-1.5 text-xs no-print">
                    <WifiOff className="h-3.5 w-3.5 text-warning" />
                    Offline — changes will sync when you reconnect
                </div>
            )}
        </>
    )
}
