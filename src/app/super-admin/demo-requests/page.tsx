import Link from "next/link"
import { ArrowLeft, MailOpen } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { DemoRequestsTable, type DemoRequestRow } from "./demo-requests-table"

/**
 * Super-admin "Demo requests" — every lead captured by the public
 * `/demo` form. Auth is already enforced by `super-admin/layout.tsx`;
 * the service-role client bypasses tenant scoping (super-admins have no
 * tenant). Triage state and free-text notes update through the
 * `/api/super-admin/demo-requests/[id]` PATCH endpoint.
 */
export default async function SuperAdminDemoRequestsPage() {
    const service = createServiceRoleClient()
    const { data, error } = await service
        .from("demo_requests")
        .select("id, name, email, phone, city, restaurant, message, source, status, notes, user_agent, ip_address, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(500)

    const tableUnavailable = !!error && /demo_requests|does not exist/i.test(error.message)
    const rows = ((data ?? []) as unknown as DemoRequestRow[])

    const counts = {
        NEW: rows.filter((r) => r.status === "NEW").length,
        CONTACTED: rows.filter((r) => r.status === "CONTACTED").length,
        CONVERTED: rows.filter((r) => r.status === "CONVERTED").length,
        DROPPED: rows.filter((r) => r.status === "DROPPED").length,
    }

    return (
        <div className="container mx-auto px-4 py-8 space-y-6">
            <div>
                <Link
                    href="/super-admin"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ArrowLeft className="h-3 w-3" /> Back to console
                </Link>
                <h1 className="text-2xl font-bold tracking-tight mt-2 flex items-center gap-2">
                    <MailOpen className="h-6 w-6 text-primary" /> Demo requests
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Every lead from the public &ldquo;Schedule a free demo&rdquo; form on{" "}
                    <code className="text-xs">/demo</code>. Update the status as you work each lead and capture call notes.
                </p>
            </div>

            {tableUnavailable ? (
                <Card className="border-warning/40 bg-warning/[0.04]">
                    <CardContent className="py-4 text-sm text-muted-foreground">
                        Demo requests aren&apos;t enabled yet — apply migration 46{" "}
                        (<code className="text-xs">46_demo_requests.sql</code>, or re-apply{" "}
                        <code className="text-xs">combined_schema.sql</code>).
                    </CardContent>
                </Card>
            ) : error ? (
                <Card className="border-destructive/40 bg-destructive/[0.04]">
                    <CardContent className="py-4 text-sm">
                        <div className="font-semibold mb-1">Couldn&apos;t load demo requests.</div>
                        <p className="text-muted-foreground">{error.message}</p>
                    </CardContent>
                </Card>
            ) : (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <StatusCard label="New" value={counts.NEW} tone="primary" />
                        <StatusCard label="Contacted" value={counts.CONTACTED} tone="warning" />
                        <StatusCard label="Converted" value={counts.CONVERTED} tone="success" />
                        <StatusCard label="Dropped" value={counts.DROPPED} tone="muted" />
                    </div>

                    {rows.length === 0 ? (
                        <Card>
                            <CardContent className="py-8 text-center text-sm text-muted-foreground">
                                No demo requests yet.
                            </CardContent>
                        </Card>
                    ) : (
                        <DemoRequestsTable initial={rows} />
                    )}
                </>
            )}
        </div>
    )
}

function StatusCard({ label, value, tone }: { label: string; value: number; tone: "primary" | "warning" | "success" | "muted" }) {
    const toneClass = {
        primary: "border-primary/40 bg-primary/[0.06]",
        warning: "border-warning/40 bg-warning/[0.06]",
        success: "border-success/40 bg-success/[0.06]",
        muted: "border-border/50 bg-card/40",
    }[tone]
    return (
        <Card className={toneClass}>
            <CardContent className="py-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
            </CardContent>
        </Card>
    )
}
