"use client"

/**
 * A YouTube-style top progress bar that gives the user immediate "something
 * is happening" feedback during route changes.
 *
 * It piggybacks off the App Router instead of `next/navigation`'s router
 * events (which don't exist for the App Router):
 *   - clicks on an internal <a> kick off a creeping width animation
 *   - a pathname / search change finishes it (jump to 100% → fade)
 *
 * The bar lives in <body> (mounted once in the root layout) so it covers
 * landing, auth, app and QR pages alike.
 */

import { useEffect, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"

export function RouteProgress() {
    const pathname = usePathname()
    const search = useSearchParams()

    const [active, setActive] = useState(false)
    const [width, setWidth] = useState(0)
    const intervalRef = useRef<number | null>(null)
    // Tracks where we are in the navigation lifecycle. Refs (not state) so the
    // click listener doesn't need to be re-attached on every change.
    const startedRef = useRef(false)

    function clearTimer() {
        if (intervalRef.current != null) {
            window.clearInterval(intervalRef.current)
            intervalRef.current = null
        }
    }

    function start() {
        startedRef.current = true
        setActive(true)
        setWidth(12)            // initial burst — feels immediate
        clearTimer()
        // Creep upwards but never reach 100% until the route actually changes.
        intervalRef.current = window.setInterval(() => {
            setWidth((w) => Math.min(w + Math.random() * 10, 85))
        }, 220)
    }

    function finish() {
        if (!startedRef.current) return
        startedRef.current = false
        clearTimer()
        setWidth(100)
        // brief pause so the user actually sees the full bar before it fades
        window.setTimeout(() => {
            setActive(false)
            setWidth(0)
        }, 200)
    }

    // Hook navigation completion: a pathname / search change means the new
    // route has rendered — race the bar to 100%.
    useEffect(() => {
        finish()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname, search])

    // Hook navigation start: intercept clicks on internal links.
    useEffect(() => {
        function onClick(e: MouseEvent) {
            if (e.defaultPrevented) return
            if (e.button !== 0) return                          // left-click only
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return  // open-in-new-tab modifiers
            const target = e.target as HTMLElement | null
            const a = target?.closest("a")
            if (!a) return
            if (a.target === "_blank") return
            const href = a.getAttribute("href")
            if (!href) return
            if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) return
            let u: URL
            try { u = new URL(href, window.location.href) } catch { return }
            if (u.origin !== window.location.origin) return     // external
            if (u.pathname === window.location.pathname && u.search === window.location.search) return
            start()
        }
        // Capture phase so we run before any onClick handlers that might
        // call preventDefault for their own reasons.
        document.addEventListener("click", onClick, { capture: true })
        // Browser back / forward also navigates — show the bar then too.
        function onPopState() { start() }
        window.addEventListener("popstate", onPopState)
        return () => {
            document.removeEventListener("click", onClick, { capture: true })
            window.removeEventListener("popstate", onPopState)
            clearTimer()
        }
    }, [])

    return (
        <div
            aria-hidden
            className="fixed top-0 left-0 right-0 z-[100] h-0.5 pointer-events-none"
            style={{
                opacity: active ? 1 : 0,
                transition: active ? "opacity 80ms" : "opacity 250ms ease-out 150ms",
            }}
        >
            <div
                className="h-full bg-gradient-to-r from-[hsl(var(--neon-cyan))] via-[hsl(var(--primary))] to-[hsl(var(--neon-magenta))] shadow-[0_0_10px_hsl(var(--primary))]"
                style={{ width: `${width}%`, transition: "width 220ms ease-out" }}
            />
        </div>
    )
}
