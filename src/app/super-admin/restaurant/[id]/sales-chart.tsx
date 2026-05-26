"use client"

/**
 * Tiny dependency-free bar chart. Renders an SVG with one bar per point.
 *
 * Why not recharts / chart.js: the super-admin detail page is the only
 * place we need a chart in the app today, and pulling in 30-50 kB of
 * charting library for two sparklines isn't worth the bundle cost. The
 * shape is intentionally simple — bars + a single horizontal grid line
 * at the max, with hover tooltips for the data values.
 */
import { useMemo, useState } from "react"

export interface SalesPoint {
    /** Display label (date or month). */
    label: string
    /** Bar value. */
    revenue: number
    /** Secondary metric shown in tooltip. */
    bill_count: number
}

export function SalesChart({
    points,
    currency,
    height = 160,
    barColor = "hsl(var(--primary))",
}: {
    points: SalesPoint[]
    currency: string
    height?: number
    barColor?: string
}) {
    const [hover, setHover] = useState<number | null>(null)

    const max = useMemo(() => Math.max(1, ...points.map((p) => p.revenue)), [points])
    const formatter = useMemo(() => {
        const locale = currency === "INR" ? "en-IN" : "en-US"
        return new Intl.NumberFormat(locale, {
            style: "currency", currency, maximumFractionDigits: 0,
        })
    }, [currency])

    if (points.length === 0) {
        return (
            <div className="grid place-items-center text-xs text-muted-foreground h-32 border border-dashed border-border/60 rounded-md">
                No data in this window
            </div>
        )
    }

    // Chart geometry. We use a 0-100 viewBox horizontal scale and `height`
    // for the vertical axis so the SVG scales fluidly with the container.
    const W = 100
    const PAD_X = 1
    const PAD_TOP = 8
    const PAD_BOTTOM = 0
    const usableH = height - PAD_TOP - PAD_BOTTOM
    const slotW = (W - PAD_X * 2) / points.length
    const barW = Math.max(0.5, slotW * 0.7)

    return (
        <div className="relative">
            <svg
                viewBox={`0 0 ${W} ${height}`}
                preserveAspectRatio="none"
                className="w-full"
                style={{ height }}
                onMouseLeave={() => setHover(null)}
            >
                {/* Max-value grid line */}
                <line
                    x1={0} x2={W}
                    y1={PAD_TOP} y2={PAD_TOP}
                    stroke="currentColor"
                    strokeWidth={0.2}
                    className="text-muted-foreground/30"
                />
                {points.map((p, i) => {
                    const x = PAD_X + i * slotW + (slotW - barW) / 2
                    const h = max > 0 ? (p.revenue / max) * usableH : 0
                    const y = PAD_TOP + (usableH - h)
                    const active = hover === i
                    return (
                        <g key={i} onMouseEnter={() => setHover(i)}>
                            {/* Full-height invisible hover target so very-short
                              * bars (or zero-value days) still register. */}
                            <rect
                                x={PAD_X + i * slotW}
                                y={0}
                                width={slotW}
                                height={height}
                                fill="transparent"
                            />
                            <rect
                                x={x}
                                y={y}
                                width={barW}
                                height={h}
                                fill={barColor}
                                opacity={active ? 1 : 0.7}
                                rx={0.3}
                            />
                        </g>
                    )
                })}
            </svg>

            {/* Tooltip — pinned above the chart, follows the hovered bar's
              * horizontal position via inline style. Renders outside the
              * SVG so we keep the type-rendering of the host stylesheet. */}
            {hover !== null && (
                <div
                    className="absolute -top-1 -translate-y-full pointer-events-none rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] whitespace-nowrap shadow-md z-10"
                    style={{ left: `calc(${PAD_X + hover * slotW + slotW / 2}% - 0px)`, transform: "translate(-50%, -100%)" }}
                >
                    <div className="font-mono">{points[hover]!.label}</div>
                    <div className="font-semibold">{formatter.format(points[hover]!.revenue)}</div>
                    <div className="text-muted-foreground">{points[hover]!.bill_count} bill{points[hover]!.bill_count === 1 ? "" : "s"}</div>
                </div>
            )}

            {/* Axis labels — show first / mid / last so we don't crowd the
              * 30-bar chart. The user can hover for exact values. */}
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono mt-1 px-0.5">
                <span>{points[0]?.label}</span>
                {points.length > 2 && <span>{points[Math.floor(points.length / 2)]?.label}</span>}
                <span>{points[points.length - 1]?.label}</span>
            </div>
        </div>
    )
}
