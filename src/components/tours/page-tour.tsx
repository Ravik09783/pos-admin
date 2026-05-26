"use client"

import dynamic from "next/dynamic"
import { useEffect, useRef } from "react"

import { TOURS, type TourKey } from "@/lib/tours/registry"

import { useTour } from "./tour-provider"

/**
 * Drop one of these into any authenticated page that has a tour
 * defined in the registry:
 *
 *     <PageTour tourKey="dashboard" />
 *
 * On mount it asks the TourProvider whether to auto-start (only fires
 * if the user hasn't already completed this specific tour). The
 * Joyride bundle is lazy-loaded — pages that haven't started a tour
 * don't pay the ~30 KB cost on first paint.
 *
 * Notes for future-you:
 *  - Joyride v3 dropped the default export; we wrap the named
 *    `Joyride` so `next/dynamic` (which expects a default export)
 *    is happy.
 *  - Auto-start is debounced by a tiny `setTimeout` so the target
 *    elements have finished rendering before Joyride hunts them down.
 *    Without the delay, the first step occasionally renders at (0,0).
 *  - Joyride writes to the parent `<body>` via portals — the styles
 *    here only theme the popover, not the page. If a step ever lands
 *    behind a sticky header, raise `zIndex` rather than touching the
 *    target's stacking context.
 */
const Joyride = dynamic(
    () => import("react-joyride").then((m) => ({ default: m.Joyride })),
    { ssr: false },
)

interface PageTourProps {
    tourKey: TourKey
    /** Override auto-start. Defaults to true. The replay button
     *  always force-starts regardless of this flag. */
    autoStart?: boolean
}

export function PageTour({ tourKey, autoStart = true }: PageTourProps) {
    const tour = useTour()
    const def = TOURS[tourKey]
    const { loaded } = tour

    // Ref to the latest `tour.autoStart` so the effect below can
    // depend only on the meaningful primitives (`loaded`, `tourKey`,
    // `autoStart`). Without this we'd re-schedule the timeout on
    // every TourProvider state change (since `tour.autoStart` is a
    // useCallback that depends on `completed`, `activeTour`, …).
    const autoStartRef = useRef(tour.autoStart)
    useEffect(() => { autoStartRef.current = tour.autoStart }, [tour.autoStart])

    useEffect(() => {
        if (!autoStart) return
        // Wait for the provider's completed-tours fetch to land
        // before attempting auto-start. Without this gate the
        // setTimeout below would fire while `completed = {}` and
        // re-trigger a tour the user already finished. We re-run
        // the effect whenever `loaded` flips, so as soon as the
        // fetch lands the auto-start attempt is scheduled.
        if (!loaded) return
        // Defer one frame so the page's `data-tour` anchors are
        // already in the DOM. 350ms gives layout effects + framer
        // entry animations time to settle so the highlight box
        // doesn't snap to a moving target.
        const t = window.setTimeout(() => {
            autoStartRef.current(tourKey)
        }, 350)
        return () => window.clearTimeout(t)
    }, [tourKey, autoStart, loaded])

    if (!def) return null
    const running = tour.activeTour === tourKey

    return (
        <Joyride
            steps={def.steps}
            run={running}
            continuous
            scrollToFirstStep
            locale={{
                back: "Back",
                close: "Close",
                last: "Done",
                next: "Next",
                skip: "Skip tour",
            }}
            options={{
                // Back + Next + Skip. Next becomes "Done" on the last
                // step automatically (via locale.last).
                buttons: ["back", "primary", "skip"],
                // Stops a stray click outside the tooltip from closing
                // the tour — kitchen and POS surfaces get touched a
                // lot, so accidental closes are common.
                overlayClickAction: false,
                showProgress: true,
                primaryColor: "hsl(var(--primary))",
                textColor: "hsl(var(--foreground))",
                backgroundColor: "hsl(var(--popover))",
                arrowColor: "hsl(var(--popover))",
                overlayColor: "rgba(0,0,0,0.55)",
                zIndex: 10_000,
                // A little breathing room around the highlighted element
                // so the spotlight doesn't crop tight against text.
                spotlightPadding: 6,
            }}
            // Mobile-first sizing for the tooltip + buttons. The
            // crucial bit is `width: min(92vw, 380px)` — on a phone
            // (≤380px) the tooltip stays inside the viewport, on a
            // tablet/desktop it caps at 380px so it doesn't sprawl.
            // Without this Joyride's default was producing tooltips
            // that wrapped off-screen or clipped the Next button.
            // (`styles` is a top-level Joyride prop in v3, NOT inside
            // `options` — moved here after a TS error pointed it out.)
            styles={{
                tooltip: {
                    width: "min(92vw, 380px)",
                    maxWidth: "92vw",
                    borderRadius: 12,
                    fontSize: 14,
                    padding: 14,
                    boxShadow: "0 10px 40px -10px rgba(0,0,0,0.45)",
                    border: "1px solid hsl(var(--border))",
                },
                tooltipContainer: {
                    textAlign: "left",
                },
                tooltipTitle: {
                    fontSize: 15,
                    fontWeight: 700,
                    marginBottom: 6,
                },
                tooltipContent: {
                    padding: "8px 0 4px 0",
                    lineHeight: 1.45,
                },
                tooltipFooter: {
                    marginTop: 12,
                    // flex-wrap so a narrow phone never clips Next/Skip
                    // off the right edge — when the row overflows the
                    // buttons drop to the next line instead.
                    flexWrap: "wrap",
                    gap: 8,
                },
                buttonPrimary: {
                    borderRadius: 8,
                    padding: "8px 14px",
                    fontSize: 13,
                    fontWeight: 600,
                },
                buttonBack: {
                    color: "hsl(var(--muted-foreground))",
                    fontSize: 13,
                    marginRight: 6,
                },
                buttonSkip: {
                    color: "hsl(var(--muted-foreground))",
                    fontSize: 13,
                },
                buttonClose: {
                    // Keep the close (×) reachable but small so it
                    // doesn't dominate the title row.
                    width: 10,
                    height: 10,
                    top: 12,
                    right: 12,
                },
            }}
            onEvent={(data) => {
                // status='finished' = user clicked Done on the last step.
                // status='skipped'  = user hit Skip at any point.
                // Either way we record it so the tour doesn't
                // auto-fire again. Other statuses (running, waiting…)
                // we ignore — only the terminal ones mark the tour
                // complete.
                if (data.status === "finished" || data.status === "skipped") {
                    tour.finishTour(tourKey)
                    return
                }

                // Explicit scroll-to-target on step transitions.
                //
                // Why we override Joyride's built-in scroll:
                // The app shell renders `<main class="flex-1 overflow-auto">`
                // so the actual scroll container is `<main>`, not the
                // window. Joyride's `scrollparent` detection sometimes
                // misses this on first paint (especially when the
                // step's target was rendered inside a framer-motion
                // wrapper that animates from y=16 to y=0) and the
                // built-in scroll either targets the window or no-ops.
                // Calling `scrollIntoView` ourselves uses the
                // browser's native scrolling, which walks up the DOM
                // and scrolls whichever ancestor needs to move — so
                // it works the same in `<main overflow-auto>` as it
                // would in plain window-scroll.
                //
                // We hook the `tooltip` lifecycle because by then
                // Joyride has resolved the actual target element;
                // earlier lifecycles (init/ready) fire before that.
                if (data.lifecycle === "tooltip") {
                    const t = data.step?.target
                    // Don't scroll for the centered welcome step
                    // (target: 'body'). Only scroll when the step
                    // points at a specific selector.
                    if (typeof t === "string" && t !== "body") {
                        const el = document.querySelector(t)
                        if (el instanceof HTMLElement) {
                            el.scrollIntoView({ behavior: "smooth", block: "center" })
                        }
                    }
                }
            }}
        />
    )
}
