"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
    ArrowRight, Edit3, Plus, Search, Trash2, UserCog,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn, formatDate } from "@/lib/utils"

export type AuditAction =
    | "TEMPLATE_CREATED"
    | "TEMPLATE_UPDATED"
    | "TEMPLATE_DELETED"
    | "USER_TEMPLATE_ASSIGNED"

export interface HistoryRow {
    id: string
    tenant_id: string
    actor_user_id: string | null
    actor_email: string | null
    action: AuditAction
    template_id: string | null
    template_name: string | null
    target_user_id: string | null
    target_user_email: string | null
    diff: AuditDiff | null
    created_at: string
}

interface AuditDiff {
    base_role?: string | { from: string; to: string }
    permissions?: string[]
    permissions_added?: string[]
    permissions_removed?: string[]
    permissions_snapshot?: string[]
    name?: { from: string; to: string }
    description_changed?: boolean
    is_system?: boolean
    from_template_id?: string | null
    from_template_name?: string | null
    to_template_id?: string | null
    to_template_name?: string | null
}

type Filter = "ALL" | AuditAction

const FILTERS: { id: Filter; label: string }[] = [
    { id: "ALL",                    label: "All" },
    { id: "TEMPLATE_CREATED",       label: "Created" },
    { id: "TEMPLATE_UPDATED",       label: "Edited" },
    { id: "TEMPLATE_DELETED",       label: "Deleted" },
    { id: "USER_TEMPLATE_ASSIGNED", label: "Assigned" },
]

export function HistoryFilters({
    rows, permLabels,
}: {
    rows: HistoryRow[]
    permLabels: Record<string, string>
}) {
    const [filter, setFilter] = useState<Filter>("ALL")
    const [q, setQ] = useState("")

    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase()
        return rows.filter((r) => {
            if (filter !== "ALL" && r.action !== filter) return false
            if (!needle) return true
            return (
                (r.template_name ?? "").toLowerCase().includes(needle) ||
                (r.actor_email ?? "").toLowerCase().includes(needle) ||
                (r.target_user_email ?? "").toLowerCase().includes(needle)
            )
        })
    }, [rows, q, filter])

    return (
        <div className="space-y-3">
            <Card>
                <CardContent className="p-3 flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[220px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Filter by template, actor, or affected user…"
                            className="pl-9"
                        />
                    </div>
                    <div className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-card/40 p-0.5">
                        {FILTERS.map((opt) => (
                            <button
                                key={opt.id}
                                onClick={() => setFilter(opt.id)}
                                className={cn(
                                    "px-3 py-1.5 text-xs font-medium rounded transition-colors",
                                    filter === opt.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {filtered.length === 0 ? (
                <Card>
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">
                        {rows.length === 0
                            ? "No template changes have been recorded yet."
                            : "Nothing matches the current filter."}
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-2">
                    {filtered.map((row) => (
                        <HistoryItem key={row.id} row={row} permLabels={permLabels} />
                    ))}
                </div>
            )}
        </div>
    )
}

function HistoryItem({ row, permLabels }: { row: HistoryRow; permLabels: Record<string, string> }) {
    return (
        <Card>
            <CardContent className="p-4 flex items-start gap-3">
                <ActionIcon action={row.action} />
                <div className="min-w-0 flex-1">
                    <ActionSummary row={row} permLabels={permLabels} />
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>
                            by{" "}
                            <strong className="text-foreground">{row.actor_email ?? "system"}</strong>
                        </span>
                        <span>·</span>
                        <span>{formatDate(row.created_at, { dateStyle: "medium", timeStyle: "short" })}</span>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

function ActionIcon({ action }: { action: AuditAction }) {
    const cfg = {
        TEMPLATE_CREATED:       { Icon: Plus,   className: "bg-success/15 text-success" },
        TEMPLATE_UPDATED:       { Icon: Edit3,  className: "bg-primary/15 text-primary" },
        TEMPLATE_DELETED:       { Icon: Trash2, className: "bg-destructive/15 text-destructive" },
        USER_TEMPLATE_ASSIGNED: { Icon: UserCog,className: "bg-warning/15 text-warning" },
    }[action]
    return (
        <span className={cn("grid place-items-center h-9 w-9 rounded-lg shrink-0", cfg.className)}>
            <cfg.Icon className="h-4 w-4" />
        </span>
    )
}

function ActionSummary({ row, permLabels }: { row: HistoryRow; permLabels: Record<string, string> }) {
    const tName = row.template_name ?? "(deleted template)"
    const diff = row.diff ?? {}

    if (row.action === "TEMPLATE_CREATED") {
        const initialCount = (diff.permissions ?? []).length
        return (
            <div className="space-y-1">
                <div className="text-sm">
                    Created template{" "}
                    <TemplateLink id={row.template_id} name={tName} />
                    {" "}with {initialCount} permission{initialCount === 1 ? "" : "s"}.
                </div>
            </div>
        )
    }

    if (row.action === "TEMPLATE_DELETED") {
        return (
            <div className="space-y-1">
                <div className="text-sm">
                    Deleted template <strong>{tName}</strong>.
                </div>
                {(diff.permissions_snapshot ?? []).length > 0 && (
                    <div className="text-[11px] text-muted-foreground">
                        Had {diff.permissions_snapshot!.length} permission{diff.permissions_snapshot!.length === 1 ? "" : "s"} at the time.
                    </div>
                )}
            </div>
        )
    }

    if (row.action === "USER_TEMPLATE_ASSIGNED") {
        const fromName = diff.from_template_name ?? null
        const toName = diff.to_template_name ?? tName
        return (
            <div className="space-y-1">
                <div className="text-sm">
                    Assigned{" "}
                    <strong>{row.target_user_email ?? "(deleted user)"}</strong>
                    {" "}to{" "}
                    <TemplateLink id={row.template_id} name={toName} />
                    {fromName && (
                        <>
                            {" "}<span className="text-muted-foreground">(was {fromName})</span>
                        </>
                    )}
                    .
                </div>
            </div>
        )
    }

    // TEMPLATE_UPDATED
    return (
        <div className="space-y-1.5">
            <div className="text-sm">
                Edited template{" "}
                <TemplateLink id={row.template_id} name={tName} />.
            </div>
            <div className="text-[11px] text-muted-foreground space-y-0.5">
                {diff.name && (
                    <div>
                        Renamed: <span className="line-through">{diff.name.from}</span>{" "}
                        <ArrowRight className="inline h-2.5 w-2.5" />{" "}
                        <strong className="text-foreground">{diff.name.to}</strong>
                    </div>
                )}
                {diff.base_role && typeof diff.base_role === "object" && (
                    <div>
                        Base role: {diff.base_role.from} <ArrowRight className="inline h-2.5 w-2.5" /> {diff.base_role.to}
                    </div>
                )}
                {diff.description_changed && (
                    <div>Updated description.</div>
                )}
                {(diff.permissions_added ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1 items-center">
                        <span>Granted:</span>
                        {diff.permissions_added!.map((p) => (
                            <Badge key={p} variant="outline" className="text-[10px] border-success/40 text-success">
                                {permLabels[p] ?? p}
                            </Badge>
                        ))}
                    </div>
                )}
                {(diff.permissions_removed ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1 items-center">
                        <span>Revoked:</span>
                        {diff.permissions_removed!.map((p) => (
                            <Badge key={p} variant="outline" className="text-[10px] border-destructive/40 text-destructive">
                                {permLabels[p] ?? p}
                            </Badge>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

function TemplateLink({ id, name }: { id: string | null; name: string }) {
    if (!id) return <strong>{name}</strong>
    return (
        <Link href={`/settings/role-templates/${id}`} className="font-semibold underline-offset-2 hover:underline">
            {name}
        </Link>
    )
}
