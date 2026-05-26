"use client"

import { useEffect, useState } from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency } from "@/lib/utils"
import type { ItemVariant, MenuItem, Modifier, ModifierGroup } from "@/types/database"

export default function MenuExtrasPage() {
    const supabase = createClient()
    const [tenantId, setTenantId] = useState("")
    const [items, setItems] = useState<MenuItem[]>([])
    const [variants, setVariants] = useState<ItemVariant[]>([])
    const [groups, setGroups] = useState<ModifierGroup[]>([])
    const [modifiers, setModifiers] = useState<Modifier[]>([])

    const [groupOpen, setGroupOpen] = useState(false)
    const [groupForm, setGroupForm] = useState({ name: "", is_required: false, min_select: "0", max_select: "1" })

    const [modOpen, setModOpen] = useState(false)
    const [modForm, setModForm] = useState({ group_id: "", name: "", price_delta: "0" })

    const [variantOpen, setVariantOpen] = useState(false)
    const [variantForm, setVariantForm] = useState({ item_id: "", name: "", price_delta: "0" })

    const [busy, setBusy] = useState(false)

    async function refresh() {
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) return
        const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
        if (!row?.tenant_id) return
        setTenantId(row.tenant_id)
        const [{ data: i }, { data: v }, { data: g }, { data: m }] = await Promise.all([
            supabase.from("menu_items").select("*").is("deleted_at", null).order("name"),
            supabase.from("item_variants").select("*").is("deleted_at", null).order("sort_order"),
            supabase.from("modifier_groups").select("*").is("deleted_at", null).order("name"),
            supabase.from("modifiers").select("*").is("deleted_at", null).order("sort_order"),
        ])
        setItems((i ?? []) as MenuItem[])
        setVariants((v ?? []) as ItemVariant[])
        setGroups((g ?? []) as ModifierGroup[])
        setModifiers((m ?? []) as Modifier[])
    }
    useEffect(() => { refresh() }, [])

    async function saveGroup(e: React.FormEvent) {
        e.preventDefault()
        if (!groupForm.name.trim()) return
        setBusy(true)
        const { error } = await supabase.from("modifier_groups").insert({
            tenant_id: tenantId,
            name: groupForm.name.trim(),
            is_required: groupForm.is_required,
            min_select: Number(groupForm.min_select) || 0,
            max_select: Number(groupForm.max_select) || 1,
        } as never)
        setBusy(false)
        if (error) return toast.error(error.message)
        toast.success("Group added")
        setGroupOpen(false)
        setGroupForm({ name: "", is_required: false, min_select: "0", max_select: "1" })
        refresh()
    }

    async function saveModifier(e: React.FormEvent) {
        e.preventDefault()
        if (!modForm.group_id || !modForm.name.trim()) return
        setBusy(true)
        const { error } = await supabase.from("modifiers").insert({
            tenant_id: tenantId,
            group_id: modForm.group_id,
            name: modForm.name.trim(),
            price_delta: Number(modForm.price_delta) || 0,
        } as never)
        setBusy(false)
        if (error) return toast.error(error.message)
        toast.success("Modifier added")
        setModOpen(false)
        setModForm({ group_id: modForm.group_id, name: "", price_delta: "0" })
        refresh()
    }

    async function saveVariant(e: React.FormEvent) {
        e.preventDefault()
        if (!variantForm.item_id || !variantForm.name.trim()) return
        setBusy(true)
        const { error } = await supabase.from("item_variants").insert({
            tenant_id: tenantId,
            item_id: variantForm.item_id,
            name: variantForm.name.trim(),
            price_delta: Number(variantForm.price_delta) || 0,
        } as never)
        setBusy(false)
        if (error) return toast.error(error.message)
        toast.success("Variant added")
        setVariantOpen(false)
        setVariantForm({ item_id: variantForm.item_id, name: "", price_delta: "0" })
        refresh()
    }

    async function deleteVariant(v: ItemVariant) {
        if (!confirm(`Delete variant "${v.name}"?`)) return
        const { error } = await supabase.from("item_variants").update({ deleted_at: new Date().toISOString() } as never).eq("id", v.id)
        if (error) return toast.error(error.message)
        refresh()
    }
    async function deleteModifier(m: Modifier) {
        if (!confirm(`Delete modifier "${m.name}"?`)) return
        const { error } = await supabase.from("modifiers").update({ deleted_at: new Date().toISOString() } as never).eq("id", m.id)
        if (error) return toast.error(error.message)
        refresh()
    }
    async function deleteGroup(g: ModifierGroup) {
        if (!confirm(`Delete group "${g.name}" and all its modifiers?`)) return
        const { error } = await supabase.from("modifier_groups").update({ deleted_at: new Date().toISOString() } as never).eq("id", g.id)
        if (error) return toast.error(error.message)
        refresh()
    }

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-6xl space-y-6">
            <PageHeader
                kicker="Catalog"
                title="Variants &amp; Modifiers"
                highlight="customisation"
                description="Half/Full sizes, cheese add-ons, no onion — all the options."
            />

            <Tabs defaultValue="modifiers">
                <TabsList>
                    <TabsTrigger value="modifiers">Modifier groups</TabsTrigger>
                    <TabsTrigger value="variants">Variants</TabsTrigger>
                </TabsList>

                <TabsContent value="modifiers" className="space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <p className="text-sm text-muted-foreground">{groups.length} group(s) · {modifiers.length} modifier(s)</p>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setModOpen(true)} disabled={groups.length === 0}><Plus className="h-4 w-4" /> New modifier</Button>
                            <Button variant="neon" onClick={() => setGroupOpen(true)}><Plus className="h-4 w-4" /> New group</Button>
                        </div>
                    </div>

                    {groups.length === 0 ? (
                        <Card><CardContent className="text-center py-12 text-muted-foreground">
                            No modifier groups yet. Example: "Choose your bread" (required, pick 1) → Roti / Naan / Paratha.
                        </CardContent></Card>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2">
                            {groups.map((g) => {
                                const mods = modifiers.filter((m) => m.group_id === g.id)
                                return (
                                    <Card key={g.id}>
                                        <CardHeader className="pb-2">
                                            <div className="flex items-start justify-between">
                                                <div>
                                                    <CardTitle className="text-base">{g.name}</CardTitle>
                                                    <div className="flex gap-1 mt-1">
                                                        {g.is_required && <Badge variant="warning">Required</Badge>}
                                                        <Badge variant="outline">Pick {g.min_select}-{g.max_select}</Badge>
                                                    </div>
                                                </div>
                                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteGroup(g)}>
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </CardHeader>
                                        <CardContent className="space-y-1">
                                            {mods.length === 0 ? (
                                                <p className="text-xs text-muted-foreground">No modifiers yet</p>
                                            ) : (
                                                mods.map((m) => (
                                                    <div key={m.id} className="flex items-center justify-between text-sm">
                                                        <span>{m.name}</span>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-muted-foreground">
                                                                {Number(m.price_delta) > 0 ? `+${formatCurrency(m.price_delta)}` :
                                                                 Number(m.price_delta) < 0 ? formatCurrency(m.price_delta) : "Free"}
                                                            </span>
                                                            <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => deleteModifier(m)}>
                                                                <Trash2 className="h-3 w-3" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                            <Button size="sm" variant="ghost" className="w-full mt-2" onClick={() => { setModForm({ ...modForm, group_id: g.id }); setModOpen(true) }}>
                                                <Plus className="h-3.5 w-3.5" /> Add modifier
                                            </Button>
                                        </CardContent>
                                    </Card>
                                )
                            })}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="variants" className="space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">{variants.length} variants across {new Set(variants.map((v) => v.item_id)).size} items</p>
                        <Button variant="neon" onClick={() => setVariantOpen(true)} disabled={items.length === 0}>
                            <Plus className="h-4 w-4" /> New variant
                        </Button>
                    </div>
                    {variants.length === 0 ? (
                        <Card><CardContent className="text-center py-12 text-muted-foreground">
                            No variants yet. Example: "Pizza" → Small (₹0), Medium (+₹120), Large (+₹240).
                        </CardContent></Card>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {Array.from(new Set(variants.map((v) => v.item_id))).map((itemId) => {
                                const item = items.find((i) => i.id === itemId)
                                const itemVariants = variants.filter((v) => v.item_id === itemId)
                                return (
                                    <Card key={itemId}>
                                        <CardHeader className="pb-2"><CardTitle className="text-base">{item?.name ?? "—"}</CardTitle></CardHeader>
                                        <CardContent className="space-y-1">
                                            {itemVariants.map((v) => (
                                                <div key={v.id} className="flex items-center justify-between text-sm">
                                                    <span>{v.name}</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-muted-foreground">
                                                            {Number(v.price_delta) === 0 ? formatCurrency(item?.base_price ?? 0)
                                                                : `${Number(v.price_delta) > 0 ? "+" : ""}${formatCurrency(v.price_delta)}`}
                                                        </span>
                                                        <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => deleteVariant(v)}>
                                                            <Trash2 className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </CardContent>
                                    </Card>
                                )
                            })}
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>New modifier group</DialogTitle></DialogHeader>
                    <form onSubmit={saveGroup} className="space-y-3">
                        <div className="space-y-1.5"><Label>Group name</Label><Input value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} placeholder="Choose your bread" /></div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5"><Label>Min select</Label><Input type="number" min="0" value={groupForm.min_select} onChange={(e) => setGroupForm({ ...groupForm, min_select: e.target.value })} /></div>
                            <div className="space-y-1.5"><Label>Max select</Label><Input type="number" min="1" value={groupForm.max_select} onChange={(e) => setGroupForm({ ...groupForm, max_select: e.target.value })} /></div>
                        </div>
                        <div className="flex items-center justify-between rounded-md border p-3">
                            <Label>Required group</Label>
                            <Switch checked={groupForm.is_required} onCheckedChange={(v) => setGroupForm({ ...groupForm, is_required: v })} />
                        </div>
                        <DialogFooter><Button type="submit" variant="neon" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Add</Button></DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={modOpen} onOpenChange={setModOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>New modifier</DialogTitle></DialogHeader>
                    <form onSubmit={saveModifier} className="space-y-3">
                        <div className="space-y-1.5">
                            <Label>Group</Label>
                            <Select value={modForm.group_id} onValueChange={(v) => setModForm({ ...modForm, group_id: v })}>
                                <SelectTrigger><SelectValue placeholder="Pick group" /></SelectTrigger>
                                <SelectContent>{groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5"><Label>Name</Label><Input value={modForm.name} onChange={(e) => setModForm({ ...modForm, name: e.target.value })} placeholder="Extra cheese" /></div>
                            <div className="space-y-1.5"><Label>Price delta (₹)</Label><Input type="number" step="0.01" value={modForm.price_delta} onChange={(e) => setModForm({ ...modForm, price_delta: e.target.value })} /></div>
                        </div>
                        <DialogFooter><Button type="submit" variant="neon" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Add</Button></DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={variantOpen} onOpenChange={setVariantOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>New variant</DialogTitle></DialogHeader>
                    <form onSubmit={saveVariant} className="space-y-3">
                        <div className="space-y-1.5">
                            <Label>Item</Label>
                            <Select value={variantForm.item_id} onValueChange={(v) => setVariantForm({ ...variantForm, item_id: v })}>
                                <SelectTrigger><SelectValue placeholder="Pick item" /></SelectTrigger>
                                <SelectContent>{items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5"><Label>Variant name</Label><Input value={variantForm.name} onChange={(e) => setVariantForm({ ...variantForm, name: e.target.value })} placeholder="Half" /></div>
                            <div className="space-y-1.5"><Label>Price delta (₹)</Label><Input type="number" step="0.01" value={variantForm.price_delta} onChange={(e) => setVariantForm({ ...variantForm, price_delta: e.target.value })} placeholder="0 for default size" /></div>
                        </div>
                        <DialogFooter><Button type="submit" variant="neon" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Add</Button></DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
