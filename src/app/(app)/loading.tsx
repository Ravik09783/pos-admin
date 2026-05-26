/**
 * App-wide loading boundary.
 *
 * Next.js renders this component the moment a soft-navigation into any
 * `(app)/*` route begins — BEFORE the route's own server-side data
 * fetches resolve, and before the page renders. That collapses the
 * "old page is frozen until the new one is ready" feel users complain
 * about into "old page → instant skeleton → new page", which reads
 * dramatically faster even when nothing's actually changed about how
 * long the data takes to fetch.
 *
 * The skeleton is intentionally bland — a generic page-header
 * placeholder + a grid of card placeholders. It doesn't try to match
 * any one route's exact shape; that would either require per-route
 * loading files (more code) or the skeleton would feel "wrong" on
 * half the pages. A neutral skeleton is the safer default.
 *
 * Server component. Zero data access. Pure CSS.
 */
export default function AppLoading() {
    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-6 md:space-y-8 animate-pulse">
            {/* Header placeholder — kicker + title + description */}
            <div className="space-y-3">
                <div className="h-4 w-24 rounded bg-muted/50" />
                <div className="h-9 w-1/2 max-w-md rounded bg-muted/60" />
                <div className="h-4 w-2/3 max-w-xl rounded bg-muted/40" />
            </div>

            {/* KPI strip placeholder — 4 tiles */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="rounded-2xl border border-border/40 bg-card/40 p-4 md:p-5 space-y-2">
                        <div className="h-3 w-20 rounded bg-muted/50" />
                        <div className="h-7 w-28 rounded bg-muted/60" />
                    </div>
                ))}
            </div>

            {/* Content placeholder — a wide card */}
            <div className="rounded-2xl border border-border/40 bg-card/40 p-5 md:p-6 space-y-3">
                <div className="h-5 w-40 rounded bg-muted/50" />
                <div className="h-4 w-full rounded bg-muted/30" />
                <div className="h-4 w-4/5 rounded bg-muted/30" />
                <div className="h-4 w-2/3 rounded bg-muted/30" />
            </div>

            {/* Secondary content placeholder */}
            <div className="grid md:grid-cols-2 gap-4">
                {[0, 1].map((i) => (
                    <div key={i} className="rounded-2xl border border-border/40 bg-card/40 p-5 space-y-3">
                        <div className="h-5 w-32 rounded bg-muted/50" />
                        <div className="h-24 rounded bg-muted/30" />
                    </div>
                ))}
            </div>
        </div>
    )
}
