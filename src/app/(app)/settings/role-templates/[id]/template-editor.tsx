"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import Link from "next/link"
import {
    AlertTriangle, ArrowLeft, Building2, Database, Home, Loader2, Lock, Save, Trash2, UserPlus, Users,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    ALL_PERMISSIONS, PERMISSION_CATEGORIES, PERMISSION_META, ROLE_LABELS,
    type Permission, type PermissionCategory,
} from "@/lib/rbac/permissions"
import type { RoleTemplate, UserRole } from "@/types/database"
import { cn } from "@/lib/utils"

const ROLES: UserRole[] = ["MANAGER", "CASHIER", "CAPTAIN", "KITCHEN", "DELIVERY", "AUDITOR"]

export interface AssignedUser {
    id: string
    name: string
    email: string | null
    avatarUrl: string | null
    isActive: boolean
    homeBranchName: string | null
    extraBranchNames: string[]
}

export function TemplateEditor({
    template, assignedCount, assigned, callerPerms,
}: {
    template: RoleTemplate
    assignedCount: number
    assigned: AssignedUser[]
    callerPerms: string[]
}) {
    const router = useRouter()
    const [name, setName] = useState(template.name)
    const [description, setDescription] = useState(template.description ?? "")
    const [baseRole, setBaseRole] = useState<UserRole>(template.base_role as UserRole)
    const [perms, setPerms] = useState<Set<Permission>>(() => new Set(template.permissions as Permission[]))
    const [saving, setSaving] = useState(false)
    const [deleting, setDeleting] = useState(false)

    const callerSet = useMemo(() => new Set(callerPerms), [callerPerms])

    const dirty = useMemo(() => {
        if (name.trim() !== template.name) return true
        if ((description.trim() || null) !== (template.description ?? null)) return true
        if (baseRole !== template.base_role) return true
        const tplSet = new Set(template.permissions)
        if (tplSet.size !== perms.size) return true
        for (const p of perms) if (!tplSet.has(p)) return true
        return false
    }, [name, description, baseRole, perms, template])

    function togglePerm(p: Permission) {
        // Block toggling ON a permission the caller doesn't have.
        if (!perms.has(p) && !callerSet.has(p)) {
            toast.error(`You don't have "${PERMISSION_META[p].label}" yourself — can't grant it.`)
            return
        }
        const next = new Set(perms)
        if (next.has(p)) next.delete(p)
        else next.add(p)
        setPerms(next)
    }

    async function save() {
        setSaving(true)
        try {
            const payload: Record<string, unknown> = {
                permissions: Array.from(perms),
            }
            // Don't send fields the API will reject for system templates.
            if (!template.is_system) {
                payload.name = name.trim()
                payload.base_role = baseRole
            }
            payload.description = description.trim() || null

            const r = await fetch(`/api/admin/role-templates/${template.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })
            const data = await r.json().catch(() => ({ error: "Bad response" }))
            if (!r.ok) {
                if (Array.isArray(data.missing_permissions) && data.missing_permissions.length > 0) {
                    const missingLabels = (data.missing_permissions as Permission[])
                        .map((p) => PERMISSION_META[p]?.label ?? p)
                        .join(", ")
                    throw new Error(`${data.error}: ${missingLabels}`)
                }
                throw new Error(data.error ?? "Failed to save")
            }
            toast.success(assignedCount > 0
                ? `Template saved — ${assignedCount} user${assignedCount === 1 ? "" : "s"} updated`
                : "Template saved")
            router.refresh()
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to save")
        } finally {
            setSaving(false)
        }
    }

    async function remove() {
        if (template.is_system) {
            toast.error("System templates can't be deleted.")
            return
        }
        if (assignedCount > 0) {
            toast.error(`Reassign the ${assignedCount} user${assignedCount === 1 ? "" : "s"} on this template first.`)
            return
        }
        if (!confirm(`Delete the "${template.name}" template? This cannot be undone.`)) return

        setDeleting(true)
        try {
            const r = await fetch(`/api/admin/role-templates/${template.id}`, { method: "DELETE" })
            const data = await r.json().catch(() => ({ error: "Bad response" }))
            if (!r.ok) throw new Error(data.error ?? "Failed to delete")
            toast.success("Template deleted")
            router.push("/settings/role-templates")
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to delete")
            setDeleting(false)
        }
    }

    const byCategory = useMemo(() => {
        const map = new Map<PermissionCategory, Permission[]>()
        for (const cat of PERMISSION_CATEGORIES) map.set(cat, [])
        for (const p of ALL_PERMISSIONS) map.get(PERMISSION_META[p].category)?.push(p)
        return map
    }, [])

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-4xl space-y-6">
            <div>
                <Link
                    href="/settings/role-templates"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ArrowLeft className="h-3 w-3" /> Back to templates
                </Link>
                <div className="mt-2 flex items-center gap-3 flex-wrap">
                    <h1 className="text-2xl font-bold tracking-tight">{template.name}</h1>
                    {template.is_system && (
                        <Badge variant="outline" className="text-[10px]"><Lock className="h-2.5 w-2.5 mr-1" /> Default</Badge>
                    )}
                </div>
            </div>

            {assignedCount > 0 && (
                <Card className="border-warning/40 bg-warning/[0.05]">
                    <CardContent className="py-3 flex items-start gap-3">
                        <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                        <div className="text-sm">
                            <strong>{assignedCount} user{assignedCount === 1 ? "" : "s"}</strong> {assignedCount === 1 ? "is" : "are"} assigned to this template. Any changes you save here apply to them immediately.
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader><CardTitle className="text-base">Identity</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                    <div className="grid sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label>Name *</Label>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                disabled={template.is_system}
                                maxLength={80}
                            />
                            {template.is_system && (
                                <p className="text-[11px] text-muted-foreground">
                                    System templates can&apos;t be renamed. Duplicate-then-rename instead.
                                </p>
                            )}
                        </div>
                        <div className="space-y-1.5">
                            <Label>Base role *</Label>
                            <Select value={baseRole} onValueChange={(v) => setBaseRole(v as UserRole)} disabled={template.is_system}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <p className="text-[11px] text-muted-foreground">
                                Drives RLS branch scoping + DB-level checks. Independent of the permission list below.
                            </p>
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Description</Label>
                        <Textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={2}
                            maxLength={500}
                            placeholder="What is this template for?"
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center justify-between flex-wrap gap-2">
                        <span>Permissions</span>
                        <span className="text-xs font-normal text-muted-foreground inline-flex items-center gap-1">
                            <Users className="h-3 w-3" /> {perms.size} of {ALL_PERMISSIONS.length} granted
                        </span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    {PERMISSION_CATEGORIES.map((cat) => {
                        const inCat = byCategory.get(cat) ?? []
                        return (
                            <div key={cat} className="space-y-2">
                                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cat}</div>
                                <div className="grid gap-2">
                                    {inCat.map((p) => {
                                        const meta = PERMISSION_META[p]
                                        const has = perms.has(p)
                                        const callerLacks = !callerSet.has(p)
                                        const disabled = callerLacks && !has
                                        return (
                                            <div
                                                key={p}
                                                className={cn(
                                                    "flex items-start justify-between gap-3 rounded-md border border-border/40 p-3",
                                                    has && "bg-primary/[0.04] border-primary/30",
                                                    disabled && "opacity-60",
                                                )}
                                            >
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-sm font-medium">{meta.label}</span>
                                                        {meta.enforcement === "db" && (
                                                            <Badge variant="outline" className="text-[10px]"><Database className="h-2.5 w-2.5 mr-1" /> DB-enforced</Badge>
                                                        )}
                                                        {callerLacks && (
                                                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                                                You don&apos;t have this
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-muted-foreground mt-0.5">{meta.description}</p>
                                                </div>
                                                <Switch
                                                    checked={has}
                                                    onCheckedChange={() => togglePerm(p)}
                                                    disabled={disabled}
                                                />
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )
                    })}
                </CardContent>
            </Card>

            {/* ── Assigned-users roster ─────────────────────────────────
              * Lets the OWNER see (and click through to manage) every
              * staff member currently on this template — with their
              * branches inline so "who's at the Pune branch on Floor
              * Manager?" is a one-glance answer. */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <Users className="h-4 w-4 text-primary" />
                        Assigned to
                        <span className="text-xs font-normal text-muted-foreground">
                            ({assigned.length} {assigned.length === 1 ? "user" : "users"})
                        </span>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {assigned.length === 0 ? (
                        <div className="text-sm text-muted-foreground py-2">
                            No one is on this template yet.{" "}
                            <Link href="/settings/staff" className="text-primary hover:underline">
                                <UserPlus className="h-3 w-3 inline" /> Assign a staff member
                            </Link>
                        </div>
                    ) : (
                        <ul className="divide-y divide-border/40">
                            {assigned.map((u) => {
                                const initials = (u.name || u.email || "?")
                                    .split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()
                                return (
                                    <li key={u.id} className={cn("py-2.5 flex items-center gap-3", !u.isActive && "opacity-60")}>
                                        {u.avatarUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={u.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover border border-border/60 shrink-0" />
                                        ) : (
                                            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary/25 to-[hsl(var(--neon-magenta))/0.25] grid place-items-center text-xs font-semibold shrink-0">
                                                {initials}
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-medium truncate">{u.name}</span>
                                                {!u.isActive && (
                                                    <Badge variant="outline" className="text-[10px]">Inactive</Badge>
                                                )}
                                            </div>
                                            <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-1 shrink-0 max-w-[55%] justify-end">
                                            {u.homeBranchName ? (
                                                <Badge variant="outline" className="text-[10px]">
                                                    <Home className="h-2.5 w-2.5 mr-1" /> {u.homeBranchName}
                                                </Badge>
                                            ) : (
                                                <Badge variant="outline" className="text-[10px] text-muted-foreground italic">
                                                    <Building2 className="h-2.5 w-2.5 mr-1" /> No home branch
                                                </Badge>
                                            )}
                                            {u.extraBranchNames.map((bn) => (
                                                <Badge key={bn} variant="outline" className="text-[10px]">{bn}</Badge>
                                            ))}
                                        </div>
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </CardContent>
            </Card>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    {!template.is_system && (
                        <Button variant="ghost" className="text-destructive" onClick={remove} disabled={deleting || assignedCount > 0}>
                            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            Delete template
                        </Button>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <Button asChild variant="ghost">
                        <Link href="/settings/role-templates">Cancel</Link>
                    </Button>
                    <Button variant="neon" onClick={save} disabled={!dirty || saving}>
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save changes
                    </Button>
                </div>
            </div>
        </div>
    )
}
