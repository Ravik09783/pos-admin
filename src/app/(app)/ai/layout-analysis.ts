/**
 * Word-level layout analyzer for OCR output.
 *
 * The line-bbox approach worked on menus with a clean global gutter
 * but broke down on the real-world cases the brief calls out:
 *
 *   • column gutters that don't sit at any fixed % of the width
 *     (some menus are 55/45, others 60/40, others 33/33/33)
 *   • menus where the column count VARIES per section (1-col banner
 *     header, 2-col body, 3-col bottom)
 *   • menus with embedded dish photos breaking column flow
 *   • menus with a narrow Half/Full price column embedded inside an
 *     item column
 *
 * The fix: forget Tesseract's line groupings. Work from word-level
 * bboxes instead and do our own layout:
 *
 *   1. Filter low-confidence words (OCR garbage).
 *   2. Cluster words into VISUAL LINES by y-position with a tolerance
 *      keyed off the median character height.
 *   3. Within each visual line, sort by x and detect COLUMN BREAKS
 *      wherever the gap between consecutive words far exceeds the
 *      typical inter-word spacing.
 *   4. The output is a flat list of SEGMENTS — each segment is the
 *      text of one row × one column.
 *   5. Globally bucket all segments by x-center to figure out the
 *      column structure (peaks in the x-center histogram).
 *   6. Assign each segment to its nearest column peak.
 *   7. Within each column, sort segments top-to-bottom.
 *   8. Emit column-by-column.
 *
 * This handles:
 *   • Variable column widths ✓ (gap threshold is per-line + relative)
 *   • Multi-column with images interspersed ✓ (no words → no segments)
 *   • Different column counts per section ✓ (each segment finds its
 *     nearest peak — uniformly two-column rows go to two peaks,
 *     full-width rows go to whichever side they lean)
 *   • Half/Full price columns ✓ (caught downstream by the parser's
 *     trailing-prices logic)
 *
 * Pure functions, no DOM. Easy to unit-test if we ever want to.
 */

export interface OcrWord {
    text: string
    bbox: { x0: number; y0: number; x1: number; y1: number }
    /** Tesseract returns confidence 0-100. */
    confidence: number
}

interface Segment {
    text: string
    x0: number
    y0: number
    x1: number
    y1: number
    /** Center x — used both for column clustering and the final
     *  left-to-right sort. */
    cx: number
}

const MIN_CONFIDENCE = 30
const LOW_CONFIDENCE_FALLBACK = 10
/** Y-tolerance for "same visual line" is this fraction of the median
 *  character height. 0.6 is forgiving enough for descenders and
 *  superscript fragments without merging adjacent lines. */
const LINE_Y_TOLERANCE_RATIO = 0.6
/** A horizontal gap that's this multiple of the median inter-word
 *  gap on the same line is treated as a column break. 3× is the
 *  smallest that's never wrong on the menus I've tested; 5× was too
 *  conservative (it missed narrow gutters). */
const COLUMN_GAP_MULTIPLIER = 3
/** Floor for the column-gap threshold relative to the line's char
 *  height — guards against absurdly small thresholds on lines with
 *  almost no inter-word spacing (e.g. one-word headers + one price). */
const COLUMN_GAP_MIN_HEIGHT_RATIO = 1.5
/** Two segment X-centers within this fraction of image width are
 *  considered the SAME column. 4% lands well — closer and we split
 *  legit columns, looser and a multi-column menu collapses into
 *  one. */
const COLUMN_CLUSTER_TOLERANCE_RATIO = 0.04

function median(xs: number[]): number {
    if (xs.length === 0) return 0
    const sorted = [...xs].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0
        ? (sorted[mid - 1]! + sorted[mid]!) / 2
        : sorted[mid]!
}

/** Group sorted X-centers into clusters separated by at least
 *  `minDistance`. Each cluster represents one column. */
function clusterByX(centers: number[], minDistance: number): { center: number; min: number; max: number }[] {
    if (centers.length === 0) return []
    const sorted = [...centers].sort((a, b) => a - b)
    const clusters: number[][] = [[sorted[0]!]]
    for (let i = 1; i < sorted.length; i++) {
        const v = sorted[i]!
        const last = clusters[clusters.length - 1]!
        if (v - last[last.length - 1]! < minDistance) {
            last.push(v)
        } else {
            clusters.push([v])
        }
    }
    return clusters.map((c) => ({
        center: c.reduce((a, b) => a + b, 0) / c.length,
        min: c[0]!,
        max: c[c.length - 1]!,
    }))
}

/**
 * Main entry. Hand it the words Tesseract returned (walked down
 * from data.blocks → paragraphs → lines → words) and it gives you
 * back text in column-by-column reading order, plus the column
 * count it detected so the UI can confirm.
 */
export function analyzeAndReflow(rawWords: OcrWord[]): {
    text: string
    columnCount: number
} {
    // 1. Confidence filter — try the strict threshold first; if it
    //    leaves us with too little, fall back to a permissive one.
    //    OCR-garbage images otherwise emit nothing.
    let words = rawWords.filter((w) => w.confidence >= MIN_CONFIDENCE && w.text.trim().length > 0)
    if (words.length < Math.max(10, rawWords.length * 0.3)) {
        words = rawWords.filter((w) => w.confidence >= LOW_CONFIDENCE_FALLBACK && w.text.trim().length > 0)
    }
    if (words.length === 0) return { text: "", columnCount: 0 }

    // 2. Visual-line clustering by y. Sort by y-center first.
    const yCenter = (w: OcrWord) => (w.bbox.y0 + w.bbox.y1) / 2
    const charHeight = median(words.map((w) => w.bbox.y1 - w.bbox.y0))
    const yTolerance = Math.max(4, charHeight * LINE_Y_TOLERANCE_RATIO)

    const sortedY = [...words].sort((a, b) => yCenter(a) - yCenter(b))
    const lines: OcrWord[][] = []
    for (const w of sortedY) {
        const wy = yCenter(w)
        // Greedy: try to append to the most recent line whose center
        // is within tolerance.
        let placed = false
        // Only check the last few lines — keeps the loop cheap on
        // long menus.
        for (let i = Math.max(0, lines.length - 4); i < lines.length; i++) {
            const ln = lines[i]!
            const lc = ln.reduce((s, x) => s + yCenter(x), 0) / ln.length
            if (Math.abs(wy - lc) <= yTolerance) {
                ln.push(w)
                placed = true
                break
            }
        }
        if (!placed) lines.push([w])
    }

    // 3. Per-line: sort by x, detect column-break gaps, split into segments.
    const allSegments: Segment[] = []
    for (const line of lines) {
        line.sort((a, b) => a.bbox.x0 - b.bbox.x0)
        // Compute gaps between consecutive words.
        const gaps: number[] = []
        for (let i = 1; i < line.length; i++) {
            gaps.push(line[i]!.bbox.x0 - line[i - 1]!.bbox.x1)
        }
        const medianGap = median(gaps.filter((g) => g >= 0))
        const minGapForBreak = Math.max(
            medianGap * COLUMN_GAP_MULTIPLIER,
            charHeight * COLUMN_GAP_MIN_HEIGHT_RATIO,
        )

        let bucket: OcrWord[] = [line[0]!]
        const lineBuckets: OcrWord[][] = []
        for (let i = 1; i < line.length; i++) {
            const gap = line[i]!.bbox.x0 - line[i - 1]!.bbox.x1
            if (gap > minGapForBreak) {
                lineBuckets.push(bucket)
                bucket = [line[i]!]
            } else {
                bucket.push(line[i]!)
            }
        }
        lineBuckets.push(bucket)

        for (const b of lineBuckets) {
            const text = b.map((w) => w.text).join(" ").replace(/\s+/g, " ").trim()
            if (!text) continue
            const x0 = Math.min(...b.map((w) => w.bbox.x0))
            const x1 = Math.max(...b.map((w) => w.bbox.x1))
            const y0 = Math.min(...b.map((w) => w.bbox.y0))
            const y1 = Math.max(...b.map((w) => w.bbox.y1))
            allSegments.push({ text, x0, x1, y0, y1, cx: (x0 + x1) / 2 })
        }
    }

    if (allSegments.length === 0) return { text: "", columnCount: 0 }

    // 4. Global column clustering by segment x-center.
    const imageWidth = Math.max(...allSegments.map((s) => s.x1))
    const clusterTolerance = imageWidth * COLUMN_CLUSTER_TOLERANCE_RATIO
    const clusters = clusterByX(allSegments.map((s) => s.cx), clusterTolerance)

    // 5. Coalesce overlapping or near-touching clusters into final
    //    columns. Two clusters merge when their x-ranges overlap by
    //    more than half of the smaller cluster's width.
    type Col = { cx: number; min: number; max: number; segs: Segment[] }
    const columns: Col[] = clusters.map((c) => ({ cx: c.center, min: c.min, max: c.max, segs: [] }))
    // Sort left-to-right and merge overlaps.
    columns.sort((a, b) => a.cx - b.cx)
    for (let i = 0; i < columns.length - 1; i++) {
        const a = columns[i]!
        const b = columns[i + 1]!
        if (b.min - a.max < clusterTolerance) {
            // Merge b into a.
            a.max = Math.max(a.max, b.max)
            a.min = Math.min(a.min, b.min)
            a.cx = (a.min + a.max) / 2
            columns.splice(i + 1, 1)
            i--
        }
    }

    // 6. Assign each segment to its nearest column.
    for (const seg of allSegments) {
        let best = 0
        let bestDist = Math.abs(seg.cx - columns[0]!.cx)
        for (let i = 1; i < columns.length; i++) {
            const d = Math.abs(seg.cx - columns[i]!.cx)
            if (d < bestDist) { bestDist = d; best = i }
        }
        columns[best]!.segs.push(seg)
    }

    // 7. Within each column, sort top-to-bottom.
    for (const col of columns) {
        col.segs.sort((a, b) => a.y0 - b.y0)
    }

    // 8. Emit column-by-column. Blank lines between columns so the
    //    parser sees a clean break and a category that opens column 2
    //    doesn't accidentally attach to the end of column 1.
    const parts: string[] = []
    for (const col of columns) {
        if (col.segs.length === 0) continue
        parts.push(col.segs.map((s) => s.text).join("\n"))
    }
    return { text: parts.join("\n\n"), columnCount: columns.length }
}
