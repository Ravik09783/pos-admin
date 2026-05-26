"use client"

import { useMemo, useState, useTransition } from "react"
import { ChevronDown, Loader2, Mail, MapPin, MessageSquare, Phone, Save, Search } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { cn, formatDate } from "@/lib/utils"

export type DemoStatus = "NEW" | "CONTACTED" | "CONVERTED" | "DROPPED"

export interface DemoRequestRow {
    id: string
    name: string
    email: string
    phone: string
    city: string | null
    restaurant: string | null
    message: string | null
    source: string | null
    status: DemoStatus
    notes: string | null
    user_agent: string | null
    ip_address: string | null
    created_at: string
    updated_at: string
}

const STATUSES: DemoStatus[] = ["NEW", "CONTACTED", "CONVERTED", "DROPPED"]

export function DemoRequestsTable({ initial }: { initial: DemoRequestRow[] }) {
    const [rows, setRows] = useState<DemoRequestRow[]>(initial)
    const [q, setQ] = useState("")
    const [filter, setFilter] = useState<DemoStatus | "ALL">("ALL")
    const [expanded, setExpanded] = useState<string | null>(null)

    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase()
        return rows.filter((r) => {
            if (filter !== "ALL" && r.status !== filter) return false
            if (!needle) return true
            return (
                r.name.toLowerCase().includes(needle) ||
                r.email.toLowerCase().includes(needle) ||
                r.phone.toLowerCase().includes(needle) ||
                (r.restaurant ?? "").toLowerCase().includes(needle) ||
                (r.city ?? "").toLowerCase().includes(needle)
            )
        })
    }, [rows, q, filter])

    function patchLocal(id: string, patch: Partial<DemoRequestRow>) {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search name, email, phone, restaurant…"
                        className="pl-9"
                    />
                </div>
                <div className="flex items-center gap-1 rounded-md border border-border/60 bg-card/40 p-0.5">
                    {(["ALL", ...STATUSES] as const).map((s) => (
                        <button
                            key={s}
                            onClick={() => setFilter(s)}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded transition-colors",
                                filter === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
                        </button>
                    ))}
                </div>
            </div>

            {filtered.length === 0 ? (
                <Card>
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">
                        No demo requests match the current filter.
                    </CardContent>
                </Card>
            ) : (
                filtered.map((row) => (
                    <DemoRequestCard
                        key={row.id}
                        row={row}
                        expanded={expanded === row.id}
                        onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
                        onPatch={(patch) => patchLocal(row.id, patch)}
                    />
                ))
            )}
        </div>
    )
}

function DemoRequestCard({
    row, expanded, onToggle, onPatch,
}: {
    row: DemoRequestRow
    expanded: boolean
    onToggle: () => void
    onPatch: (p: Partial<DemoRequestRow>) => void
}) {
    const [notesDraft, setNotesDraft] = useState(row.notes ?? "")
    const [savingNotes, startSavingNotes] = useTransition()
    const [savingStatus, startSavingStatus] = useTransition()

    const notesDirty = (notesDraft ?? "") !== (row.notes ?? "")

    async function patch(p: { status?: DemoStatus; notes?: string | null }): Promise<boolean> {
        const res = await fetch(`/api/super-admin/demo-requests/${row.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(p),
        })
        if (!res.ok) {
            const j = await res.json().catch(() => ({}))
            toast.error(j.error ?? "Couldn't save change.")
            return false
        }
        return true
    }

    function onStatusChange(next: DemoStatus) {
        if (next === row.status) return
        startSavingStatus(async () => {
            const prev = row.status
            onPatch({ status: next })
            const ok = await patch({ status: next })
            if (!ok) {
                onPatch({ status: prev })
                return
            }
            const verb = next === "CONVERTED" ? "Marked as converted 🎉"
                : next === "DROPPED" ? "Marked as dropped"
                    : next === "CONTACTED" ? "Marked as contacted"
                        : "Reset to new"
            toast.success(verb)
        })
    }

    function onSaveNotes() {
        startSavingNotes(async () => {
            const next = notesDraft.trim().length > 0 ? notesDraft : null
            const ok = await patch({ notes: next })
            if (ok) {
                onPatch({ notes: next })
                toast.success("Notes saved")
            }
        })
    }

    return (
        <Card className={cn("transition-colors", expanded && "border-primary/40")}>
            <button
                type="button"
                onClick={onToggle}
                className="w-full text-left p-4 hover:bg-accent/20 transition-colors"
            >
                <div className="flex flex-wrap items-start gap-3">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold">{row.name}</span>
                            {row.restaurant && (
                                <span className="text-sm text-muted-foreground">· {row.restaurant}</span>
                            )}
                            <StatusBadge status={row.status} />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {row.email}</span>
                            <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {row.phone}</span>
                            {row.city && (
                                <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {row.city}</span>
                            )}
                            <span>
                                Received {formatDate(row.created_at, { dateStyle: "medium", timeStyle: "short" })}
                            </span>
                            {row.notes && (
                                <span className="inline-flex items-center gap-1 text-primary/80">
                                    <MessageSquare className="h-3 w-3" /> Has notes
                                </span>
                            )}
                        </div>
                    </div>
                    <ChevronDown
                        className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", expanded && "rotate-180")}
                    />
                </div>
            </button>

            {expanded && (
                <CardContent className="pt-0 pb-4 border-t border-border/40 space-y-4">
                    {row.message && (
                        <div>
                            <div className="text-xs font-semibold text-muted-foreground mb-1">Customer message</div>
                            <p className="text-sm whitespace-pre-wrap leading-relaxed rounded-md bg-card/40 border border-border/40 p-3">
                                {row.message}
                            </p>
                        </div>
                    )}

                    <div className="grid md:grid-cols-2 gap-4">
                        <div>
                            <div className="text-xs font-semibold text-muted-foreground mb-1.5">Status</div>
                            <Select
                                value={row.status}
                                onValueChange={(v) => onStatusChange(v as DemoStatus)}
                                disabled={savingStatus}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {STATUSES.map((s) => (
                                        <SelectItem key={s} value={s}>
                                            {s.charAt(0) + s.slice(1).toLowerCase()}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-[11px] text-muted-foreground mt-1.5">
                                New → Contacted → Converted (won) / Dropped (lost).
                            </p>
                        </div>

                        <div className="grid md:grid-cols-1 gap-1.5 text-xs text-muted-foreground content-start">
                            <div>
                                <span className="font-semibold text-foreground">Source:</span>{" "}
                                <code className="text-[11px]">{row.source ?? "—"}</code>
                            </div>
                            {row.ip_address && (
                                <div>
                                    <span className="font-semibold text-foreground">IP:</span>{" "}
                                    <code className="text-[11px]">{row.ip_address}</code>
                                </div>
                            )}
                            {row.user_agent && (
                                <div className="truncate" title={row.user_agent}>
                                    <span className="font-semibold text-foreground">User agent:</span>{" "}
                                    <span className="text-[11px]">{row.user_agent}</span>
                                </div>
                            )}
                            <div>
                                <span className="font-semibold text-foreground">Last updated:</span>{" "}
                                {formatDate(row.updated_at, { dateStyle: "medium", timeStyle: "short" })}
                            </div>
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <div className="text-xs font-semibold text-muted-foreground">Internal notes</div>
                            {notesDirty && (
                                <Badge variant="outline" className="text-[10px]">Unsaved</Badge>
                            )}
                        </div>
                        <Textarea
                            value={notesDraft}
                            onChange={(e) => setNotesDraft(e.target.value)}
                            placeholder="What happened on the call? Next steps? Why dropped?"
                            rows={4}
                            maxLength={4000}
                        />
                        <div className="mt-2 flex items-center gap-2">
                            <Button
                                type="button"
                                size="sm"
                                variant="neon"
                                onClick={onSaveNotes}
                                disabled={!notesDirty || savingNotes}
                            >
                                {savingNotes ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                Save notes
                            </Button>
                            {notesDirty && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setNotesDraft(row.notes ?? "")}
                                    disabled={savingNotes}
                                >
                                    Discard
                                </Button>
                            )}
                            <span className="text-[11px] text-muted-foreground ml-auto tabular-nums">
                                {notesDraft.length} / 4000
                            </span>
                        </div>
                    </div>
                </CardContent>
            )}
        </Card>
    )
}

function StatusBadge({ status }: { status: DemoStatus }) {
    const map: Record<DemoStatus, { label: string; className: string }> = {
        NEW:       { label: "New",       className: "bg-primary/15 text-primary border-primary/40" },
        CONTACTED: { label: "Contacted", className: "bg-warning/15 text-warning border-warning/40" },
        CONVERTED: { label: "Converted", className: "bg-success/15 text-success border-success/40" },
        DROPPED:   { label: "Dropped",   className: "bg-muted text-muted-foreground border-border" },
    }
    const m = map[status]
    return (
        <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border", m.className)}>
            {m.label}
        </span>
    )
}
