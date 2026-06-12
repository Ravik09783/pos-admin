"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Building2, Copy, KeyRound, Loader2, Mail, Pencil, ShieldOff, UserPlus } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/app-shell/page-header"
import { ImageUploader } from "@/components/ui/image-uploader"
import { createClient } from "@/lib/supabase/client"
import { ROLE_LABELS } from "@/lib/rbac/permissions"
import { tenantImagePath } from "@/lib/storage/image-upload"
import { computeAge } from "@/lib/profile/age"
import { formatDate } from "@/lib/utils"
import type { AppUser, Branch, RoleTemplate, StaffInvite, UserRole } from "@/types/database"

const ROLES: UserRole[] = ["OWNER", "MANAGER", "CASHIER", "CAPTAIN", "KITCHEN", "DELIVERY", "AUDITOR"]

// Path key under user-avatars: <tenant_id>/<user_id-or-tmp>/avatar.jpg
function avatarPath(tenantId: string, userKey: string): string {
    const stamp = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36)
    return `${tenantId}/${userKey}/avatar-${stamp}.jpg`
}

interface DirectForm {
    email: string
    password: string
    full_name: string
    /** Picked from the role-templates dropdown. Drives both the user's
     *  base role (template.base_role) and their UI permission set. */
    role_template_id: string
    dob: string                    // yyyy-mm-dd
    phone: string
    avatar_url: string | null
    /** Branch assignment. Auto-defaults to the only branch when there's
     *  one, required pick when there are 2+, ignored when there are zero. */
    branch_id: string | null
}
const EMPTY_DIRECT: DirectForm = {
    email: "", password: "", full_name: "", role_template_id: "", dob: "", phone: "", avatar_url: null, branch_id: null,
}

export default function StaffPage() {
    const supabase = createClient()
    const [users, setUsers] = useState<AppUser[]>([])
    const [invites, setInvites] = useState<StaffInvite[]>([])
    const [tenantId, setTenantId] = useState("")
    // Multi-branch UX kicks in only when 2+ branches exist:
    //   - 0 branches → no picker, no column, branch_id stays null
    //   - 1 branch   → silently auto-assign; no UI clutter
    //   - 2+         → required picker on create / edit / invite, filter
    //                  chip on the list, "Branch" column shown.
    const [branches, setBranches] = useState<Branch[]>([])
    const [templates, setTemplates] = useState<RoleTemplate[]>([])
    /** The caller's own permission set — drives the "you can't assign
     *  a template with more permissions than you have" check that the
     *  API enforces. We mirror it client-side to grey out impossible
     *  picks rather than wait for a 403. */
    const [myPerms, setMyPerms] = useState<Set<string>>(new Set())
    const [branchFilter, setBranchFilter] = useState<string>("ALL")
    // Toggle between "Active only" and "Show inactive too" so admins
    // can see deactivated staff (and reactivate them if their plan
    // allows). Inactive staff are exempted from the seat counter on
    // purpose — the SQL gates agree.
    const [showInactive, setShowInactive] = useState(false)

    const [createOpen, setCreateOpen] = useState(false)
    const [direct, setDirect] = useState<DirectForm>(EMPTY_DIRECT)
    const [creating, setCreating] = useState(false)

    const [inviteOpen, setInviteOpen] = useState(false)
    const [invForm, setInvForm] = useState<{ email: string; role: UserRole; full_name: string; branch_id: string | null }>({
        email: "", role: "CASHIER", full_name: "", branch_id: null,
    })
    const [inviting, setInviting] = useState(false)

    // Profile-edit dialog state. Email + role are NOT editable here:
    // - Email is the login identity and is changed via Supabase Auth flows.
    // - Role has its own inline dropdown (with a confirm prompt) on each row.
    // What admins CAN edit here: full name, phone, DOB, avatar.
    const [editingUser, setEditingUser] = useState<AppUser | null>(null)
    const [editBusy, setEditBusy] = useState(false)
    const [editForm, setEditForm] = useState<{ full_name: string; phone: string; dob: string; avatar_url: string | null; branch_id: string | null }>({
        full_name: "", phone: "", dob: "", avatar_url: null, branch_id: null,
    })
    function openEditProfile(u: AppUser) {
        const ux = u as AppUser & { dob?: string | null; avatar_url?: string | null; phone?: string | null; branch_id?: string | null }
        setEditingUser(u)
        setEditForm({
            full_name: u.full_name ?? "",
            phone: ux.phone ?? "",
            dob: ux.dob ?? "",
            avatar_url: ux.avatar_url ?? null,
            branch_id: ux.branch_id ?? null,
        })
    }
    async function saveProfile(e: React.FormEvent) {
        e.preventDefault()
        if (!editingUser) return
        // When the tenant has 2+ branches, an explicit assignment is
        // required so a staffer can't accidentally end up branchless.
        if (branches.length >= 2 && !editForm.branch_id) {
            return toast.error("Pick a branch for this staff member")
        }
        setEditBusy(true)
        const { error } = await supabase
            .from("users")
            .update({
                full_name: editForm.full_name.trim() || null,
                phone: editForm.phone.trim() || null,
                dob: editForm.dob || null,
                avatar_url: editForm.avatar_url,
                // Only set branch_id when 1+ branches exist; for zero-
                // branch tenants we leave the column null (legacy mode).
                ...(branches.length > 0 ? { branch_id: editForm.branch_id } : {}),
            } as never)
            .eq("id", editingUser.id)
        setEditBusy(false)
        if (error) return toast.error(error.message)
        toast.success("Profile updated")
        setEditingUser(null)
        refresh()
    }

    async function refresh() {
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) return
        const { data: row } = await supabase
            .from("users")
            .select("tenant_id, role_template:role_templates!users_role_template_id_fkey(permissions)")
            .eq("id", u.user.id)
            .maybeSingle() as { data: { tenant_id: string | null; role_template: { permissions: string[] } | { permissions: string[] }[] | null } | null }
        if (!row?.tenant_id) return
        setTenantId(row.tenant_id)
        const callerTpl = Array.isArray(row.role_template) ? row.role_template[0] : row.role_template
        setMyPerms(new Set(callerTpl?.permissions ?? []))
        const [{ data: us }, { data: ivs }, { data: brs }, { data: tpls }] = await Promise.all([
            supabase.from("users").select("*").order("created_at"),
            supabase.from("staff_invites").select("*").order("created_at", { ascending: false }),
            supabase.from("branches").select("*").eq("is_active", true).order("name"),
            supabase.from("role_templates")
                .select("id, tenant_id, name, description, base_role, permissions, is_system, created_by, created_at, updated_at")
                .order("is_system", { ascending: false })
                .order("base_role", { ascending: true })
                .order("name", { ascending: true }),
        ])
        setUsers((us ?? []) as AppUser[])
        setInvites((ivs ?? []) as StaffInvite[])
        setBranches((brs ?? []) as Branch[])
        setTemplates((tpls ?? []) as RoleTemplate[])
    }
    useEffect(() => { refresh() }, [])

    // Pre-fill the create + invite forms with the SOLE branch when one
    // exists, so single-branch shops never see the picker. With 2+ the
    // admin is forced to pick at submit time.
    useEffect(() => {
        if (branches.length === 1) {
            const id = branches[0]!.id
            setDirect((d) => d.branch_id ? d : { ...d, branch_id: id })
            setInvForm((f) => f.branch_id ? f : { ...f, branch_id: id })
        }
    }, [branches])

    /** Templates the CALLER is allowed to assign — subset rule applied
     *  client-side so the dropdown doesn't list options that the API
     *  would 403 on. Owner sees everything; a delegated manage_users
     *  user sees only templates whose permissions are contained in
     *  theirs. */
    const assignableTemplates = useMemo(() => {
        // Pre-load shortcut: while myPerms is still empty, show every
        // template so the dropdown isn't blank. The API enforces the
        // real subset rule on submit either way.
        if (myPerms.size === 0) return templates
        return templates.filter((t) =>
            t.permissions.every((p) => myPerms.has(p)),
        )
    }, [templates, myPerms])
    const templateById = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates])
    /** Truthy only for the OWNER (the only role that has staff.manage
     *  by default — see PERMISSIONS["staff.manage"]). Drives whether
     *  the page shows owner-only actions (deactivate, reset password,
     *  edit profile) which the underlying RLS still gates. Delegates
     *  with `manage_users` can add staff + reassign templates but
     *  can't touch those owner-only knobs. */
    const isOwnerLike = myPerms.has("staff.manage")

    const filteredUsers = users
        .filter((u) => showInactive || u.is_active !== false)
        .filter((u) => {
            if (branchFilter === "ALL") return true
            return (u as AppUser & { branch_id?: string | null }).branch_id === branchFilter
        })
    const branchNameById = (id: string | null | undefined) =>
        id ? branches.find((b) => b.id === id)?.name ?? "—" : "—"

    // Staff seats are UNLIMITED on every plan (migration 59) — the Add
    // staff CTA is never capacity-gated. Branch limits live on the
    // Branches settings page.
    const inactiveStaffCount = users.filter((u) => u.is_active === false).length
    const addStaffDisabled = false
    const addStaffTooltip: string | undefined = undefined

    function genPassword(): string {
        // 12-char readable temp password — admin can copy from the dialog.
        const chars = "abcdefghkmnpqrstuvwxyzABCDEFGHKLMNPRSTUVWXYZ23456789"
        let out = ""
        const bytes = new Uint8Array(12)
        ;(globalThis.crypto ?? window.crypto).getRandomValues(bytes)
        for (const b of bytes) out += chars[b % chars.length]
        return out
    }

    async function createStaff(e: React.FormEvent) {
        e.preventDefault()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(direct.email)) return toast.error("Valid email required")
        if (direct.password.length < 8) return toast.error("Password must be at least 8 characters")
        if (!direct.role_template_id) return toast.error("Pick a role template for this staff member")
        if (branches.length >= 2 && !direct.branch_id) return toast.error("Pick a branch for this staff member")
        setCreating(true)
        try {
            const r = await fetch("/api/admin/staff/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: direct.email.trim().toLowerCase(),
                    password: direct.password,
                    full_name: direct.full_name.trim() || null,
                    role_template_id: direct.role_template_id,
                    dob: direct.dob || null,
                    phone: direct.phone.trim() || null,
                    avatar_url: direct.avatar_url,
                    // Send branch_id only when we have one; zero-branch
                    // tenants stay branchless (the RPC accepts null).
                    branch_id: branches.length > 0 ? direct.branch_id : null,
                }),
            })
            const data = await r.json().catch(() => ({ error: "Bad response" }))
            if (!r.ok) {
                if (Array.isArray(data.missing_permissions) && data.missing_permissions.length > 0) {
                    throw new Error(`${data.error} Missing: ${data.missing_permissions.join(", ")}`)
                }
                throw new Error(data.error ?? "Failed to create staff")
            }
            // Hand the admin the credentials in clipboard so they can pass
            // them to the staff member directly.
            const creds = `Email: ${direct.email}\nPassword: ${direct.password}`
            try { await navigator.clipboard.writeText(creds) } catch { /* ignore */ }
            toast.success("Staff created — login credentials copied to clipboard")
            setDirect(EMPTY_DIRECT)
            setCreateOpen(false)
            refresh()
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to create staff")
        } finally {
            setCreating(false)
        }
    }

    async function invite(e: React.FormEvent) {
        e.preventDefault()
        if (!invForm.email.includes("@")) return toast.error("Valid email required")
        if (branches.length >= 2 && !invForm.branch_id) return toast.error("Pick a branch for this invite")
        setInviting(true)
        const { data: { user } } = await supabase.auth.getUser()
        const { data: row, error } = await supabase
            .from("staff_invites")
            .insert({
                tenant_id: tenantId,
                email: invForm.email.trim().toLowerCase(),
                role: invForm.role,
                full_name: invForm.full_name.trim() || null,
                invited_by: user?.id ?? null,
                // The invite-acceptance flow (accept_staff_invite RPC,
                // migration 03) propagates branch_id to the new users row.
                branch_id: branches.length > 0 ? invForm.branch_id : null,
            } as never)
            .select("token")
            .maybeSingle()
        setInviting(false)
        if (error) return toast.error(error.message)
        toast.success("Invite created")
        const link = `${window.location.origin}/invite/${(row as { token: string } | null)?.token ?? ""}`
        try { await navigator.clipboard.writeText(link) } catch {}
        toast.message("Invite link copied", { description: link })
        setInviteOpen(false)
        setInvForm({ email: "", role: "CASHIER", full_name: "", branch_id: branches.length === 1 ? branches[0]!.id : null })
        refresh()
    }

    async function copyLink(t: string) {
        const link = `${window.location.origin}/invite/${t}`
        try { await navigator.clipboard.writeText(link); toast.success("Link copied") }
        catch { toast.message(link) }
    }
    async function revoke(id: string) {
        const { error } = await supabase.from("staff_invites").update({ status: "REVOKED" } as never).eq("id", id)
        if (error) return toast.error(error.message)
        refresh()
    }
    async function setActive(u: AppUser, active: boolean) {
        // Goes through the admin API (service-role) so a deactivation does
        // three things atomically instead of one:
        //   - bans the auth.users row (blocks signInWithPassword)
        //   - signs out any live session (kicks them out mid-shift)
        //   - flips is_active + clears the PIN
        // Invoice-reservation release also happens server-side now.
        try {
            const r = await fetch("/api/admin/staff/set-active", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: u.id, active }),
            })
            const data = await r.json().catch(() => ({ error: "Bad response" }))
            if (!r.ok) throw new Error(data.error ?? "Failed to update status")
            if (!active) {
                const freed = typeof data.freed === "number" ? data.freed : 0
                if (freed > 0) {
                    toast.success(`${u.email} deactivated · ${freed} reserved invoice number${freed === 1 ? "" : "s"} freed for reuse`)
                } else {
                    toast.success(`${u.email} deactivated — can no longer sign in`)
                }
            } else {
                toast.success(`${u.email} reactivated`)
            }
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to update status")
        }
        refresh()
    }

    // Reset-password dialog state. We never read the OLD password — the
    // service-role endpoint just overwrites it. Owner accounts are blocked
    // server-side; we hide the button on owner rows below to match.
    const [resetUser, setResetUser] = useState<AppUser | null>(null)
    const [resetPassword, setResetPassword] = useState("")
    const [resetBusy, setResetBusy] = useState(false)
    function openResetPassword(u: AppUser) {
        setResetUser(u)
        setResetPassword(genPassword())
    }
    async function submitResetPassword(e: React.FormEvent) {
        e.preventDefault()
        if (!resetUser) return
        if (resetPassword.length < 8) return toast.error("Password must be at least 8 characters")
        setResetBusy(true)
        try {
            const r = await fetch("/api/admin/staff/reset-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: resetUser.id, password: resetPassword }),
            })
            const data = await r.json().catch(() => ({ error: "Bad response" }))
            if (!r.ok) throw new Error(data.error ?? "Failed to reset password")
            const creds = `Email: ${resetUser.email}\nPassword: ${resetPassword}`
            try { await navigator.clipboard.writeText(creds) } catch { /* ignore */ }
            toast.success("Password reset — new credentials copied to clipboard")
            setResetUser(null)
            setResetPassword("")
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to reset password")
        } finally {
            setResetBusy(false)
        }
    }
    async function changeTemplate(u: AppUser, templateId: string) {
        const tpl = templateById.get(templateId)
        if (!tpl) return toast.error("Template not found")
        if (!confirm(`Move ${u.email} to template "${tpl.name}"?`)) return
        try {
            const r = await fetch(`/api/admin/staff/${u.id}/template`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role_template_id: templateId }),
            })
            const data = await r.json().catch(() => ({ error: "Bad response" }))
            if (!r.ok) {
                if (Array.isArray(data.missing_permissions) && data.missing_permissions.length > 0) {
                    throw new Error(`${data.error} Missing: ${data.missing_permissions.join(", ")}`)
                }
                throw new Error(data.error ?? "Failed to update template")
            }
            toast.success("Template updated")
            refresh()
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to update template")
        }
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-6xl space-y-6">
            <PageHeader
                kicker="Configure"
                title="Staff"
                highlight="roles + accounts"
                description="Create staff accounts directly (no email verification), or send an invite link if you'd rather they set their own password."
                actions={
                    <>
                        <Button variant="outline" onClick={() => setInviteOpen(true)} disabled={addStaffDisabled} title={addStaffTooltip}>
                            <Mail className="h-4 w-4" /> Send invite
                        </Button>
                        <Button
                            variant="neon"
                            onClick={() => {
                                // Pre-fill the branch when there's only one,
                                // so the picker stays hidden in the form.
                                const defaultBranch = branches.length === 1 ? branches[0]!.id : null
                                // Default to the system Cashier template if
                                // present — the most common new-hire pick.
                                const defaultTemplate = assignableTemplates.find(
                                    (t) => t.base_role === "CASHIER" && t.is_system,
                                )?.id ?? ""
                                setDirect({
                                    ...EMPTY_DIRECT,
                                    password: genPassword(),
                                    branch_id: defaultBranch,
                                    role_template_id: defaultTemplate,
                                })
                                setCreateOpen(true)
                            }}
                            disabled={addStaffDisabled}
                            title={addStaffTooltip}
                        >
                            <UserPlus className="h-4 w-4" /> Add staff
                        </Button>
                    </>
                }
            />


            <Card>
                <CardHeader className="flex-row items-center justify-between py-3 space-y-0 flex-wrap gap-3">
                    <CardTitle className="text-base">
                        {showInactive ? "All staff" : "Active staff"}
                        {inactiveStaffCount > 0 && !showInactive && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                                · {inactiveStaffCount} inactive hidden
                            </span>
                        )}
                    </CardTitle>
                    <div className="flex items-center gap-3 flex-wrap">
                        {/* Show-inactive toggle. Hidden when there's nothing
                          * to show so the header doesn't get cluttered. */}
                        {inactiveStaffCount > 0 && (
                            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                                <Switch checked={showInactive} onCheckedChange={setShowInactive} />
                                Show inactive
                            </label>
                        )}
                        {branches.length >= 2 && (
                            <div className="flex items-center gap-2">
                                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                                <Select value={branchFilter} onValueChange={setBranchFilter}>
                                    <SelectTrigger className="h-8 text-xs w-44"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">All branches</SelectItem>
                                        {branches.map((b) => (
                                            <SelectItem key={b.id} value={b.id}>{b.name}{b.is_main ? " (main)" : ""}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="px-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-12" />
                                <TableHead>Name</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead className="w-20">Age</TableHead>
                                <TableHead>Role template</TableHead>
                                {branches.length >= 2 && <TableHead>Branch</TableHead>}
                                <TableHead>Status</TableHead>
                                <TableHead>Joined</TableHead>
                                <TableHead className="text-right w-[110px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredUsers.map((u) => {
                                const ux = u as AppUser & { dob?: string | null; avatar_url?: string | null; branch_id?: string | null }
                                const age = computeAge(ux.dob ?? null)
                                const inactive = u.is_active === false
                                return (
                                    <TableRow key={u.id} className={inactive ? "opacity-60" : undefined}>
                                        <TableCell>
                                            {ux.avatar_url
                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                ? <img src={ux.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover border border-border/60" />
                                                : <div className="h-8 w-8 rounded-full bg-muted grid place-items-center text-xs font-semibold">{(u.full_name ?? u.email ?? "?").slice(0, 1).toUpperCase()}</div>}
                                        </TableCell>
                                        <TableCell>{u.full_name ?? "—"}</TableCell>
                                        <TableCell className="text-sm">{u.email}</TableCell>
                                        <TableCell className="text-sm text-muted-foreground">{age ?? "—"}</TableCell>
                                        <TableCell>
                                            {u.role === "OWNER" ? (
                                                <Badge variant="outline" className="text-[10px]">{ROLE_LABELS.OWNER}</Badge>
                                            ) : (
                                                <Select
                                                    value={(u as AppUser & { role_template_id?: string | null }).role_template_id ?? ""}
                                                    onValueChange={(v) => changeTemplate(u, v)}
                                                >
                                                    <SelectTrigger className="h-7 text-xs w-44">
                                                        <SelectValue placeholder="Pick template" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {assignableTemplates.map((t) => (
                                                            <SelectItem key={t.id} value={t.id}>
                                                                {t.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        </TableCell>
                                        {branches.length >= 2 && (
                                            <TableCell className="text-sm">
                                                {ux.branch_id ? (
                                                    <span className="inline-flex items-center gap-1">
                                                        <Building2 className="h-3 w-3 text-muted-foreground" />
                                                        {branchNameById(ux.branch_id)}
                                                    </span>
                                                ) : (
                                                    <span className="text-muted-foreground italic text-xs">Unassigned</span>
                                                )}
                                            </TableCell>
                                        )}
                                        <TableCell>
                                            {isOwnerLike ? (
                                                <div className="flex items-center gap-2">
                                                    <Switch checked={u.is_active} onCheckedChange={(v) => setActive(u, v)} />
                                                    <span className="text-xs text-muted-foreground">{u.is_active ? "Active" : "Inactive"}</span>
                                                </div>
                                            ) : (
                                                <Badge variant={u.is_active ? "secondary" : "outline"} className="text-[10px]">
                                                    {u.is_active ? "Active" : "Inactive"}
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm">{formatDate(u.created_at, { dateStyle: "medium" })}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center gap-1 justify-end">
                                                {isOwnerLike && u.role !== "OWNER" && (
                                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openResetPassword(u)} aria-label="Reset password" title="Reset password">
                                                        <KeyRound className="h-3.5 w-3.5" />
                                                    </Button>
                                                )}
                                                {isOwnerLike && (
                                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEditProfile(u)} aria-label="Edit profile" title="Edit profile">
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </Button>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle className="text-base">Pending invites</CardTitle></CardHeader>
                <CardContent className="px-0">
                    {invites.length === 0 ? (
                        <p className="px-6 py-8 text-sm text-muted-foreground">No invites sent.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Role</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Expires</TableHead>
                                    <TableHead className="w-32" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {invites.map((i) => (
                                    <TableRow key={i.id}>
                                        <TableCell className="text-sm">{i.email}</TableCell>
                                        <TableCell><Badge variant="outline">{ROLE_LABELS[i.role]}</Badge></TableCell>
                                        <TableCell>
                                            <Badge variant={i.status === "PENDING" ? "warning" : i.status === "ACCEPTED" ? "success" : "secondary"}>
                                                {i.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-sm">{formatDate(i.expires_at, { dateStyle: "short" })}</TableCell>
                                        <TableCell>
                                            <div className="flex gap-1">
                                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copyLink(i.token)} title="Copy link">
                                                    <Copy className="h-3.5 w-3.5" />
                                                </Button>
                                                {i.status === "PENDING" && (
                                                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => revoke(i.id)} title="Revoke">
                                                        <ShieldOff className="h-3.5 w-3.5" />
                                                    </Button>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* ── Direct-create dialog ─────────────────────────────────── */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader><DialogTitle>Add staff</DialogTitle></DialogHeader>
                    <form onSubmit={createStaff} className="space-y-3">
                        <div className="flex items-start gap-4">
                            <ImageUploader
                                label="Photo"
                                value={direct.avatar_url}
                                onChange={(url) => setDirect({ ...direct, avatar_url: url })}
                                bucket="user-avatars"
                                path={avatarPath(tenantId, "tmp")}
                                size={88}
                            />
                            <div className="flex-1 space-y-3">
                                <div className="space-y-1.5">
                                    <Label>Full name</Label>
                                    <Input value={direct.full_name} onChange={(e) => setDirect({ ...direct, full_name: e.target.value })} placeholder="Karan Sharma" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Email *</Label>
                                    <Input type="email" value={direct.email} onChange={(e) => setDirect({ ...direct, email: e.target.value })} placeholder="karan@example.com" />
                                </div>
                            </div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5 sm:col-span-2">
                                <Label>Role template *</Label>
                                <Select value={direct.role_template_id} onValueChange={(v) => setDirect({ ...direct, role_template_id: v })}>
                                    <SelectTrigger><SelectValue placeholder="Pick a role template" /></SelectTrigger>
                                    <SelectContent>
                                        {assignableTemplates
                                            .filter((t) => t.base_role !== "OWNER")
                                            .map((t) => (
                                                <SelectItem key={t.id} value={t.id}>
                                                    {t.name}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-[11px] text-muted-foreground">
                                    Defines what this user can see and do. Manage templates in{" "}
                                    <Link href="/settings/role-templates" className="underline">
                                        Settings &rarr; Role templates
                                    </Link>.
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Phone</Label>
                                <Input value={direct.phone} onChange={(e) => setDirect({ ...direct, phone: e.target.value })} placeholder="+91 ..." />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Date of birth</Label>
                                <Input type="date" value={direct.dob} onChange={(e) => setDirect({ ...direct, dob: e.target.value })} max={new Date().toISOString().slice(0, 10)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Temporary password *</Label>
                                <div className="flex gap-1">
                                    <Input value={direct.password} onChange={(e) => setDirect({ ...direct, password: e.target.value })} className="font-mono" />
                                    <Button type="button" variant="outline" size="sm" onClick={() => setDirect({ ...direct, password: genPassword() })} title="Generate a new one">
                                        ↻
                                    </Button>
                                </div>
                            </div>
                            {/* Branch picker — only when the tenant has 2+
                             *  branches. Single-branch tenants get the
                             *  branch auto-assigned silently via the
                             *  useEffect that watches `branches`. */}
                            {branches.length >= 2 && (
                                <div className="space-y-1.5 sm:col-span-2">
                                    <Label>Branch *</Label>
                                    <Select value={direct.branch_id ?? ""} onValueChange={(v) => setDirect({ ...direct, branch_id: v })}>
                                        <SelectTrigger><SelectValue placeholder="Pick a branch" /></SelectTrigger>
                                        <SelectContent>
                                            {branches.map((b) => (
                                                <SelectItem key={b.id} value={b.id}>{b.name}{b.is_main ? " (main)" : ""}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground rounded-md bg-muted/40 px-3 py-2">
                            The staff member can sign in immediately — no email verification needed. After "Add staff" we&apos;ll copy the email + password to your clipboard so you can pass them along.
                        </p>
                        <DialogFooter>
                            <Button type="submit" variant="neon" disabled={creating}>
                                {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                                Add staff
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* ── Profile-edit dialog ───────────────────────────────────
              * Lets the admin fix the name / phone / DOB / avatar of an
              * existing staff member. Role + email + active state are
              * handled by the inline row controls above. */}
            <Dialog open={!!editingUser} onOpenChange={(o) => { if (!o) setEditingUser(null) }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader><DialogTitle>Edit profile{editingUser?.full_name ? ` · ${editingUser.full_name}` : ""}</DialogTitle></DialogHeader>
                    <form onSubmit={saveProfile} className="space-y-3">
                        <div className="flex items-start gap-4">
                            <ImageUploader
                                label="Photo"
                                value={editForm.avatar_url}
                                onChange={(url) => setEditForm({ ...editForm, avatar_url: url })}
                                bucket="user-avatars"
                                path={avatarPath(tenantId, editingUser?.id ?? "tmp")}
                                size={88}
                            />
                            <div className="flex-1 space-y-3">
                                <div className="space-y-1.5">
                                    <Label>Full name</Label>
                                    <Input value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} placeholder="Karan Sharma" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Email</Label>
                                    <Input value={editingUser?.email ?? ""} disabled className="text-muted-foreground" />
                                </div>
                            </div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Phone</Label>
                                <Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} placeholder="+91 ..." />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Date of birth</Label>
                                <Input type="date" value={editForm.dob} onChange={(e) => setEditForm({ ...editForm, dob: e.target.value })} max={new Date().toISOString().slice(0, 10)} />
                            </div>
                            {branches.length >= 2 && (
                                <div className="space-y-1.5 sm:col-span-2">
                                    <Label>Branch *</Label>
                                    <Select value={editForm.branch_id ?? ""} onValueChange={(v) => setEditForm({ ...editForm, branch_id: v })}>
                                        <SelectTrigger><SelectValue placeholder="Pick a branch" /></SelectTrigger>
                                        <SelectContent>
                                            {branches.map((b) => (
                                                <SelectItem key={b.id} value={b.id}>{b.name}{b.is_main ? " (main)" : ""}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground rounded-md bg-muted/40 px-3 py-2">
                            Email + role are managed elsewhere — email via Supabase Auth flows, role via the dropdown on the row above.
                        </p>
                        <DialogFooter>
                            <Button type="submit" variant="neon" disabled={editBusy}>
                                {editBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                                Save changes
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* ── Reset-password dialog ──────────────────────────────── */}
            <Dialog open={!!resetUser} onOpenChange={(o) => { if (!o) { setResetUser(null); setResetPassword("") } }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Reset password{resetUser?.full_name ? ` · ${resetUser.full_name}` : resetUser ? ` · ${resetUser.email}` : ""}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={submitResetPassword} className="space-y-3">
                        <div className="space-y-1.5">
                            <Label>New password *</Label>
                            <div className="flex gap-1">
                                <Input value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} className="font-mono" autoComplete="new-password" />
                                <Button type="button" variant="outline" size="sm" onClick={() => setResetPassword(genPassword())} title="Generate a new one">
                                    ↻
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">Minimum 8 characters. Existing sessions for this user will be signed out.</p>
                        </div>
                        <p className="text-xs text-muted-foreground rounded-md bg-muted/40 px-3 py-2">
                            We&apos;ll copy <span className="font-mono">email + new password</span> to your clipboard so you can hand them over.
                        </p>
                        <DialogFooter>
                            <Button type="submit" variant="neon" disabled={resetBusy}>
                                {resetBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                                Reset password
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* ── Invite-link dialog (kept as secondary path) ────────── */}
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Send invite link</DialogTitle></DialogHeader>
                    <form onSubmit={invite} className="space-y-3">
                        <div className="space-y-1.5">
                            <Label>Email</Label>
                            <Input type="email" value={invForm.email} onChange={(e) => setInvForm({ ...invForm, email: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Name (optional)</Label>
                                <Input value={invForm.full_name} onChange={(e) => setInvForm({ ...invForm, full_name: e.target.value })} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Role</Label>
                                <Select value={invForm.role} onValueChange={(v) => setInvForm({ ...invForm, role: v as UserRole })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {ROLES.filter((r) => r !== "OWNER").map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            {branches.length >= 2 && (
                                <div className="space-y-1.5 col-span-2">
                                    <Label>Branch *</Label>
                                    <Select value={invForm.branch_id ?? ""} onValueChange={(v) => setInvForm({ ...invForm, branch_id: v })}>
                                        <SelectTrigger><SelectValue placeholder="Pick a branch" /></SelectTrigger>
                                        <SelectContent>
                                            {branches.map((b) => (
                                                <SelectItem key={b.id} value={b.id}>{b.name}{b.is_main ? " (main)" : ""}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground rounded-md bg-muted/40 px-3 py-2">
                            <Mail className="h-3.5 w-3.5 inline mr-1" /> Use this if you want the staff member to set their own password. They&apos;ll click the link and sign up.
                        </p>
                        <DialogFooter>
                            <Button type="submit" variant="neon" disabled={inviting}>
                                {inviting && <Loader2 className="h-4 w-4 animate-spin" />}
                                Generate invite
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
