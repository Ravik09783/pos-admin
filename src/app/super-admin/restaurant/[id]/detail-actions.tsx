"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarPlus, Loader2, LogIn, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { DeleteTenantDialog } from "../../delete-tenant-dialog"
import { ExtendTrialDialog } from "./extend-trial-dialog"

/**
 * Top-right actions on the tenant detail page:
 *   - "Impersonate owner": opens a Supabase magic-link in a new tab so
 *     the super-admin can sign in as the OWNER without losing their
 *     own super-admin session in this tab.
 *   - "Delete restaurant": opens the existing confirmation dialog.
 *     After a successful delete we navigate back to /super-admin since
 *     this tenant no longer exists.
 *
 * Both endpoints are the same ones the table-row actions use — we
 * don't duplicate server logic, just the UI surface.
 */
export function DetailActions({
    tenantId,
    tenantName,
    ownerEmail,
    trialEndsAt,
}: {
    tenantId: string
    tenantName: string
    ownerEmail: string | null
    /** Current trial_ends_at ISO string, shown in the Extend Trial
     *  dialog as the anchor for "+N days" preview math. */
    trialEndsAt: string | null
}) {
    const router = useRouter()
    const [busy, setBusy] = useState<"impersonate" | "delete" | null>(null)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [extendOpen, setExtendOpen] = useState(false)

    async function impersonate() {
        setBusy("impersonate")
        try {
            const r = await fetch("/api/super-admin/impersonate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tenant_id: tenantId }),
            })
            const data = await r.json() as { ok?: boolean; action_link?: string; error?: string; owner_email?: string }
            if (!r.ok || !data.ok || !data.action_link) {
                throw new Error(data.error ?? "Failed to mint impersonation link")
            }
            window.open(data.action_link, "_blank", "noopener")
            toast.success(`Signing in as ${data.owner_email} in a new tab`, {
                description: "Close that tab to return; your super-admin session here is unchanged.",
            })
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Impersonation failed")
        } finally {
            setBusy(null)
        }
    }

    async function confirmDelete() {
        setBusy("delete")
        try {
            const r = await fetch(`/api/super-admin/tenant/${tenantId}`, { method: "DELETE" })
            const data = await r.json() as { ok?: boolean; error?: string }
            if (!r.ok || !data.ok) throw new Error(data.error ?? "Delete failed")
            toast.success(`${tenantName} deleted`)
            setDeleteOpen(false)
            // The tenant is gone — bounce back to the list.
            router.push("/super-admin")
            router.refresh()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Delete failed")
        } finally {
            setBusy(null)
        }
    }

    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    variant="neon"
                    onClick={impersonate}
                    disabled={busy !== null || !ownerEmail}
                    title={ownerEmail ? "Sign in as the OWNER in a new tab" : "No OWNER on record"}
                >
                    {busy === "impersonate"
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <LogIn className="h-4 w-4" />}
                    Impersonate owner
                </Button>
                <Button
                    variant="outline"
                    onClick={() => setExtendOpen(true)}
                    disabled={busy !== null}
                    title="Push out this tenant's free-trial end date"
                >
                    <CalendarPlus className="h-4 w-4" />
                    Extend trial
                </Button>
                <Button
                    variant="outline"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/40"
                    onClick={() => setDeleteOpen(true)}
                    disabled={busy !== null}
                >
                    <Trash2 className="h-4 w-4" />
                    Delete restaurant
                </Button>
            </div>

            <ExtendTrialDialog
                open={extendOpen}
                onClose={() => setExtendOpen(false)}
                tenantId={tenantId}
                tenantName={tenantName}
                currentTrialEnd={trialEndsAt}
            />

            {deleteOpen && (
                <DeleteTenantDialog
                    tenant={{
                        id: tenantId,
                        name: tenantName,
                        slug: null,
                        country: null,
                        currency: null,
                        plan_tier: null,
                        subscription_status: null,
                        trial_ends_at: null,
                        current_period_end: null,
                        created_at: "",
                        owner_email: ownerEmail,
                        owner_full_name: null,
                        branch_count: 0,
                        staff_count: 0,
                        total_bills: 0,
                        total_revenue: 0,
                        last_activity_at: null,
                    }}
                    busy={busy === "delete"}
                    onClose={() => setDeleteOpen(false)}
                    onConfirm={confirmDelete}
                />
            )}
        </>
    )
}
