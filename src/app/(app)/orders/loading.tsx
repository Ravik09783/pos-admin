/**
 * Sales (orders) route loading state. Skeleton matches the actual
 * page shape — filters row + status chips + a table of rows — so the
 * transition from any other page into Sales feels continuous instead
 * of flashing a generic shell.
 */
export default function OrdersLoading() {
    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-4 animate-pulse">
            {/* Page header */}
            <div className="space-y-3">
                <div className="h-4 w-32 rounded bg-muted/50" />
                <div className="h-8 w-64 rounded bg-muted/60" />
                <div className="h-4 w-80 rounded bg-muted/40" />
            </div>

            {/* Filters card */}
            <div className="rounded-2xl border border-border/40 bg-card/40 p-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                    <div className="h-9 w-64 rounded bg-muted/40" />
                    <div className="h-9 w-40 rounded bg-muted/40" />
                    <div className="h-9 w-36 rounded bg-muted/40" />
                    <div className="h-9 w-32 rounded bg-muted/40" />
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                        <div key={i} className="h-7 w-20 rounded-md bg-muted/40" />
                    ))}
                </div>
            </div>

            {/* Results table */}
            <div className="rounded-2xl border border-border/40 bg-card/40">
                <div className="px-6 py-3 flex items-center justify-between">
                    <div className="h-5 w-20 rounded bg-muted/50" />
                    <div className="h-3 w-24 rounded bg-muted/40" />
                </div>
                <div className="px-6 pb-4 space-y-2">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="h-12 rounded-md bg-muted/30" />
                    ))}
                </div>
            </div>
        </div>
    )
}
