"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { ROLE_LABELS } from "@/lib/rbac/permissions"
import type { UserRole } from "@/types/database"

const ROLES_FOR_NEW: UserRole[] = ["MANAGER", "CASHIER", "CAPTAIN", "KITCHEN", "DELIVERY", "AUDITOR"]

/**
 * "+ Create template" — opens a small dialog that captures the
 * template's name, description, and base role, then POSTs to
 * /api/admin/role-templates with NO permissions (admin fills those in
 * on the next screen — the dedicated editor). The dialog stays
 * minimal so admins land in the full editor for the actual permission
 * picks, where they have screen space + categorization.
 */
export function CreateTemplateButton({ callerPerms: _callerPerms }: { callerPerms: string[] }) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [name, setName] = useState("")
    const [description, setDescription] = useState("")
    const [baseRole, setBaseRole] = useState<UserRole>("CASHIER")
    const [busy, setBusy] = useState(false)

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        if (name.trim().length < 2) { toast.error("Name your template (min 2 characters)."); return }
        setBusy(true)
        try {
            const r = await fetch("/api/admin/role-templates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(),
                    description: description.trim() || null,
                    base_role: baseRole,
                    // Empty perms — the admin fills these on the next screen.
                    permissions: [],
                }),
            })
            const data = await r.json().catch(() => ({ error: "Bad response" }))
            if (!r.ok) throw new Error(data.error ?? "Failed to create template")
            toast.success("Template created — add permissions next")
            setOpen(false)
            setName(""); setDescription(""); setBaseRole("CASHIER")
            router.push(`/settings/role-templates/${data.id}`)
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to create template")
        } finally {
            setBusy(false)
        }
    }

    return (
        <>
            <Button variant="neon" onClick={() => setOpen(true)}>
                <Plus className="h-4 w-4" /> Create template
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader><DialogTitle>New role template</DialogTitle></DialogHeader>
                    <form onSubmit={submit} className="space-y-3">
                        <div className="space-y-1.5">
                            <Label>Name *</Label>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Cash Counter Staff, Floor Manager"
                                maxLength={80}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Base role *</Label>
                            <Select value={baseRole} onValueChange={(v) => setBaseRole(v as UserRole)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {ROLES_FOR_NEW.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Drives branch scoping and DB-level rules. You set the actual permission list on the next screen.
                            </p>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Description (optional)</Label>
                            <Textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="What is this template for? Who should be assigned to it?"
                                rows={2}
                                maxLength={500}
                            />
                        </div>
                        <DialogFooter>
                            <Button type="submit" variant="neon" disabled={busy}>
                                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                                Create &amp; edit permissions
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    )
}
