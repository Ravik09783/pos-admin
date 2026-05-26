import type { Meta, StoryObj } from "@storybook/react-vite"
import { CheckCircle2, Download, FileSpreadsheet, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * Screen-level twin of the CA Export page (`src/app/(app)/ca-export/page.tsx`).
 * The real page builds an Excel bundle (GSTR-1 worksheet, GSTR-3B
 * worksheet, P&L, Balance Sheet) plus a Tally-importable XML and the
 * GST portal JSON, then offers a single ZIP download. This story
 * exposes the visual layout (FY picker, sheet previews, download CTA)
 * across three states: idle, generating, ready.
 */
type ExportState = "idle" | "generating" | "ready"

interface CaExportViewProps {
    fy: string
    state: ExportState
    /** Counts that show on the bundle preview tiles. */
    invoiceCount: number
    b2bCount: number
    interStateCount: number
}

function CaExportView({ fy, state, invoiceCount, b2bCount, interStateCount }: CaExportViewProps) {
    return (
        <div className="min-h-[800px] w-full bg-background text-foreground rounded-md border border-border/40 p-5 space-y-5 max-w-4xl mx-auto">
            <div className="flex items-center gap-3 flex-wrap">
                <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">India</div>
                    <h1 className="text-xl font-bold">CA Export</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        One zip with everything your accountant needs: GSTR-1, GSTR-3B, P&amp;L, Balance Sheet, Tally XML.
                    </p>
                </div>
            </div>

            {/* FY picker */}
            <Card>
                <CardContent className="p-4 flex items-center gap-3 flex-wrap">
                    <div>
                        <div className="text-xs uppercase tracking-wider text-muted-foreground">Financial year</div>
                        <div className="text-base font-semibold mt-0.5">FY {fy}</div>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                        <Button variant="outline" size="sm">Change FY</Button>
                        <Button variant="outline" size="sm">Filter branches</Button>
                    </div>
                </CardContent>
            </Card>

            {/* Bundle preview tiles */}
            <div className="grid md:grid-cols-2 gap-3">
                <SheetTile name="GSTR-1 (working sheet)" subtitle={`${invoiceCount} invoices · ${b2bCount} B2B · ${interStateCount} inter-state`} status="ready" />
                <SheetTile name="GSTR-3B (summary)" subtitle="One sheet per month · 12 months" status="ready" />
                <SheetTile name="Profit & Loss" subtitle="Revenue · COGS · Operating expenses" status="ready" />
                <SheetTile name="Balance Sheet" subtitle="Assets · Liabilities · Equity" status={state === "ready" ? "ready" : "queued"} />
                <SheetTile name="Tally XML" subtitle="Importable into Tally Prime / ERP" status={state === "ready" ? "ready" : "queued"} />
                <SheetTile name="GST portal JSON" subtitle="Upload directly at gst.gov.in" status={state === "ready" ? "ready" : "queued"} />
            </div>

            {/* Download CTA */}
            <Card className="border-primary/40 bg-primary/[0.04]">
                <CardContent className="p-5 flex items-center gap-4 flex-wrap">
                    <span className="grid place-items-center h-12 w-12 rounded-xl bg-gradient-to-br from-primary/30 to-[hsl(var(--neon-magenta)/0.2)] shrink-0">
                        <FileSpreadsheet className="h-6 w-6 text-primary" />
                    </span>
                    <div className="flex-1 min-w-0">
                        {state === "idle" && (
                            <>
                                <div className="font-semibold">Ready to bundle</div>
                                <p className="text-sm text-muted-foreground">Tap below to generate the FY {fy} zip.</p>
                            </>
                        )}
                        {state === "generating" && (
                            <>
                                <div className="font-semibold">Bundling…</div>
                                <p className="text-sm text-muted-foreground">Compiling sheets. This usually takes 10-30 seconds.</p>
                            </>
                        )}
                        {state === "ready" && (
                            <>
                                <div className="font-semibold flex items-center gap-1.5">
                                    <CheckCircle2 className="h-4 w-4 text-success" /> Bundle ready
                                </div>
                                <p className="text-sm text-muted-foreground">restopos-ca-export-{fy}.zip · 1.8 MB</p>
                            </>
                        )}
                    </div>
                    {state === "ready" ? (
                        <Button variant="neon" size="lg"><Download className="h-4 w-4" /> Download zip</Button>
                    ) : (
                        <Button variant="neon" size="lg" disabled={state === "generating"}>
                            {state === "generating" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                            {state === "generating" ? "Bundling…" : "Generate bundle"}
                        </Button>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

function SheetTile({ name, subtitle, status }: { name: string; subtitle: string; status: "ready" | "queued" }) {
    return (
        <Card className={cn(status === "queued" && "opacity-50")}>
            <CardContent className="p-4 flex items-start gap-3">
                <FileSpreadsheet className={cn("h-5 w-5 mt-0.5 shrink-0", status === "ready" ? "text-success" : "text-muted-foreground")} />
                <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{name}</div>
                    <div className="text-[11px] text-muted-foreground">{subtitle}</div>
                </div>
                <Badge variant={status === "ready" ? "success" : "secondary"} className="text-[10px]">
                    {status === "ready" ? "Ready" : "Queued"}
                </Badge>
            </CardContent>
        </Card>
    )
}

const meta: Meta<typeof CaExportView> = {
    title: "Screens/CA Export",
    component: CaExportView,
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "India-only: one-click monthly/yearly export bundle for the restaurant's CA. Composes a single ZIP with GSTR-1 working sheet, GSTR-3B summary, P&L, Balance Sheet, Tally-importable XML and the GST portal JSON. Real page builds the bundle in the browser from the bills + payments tables (no server round-trip) using `src/lib/ca-export/excel.ts` and `bundle.ts`. The page is gated to India tenants — non-India OWNERs never see it (they don't have GSTR filings).",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof CaExportView>

export const Idle: Story = {
    args: { fy: "2026-27", state: "idle", invoiceCount: 412, b2bCount: 36, interStateCount: 18 },
}

export const Generating: Story = {
    args: { fy: "2026-27", state: "generating", invoiceCount: 412, b2bCount: 36, interStateCount: 18 },
}

export const Ready: Story = {
    args: { fy: "2026-27", state: "ready", invoiceCount: 412, b2bCount: 36, interStateCount: 18 },
}
