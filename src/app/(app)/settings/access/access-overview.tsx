"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
    Building2, ChevronDown, Edit3, Home, Lock, Search, ShieldCheck, Users,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { UserRole } from "@/types/database"

export interface PermissionMeta {
    label: string
    category: "Sales" | "Catalog" | "Operations" | "Reports" | "Finance" | "Settings"
}

export interface AccessRow {
    id: string
    name: string
    email: string | null
    avatarUrl: string | null
    role: UserRole
    /** Human label of the role (may differ from `role` when template
     *  base_role differs — we show the template's role). */
    roleLabel: string
    isActive: boolean
    templateId: string | null
    templateName: string
    templateIsSystem: boolean
    permissions: string[]
    homeBranch: { id: string; name: string; isMain: boolean } | null
    extraBranches: { id: string; name: string; isMain: boolean }[]
    /** Admin / auditor roles see every branch regardless of explicit
     *  grants — we show "All branches" instead of a list. */
    isAllBranches: boolean
}

const CATEGORY_ACCENT: Record<PermissionMeta["category"], string> = {
    Sales:      "border-primary/40 text-primary bg-primary/[0.06]",
    Catalog:    "border-success/40 text-success bg-success/[0.06]",
    Operations: "border-primary/40 text-primary bg-primary/[0.06]",
    Reports:    "border-[hsl(var(--neon-magenta)/0.5)] text-[hsl(var(--neon-magenta))] bg-[hsl(var(--neon-magenta)/0.05)]",
    Finance:    "border-amber-500/40 text-amber-500 bg-amber-500/[0.06]",
    Settings:   "border-border text-muted-foreground bg-muted/40",
}

const ROLE_PRIORITY: Record<UserRole, number> = {
    OWNER: 0, MANAGER: 1, AUDITOR: 2, CASHIER: 3, CAPTAIN: 4, KITCHEN: 5, DELIVERY: 6,
}

export function AccessOverview({
    rows, permMeta,
}: {
    rows: AccessRow[]
    permMeta: Record<string, PermissionMeta>
}) {
    const [q, setQ] = useState("")
    const [roleFilter, setRoleFilter] = useState<UserRole | "ALL">("ALL")
    const [templateFilter, setTemplateFilter] = useState<string>("ALL")
    const [branchFilter, setBranchFilter] = useState<string>("ALL")
    const [showInactive, setShowInactive] = useState(false)
    const [expandedAll, setExpandedAll] = useState(false)

    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase()
        return rows.filter((r) => {
            if (!showInactive && !r.isActive) return false
            if (roleFilter !== "ALL" && r.role !== roleFilter) return false
            if (templateFilter !== "ALL" && r.templateId !== templateFilter) return false
            if (branchFilter !== "ALL") {
                if (r.isAllBranches) return true
                const allBranches = [r.homeBranch, ...r.extraBranches].filter(Boolean) as { id: string }[]
                if (!allBranches.some((b) => b.id === branchFilter)) return false
            }
            if (!needle) return true
            return (
                r.name.toLowerCase().includes(needle) ||
                (r.email ?? "").toLowerCase().includes(needle) ||
                r.templateName.toLowerCase().includes(needle)
            )
        }).sort((a, b) => {
            const pa = ROLE_PRIORITY[a.role] ?? 9
            const pb = ROLE_PRIORITY[b.role] ?? 9
            return pa - pb || a.name.localeCompare(b.name)
        })
    }, [rows, q, roleFilter, templateFilter, branchFilter, showInactive])

    // Build dropdown option lists from the data we have.
    const templateOptions = useMemo(() => {
        const seen = new Map<string, string>()
        for (const r of rows) {
            if (r.templateId) seen.set(r.templateId, r.templateName)
        }
        return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]))
    }, [rows])
    const branchOptions = useMemo(() => {
        const seen = new Map<string, string>()
        for (const r of rows) {
            if (r.homeBranch) seen.set(r.homeBranch.id, r.homeBranch.name)
            for (const b of r.extraBranches) seen.set(b.id, b.name)
        }
        return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]))
    }, [rows])

    const inactiveCount = rows.filter((r) => !r.isActive).length

    return (
        <div className="space-y-4">
            {/* ── Filters bar ─────────────────────────────────────────── */}
            <Card>
                <CardContent className="p-3 flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[220px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Search by name, email or template…"
                            className="pl-9"
                        />
                    </div>
                    <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as UserRole | "ALL")}>
                        <SelectTrigger className="w-36 h-9 text-xs">
                            <SelectValue placeholder="Role" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ALL">All roles</SelectItem>
                            {(["OWNER","MANAGER","CASHIER","CAPTAIN","KITCHEN","DELIVERY","AUDITOR"] as UserRole[]).map((r) => (
                                <SelectItem key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={templateFilter} onValueChange={setTemplateFilter}>
                        <SelectTrigger className="w-48 h-9 text-xs">
                            <SelectValue placeholder="Template" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ALL">All templates</SelectItem>
                            {templateOptions.map(([id, name]) => (
                                <SelectItem key={id} value={id}>{name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {branchOptions.length > 0 && (
                        <Select value={branchFilter} onValueChange={setBranchFilter}>
                            <SelectTrigger className="w-40 h-9 text-xs">
                                <SelectValue placeholder="Branch" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">All branches</SelectItem>
                                {branchOptions.map(([id, name]) => (
                                    <SelectItem key={id} value={id}>{name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                    {inactiveCount > 0 && (
                        <Button
                            type="button"
                            variant={showInactive ? "default" : "outline"}
                            size="sm"
                            onClick={() => setShowInactive((v) => !v)}
                        >
                            {showInactive ? "Hide" : "Show"} inactive ({inactiveCount})
                        </Button>
                    )}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setExpandedAll((v) => !v)}
                        title={expandedAll ? "Collapse all" : "Expand all permissions"}
                    >
                        <ChevronDown className={cn("h-4 w-4 transition-transform", expandedAll && "rotate-180")} />
                        {expandedAll ? "Collapse" : "Expand"} permissions
                    </Button>
                </CardContent>
            </Card>

            {/* ── Roster ──────────────────────────────────────────────── */}
            {filtered.length === 0 ? (
                <Card>
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">
                        No staff match the current filter.
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {filtered.map((row) => (
                        <UserAccessCard key={row.id} row={row} permMeta={permMeta} forceExpanded={expandedAll} />
                    ))}
                </div>
            )}
        </div>
    )
}

function UserAccessCard({
    row, permMeta, forceExpanded,
}: {
    row: AccessRow
    permMeta: Record<string, PermissionMeta>
    forceExpanded: boolean
}) {
    const [openSelf, setOpenSelf] = useState(false)
    const open = openSelf || forceExpanded

    const initials = (row.name || row.email || "?")
        .split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()

    // Group permissions by category for the expanded view.
    const byCategory = useMemo(() => {
        const map = new Map<PermissionMeta["category"], string[]>()
        for (const p of row.permissions) {
            const meta = permMeta[p]
            if (!meta) continue
            const list = map.get(meta.category) ?? []
            list.push(p)
            map.set(meta.category, list)
        }
        return map
    }, [row.permissions, permMeta])

    const categoryOrder: PermissionMeta["category"][] = ["Sales", "Catalog", "Operations", "Reports", "Finance", "Settings"]

    return (
        <Card className={cn("transition-colors", !row.isActive && "opacity-60")}>
            <CardContent className="p-4 space-y-3">
                {/* Header row */}
                <div className="flex items-start gap-3 flex-wrap">
                    <Avatar name={row.name} src={row.avatarUrl} initials={initials} />
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold">{row.name}</span>
                            {!row.isActive && (
                                <Badge variant="outline" className="text-[10px]">Inactive</Badge>
                            )}
                            <RoleBadge label={row.roleLabel} owner={row.role === "OWNER"} />
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground truncate">
                            {row.email}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <Button asChild size="sm" variant="outline">
                            <Link href="/settings/staff">
                                <Edit3 className="h-3.5 w-3.5" /> Edit
                            </Link>
                        </Button>
                    </div>
                </div>

                {/* Template + permission count + branches */}
                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                    <div className="flex items-start gap-2">
                        <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Template</div>
                            <div className="text-sm">
                                {row.templateId ? (
                                    <Link
                                        href={`/settings/role-templates/${row.templateId}`}
                                        className="font-medium hover:text-primary underline-offset-2 hover:underline inline-flex items-center gap-1.5"
                                    >
                                        {row.templateName}
                                        {row.templateIsSystem && <Lock className="h-3 w-3 text-muted-foreground" />}
                                    </Link>
                                ) : (
                                    <span className="text-muted-foreground italic">No template — using role defaults</span>
                                )}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                                {row.permissions.length} of 21 permission{row.permissions.length === 1 ? "" : "s"}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-start gap-2">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Branches</div>
                            <div className="text-sm flex flex-wrap gap-1 mt-0.5">
                                {row.isAllBranches ? (
                                    <Badge variant="outline" className="text-[10px]">
                                        <Users className="h-2.5 w-2.5 mr-1" /> All branches
                                    </Badge>
                                ) : !row.homeBranch && row.extraBranches.length === 0 ? (
                                    <span className="text-muted-foreground italic text-xs">Unassigned</span>
                                ) : (
                                    <>
                                        {row.homeBranch && (
                                            <Badge variant="outline" className="text-[10px]">
                                                <Home className="h-2.5 w-2.5 mr-1" /> {row.homeBranch.name}
                                                {row.homeBranch.isMain && <span className="ml-1 text-muted-foreground">(main)</span>}
                                            </Badge>
                                        )}
                                        {row.extraBranches.map((b) => (
                                            <Badge key={b.id} variant="outline" className="text-[10px]">
                                                {b.name}
                                            </Badge>
                                        ))}
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Permissions toggle + expansion */}
                {row.permissions.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                        This template has no permissions — the user can sign in but can&apos;t do anything beyond the dashboard.
                    </p>
                ) : !open ? (
                    <button
                        onClick={() => setOpenSelf(true)}
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                    >
                        Show permissions <ChevronDown className="h-3 w-3" />
                    </button>
                ) : (
                    <div className="space-y-2 pt-1 border-t border-border/40">
                        {categoryOrder.map((cat) => {
                            const perms = byCategory.get(cat) ?? []
                            if (perms.length === 0) return null
                            return (
                                <div key={cat}>
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{cat}</div>
                                    <div className="flex flex-wrap gap-1">
                                        {perms.map((p) => (
                                            <Badge
                                                key={p}
                                                variant="outline"
                                                className={cn("text-[10px] font-medium border", CATEGORY_ACCENT[cat])}
                                            >
                                                {permMeta[p]?.label ?? p}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            )
                        })}
                        {!forceExpanded && (
                            <button
                                onClick={() => setOpenSelf(false)}
                                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-2"
                            >
                                <ChevronDown className="h-3 w-3 rotate-180" /> Hide
                            </button>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

function Avatar({ name, src, initials }: { name: string; src: string | null; initials: string }) {
    if (src) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={src} alt={name} className="h-11 w-11 rounded-full object-cover border border-border/60 shrink-0" />
    }
    return (
        <div className="h-11 w-11 rounded-full bg-primary/15 grid place-items-center text-sm font-semibold shrink-0">
            {initials}
        </div>
    )
}

function RoleBadge({ label, owner }: { label: string; owner: boolean }) {
    return (
        <Badge
            variant="outline"
            className={cn(
                "text-[10px]",
                owner && "border-warning/50 text-warning bg-warning/[0.06]",
            )}
        >
            {label}
        </Badge>
    )
}
