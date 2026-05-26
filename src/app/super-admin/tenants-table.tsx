"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Loader2, LogIn, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn, formatDate } from "@/lib/utils"
import { DeleteTenantDialog } from "./delete-tenant-dialog"
import type { TenantRow } from "./page"

/** Sort options offered in the toolbar dropdown. */
const SORT_OPTIONS = [
    { value: "newest", label: "Newest first" },
    { value: "oldest", label: "Oldest first" },
    { value: "revenue", label: "Highest revenue" },
    { value: "bills", label: "Most bills" },
    { value: "staff", label: "Most staff" },
    { value: "branches", label: "Most branches" },
    { value: "active", label: "Recently active" },
    { value: "name", label: "Name (A–Z)" },
] as const

const PER_PAGE_OPTIONS = [10, 25, 50, 100]

/** Billing filter — buckets a tenant's subscription_status into a plain-
 *  language category. "Paid plan" is the converted-to-paying cohort. */
const BILLING_OPTIONS = [
    { value: "ALL", label: "All billing" },
    { value: "PAID", label: "Paid plan" },
    { value: "TRIAL", label: "Free trial" },
    { value: "INACTIVE", label: "Past-due / canceled" },
] as const

function billingBucket(status: string | null): "PAID" | "TRIAL" | "INACTIVE" {
    if (status === "ACTIVE") return "PAID"
    if (status === "TRIAL" || status == null) return "TRIAL"
    return "INACTIVE"
}

/** Distinct, sorted, non-empty values — drives a filter dropdown. */
function distinct(values: (string | null)[]): string[] {
    const set = new Set<string>()
    for (const v of values) if (v) set.add(v)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
}

/** Last-activity timestamp, falling back to signup date so tenants with
 *  no bills yet still sort sensibly under "Recently active". */
function activityTime(t: TenantRow): number {
    return new Date(t.last_activity_at ?? t.created_at).getTime()
}

function sortRows(rows: TenantRow[], sortBy: string): TenantRow[] {
    const arr = [...rows]
    switch (sortBy) {
        case "oldest":
            return arr.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
        case "revenue":
            return arr.sort((a, b) => Number(b.total_revenue ?? 0) - Number(a.total_revenue ?? 0))
        case "bills":
            return arr.sort((a, b) => Number(b.total_bills ?? 0) - Number(a.total_bills ?? 0))
        case "staff":
            return arr.sort((a, b) => Number(b.staff_count ?? 0) - Number(a.staff_count ?? 0))
        case "branches":
            return arr.sort((a, b) => Number(b.branch_count ?? 0) - Number(a.branch_count ?? 0))
        case "active":
            return arr.sort((a, b) => activityTime(b) - activityTime(a))
        case "name":
            return arr.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
        case "newest":
        default:
            return arr.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    }
}

/**
 * Client-side list + actions for the super-admin dashboard. The server
 * fetches every tenant once; this component handles search, country /
 * plan / subscription-status filtering, sorting, pagination, and the
 * impersonate / delete row actions.
 */
export function TenantsTable({ initialTenants }: { initialTenants: TenantRow[] }) {
    const router = useRouter()
    const [tenants, setTenants] = useState(initialTenants)
    const [search, setSearch] = useState("")
    const [countryFilter, setCountryFilter] = useState("ALL")
    const [planFilter, setPlanFilter] = useState("ALL")
    const [billingFilter, setBillingFilter] = useState("ALL")
    const [sortBy, setSortBy] = useState<string>("newest")
    const [perPage, setPerPage] = useState(25)
    const [page, setPage] = useState(1)
    const [busy, setBusy] = useState<{ id: string; action: "impersonate" | "delete" } | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<TenantRow | null>(null)

    // Distinct values present in the data — drive the filter dropdowns.
    const countries = useMemo(() => distinct(tenants.map((t) => t.country)), [tenants])
    const plans = useMemo(() => distinct(tenants.map((t) => t.plan_tier)), [tenants])

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        return tenants.filter((t) => {
            if (countryFilter !== "ALL" && t.country !== countryFilter) return false
            if (planFilter !== "ALL" && t.plan_tier !== planFilter) return false
            if (billingFilter !== "ALL" && billingBucket(t.subscription_status) !== billingFilter) return false
            if (!q) return true
            return [t.name, t.slug, t.country, t.owner_email, t.owner_full_name]
                .some((v) => v?.toLowerCase().includes(q))
        })
    }, [tenants, search, countryFilter, planFilter, billingFilter])

    const sorted = useMemo(() => sortRows(filtered, sortBy), [filtered, sortBy])

    // Pagination. currentPage is clamped so a shrinking result set (after
    // a delete, or a filter change) never strands the view on a dead page.
    const totalPages = Math.max(1, Math.ceil(sorted.length / perPage))
    const currentPage = Math.min(Math.max(1, page), totalPages)
    const pageRows = useMemo(
        () => sorted.slice((currentPage - 1) * perPage, currentPage * perPage),
        [sorted, currentPage, perPage],
    )

    // Any filter / sort / page-size change jumps back to the first page.
    useEffect(() => {
        setPage(1)
    }, [search, countryFilter, planFilter, billingFilter, sortBy, perPage])

    async function impersonate(tenant: TenantRow) {
        setBusy({ id: tenant.id, action: "impersonate" })
        try {
            const r = await fetch("/api/super-admin/impersonate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tenant_id: tenant.id }),
            })
            const data = await r.json() as { ok?: boolean; action_link?: string; error?: string; owner_email?: string }
            if (!r.ok || !data.ok || !data.action_link) {
                throw new Error(data.error ?? "Failed to mint impersonation link")
            }
            // Open the magic link in a new tab so the super-admin's
            // current session stays intact in this tab.
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

    async function confirmDelete(tenant: TenantRow) {
        setBusy({ id: tenant.id, action: "delete" })
        try {
            const r = await fetch(`/api/super-admin/tenant/${tenant.id}`, { method: "DELETE" })
            const data = await r.json() as {
                ok?: boolean
                error?: string
                cleanup?: {
                    storage_objects_deleted: number
                    auth_users_deleted: number
                    storage_errors: string[]
                    auth_errors: string[]
                    stripe_subscription: string
                    stripe_connect: string
                }
            }
            if (!r.ok || !data.ok) throw new Error(data.error ?? "Delete failed")
            setTenants((rows) => rows.filter((r) => r.id !== tenant.id))
            const c = data.cleanup
            toast.success(`${tenant.name ?? "Tenant"} deleted`, {
                description: c
                    ? `${c.auth_users_deleted} users · ${c.storage_objects_deleted} files removed`
                        + (c.storage_errors.length + c.auth_errors.length > 0
                            ? ` · ${c.storage_errors.length + c.auth_errors.length} cleanup warnings (check logs)`
                            : "")
                    : undefined,
                duration: 6000,
            })
            setDeleteTarget(null)
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Delete failed")
        } finally {
            setBusy(null)
        }
    }

    const rangeStart = sorted.length === 0 ? 0 : (currentPage - 1) * perPage + 1
    const rangeEnd = Math.min(currentPage * perPage, sorted.length)

    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search name, slug, country, owner…"
                        className="pl-8"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <FilterSelect
                    value={countryFilter}
                    onChange={setCountryFilter}
                    allLabel="All countries"
                    options={countries}
                />
                {plans.length > 0 && (
                    <FilterSelect
                        value={planFilter}
                        onChange={setPlanFilter}
                        allLabel="All plans"
                        options={plans}
                    />
                )}
                <Select value={billingFilter} onValueChange={setBillingFilter}>
                    <SelectTrigger className="w-[170px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {BILLING_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select value={sortBy} onValueChange={setSortBy}>
                    <SelectTrigger className="w-[170px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {SORT_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                                {o.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <Card className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Restaurant</TableHead>
                            <TableHead>Country</TableHead>
                            <TableHead>Plan</TableHead>
                            <TableHead>Owner</TableHead>
                            <TableHead className="text-right">Branches</TableHead>
                            <TableHead className="text-right">Staff</TableHead>
                            <TableHead className="text-right">Bills</TableHead>
                            <TableHead>Joined</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {pageRows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                                    {tenants.length === 0
                                        ? "No restaurants registered yet."
                                        : "No restaurants match the filters."}
                                </TableCell>
                            </TableRow>
                        ) : pageRows.map((t) => (
                            <TableRow
                                key={t.id}
                                onClick={() => router.push(`/super-admin/restaurant/${t.id}`)}
                                // Whole row is clickable → detail page. The
                                // per-row buttons in the last cell stop
                                // propagation so they don't navigate.
                                className="cursor-pointer hover:bg-muted/40 transition-colors"
                            >
                                <TableCell>
                                    <div className="font-medium">{t.name ?? "(unnamed)"}</div>
                                    <div className="text-[11px] font-mono text-muted-foreground">{t.slug ?? "—"}</div>
                                </TableCell>
                                <TableCell>
                                    <span className="text-sm">{t.country ?? "—"}</span>
                                    <div className="text-[10px] text-muted-foreground">{t.currency ?? ""}</div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-1.5">
                                        <Badge variant="outline" className="text-[10px] capitalize">
                                            {t.plan_tier ?? "—"}
                                        </Badge>
                                        <SubscriptionBadge status={t.subscription_status} />
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="text-sm">{t.owner_full_name ?? "—"}</div>
                                    <div className="text-[11px] font-mono text-muted-foreground truncate max-w-[200px]">
                                        {t.owner_email ?? "—"}
                                    </div>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">{t.branch_count}</TableCell>
                                <TableCell className="text-right tabular-nums">{t.staff_count}</TableCell>
                                <TableCell className="text-right tabular-nums">{t.total_bills}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                    {formatDate(t.created_at, { dateStyle: "medium" })}
                                </TableCell>
                                <TableCell
                                    className="text-right"
                                    // Stop the row click from firing when a
                                    // user clicks an action button or the
                                    // surrounding cell whitespace.
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => impersonate(t)}
                                            disabled={busy?.id === t.id}
                                            title="Sign in as the restaurant owner in a new tab"
                                        >
                                            {busy?.id === t.id && busy.action === "impersonate"
                                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                : <LogIn className="h-3.5 w-3.5" />}
                                            Impersonate
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                            onClick={() => setDeleteTarget(t)}
                                            disabled={busy?.id === t.id}
                                            title="Delete this restaurant and all its data"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Card>

            {/* Pagination footer */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Rows per page</span>
                    <Select value={String(perPage)} onValueChange={(v) => setPerPage(Number(v))}>
                        <SelectTrigger className="h-8 w-[72px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {PER_PAGE_OPTIONS.map((n) => (
                                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="tabular-nums">
                        {sorted.length === 0 ? "0" : `${rangeStart}–${rangeEnd}`} of {sorted.length}
                    </span>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={currentPage <= 1}
                            onClick={() => setPage(currentPage - 1)}
                            aria-label="Previous page"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="px-1 tabular-nums">
                            Page {currentPage} of {totalPages}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={currentPage >= totalPages}
                            onClick={() => setPage(currentPage + 1)}
                            aria-label="Next page"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </div>

            {deleteTarget && (
                <DeleteTenantDialog
                    tenant={deleteTarget}
                    busy={busy?.id === deleteTarget.id && busy.action === "delete"}
                    onClose={() => setDeleteTarget(null)}
                    onConfirm={() => confirmDelete(deleteTarget)}
                />
            )}
        </>
    )
}

/** A single "All X" + distinct-values dropdown used for the filters. */
function FilterSelect({
    value,
    onChange,
    allLabel,
    options,
}: {
    value: string
    onChange: (v: string) => void
    allLabel: string
    options: string[]
}) {
    return (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger className="w-[150px]">
                <SelectValue placeholder={allLabel} />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="ALL">{allLabel}</SelectItem>
                {options.map((o) => (
                    <SelectItem key={o} value={o} className="capitalize">{o}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

function SubscriptionBadge({ status }: { status: string | null }) {
    if (!status) return null
    const variant = status === "ACTIVE" ? "success"
        : status === "TRIAL" ? "default"
        : status === "PAST_DUE" ? "warning"
        : "destructive"
    return (
        <Badge variant={variant} className={cn("text-[10px]")}>
            {status}
        </Badge>
    )
}
