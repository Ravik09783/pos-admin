"use client"

import { useMemo, useState } from "react"
import { Loader2, LogIn, Search } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate } from "@/lib/utils"
import type { OrphanAccount } from "./page"

/**
 * Lists accounts that have signed up but have no restaurant attached
 * (tenant_id IS NULL) — the "Accounts without restaurant" tab.
 *
 * Each row has an Impersonate action: the super-admin can sign in as the
 * account in a new tab (it lands on /onboarding, since there's no tenant
 * yet) to finish setup or investigate. A text search keeps the list
 * usable once it grows.
 */
export function OrphanAccountsTable({ accounts }: { accounts: OrphanAccount[] }) {
    const [search, setSearch] = useState("")
    const [busyId, setBusyId] = useState<string | null>(null)

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return accounts
        return accounts.filter((a) =>
            [a.email, a.full_name, a.role].some((v) => v?.toLowerCase().includes(q)),
        )
    }, [accounts, search])

    async function impersonate(account: OrphanAccount) {
        setBusyId(account.id)
        try {
            const r = await fetch("/api/super-admin/impersonate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: account.id }),
            })
            const data = await r.json() as { ok?: boolean; action_link?: string; error?: string; owner_email?: string }
            if (!r.ok || !data.ok || !data.action_link) {
                throw new Error(data.error ?? "Failed to mint impersonation link")
            }
            // Open the magic link in a new tab so the super-admin's
            // current session stays intact in this tab.
            window.open(data.action_link, "_blank", "noopener")
            toast.success(`Signing in as ${data.owner_email} in a new tab`, {
                description: "They have no restaurant yet, so the tab lands on onboarding. Your super-admin session here is unchanged.",
            })
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Impersonation failed")
        } finally {
            setBusyId(null)
        }
    }

    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px] max-w-md">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by name, email, role…"
                        className="pl-8"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <span className="text-xs text-muted-foreground ml-auto">
                    {filtered.length} of {accounts.length}
                </span>
            </div>

            <Card className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Signed up</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                                    {accounts.length === 0
                                        ? "Every account has a restaurant — nothing pending here."
                                        : "No accounts match the search."}
                                </TableCell>
                            </TableRow>
                        ) : filtered.map((a) => (
                            <TableRow key={a.id}>
                                <TableCell className="font-medium">{a.full_name ?? "—"}</TableCell>
                                <TableCell className="font-mono text-[11px] text-muted-foreground">
                                    {a.email ?? "—"}
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline" className="text-[10px]">
                                        {a.role ?? "—"}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    {a.is_active === false ? (
                                        <Badge variant="destructive" className="text-[10px]">Inactive</Badge>
                                    ) : (
                                        <Badge variant="success" className="text-[10px]">Active</Badge>
                                    )}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                    {formatDate(a.created_at, { dateStyle: "medium" })}
                                </TableCell>
                                <TableCell className="text-right">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => impersonate(a)}
                                        disabled={busyId === a.id || !a.email}
                                        title={a.email ? "Sign in as this account in a new tab" : "No email on record"}
                                    >
                                        {busyId === a.id
                                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            : <LogIn className="h-3.5 w-3.5" />}
                                        Impersonate
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Card>
        </>
    )
}
