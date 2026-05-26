"use client"

import { HelpCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { TOURS, type TourKey, tourVisibleToRole } from "@/lib/tours/registry"

import { useReplayTour, useTour } from "./tour-provider"

/**
 * Tiny help-icon button that re-runs a specific tour. Drop it into a
 * `<PageHeader actions={…}>` slot:
 *
 *     <PageHeader
 *         title="Menu"
 *         actions={<><MyButtons /><TourReplayButton tourKey="menu" /></>}
 *     />
 *
 * Hidden automatically if the current user's role isn't on the tour's
 * `roles` allow-list, so a KITCHEN user doesn't see a "menu tour"
 * button they aren't allowed to run.
 *
 * Tooltip text comes from the native `title` attribute — the codebase
 * doesn't currently ship a shared `<Tooltip>` primitive, and pulling
 * one in just for this would be overkill.
 */
export function TourReplayButton({ tourKey }: { tourKey: TourKey }) {
    const { role } = useTour()
    const replay = useReplayTour()
    const def = TOURS[tourKey]
    if (!def || !tourVisibleToRole(def, role)) return null
    return (
        <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Replay ${def.label}`}
            title={def.label}
            onClick={() => replay(tourKey)}
        >
            <HelpCircle className="h-4 w-4" />
        </Button>
    )
}
