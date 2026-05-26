/**
 * POS route loading state. The POS is the busiest screen in the app
 * and the one users hammer most — needs a tailored skeleton that
 * roughly matches the actual layout (filters strip + menu grid +
 * cart panel on the right) so the transition feels seamless.
 *
 * The skeleton tracks the real card geometry: same grid breakpoints
 * (2 / 3 / 4 / 5 / 6 cols), same image aspect (3:2), and same body
 * padding as `renderItemCard` in page.tsx. When the data lands the
 * tile sizes don't reflow.
 */
export default function PosLoading() {
    return (
        <div className="h-full flex flex-col animate-pulse">
            {/* Top filters strip (order type tabs + table + source) */}
            <div className="border-b border-border/40 px-4 py-3 flex items-center gap-2">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-8 w-16 rounded-md bg-muted/40" />
                ))}
                <div className="h-8 w-32 rounded-md bg-muted/40 ml-2" />
                <div className="h-8 w-36 rounded-md bg-muted/40 ml-auto" />
            </div>

            {/* Category chips */}
            <div className="border-b border-border/40 px-4 py-2 flex items-center gap-2">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="h-7 w-20 rounded-md bg-muted/40" />
                ))}
            </div>

            <div className="flex-1 grid lg:grid-cols-[1fr_360px] min-h-0">
                {/* Menu grid — matches `ITEM_GRID_CLS` + the new dense
                 *  3:2 image aspect from the actual card. 18 placeholders
                 *  fills 3 rows at the densest breakpoint so the user
                 *  doesn't see a sparsely-shimmering grid on wide screens. */}
                <div className="overflow-auto p-4">
                    <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                        {Array.from({ length: 18 }).map((_, i) => (
                            <div key={i} className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
                                {/* Image area — 3:2 to mirror the real card. */}
                                <div className="aspect-[3/2] w-full bg-muted/40" />
                                {/* Body — name + price/button row at same
                                  * vertical rhythm as the live card. */}
                                <div className="p-2 space-y-1.5">
                                    <div className="h-3 w-3/4 rounded bg-muted/50" />
                                    <div className="flex items-end justify-between gap-2 pt-0.5">
                                        <div className="space-y-1">
                                            <div className="h-3.5 w-12 rounded bg-muted/60" />
                                            <div className="h-2 w-8 rounded bg-muted/30" />
                                        </div>
                                        <div className="h-8 w-8 rounded-lg bg-muted/50" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Cart panel placeholder */}
                <aside className="hidden lg:flex flex-col border-l border-border/40 p-4 gap-3">
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <div className="h-5 w-16 rounded bg-muted/60" />
                            <div className="h-3 w-12 rounded bg-muted/40" />
                        </div>
                        <div className="h-8 w-14 rounded bg-muted/40" />
                    </div>
                    <div className="h-10 rounded-md bg-muted/30" />
                    <div className="flex-1 space-y-2">
                        {[0, 1, 2].map((i) => (
                            <div key={i} className="h-12 rounded-md bg-muted/30" />
                        ))}
                    </div>
                    <div className="h-12 rounded-lg bg-muted/40" />
                </aside>
            </div>
        </div>
    )
}
