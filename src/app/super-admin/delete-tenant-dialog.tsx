"use client"

import { useState } from "react"
import { AlertTriangle, Loader2, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatDate } from "@/lib/utils"
import type { TenantRow } from "./page"

/**
 * Destructive-action dialog for `super_admin_delete_tenant`. The
 * super-admin has to type the restaurant's exact name to enable the
 * Delete button — a deliberate friction step matching GitHub's
 * "delete repo" pattern.
 *
 * The warning is intentionally long because what's about to happen is
 * irreversible. We enumerate every category of data that'll be wiped
 * (DB rows, staff logins, storage blobs, Stripe sub) so the operator
 * can't say they weren't told.
 */
export function DeleteTenantDialog({
    tenant, busy, onClose, onConfirm,
}: {
    tenant: TenantRow
    busy: boolean
    onClose: () => void
    onConfirm: () => void
}) {
    const [typed, setTyped] = useState("")
    const expected = (tenant.name ?? "").trim()
    const armed = typed.trim() === expected && expected.length > 0

    return (
        <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose() }}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-destructive">
                        <AlertTriangle className="h-5 w-5" />
                        Delete {tenant.name ?? "this restaurant"}?
                    </DialogTitle>
                    <DialogDescription className="pt-2">
                        This action is <span className="font-semibold text-foreground">permanent and cannot be undone</span>.
                        Once confirmed, the following data will be wiped:
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    <div className="rounded-md border border-destructive/40 bg-destructive/[0.05] p-3 text-xs space-y-2">
                        <Row label="Restaurant" value={tenant.name ?? "(unnamed)"} />
                        <Row label="Owner" value={tenant.owner_email ?? "—"} />
                        <Row label="Joined" value={formatDate(tenant.created_at, { dateStyle: "medium" })} />
                        <Row label="Branches" value={String(tenant.branch_count)} />
                        <Row label="Staff users" value={`${tenant.staff_count} will lose access immediately`} />
                        <Row label="Bills issued" value={`${tenant.total_bills} historical records`} />
                    </div>

                    <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
                        <li>Every database row tied to this tenant (orders, bills, payments, menu, customers, coupons, stock, audit logs)</li>
                        <li>All uploaded files (menu images, logos, staff avatars)</li>
                        <li>Every staff user&apos;s login — they can&apos;t sign in again</li>
                        <li>The Stripe subscription is canceled (no further charges)</li>
                        <li>The Connect onboarding link is de-authorized</li>
                    </ul>

                    <div className="rounded-md border border-warning/40 bg-warning/[0.05] p-3 text-xs">
                        <strong className="text-warning">There is no undo and no soft-delete.</strong>{" "}
                        Database backups taken before this moment are the only way to restore anything.
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs">
                            Type <span className="font-mono font-semibold text-foreground">{expected}</span> to confirm:
                        </Label>
                        <Input
                            value={typed}
                            onChange={(e) => setTyped(e.target.value)}
                            placeholder={expected}
                            autoComplete="off"
                            disabled={busy}
                        />
                    </div>
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
                    <Button
                        variant="destructive"
                        onClick={onConfirm}
                        disabled={!armed || busy}
                    >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        {busy ? "Deleting…" : "Delete permanently"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium text-right truncate">{value}</span>
        </div>
    )
}
