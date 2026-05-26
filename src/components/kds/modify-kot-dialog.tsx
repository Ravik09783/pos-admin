"use client"

/**
 * Modify-KOT dialog — the audited path for "customer changed their mind
 * after the KOT was sent".
 *
 * Two columns of action:
 *
 *   • LEFT  — items currently on the KOT. Each row has a checkbox that
 *             flags it to be VOIDED. Already-voided items are listed but
 *             greyed out (can't double-void).
 *   • RIGHT — search the menu, pick replacement / additional items.
 *             Quantities adjust inline. These get pushed as new
 *             order_items pointing at the SAME kot so the kitchen sees
 *             the change on their existing ticket.
 *
 * The "Reason" textarea is REQUIRED (min 2 chars). The RPC
 * (`modify_kot_items`) refuses anything blank — but we validate
 * client-side too so the cashier gets the message before round-tripping.
 *
 * Allowed KOT states: PENDING and PREPARING. The dialog refuses to
 * open on READY/SERVED/CANCELLED.
 */

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ChefHat, Loader2, Minus, Plus, RotateCcw, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { cn, formatCurrency } from "@/lib/utils"
import type { MenuItem } from "@/types/database"

export interface ModifiableKotItem {
    id: string
    item_name: string
    quantity: number | string
    line_total: number | string
    is_void: boolean
}

interface AddDraft {
    menu_item: MenuItem
    quantity: number
    notes: string
}

export function ModifyKotDialog({
    open, onClose,
    kotId, kotNumber, kotStatus,
    currentItems,
    currency = "INR",
    onSaved,
}: {
    open: boolean
    onClose: () => void
    kotId: string
    kotNumber: number
    kotStatus: "PENDING" | "PREPARING" | "READY" | "SERVED" | "CANCELLED"
    currentItems: ModifiableKotItem[]
    currency?: string
    onSaved: () => void
}) {
    const supabase = useMemo(() => createClient(), [])
    const money = (v: number) => formatCurrency(v, currency)

    const [reason, setReason] = useState("")
    const [voidIds, setVoidIds] = useState<Set<string>>(new Set())
    const [adds, setAdds] = useState<AddDraft[]>([])
    const [menuSearch, setMenuSearch] = useState("")
    const [menu, setMenu] = useState<MenuItem[]>([])
    const [loadingMenu, setLoadingMenu] = useState(false)
    const [saving, setSaving] = useState(false)

    // Reset whenever a NEW kot is opened.
    useEffect(() => {
        if (!open) return
        setReason("")
        setVoidIds(new Set())
        setAdds([])
        setMenuSearch("")
    }, [open, kotId])

    // Fetch the menu on first open. Cheap, single round-trip; the cashier
    // is unlikely to keep this dialog open long enough for it to stale.
    useEffect(() => {
        if (!open) return
        if (menu.length > 0) return
        setLoadingMenu(true)
        ;(async () => {
            const { data } = await supabase
                .from("menu_items")
                .select("*")
                .eq("is_active", true)
                .is("deleted_at", null)
                .order("sort_order")
            setMenu((data ?? []) as MenuItem[])
            setLoadingMenu(false)
        })()
    }, [open, supabase, menu.length])

    function toggleVoid(id: string) {
        setVoidIds((s) => {
            const next = new Set(s)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    function bumpAdd(mi: MenuItem, delta: number) {
        setAdds((prev) => {
            const ix = prev.findIndex((a) => a.menu_item.id === mi.id)
            if (ix === -1) {
                if (delta > 0) return [...prev, { menu_item: mi, quantity: delta, notes: "" }]
                return prev
            }
            const next = [...prev]
            const newQty = next[ix]!.quantity + delta
            if (newQty <= 0) next.splice(ix, 1)
            else next[ix] = { ...next[ix]!, quantity: newQty }
            return next
        })
    }

    const menuFiltered = useMemo(() => {
        const q = menuSearch.trim().toLowerCase()
        if (!q) return menu.slice(0, 50)
        return menu.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 50)
    }, [menu, menuSearch])

    const dirty = voidIds.size > 0 || adds.length > 0

    const stateLocked = kotStatus !== "PENDING" && kotStatus !== "PREPARING"

    /** Reason + audit kick in only after the kitchen has started
     *  cooking. While the KOT is still PENDING the change is free —
     *  no waste, nobody to apologise to, no row in the audit log. */
    const reasonRequired = kotStatus === "PREPARING"

    async function save() {
        if (stateLocked) {
            toast.error(`Can't modify — KOT is already ${kotStatus}. Send a new KOT instead.`)
            return
        }
        if (reasonRequired && reason.trim().length < 2) {
            toast.error("Kitchen has already started — enter a reason so the audit log can record it.")
            return
        }
        if (!dirty) {
            toast.error("Nothing to modify — flag at least one item to void OR add something new.")
            return
        }
        setSaving(true)
        try {
            const { data, error } = await supabase.rpc("modify_kot_items" as never, {
                p_kot_id: kotId,
                p_void_item_ids: Array.from(voidIds),
                p_add_items: adds.map((a) => ({
                    menu_item_id: a.menu_item.id,
                    quantity: a.quantity,
                    notes: a.notes || null,
                })),
                p_reason: reason.trim(),
            } as never)
            if (error) {
                // Detect the "migration not applied yet" case and give the
                // operator a precise next step instead of the generic
                // PostgREST error string.
                const msg = (error as { message?: string; code?: string }).message ?? ""
                const code = (error as { code?: string }).code ?? ""
                if (code === "PGRST202" || /could not find the function|modify_kot_items/i.test(msg)) {
                    toast.error(
                        "Modify KOT isn't enabled in this database yet. Apply migration 50 "
                        + "(supabase/migrations/_backup_2026-05-20/50_kot_modifications.sql, "
                        + "or re-apply combined_schema.sql).",
                        { duration: 8000 },
                    )
                    return
                }
                throw error
            }
            const result = (data ?? {}) as { auto_cancelled?: boolean }
            if (result.auto_cancelled) {
                // The RPC noticed that voiding emptied the KOT and
                // flipped it to CANCELLED for us — surface that
                // explicitly so the cashier knows the KOT has dropped
                // off the kitchen screen, not just had items removed.
                toast.success(`KOT #${kotNumber} had no items left after the change — cancelled automatically.`)
            } else {
                const voidedN = voidIds.size
                const addedN = adds.length
                const parts: string[] = []
                if (voidedN > 0) parts.push(`removed ${voidedN}`)
                if (addedN > 0)  parts.push(`added ${addedN}`)
                toast.success(`KOT #${kotNumber} updated — kitchen will see the change (${parts.join(", ")}).`)
            }
            onSaved()
            onClose()
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Couldn't save changes"
            toast.error(msg)
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ChefHat className="h-5 w-5 text-primary" />
                        Modify KOT #{kotNumber}
                        <Badge variant={kotStatus === "PENDING" ? "warning" : "outline"} className="text-[10px]">
                            {kotStatus}
                        </Badge>
                    </DialogTitle>
                </DialogHeader>

                {stateLocked ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/[0.05] p-4 text-sm flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                        <div>
                            <strong>This KOT can&apos;t be edited.</strong> Once the kitchen
                            marks a ticket {kotStatus}, the food is already plated. Send a
                            <strong> new KOT</strong> for the new items instead — the new
                            KOT will sit alongside this one on the kitchen screen and the
                            audit log will tie them together.
                        </div>
                    </div>
                ) : (
                    <div className="grid md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto">
                        {/* LEFT — items currently on the KOT */}
                        <div className="space-y-2">
                            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                                On this ticket
                            </h3>
                            <ul className="space-y-1.5">
                                {currentItems.length === 0 && (
                                    <li className="text-xs text-muted-foreground italic">(empty KOT)</li>
                                )}
                                {currentItems.map((it) => {
                                    const isVoided = it.is_void
                                    const flagged = voidIds.has(it.id)
                                    // Whole row + the trash icon both toggle
                                    // the void flag — the old single-checkbox
                                    // target was too small and the trash icon
                                    // looked clickable but wasn't.
                                    return (
                                        <li
                                            key={it.id}
                                            role={isVoided ? undefined : "button"}
                                            tabIndex={isVoided ? -1 : 0}
                                            onClick={isVoided ? undefined : () => toggleVoid(it.id)}
                                            onKeyDown={(e) => {
                                                if (isVoided) return
                                                if (e.key === "Enter" || e.key === " ") {
                                                    e.preventDefault()
                                                    toggleVoid(it.id)
                                                }
                                            }}
                                            className={cn(
                                                "flex items-center gap-2 rounded-md border p-2 text-sm select-none transition-colors",
                                                isVoided && "opacity-50 line-through",
                                                flagged && "border-destructive/50 bg-destructive/[0.05] line-through",
                                                !isVoided && !flagged && "border-border/60 cursor-pointer hover:border-destructive/40 hover:bg-destructive/[0.03]",
                                                !isVoided && flagged && "cursor-pointer",
                                            )}
                                        >
                                            <span className="text-primary text-xs font-mono mr-1">×{Number(it.quantity)}</span>
                                            <span className="flex-1 truncate">{it.item_name}</span>
                                            <span className="text-xs tabular-nums text-muted-foreground">{money(Number(it.line_total))}</span>
                                            {isVoided ? (
                                                <Badge variant="outline" className="text-[10px]">already voided</Badge>
                                            ) : (
                                                <Button
                                                    type="button"
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-7 w-7 shrink-0"
                                                    onClick={(e) => {
                                                        // Stop the click bubbling to the row's
                                                        // own onClick — without this the row
                                                        // handler immediately undoes the toggle.
                                                        e.stopPropagation()
                                                        toggleVoid(it.id)
                                                    }}
                                                    aria-label={flagged ? `Restore ${it.item_name}` : `Remove ${it.item_name}`}
                                                    title={flagged ? "Keep this item" : "Remove from this KOT"}
                                                >
                                                    {flagged
                                                        ? <RotateCcw className="h-3.5 w-3.5 text-success" />
                                                        : <Trash2 className="h-3.5 w-3.5 text-destructive" />}
                                                </Button>
                                            )}
                                        </li>
                                    )
                                })}
                            </ul>
                        </div>

                        {/* RIGHT — add new items */}
                        <div className="space-y-2">
                            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                                Add to this ticket
                            </h3>
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    value={menuSearch}
                                    onChange={(e) => setMenuSearch(e.target.value)}
                                    placeholder="Find a menu item…"
                                    className="pl-8 h-9 text-sm"
                                />
                            </div>
                            {adds.length > 0 && (
                                <div className="space-y-1 rounded-md border border-primary/30 bg-primary/[0.04] p-2">
                                    <div className="text-[10px] uppercase tracking-wider text-primary font-semibold">Adding</div>
                                    {adds.map((a) => (
                                        <div key={a.menu_item.id} className="flex items-center gap-2 text-sm">
                                            <span className="text-primary text-xs font-mono">×{a.quantity}</span>
                                            <span className="flex-1 truncate">{a.menu_item.name}</span>
                                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => bumpAdd(a.menu_item, -1)}>
                                                <Minus className="h-3 w-3" />
                                            </Button>
                                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => bumpAdd(a.menu_item, 1)}>
                                                <Plus className="h-3 w-3" />
                                            </Button>
                                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setAdds((prev) => prev.filter((x) => x.menu_item.id !== a.menu_item.id))}>
                                                <X className="h-3 w-3 text-destructive" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {loadingMenu ? (
                                <div className="text-xs text-muted-foreground py-2">Loading menu…</div>
                            ) : (
                                <ul className="space-y-1 max-h-[40vh] overflow-y-auto">
                                    {menuFiltered.map((mi) => (
                                        <li key={mi.id} className="flex items-center justify-between gap-2 rounded-md border border-border/40 p-2 text-sm hover:border-primary/40">
                                            <div className="min-w-0">
                                                <div className="truncate">{mi.name}</div>
                                                <div className="text-[11px] text-muted-foreground tabular-nums">
                                                    {money(Number(mi.sale_price ?? mi.base_price))}
                                                </div>
                                            </div>
                                            <Button size="sm" variant="outline" onClick={() => bumpAdd(mi, 1)}>
                                                <Plus className="h-3 w-3" /> Add
                                            </Button>
                                        </li>
                                    ))}
                                    {menuFiltered.length === 0 && menuSearch && (
                                        <li className="text-xs text-muted-foreground italic text-center py-2">No matches.</li>
                                    )}
                                </ul>
                            )}
                        </div>
                    </div>
                )}

                {!stateLocked && reasonRequired && (
                    <div className="space-y-2 border-t border-border/40 pt-3">
                        <Label className="text-sm">
                            Why are you changing this KOT? <span className="text-destructive">*</span>
                        </Label>
                        <Textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Customer changed their order — wanted veg instead of paneer…"
                            rows={2}
                            maxLength={500}
                        />
                        <p className="text-[11px] text-muted-foreground">
                            The kitchen has already started — the audit log will keep your name + this reason next to the bill so supervisors can review modifications during shift close.
                        </p>
                    </div>
                )}
                {!stateLocked && !reasonRequired && (
                    <div className="rounded-md border border-border/40 bg-card/40 px-3 py-2 text-[11px] text-muted-foreground">
                        Kitchen hasn&apos;t started cooking yet — this change is free, no reason needed.
                    </div>
                )}

                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    {!stateLocked && (
                        <Button
                            variant="neon"
                            onClick={save}
                            disabled={saving || !dirty || (reasonRequired && reason.trim().length < 2)}
                        >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChefHat className="h-4 w-4" />}
                            Send change to kitchen
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
