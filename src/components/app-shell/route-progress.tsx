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

    // Every timer the component owns is parked in a ref so a fresh
    // navigation can cancel a stale fadeout / safety-net firing from
    // the previous one. Without this discipline the bar would either
    // get stuck visible (preventDefault'd click → start() ran but
    // pathname never changed → finish() never fires) or vanish
    // mid-navigation (orphan fadeout setTimeout from the previous
    // route flips `active` off after the next start() already lit it).
    const intervalRef = useRef<number | null>(null)
    const fadeoutRef = useRef<number | null>(null)
    const safetyRef = useRef<number | null>(null)
    const startedRef = useRef(false)

    function clearAllTimers() {
        if (intervalRef.current != null) {
            window.clearInterval(intervalRef.current)
            intervalRef.current = null
        }
        if (fadeoutRef.current != null) {
            window.clearTimeout(fadeoutRef.current)
            fadeoutRef.current = null
        }
        if (safetyRef.current != null) {
            window.clearTimeout(safetyRef.current)
            safetyRef.current = null
        }
    }

    function start() {
        // Already in flight — don't restart, otherwise rapid double-
        // clicks reset the creep back to 12 %.
        if (startedRef.current) return
        startedRef.current = true
        clearAllTimers()
        setActive(true)
        setWidth(12) // initial burst — feels immediate
        // Creep upwards but never reach 100% until the route actually
        // changes (or the safety-net fires).
        intervalRef.current = window.setInterval(() => {
            setWidth((w) => Math.min(w + Math.random() * 10, 85))
        }, 220)
        // Safety net: if no pathname change lands within 5 s (link
        // got preventDefault'd, navigation cancelled, redirect loop,
        // stalled network), force-finish so the bar doesn't end up
        // permanently stuck near 85 %.
        safetyRef.current = window.setTimeout(() => {
            finish()
        }, 5000)
    }

    function finish() {
        if (!startedRef.current) return
        startedRef.current = false
        clearAllTimers()
        setWidth(100)
        // Brief pause so the user sees the full bar before it fades.
        // Tracked in a ref so a brand-new navigation can cancel it
        // and the new progress doesn't get clobbered.
        fadeoutRef.current = window.setTimeout(() => {
            setActive(false)
            setWidth(0)
            fadeoutRef.current = null
        }, 150)
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
            // Anchors with `download` are file saves, not navigations.
            if (a.hasAttribute("download")) return
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
            clearAllTimers()
        }
    }, [])

    return (
        <div
            aria-hidden
            className="fixed top-0 left-0 right-0 z-[100] h-0.5 pointer-events-none"
            style={{
                opacity: active ? 1 : 0,
                // No transition-delay — when `active` flips off the bar
                // should start fading immediately. The 150 ms hold-at-100
                // pause inside finish() already gives the user the
                // "full bar" beat before this fade kicks in.
                transition: active ? "opacity 80ms" : "opacity 200ms ease-out",
            }}
        >
            <div
                className="h-full bg-primary shadow-sm"
                style={{ width: `${width}%`, transition: "width 220ms ease-out" }}
            />
        </div>
    )
}
