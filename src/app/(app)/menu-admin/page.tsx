// "use client"

// import { useEffect, useMemo, useState } from "react"
// import { ArrowRight, Ban, Building2, Lightbulb, Loader2, Pencil, Plus, Save, Settings2, Trash2 } from "lucide-react"
// import { toast } from "sonner"

// import { Badge } from "@/components/ui/badge"
// import { Button } from "@/components/ui/button"
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
// import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
// import { Input } from "@/components/ui/input"
// import { Label } from "@/components/ui/label"
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
// import { Textarea } from "@/components/ui/textarea"
// import { Switch } from "@/components/ui/switch"
// import { Skeleton } from "@/components/ui/skeleton"
// import { PageHeader } from "@/components/app-shell/page-header"
// import { ImageUploader } from "@/components/ui/image-uploader"
// import { createClient } from "@/lib/supabase/client"
// import { deleteFromStorage, pathFromPublicUrl, tenantImagePath } from "@/lib/storage/image-upload"
// import { getTaxConfig } from "@/lib/tax/locale-config"
// import { cn, formatCurrency } from "@/lib/utils"
// import { useActiveBranch } from "@/lib/branch/active-branch"
// import type { FoodType, HsnCode, MenuCategory, MenuItem, UserRole } from "@/types/database"

// const MAX_RECOMMENDATIONS = 6
// const FOOD_TYPES: { value: FoodType; label: string; dot: string }[] = [
//     { value: "VEG", label: "Veg", dot: "bg-green-500" },
//     { value: "NON_VEG", label: "Non-Veg", dot: "bg-red-500" },
//     { value: "EGG", label: "Egg", dot: "bg-amber-500" },
//     { value: "VEGAN", label: "Vegan", dot: "bg-emerald-500" },
// ]

// interface ItemForm {
//     id?: string
//     name: string
//     description: string
//     category_id: string
//     base_price: string
//     /** Optional discounted selling price. Empty string = no sale. When the
//      *  user fills it in, save() validates it's > 0 and < base_price before
//      *  inserting (Postgres CHECK constraint enforces the same on the DB). */
//     sale_price: string
//     food_type: FoodType
//     hsn_code: string
//     gst_slab: string
//     is_tax_inclusive: boolean
//     is_active: boolean
//     prep_time_minutes: string
//     image_url: string | null
//     /** Which branch this item belongs to. Null = "available at every
//      *  branch" (legacy + intentional shared items). Set to a specific
//      *  branch id to scope the item — including its is_sold_out flag —
//      *  to just that outlet. */
//     branch_id: string | null
//     /** IDs of other menu items suggested as add-ons (Domino's-style upsell). */
//     recommendedIds: string[]
// }

// const EMPTY_ITEM: ItemForm = {
//     name: "",
//     description: "",
//     category_id: "",
//     base_price: "0",
//     sale_price: "",
//     food_type: "VEG",
//     hsn_code: "996331",
//     gst_slab: "5",
//     is_tax_inclusive: false,
//     is_active: true,
//     prep_time_minutes: "10",
//     image_url: null,
//     branch_id: null,
//     recommendedIds: [],
// }

// export default function MenuPage() {
//     const supabase = createClient()
//     const [loading, setLoading] = useState(true)
//     const [tenantId, setTenantId] = useState<string>("")
//     const [tenantCountry, setTenantCountry] = useState<string | null>(null)
//     const [categories, setCategories] = useState<MenuCategory[]>([])
//     const [items, setItems] = useState<MenuItem[]>([])
//     const [hsnCodes, setHsnCodes] = useState<HsnCode[]>([])
//     const [activeCat, setActiveCat] = useState<string | "ALL">("ALL")
//     // Multi-branch: the global active branch (set in the topbar) drives
//     // which items show in the catalog and which branch new items belong
//     // to. NULL-branch items are "available everywhere" so they always
//     // show regardless of which branch is active.
//     const { activeBranchId, branches } = useActiveBranch()
//     const [importOpen, setImportOpen] = useState(false)
//     const [importSource, setImportSource] = useState<string>("")
//     const [importTarget, setImportTarget] = useState<string>("")
//     const [importBusy, setImportBusy] = useState(false)

//     const cfg = useMemo(() => getTaxConfig(tenantCountry), [tenantCountry])

//     const [catDialogOpen, setCatDialogOpen] = useState(false)
//     const [newCatName, setNewCatName] = useState("")
//     const [savingCat, setSavingCat] = useState(false)

//     const [itemDialogOpen, setItemDialogOpen] = useState(false)
//     const [editing, setEditing] = useState<ItemForm>(EMPTY_ITEM)
//     const [savingItem, setSavingItem] = useState(false)

//     // Role gating — only OWNER / MANAGER manage the catalog (matches the
//     // menu_categories_write RLS policy). Other staff get a read-only view.
//     const [role, setRole] = useState<UserRole>("CASHIER")
//     const canManage = role === "OWNER" || role === "MANAGER"

//     // Manage-categories dialog (rename + delete)
//     const [manageCatsOpen, setManageCatsOpen] = useState(false)
//     const [catEdits, setCatEdits] = useState<Record<string, string>>({})
//     const [catBusy, setCatBusy] = useState<string | null>(null)

//     async function refresh() {
//         setLoading(true)
//         const { data: u } = await supabase.auth.getUser()
//         if (!u.user) return
//         const { data: row } = await supabase.from("users").select("tenant_id, role").eq("id", u.user.id).maybeSingle()
//         if (!row?.tenant_id) return
//         setTenantId(row.tenant_id)
//         setRole((row as { role?: UserRole }).role ?? "CASHIER")
//         const [{ data: cats }, { data: its }, { data: hsn }, { data: tenant }] = await Promise.all([
//             supabase.from("menu_categories").select("*").is("deleted_at", null).order("sort_order"),
//             supabase.from("menu_items").select("*").is("deleted_at", null).order("sort_order"),
//             supabase.from("hsn_codes").select("*").order("code"),
//             supabase.from("tenants").select("country").eq("id", row.tenant_id).maybeSingle(),
//         ])
//         setTenantCountry((tenant as { country?: string } | null)?.country ?? null)
//         setCategories((cats ?? []) as MenuCategory[])
//         setItems((its ?? []) as MenuItem[])
//         setHsnCodes((hsn ?? []) as HsnCode[])
//         setLoading(false)
//     }

//     /** Items visible at the currently-active branch. NULL active = "all
//      *  branches" view shows everything. NULL branch_id on a row = shared,
//      *  so it appears at every branch. */
//     const branchScopedItems = useMemo(() => {
//         if (activeBranchId === null) return items
//         return items.filter((i) => {
//             const b = (i as MenuItem & { branch_id?: string | null }).branch_id
//             return b === activeBranchId || !b
//         })
//     }, [items, activeBranchId])

//     async function runImport() {
//         if (!importSource || !importTarget) return toast.error("Pick source and target branches")
//         if (importSource === importTarget) return toast.error("Source and target must differ")
//         setImportBusy(true)
//         try {
//             const { data, error } = await supabase.rpc("copy_menu_to_branch" as never, {
//                 p_source_branch_id: importSource,
//                 p_target_branch_id: importTarget,
//             } as never)
//             if (error) throw error
//             const r = data as { copied?: number; skipped_existing?: number } | null
//             toast.success(`Imported ${r?.copied ?? 0} item(s)${r?.skipped_existing ? ` · skipped ${r.skipped_existing} that already existed at the target` : ""}`)
//             setImportOpen(false)
//             setImportSource("")
//             setImportTarget("")
//             refresh()
//         } catch (e: unknown) {
//             toast.error(e instanceof Error ? e.message : "Import failed")
//         } finally {
//             setImportBusy(false)
//         }
//     }

//     useEffect(() => {
//         refresh()
//     }, [])

//     const visibleItems =
//         activeCat === "ALL" ? branchScopedItems : branchScopedItems.filter((i) => i.category_id === activeCat)

//     // Candidates for the "recommended add-ons" picker = every active item
//     // except the one currently being edited.
//     const recCandidates = useMemo(
//         () => items.filter((i) => i.is_active && i.id !== editing.id),
//         [items, editing.id],
//     )
//     const recById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

//     async function saveCategory(e: React.FormEvent) {
//         e.preventDefault()
//         if (!newCatName.trim()) return
//         setSavingCat(true)
//         const { error } = await supabase
//             .from("menu_categories")
//             .insert({ tenant_id: tenantId, name: newCatName.trim(), sort_order: categories.length } as never)
//         setSavingCat(false)
//         if (error) return toast.error(error.message)
//         toast.success("Category created")
//         setNewCatName("")
//         setCatDialogOpen(false)
//         refresh()
//     }

//     async function updateCategoryImage(cat: MenuCategory, url: string | null) {
//         // Capture the previous URL before we mutate state so we can clean up
//         // the old object from storage after the DB write commits.
//         const prev = (cat as MenuCategory & { image_url?: string | null }).image_url ?? null
//         // Optimistic — the uploader already toasted the success. If the DB
//         // update fails the next refresh() snaps the value back.
//         setCategories((p) => p.map((c) =>
//             c.id === cat.id ? ({ ...c, image_url: url } as MenuCategory) : c,
//         ))
//         const { error } = await supabase
//             .from("menu_categories")
//             .update({ image_url: url } as never)
//             .eq("id", cat.id)
//         if (error) {
//             toast.error(`Couldn't save image: ${error.message}`)
//             refresh()
//             return
//         }
//         // Replacing or clearing → delete the orphan from storage (best-effort).
//         if (prev && prev !== url) {
//             const oldPath = pathFromPublicUrl(prev, "menu-images")
//             if (oldPath) await deleteFromStorage(supabase, "menu-images", [oldPath])
//         }
//     }

//     async function renameCategory(cat: MenuCategory) {
//         const next = (catEdits[cat.id] ?? cat.name).trim()
//         if (!next || next === cat.name) return
//         setCatBusy(cat.id)
//         const { error } = await supabase
//             .from("menu_categories")
//             .update({ name: next } as never)
//             .eq("id", cat.id)
//         setCatBusy(null)
//         if (error) return toast.error(error.message)
//         toast.success(`Renamed to "${next}"`)
//         setCatEdits((p) => { const c = { ...p }; delete c[cat.id]; return c })
//         refresh()
//     }

//     async function deleteCategory(cat: MenuCategory) {
//         const inCat = items.filter((i) => i.category_id === cat.id)
//         const msg = inCat.length > 0
//             ? `Delete "${cat.name}"? ${inCat.length} item${inCat.length !== 1 ? "s" : ""} in this category will be archived along with it.`
//             : `Delete "${cat.name}"?`
//         if (!confirm(msg)) return
//         setCatBusy(cat.id)
//         const now = new Date().toISOString()

//         // Collect every image we'll need to clean from storage — the category's
//         // own image plus each child item's. We compute paths up front so a
//         // failed DB write doesn't leave us with the row still pointing at the
//         // (already deleted) object.
//         const catImagePath = pathFromPublicUrl(
//             (cat as MenuCategory & { image_url?: string | null }).image_url ?? null,
//             "menu-images",
//         )
//         const itemImagePaths = inCat
//             .map((i) => pathFromPublicUrl(i.image_url, "menu-images"))
//             .filter((p): p is string => Boolean(p))

//         const catPatch: Record<string, string | null> = { deleted_at: now }
//         if (catImagePath) catPatch.image_url = null
//         const { error: cErr } = await supabase
//             .from("menu_categories")
//             .update(catPatch as never)
//             .eq("id", cat.id)
//         if (cErr) { setCatBusy(null); return toast.error(cErr.message) }
//         if (inCat.length > 0) {
//             // archive the items too — they'd otherwise become orphaned (visible
//             // under "ALL" but unreachable from any category chip). Null out
//             // image_url in the same UPDATE so the rows don't keep dangling
//             // pointers if anyone restores them later.
//             const { error: iErr } = await supabase
//                 .from("menu_items")
//                 .update({ deleted_at: now, image_url: null } as never)
//                 .eq("category_id", cat.id)
//                 .is("deleted_at", null)
//             if (iErr) {
//                 setCatBusy(null)
//                 return toast.error(`Category deleted, but couldn't archive its items: ${iErr.message}`)
//             }
//         }
//         // Best-effort storage cleanup — one round-trip for all paths.
//         const allPaths = catImagePath ? [catImagePath, ...itemImagePaths] : itemImagePaths
//         if (allPaths.length > 0) {
//             await deleteFromStorage(supabase, "menu-images", allPaths)
//         }
//         setCatBusy(null)
//         toast.success(inCat.length > 0 ? `Deleted, archived ${inCat.length} item${inCat.length !== 1 ? "s" : ""}` : "Deleted")
//         if (activeCat === cat.id) setActiveCat("ALL")
//         refresh()
//     }

//     function openCreate() {
//         // New items are auto-assigned to the currently-active branch.
//         // Active = null ("All branches" view) → item is shared. Admin can
//         // change this later if needed.
//         setEditing({
//             ...EMPTY_ITEM,
//             category_id: activeCat === "ALL" ? categories[0]?.id ?? "" : activeCat,
//             gst_slab: String(cfg.defaultRate),
//             branch_id: activeBranchId,
//             recommendedIds: [],
//         })
//         setItemDialogOpen(true)
//     }
//     async function openEdit(it: MenuItem) {
//         // Pull this item's existing recommendations so the picker is pre-filled.
//         const { data: recs } = await supabase
//             .from("menu_item_recommendations")
//             .select("recommended_item_id, sort_order")
//             .eq("item_id", it.id)
//             .order("sort_order")
//         const recommendedIds = ((recs ?? []) as { recommended_item_id: string }[]).map((r) => r.recommended_item_id)
//         setEditing({
//             id: it.id,
//             name: it.name,
//             description: it.description ?? "",
//             category_id: it.category_id ?? "",
//             base_price: String(it.base_price),
//             sale_price: it.sale_price != null ? String(it.sale_price) : "",
//             food_type: it.food_type,
//             hsn_code: it.hsn_code ?? "996331",
//             gst_slab: String(it.gst_slab),
//             is_tax_inclusive: it.is_tax_inclusive,
//             is_active: it.is_active,
//             prep_time_minutes: String(it.prep_time_minutes),
//             image_url: it.image_url ?? null,
//             branch_id: (it as MenuItem & { branch_id?: string | null }).branch_id ?? null,
//             recommendedIds,
//         })
//         setItemDialogOpen(true)
//     }

//     function toggleRecommendation(id: string) {
//         setEditing((prev) => {
//             const has = prev.recommendedIds.includes(id)
//             if (has) return { ...prev, recommendedIds: prev.recommendedIds.filter((x) => x !== id) }
//             if (prev.recommendedIds.length >= MAX_RECOMMENDATIONS) {
//                 toast.error(`Up to ${MAX_RECOMMENDATIONS} suggestions per item`)
//                 return prev
//             }
//             return { ...prev, recommendedIds: [...prev.recommendedIds, id] }
//         })
//     }

//     async function syncRecommendations(itemId: string, recommendedIds: string[]) {
//         // Replace the whole set: clear then re-insert in picked order.
//         await supabase.from("menu_item_recommendations").delete().eq("item_id", itemId)
//         if (recommendedIds.length === 0) return
//         const rows = recommendedIds.map((rid, i) => ({
//             tenant_id: tenantId,
//             item_id: itemId,
//             recommended_item_id: rid,
//             sort_order: i,
//         }))
//         const { error } = await supabase.from("menu_item_recommendations").insert(rows as never)
//         if (error) toast.error(`Item saved, but suggestions failed: ${error.message}`)
//     }

//     async function saveItem(e: React.FormEvent) {
//         e.preventDefault()
//         if (!editing.name.trim()) return toast.error("Name required")
//         if (!editing.category_id) return toast.error("Pick a category")
//         const basePrice = Number(editing.base_price)
//         // Validate sale_price client-side (DB CHECK constraint is the
//         // belt-and-suspenders if this slips through):
//         //   - empty string / null = no sale, fine.
//         //   - present must be > 0 and strictly less than base_price.
//         let salePrice: number | null = null
//         const rawSale = editing.sale_price.trim()
//         if (rawSale !== "") {
//             const n = Number(rawSale)
//             if (!Number.isFinite(n) || n <= 0) {
//                 return toast.error("Sale price must be a positive number, or leave it blank")
//             }
//             if (n >= basePrice) {
//                 return toast.error("Sale price must be lower than the regular price")
//             }
//             salePrice = Number(n.toFixed(2))
//         }
//         setSavingItem(true)
//         const payload = {
//             tenant_id: tenantId,
//             category_id: editing.category_id,
//             name: editing.name.trim(),
//             description: editing.description.trim() || null,
//             base_price: basePrice,
//             sale_price: salePrice,
//             food_type: editing.food_type,
//             hsn_code: editing.hsn_code || null,
//             gst_slab: Number(editing.gst_slab),
//             is_tax_inclusive: editing.is_tax_inclusive,
//             is_active: editing.is_active,
//             prep_time_minutes: Number(editing.prep_time_minutes) || 10,
//             image_url: editing.image_url,
//             // Branch scoping. Null = "available at every branch" (the
//             // default for single-branch tenants and for shared items).
//             // Set to a branch id to make the row exist only at that outlet.
//             branch_id: editing.branch_id,
//         }
//         // When editing an existing item, find the prior image URL so we can
//         // delete its storage object if the user replaced or cleared it.
//         const previousImage = editing.id
//             ? items.find((x) => x.id === editing.id)?.image_url ?? null
//             : null
//         try {
//             let itemId = editing.id
//             if (editing.id) {
//                 const { error } = await supabase.from("menu_items").update(payload as never).eq("id", editing.id)
//                 if (error) throw error
//             } else {
//                 const { data, error } = await supabase.from("menu_items").insert(payload as never).select("id").single()
//                 if (error) throw error
//                 itemId = (data as { id: string }).id
//             }
//             if (itemId) await syncRecommendations(itemId, editing.recommendedIds)
//             // Image changed → reap the old object (best-effort).
//             if (previousImage && previousImage !== editing.image_url) {
//                 const oldPath = pathFromPublicUrl(previousImage, "menu-images")
//                 if (oldPath) await deleteFromStorage(supabase, "menu-images", [oldPath])
//             }
//             toast.success(editing.id ? "Item updated" : "Item created")
//             setItemDialogOpen(false)
//             refresh()
//         } catch (err: unknown) {
//             toast.error(err instanceof Error ? err.message : "Failed to save item")
//         } finally {
//             setSavingItem(false)
//         }
//     }

//     async function deleteItem(it: MenuItem) {
//         if (!confirm(`Archive "${it.name}"? It will no longer appear on the POS.`)) return
//         // Hard-delete the image from storage so we don't pay to keep photos
//         // for archived items forever. Also null out the column so the row
//         // doesn't keep a dangling URL pointer if it's ever restored.
//         const imagePath = pathFromPublicUrl(it.image_url, "menu-images")
//         const patch: Record<string, string | null> = { deleted_at: new Date().toISOString() }
//         if (imagePath) patch.image_url = null
//         const { error } = await supabase
//             .from("menu_items")
//             .update(patch as never)
//             .eq("id", it.id)
//         if (error) return toast.error(error.message)
//         // Best-effort: a storage failure here doesn't undo the archive — the
//         // row is already gone from the POS.
//         if (imagePath) {
//             await deleteFromStorage(supabase, "menu-images", [imagePath])
//         }
//         toast.success("Archived")
//         refresh()
//     }

//     async function toggleSoldOut(it: MenuItem) {
//         const next = !it.is_sold_out
//         // optimistic UI
//         setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, is_sold_out: next } : x))
//         const { error } = await supabase
//             .from("menu_items")
//             .update({ is_sold_out: next } as never)
//             .eq("id", it.id)
//         if (error) {
//             setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, is_sold_out: !next } : x))
//             return toast.error(error.message)
//         }
//         toast.success(next ? `${it.name} marked sold out` : `${it.name} back in stock`)
//     }

//     return (
//         <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-6">
//             <PageHeader
//                 kicker="Catalog"
//                 title="Menu"
//                 highlight="tax-ready"
//                 description={`Categories, items, ${cfg.taxShortName} rates${cfg.code === "IN" ? ", HSN codes" : ""}.`}
//                 actions={
//                     <>
//                         <Button asChild variant="ghost"><a href="/menu-admin/extras">Variants &amp; modifiers</a></Button>
//                         {canManage && categories.length > 0 && (
//                             <Button variant="outline" onClick={() => {
//                                 setCatEdits(Object.fromEntries(categories.map((c) => [c.id, c.name])))
//                                 setManageCatsOpen(true)
//                             }}>
//                                 <Settings2 className="h-4 w-4" /> Manage categories
//                             </Button>
//                         )}
//                         {canManage && (
//                             <Button variant="outline" onClick={() => setCatDialogOpen(true)}>
//                                 <Plus className="h-4 w-4" /> New category
//                             </Button>
//                         )}
//                         {canManage && branches.length >= 2 && (
//                             <Button variant="outline" onClick={() => setImportOpen(true)}>
//                                 <ArrowRight className="h-4 w-4" /> Import from branch
//                             </Button>
//                         )}
//                         {canManage && (
//                             <Button variant="neon" onClick={openCreate} disabled={categories.length === 0}>
//                                 <Plus className="h-4 w-4" /> New item
//                             </Button>
//                         )}
//                     </>
//                 }
//             />

//             <div className="flex flex-wrap gap-2">
//                 <button
//                     onClick={() => setActiveCat("ALL")}
//                     className={cn(
//                         "px-3 py-1.5 rounded-md text-sm transition-colors",
//                         activeCat === "ALL"
//                             ? "bg-primary text-primary-foreground"
//                             : "bg-muted/40 text-muted-foreground hover:text-foreground",
//                     )}
//                 >
//                     All ({items.length})
//                 </button>
//                 {categories.map((c) => (
//                     <button
//                         key={c.id}
//                         onClick={() => setActiveCat(c.id)}
//                         className={cn(
//                             "px-3 py-1.5 rounded-md text-sm transition-colors",
//                             activeCat === c.id
//                                 ? "bg-primary text-primary-foreground"
//                                 : "bg-muted/40 text-muted-foreground hover:text-foreground",
//                         )}
//                     >
//                         {c.name} ({items.filter((i) => i.category_id === c.id).length})
//                     </button>
//                 ))}
//             </div>

//             {loading ? (
//                 <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
//                     {Array.from({ length: 6 }).map((_, i) => (
//                         <Skeleton key={i} className="h-28" />
//                     ))}
//                 </div>
//             ) : visibleItems.length === 0 ? (
//                 <Card className="neon-border">
//                     <CardContent className="text-center py-16 text-muted-foreground">
//                         {categories.length === 0
//                             ? "Add a category first, then items."
//                             : "No items yet — click 'New item' to add one."}
//                     </CardContent>
//                 </Card>
//             ) : (
//                 <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
//                     {visibleItems.map((it) => {
//                         const dot = FOOD_TYPES.find((f) => f.value === it.food_type)
//                         return (
//                             <Card key={it.id} className="neon-border hover:border-primary/40 transition-colors overflow-hidden">
//                                 {it.image_url && (
//                                     // eslint-disable-next-line @next/next/no-img-element
//                                     <img
//                                         src={it.image_url}
//                                         alt=""
//                                         className="w-full h-32 object-cover border-b border-border/40"
//                                         loading="lazy"
//                                     />
//                                 )}
//                                 <CardHeader className="pb-2">
//                                     <div className="flex items-start justify-between gap-2">
//                                         <div className="flex items-center gap-2">
//                                             <span className={cn("h-2.5 w-2.5 rounded-full", dot?.dot)} />
//                                             <CardTitle className="text-base leading-tight">{it.name}</CardTitle>
//                                         </div>
//                                         <Badge variant="outline">{cfg.taxShortName} {it.gst_slab}%</Badge>
//                                     </div>
//                                 </CardHeader>
//                                 <CardContent className="space-y-2">
//                                     <div className="flex items-end justify-between">
//                                         <div className="text-2xl font-semibold">{formatCurrency(it.base_price)}</div>
//                                         {it.hsn_code && (
//                                             <span className="text-xs text-muted-foreground">HSN {it.hsn_code}</span>
//                                         )}
//                                     </div>
//                                     {it.description && <p className="text-sm text-muted-foreground line-clamp-2">{it.description}</p>}
//                                     <div className="flex items-center gap-2 pt-1 flex-wrap">
//                                         <Button size="sm" variant="outline" onClick={() => openEdit(it)}>Edit</Button>
//                                         <Button
//                                             size="sm"
//                                             variant={it.is_sold_out ? "destructive" : "ghost"}
//                                             onClick={() => toggleSoldOut(it)}
//                                             title={it.is_sold_out ? "Mark back in stock" : "Mark sold out for today"}
//                                         >
//                                             <Ban className="h-3.5 w-3.5" />
//                                             {it.is_sold_out ? "Sold out" : "Mark sold out"}
//                                         </Button>
//                                         <Button size="sm" variant="ghost" onClick={() => deleteItem(it)} className="text-destructive">
//                                             <Trash2 className="h-3.5 w-3.5" />
//                                         </Button>
//                                         {!it.is_active && <Badge variant="warning">Inactive</Badge>}
//                                     </div>
//                                 </CardContent>
//                             </Card>
//                         )
//                     })}
//                 </div>
//             )}

//             <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
//                 <DialogContent>
//                     <DialogHeader>
//                         <DialogTitle>New category</DialogTitle>
//                     </DialogHeader>
//                     <form onSubmit={saveCategory} className="space-y-4">
//                         <div className="space-y-1.5">
//                             <Label htmlFor="catName">Name</Label>
//                             <Input id="catName" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="Starters" />
//                         </div>
//                         <DialogFooter>
//                             <Button type="submit" variant="neon" disabled={savingCat}>
//                                 {savingCat && <Loader2 className="h-4 w-4 animate-spin" />}
//                                 Create
//                             </Button>
//                         </DialogFooter>
//                     </form>
//                 </DialogContent>
//             </Dialog>

//             <Dialog open={manageCatsOpen} onOpenChange={setManageCatsOpen}>
//                 <DialogContent className="max-w-lg">
//                     <DialogHeader>
//                         <DialogTitle>Manage categories</DialogTitle>
//                     </DialogHeader>
//                     <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1 scrollbar-thin">
//                         {categories.length === 0 && (
//                             <p className="text-sm text-muted-foreground">No categories yet.</p>
//                         )}
//                         {categories.map((c) => {
//                             const inCat = items.filter((i) => i.category_id === c.id).length
//                             const busy = catBusy === c.id
//                             const draftName = catEdits[c.id] ?? c.name
//                             const dirty = draftName.trim() !== c.name
//                             const catImage = (c as MenuCategory & { image_url?: string | null }).image_url ?? null
//                             return (
//                                 <div key={c.id} className="flex items-center gap-2 rounded-md border border-border/60 p-2">
//                                     <ImageUploader
//                                         value={catImage}
//                                         onChange={(url) => updateCategoryImage(c, url)}
//                                         bucket="menu-images"
//                                         path={tenantImagePath(tenantId, "menu-category", c.id)}
//                                         aspect="square"
//                                         size={56}
//                                         disabled={busy}
//                                     />
//                                     <div className="flex-1 space-y-0.5 min-w-0">
//                                         <Input
//                                             value={draftName}
//                                             onChange={(e) => setCatEdits((p) => ({ ...p, [c.id]: e.target.value }))}
//                                             placeholder="Category name"
//                                         />
//                                         <p className="text-[11px] text-muted-foreground">
//                                             {inCat} item{inCat !== 1 ? "s" : ""} in this category
//                                         </p>
//                                     </div>
//                                     <Button
//                                         size="sm"
//                                         variant="outline"
//                                         disabled={!dirty || busy}
//                                         onClick={() => renameCategory(c)}
//                                         title="Rename"
//                                     >
//                                         {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
//                                         <span className="sr-only sm:not-sr-only sm:ml-1">Rename</span>
//                                     </Button>
//                                     <Button
//                                         size="sm"
//                                         variant="destructive"
//                                         disabled={busy}
//                                         onClick={() => deleteCategory(c)}
//                                         title="Delete"
//                                     >
//                                         <Trash2 className="h-4 w-4" />
//                                         <span className="sr-only sm:not-sr-only sm:ml-1">Delete</span>
//                                     </Button>
//                                 </div>
//                             )
//                         })}
//                     </div>
//                     <DialogFooter>
//                         <Button variant="ghost" onClick={() => setManageCatsOpen(false)}>Close</Button>
//                     </DialogFooter>
//                 </DialogContent>
//             </Dialog>

//             <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
//                 <DialogContent className="max-w-xl">
//                     <DialogHeader>
//                         <DialogTitle>{editing.id ? "Edit item" : "New item"}</DialogTitle>
//                     </DialogHeader>
//                     <form onSubmit={saveItem} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1 scrollbar-thin">
//                         <div className="flex items-start gap-4">
//                             <ImageUploader
//                                 label="Photo"
//                                 hint="Auto-compressed · ~250 KB max"
//                                 value={editing.image_url}
//                                 onChange={(url) => setEditing({ ...editing, image_url: url })}
//                                 bucket="menu-images"
//                                 path={tenantImagePath(tenantId, "menu-item", editing.id ?? "new")}
//                                 aspect="square"
//                                 size={112}
//                                 disabled={!tenantId}
//                             />
//                             <div className="flex-1 space-y-3">
//                                 <div className="space-y-1.5">
//                                     <Label>Name *</Label>
//                                     <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
//                                 </div>
//                                 <div className="space-y-1.5">
//                                     <Label>Description</Label>
//                                     <Textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={2} />
//                                 </div>
//                             </div>
//                         </div>
//                         <div className="grid sm:grid-cols-2 gap-4">
//                             <div className="space-y-1.5">
//                                 <Label>Category *</Label>
//                                 <Select value={editing.category_id} onValueChange={(v) => setEditing({ ...editing, category_id: v })}>
//                                     <SelectTrigger><SelectValue placeholder="Pick category" /></SelectTrigger>
//                                     <SelectContent>
//                                         {categories.map((c) => (
//                                             <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
//                                         ))}
//                                     </SelectContent>
//                                 </Select>
//                             </div>
//                             <div className="space-y-1.5">
//                                 <Label>Food type</Label>
//                                 <Select value={editing.food_type} onValueChange={(v) => setEditing({ ...editing, food_type: v as FoodType })}>
//                                     <SelectTrigger><SelectValue /></SelectTrigger>
//                                     <SelectContent>
//                                         {FOOD_TYPES.map((f) => (
//                                             <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
//                                         ))}
//                                     </SelectContent>
//                                 </Select>
//                             </div>
//                         </div>
//                         <div className="grid sm:grid-cols-3 gap-4">
//                             <div className="space-y-1.5">
//                                 <Label>Price *</Label>
//                                 <Input type="number" step="0.01" min="0" value={editing.base_price}
//                                        onChange={(e) => setEditing({ ...editing, base_price: e.target.value })} />
//                             </div>
//                             <div className="space-y-1.5">
//                                 <Label className="flex items-center justify-between gap-2">
//                                     <span>Sale price</span>
//                                     <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-normal">optional</span>
//                                 </Label>
//                                 <Input
//                                     type="number" step="0.01" min="0"
//                                     placeholder="e.g. 199.00"
//                                     value={editing.sale_price}
//                                     onChange={(e) => setEditing({ ...editing, sale_price: e.target.value })}
//                                 />
//                                 {/* Live preview of the discount % — handy when admins are
//                                  *  typing a flat sale price and want to know what % off
//                                  *  that comes out to. Shown only when valid. */}
//                                 {(() => {
//                                     const base = Number(editing.base_price)
//                                     const sale = Number(editing.sale_price)
//                                     if (!Number.isFinite(base) || base <= 0) return null
//                                     if (!editing.sale_price.trim()) return null
//                                     if (!Number.isFinite(sale) || sale <= 0 || sale >= base) {
//                                         return <p className="text-[11px] text-destructive">Must be lower than the regular price</p>
//                                     }
//                                     const pct = Math.round((1 - sale / base) * 100)
//                                     return <p className="text-[11px] text-success">{pct}% off · saves {formatCurrency(base - sale, cfg.currency)}</p>
//                                 })()}
//                             </div>
//                             <div className="space-y-1.5">
//                                 <Label>{cfg.taxShortName} rate</Label>
//                                 <Select value={editing.gst_slab} onValueChange={(v) => setEditing({ ...editing, gst_slab: v })}>
//                                     <SelectTrigger><SelectValue /></SelectTrigger>
//                                     <SelectContent>
//                                         {/* country rates + the item's current rate if it's not in the list */}
//                                         {Array.from(new Set([...cfg.rates, Number(editing.gst_slab)])).sort((a, b) => a - b).map((s) => (
//                                             <SelectItem key={s} value={String(s)}>{s}%</SelectItem>
//                                         ))}
//                                     </SelectContent>
//                                 </Select>
//                             </div>
//                         </div>
//                         <div className="grid sm:grid-cols-3 gap-4">
//                             <div className="space-y-1.5">
//                                 <Label>Prep time (min)</Label>
//                                 <Input type="number" min="1" value={editing.prep_time_minutes}
//                                        onChange={(e) => setEditing({ ...editing, prep_time_minutes: e.target.value })} />
//                             </div>
//                             {/* Branch assignment is driven by the global
//                              *  topbar switcher; new items inherit it.
//                              *  The badge below shows the current scope
//                              *  so the admin sees what they're building. */}
//                             {branches.length >= 2 && (
//                                 <div className="space-y-1.5 sm:col-span-2">
//                                     <Label>Branch</Label>
//                                     <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm">
//                                         {editing.branch_id
//                                             ? <>Only at <strong>{branches.find((b) => b.id === editing.branch_id)?.name ?? "—"}</strong></>
//                                             : <>Available at <strong>every branch</strong> (shared)</>}
//                                     </div>
//                                     <p className="text-[11px] text-muted-foreground">
//                                         Switch branches via the dropdown in the top bar to manage that branch&apos;s catalog. Use &ldquo;Import from branch&rdquo; to copy an existing menu.
//                                     </p>
//                                 </div>
//                             )}
//                         </div>
//                         <div className="space-y-1.5">
//                             <Label>HSN / SAC code</Label>
//                             <Select value={editing.hsn_code} onValueChange={(v) => setEditing({ ...editing, hsn_code: v })}>
//                                 <SelectTrigger><SelectValue placeholder="Pick HSN" /></SelectTrigger>
//                                 <SelectContent>
//                                     {hsnCodes.map((h) => (
//                                         <SelectItem key={h.code} value={h.code}>{h.code} — {h.description}</SelectItem>
//                                     ))}
//                                 </SelectContent>
//                             </Select>
//                         </div>
//                         <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
//                             <div>
//                                 <Label>Tax inclusive</Label>
//                                 <p className="text-xs text-muted-foreground">Price already includes {cfg.taxShortName}.</p>
//                             </div>
//                             <Switch checked={editing.is_tax_inclusive}
//                                     onCheckedChange={(v) => setEditing({ ...editing, is_tax_inclusive: v })} />
//                         </div>
//                         <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
//                             <div>
//                                 <Label>Active</Label>
//                                 <p className="text-xs text-muted-foreground">Show on POS &amp; QR menu.</p>
//                             </div>
//                             <Switch checked={editing.is_active}
//                                     onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
//                         </div>

//                         {/* ---- Recommended add-ons (Domino's-style upsell) ---- */}
//                         <div className="rounded-md border border-border/60 p-3 space-y-2">
//                             <div className="flex items-center gap-2">
//                                 <Lightbulb className="h-4 w-4 text-primary" />
//                                 <Label>Recommended add-ons</Label>
//                                 <Badge variant="outline" className="text-[10px] ml-auto">
//                                     {editing.recommendedIds.length}/{MAX_RECOMMENDATIONS}
//                                 </Badge>
//                             </div>
//                             <p className="text-xs text-muted-foreground">
//                                 Suggested when this item is added — staff sees a one-tap &ldquo;add this too&rdquo; on the POS, customers see it on the QR menu. Great for &ldquo;want a coldrink with that?&rdquo;.
//                             </p>
//                             {editing.recommendedIds.length > 0 && (
//                                 <div className="flex flex-wrap gap-1.5">
//                                     {editing.recommendedIds.map((rid) => {
//                                         const r = recById.get(rid)
//                                         if (!r) return null
//                                         return (
//                                             <button
//                                                 key={rid}
//                                                 type="button"
//                                                 onClick={() => toggleRecommendation(rid)}
//                                                 className="inline-flex items-center gap-1 rounded-full bg-primary/15 border border-primary/30 text-primary px-2.5 py-1 text-xs font-medium hover:bg-primary/25 transition-colors"
//                                             >
//                                                 {r.name}
//                                                 <Trash2 className="h-3 w-3 opacity-60" />
//                                             </button>
//                                         )
//                                     })}
//                                 </div>
//                             )}
//                             {recCandidates.length === 0 ? (
//                                 <p className="text-xs text-muted-foreground italic">Add more menu items first.</p>
//                             ) : (
//                                 <div className="max-h-40 overflow-y-auto scrollbar-thin rounded-md border border-border/40 divide-y divide-border/30">
//                                     {recCandidates.map((c) => {
//                                         const picked = editing.recommendedIds.includes(c.id)
//                                         return (
//                                             <button
//                                                 key={c.id}
//                                                 type="button"
//                                                 onClick={() => toggleRecommendation(c.id)}
//                                                 className={cn(
//                                                     "w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors",
//                                                     picked ? "bg-primary/10" : "hover:bg-accent/40",
//                                                 )}
//                                             >
//                                                 <span className="truncate">{c.name}</span>
//                                                 <span className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
//                                                     {formatCurrency(c.base_price)}
//                                                     <span className={cn(
//                                                         "grid place-items-center h-4 w-4 rounded border",
//                                                         picked ? "bg-primary border-primary text-primary-foreground" : "border-border",
//                                                     )}>
//                                                         {picked && "✓"}
//                                                     </span>
//                                                 </span>
//                                             </button>
//                                         )
//                                     })}
//                                 </div>
//                             )}
//                         </div>

//                         <DialogFooter>
//                             <Button type="submit" variant="neon" disabled={savingItem}>
//                                 {savingItem ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
//                                 {editing.id ? "Save changes" : "Create item"}
//                             </Button>
//                         </DialogFooter>
//                     </form>
//                 </DialogContent>
//             </Dialog>

//             {/* ── Import from another branch ─────────────────────────────
//               * Calls copy_menu_to_branch (migration 19) — every active item
//               * from source becomes a fresh, independent row at target.
//               * Each branch's is_sold_out flag stays independent because
//               * each branch has its own menu_items row. */}
//             <Dialog open={importOpen} onOpenChange={setImportOpen}>
//                 <DialogContent>
//                     <DialogHeader><DialogTitle>Import menu from another branch</DialogTitle></DialogHeader>
//                     <div className="space-y-3">
//                         <p className="text-xs text-muted-foreground rounded-md bg-muted/40 px-3 py-2 leading-relaxed">
//                             Copies every active item from the source branch into the target branch as fresh rows.
//                             Same-name items already at the target are skipped — nothing gets overwritten.
//                             Each branch&apos;s sold-out flag stays independent after the copy.
//                         </p>
//                         <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
//                             <div className="space-y-1.5">
//                                 <Label className="text-xs">From branch</Label>
//                                 <Select value={importSource} onValueChange={setImportSource}>
//                                     <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
//                                     <SelectContent>
//                                         {branches.map((b) => (
//                                             <SelectItem key={b.id} value={b.id}>{b.name}{b.is_main ? " (main)" : ""}</SelectItem>
//                                         ))}
//                                     </SelectContent>
//                                 </Select>
//                             </div>
//                             <ArrowRight className="h-4 w-4 text-muted-foreground mb-2.5" />
//                             <div className="space-y-1.5">
//                                 <Label className="text-xs">To branch</Label>
//                                 <Select value={importTarget} onValueChange={setImportTarget}>
//                                     <SelectTrigger><SelectValue placeholder="Target" /></SelectTrigger>
//                                     <SelectContent>
//                                         {branches.filter((b) => b.id !== importSource).map((b) => (
//                                             <SelectItem key={b.id} value={b.id}>{b.name}{b.is_main ? " (main)" : ""}</SelectItem>
//                                         ))}
//                                     </SelectContent>
//                                 </Select>
//                             </div>
//                         </div>
//                     </div>
//                     <DialogFooter>
//                         <Button variant="neon" onClick={runImport} disabled={importBusy || !importSource || !importTarget}>
//                             {importBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
//                             Import
//                         </Button>
//                     </DialogFooter>
//                 </DialogContent>
//             </Dialog>
//         </div>
//     )
// }


"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowRight, Ban, Lightbulb, Loader2, Pencil, Plus, Save, Settings2, Trash2, UtensilsCrossed } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/app-shell/page-header"
import { PageTour } from "@/components/tours/page-tour"
import { TourReplayButton } from "@/components/tours/tour-replay-button"
import { ImageUploader } from "@/components/ui/image-uploader"
import { createClient } from "@/lib/supabase/client"
import { deleteFromStorage, pathFromPublicUrl, tenantImagePath } from "@/lib/storage/image-upload"
import { getTaxConfig, mergedTaxRates } from "@/lib/tax/locale-config"
import { cn, formatCurrency } from "@/lib/utils"
import { useActiveBranch } from "@/lib/branch/active-branch"
import type { FoodType, HsnCode, MenuCategory, MenuItem, UserRole } from "@/types/database"

const MAX_RECOMMENDATIONS = 6
const FOOD_TYPES: { value: FoodType; label: string; dot: string }[] = [
    { value: "VEG",     label: "Veg",     dot: "bg-green-500"   },
    { value: "NON_VEG", label: "Non-Veg", dot: "bg-red-500"     },
    { value: "EGG",     label: "Egg",     dot: "bg-amber-500"   },
    { value: "VEGAN",   label: "Vegan",   dot: "bg-emerald-500" },
]

interface ItemForm {
    id?: string
    name: string
    description: string
    category_id: string
    base_price: string
    sale_price: string
    food_type: FoodType
    hsn_code: string
    gst_slab: string
    is_tax_inclusive: boolean
    is_active: boolean
    prep_time_minutes: string
    image_url: string | null
    branch_id: string | null
    recommendedIds: string[]
}

const EMPTY_ITEM: ItemForm = {
    name: "",
    description: "",
    category_id: "",
    base_price: "0",
    sale_price: "",
    food_type: "VEG",
    hsn_code: "996331",
    gst_slab: "5",
    is_tax_inclusive: false,
    is_active: true,
    prep_time_minutes: "10",
    image_url: null,
    branch_id: null,
    recommendedIds: [],
}

// ─── Section divider with label ──────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 whitespace-nowrap">
                {children}
            </span>
            <div className="flex-1 h-px bg-border/50" />
        </div>
    )
}

// ─── Toggle row ───────────────────────────────────────────────────────────────
function ToggleRow({
    label, hint, checked, onCheckedChange,
}: {
    label: string; hint: string; checked: boolean; onCheckedChange: (v: boolean) => void
}) {
    return (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
            <div className="min-w-0">
                <p className="text-sm font-medium leading-none">{label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
            </div>
            <Switch checked={checked} onCheckedChange={onCheckedChange} />
        </div>
    )
}

export default function MenuPage() {
    const supabase = createClient()
    const [loading, setLoading]             = useState(true)
    const [tenantId, setTenantId]           = useState<string>("")
    const [tenantCountry, setTenantCountry] = useState<string | null>(null)
    // Tax defaults from Settings → Tax (migration 38).
    const [tenantDefaultRate,      setTenantDefaultRate]      = useState<number | null>(null)
    const [tenantCustomRates,      setTenantCustomRates]      = useState<number[]>([])
    const [tenantPricesIncludeTax, setTenantPricesIncludeTax] = useState(false)
    const [categories, setCategories]       = useState<MenuCategory[]>([])
    const [items, setItems]                 = useState<MenuItem[]>([])
    const [hsnCodes, setHsnCodes]           = useState<HsnCode[]>([])
    const [activeCat, setActiveCat]         = useState<string | "ALL">("ALL")
    const { activeBranchId, branches }      = useActiveBranch()

    const [importOpen,   setImportOpen]   = useState(false)
    const [importSource, setImportSource] = useState<string>("")
    const [importTarget, setImportTarget] = useState<string>("")
    const [importBusy,   setImportBusy]   = useState(false)

    const cfg = useMemo(() => getTaxConfig(tenantCountry), [tenantCountry])

    const [catDialogOpen, setCatDialogOpen] = useState(false)
    const [newCatName,    setNewCatName]    = useState("")
    const [savingCat,     setSavingCat]     = useState(false)

    const [itemDialogOpen, setItemDialogOpen] = useState(false)
    const [editing,        setEditing]        = useState<ItemForm>(EMPTY_ITEM)
    const [savingItem,     setSavingItem]     = useState(false)

    const [role, setRole] = useState<UserRole>("CASHIER")
    const canManage = role === "OWNER" || role === "MANAGER"

    const [manageCatsOpen, setManageCatsOpen] = useState(false)
    const [catEdits,       setCatEdits]       = useState<Record<string, string>>({})
    const [catBusy,        setCatBusy]        = useState<string | null>(null)

    async function refresh() {
        setLoading(true)
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) return
        const { data: row } = await supabase.from("users").select("tenant_id, role").eq("id", u.user.id).maybeSingle()
        if (!row?.tenant_id) return
        setTenantId(row.tenant_id)
        setRole((row as { role?: UserRole }).role ?? "CASHIER")
        const [{ data: cats }, { data: its }, { data: hsn }, { data: tenant }] = await Promise.all([
            supabase.from("menu_categories").select("*").is("deleted_at", null).order("sort_order"),
            supabase.from("menu_items").select("*").is("deleted_at", null).order("sort_order"),
            supabase.from("hsn_codes").select("*").order("code"),
            supabase.from("tenants")
                .select("country, default_tax_rate, custom_tax_rates, prices_include_tax")
                .eq("id", row.tenant_id).maybeSingle(),
        ])
        const tx = tenant as {
            country?: string | null
            default_tax_rate?: number | null
            custom_tax_rates?: number[] | null
            prices_include_tax?: boolean | null
        } | null
        setTenantCountry(tx?.country ?? null)
        setTenantDefaultRate(tx?.default_tax_rate ?? null)
        setTenantCustomRates(tx?.custom_tax_rates ?? [])
        setTenantPricesIncludeTax(tx?.prices_include_tax ?? false)
        setCategories((cats ?? []) as MenuCategory[])
        setItems((its ?? []) as MenuItem[])
        setHsnCodes((hsn ?? []) as HsnCode[])
        setLoading(false)
    }

    const branchScopedItems = useMemo(() => {
        if (activeBranchId === null) return items
        return items.filter((i) => {
            const b = (i as MenuItem & { branch_id?: string | null }).branch_id
            return b === activeBranchId || !b
        })
    }, [items, activeBranchId])

    async function runImport() {
        if (!importSource || !importTarget) return toast.error("Pick source and target branches")
        if (importSource === importTarget)  return toast.error("Source and target must differ")
        setImportBusy(true)
        try {
            const { data, error } = await supabase.rpc("copy_menu_to_branch" as never, {
                p_source_branch_id: importSource,
                p_target_branch_id: importTarget,
            } as never)
            if (error) throw error
            const r = data as { copied?: number; skipped_existing?: number } | null
            toast.success(
                `Imported ${r?.copied ?? 0} item(s)` +
                (r?.skipped_existing ? ` · skipped ${r.skipped_existing} that already existed at the target` : ""),
            )
            setImportOpen(false); setImportSource(""); setImportTarget("")
            refresh()
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Import failed")
        } finally {
            setImportBusy(false)
        }
    }

    useEffect(() => { refresh() }, [])

    const visibleItems =
        activeCat === "ALL" ? branchScopedItems : branchScopedItems.filter((i) => i.category_id === activeCat)

    const recCandidates = useMemo(() => items.filter((i) => i.is_active && i.id !== editing.id), [items, editing.id])
    const recById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

    async function saveCategory(e: React.FormEvent) {
        e.preventDefault()
        if (!newCatName.trim()) return
        setSavingCat(true)
        const { error } = await supabase
            .from("menu_categories")
            .insert({ tenant_id: tenantId, name: newCatName.trim(), sort_order: categories.length } as never)
        setSavingCat(false)
        if (error) return toast.error(error.message)
        toast.success("Category created"); setNewCatName(""); setCatDialogOpen(false); refresh()
    }

    async function updateCategoryImage(cat: MenuCategory, url: string | null) {
        const prev = (cat as MenuCategory & { image_url?: string | null }).image_url ?? null
        setCategories((p) => p.map((c) => c.id === cat.id ? ({ ...c, image_url: url } as MenuCategory) : c))
        const { error } = await supabase.from("menu_categories").update({ image_url: url } as never).eq("id", cat.id)
        if (error) { toast.error(`Couldn't save image: ${error.message}`); refresh(); return }
        if (prev && prev !== url) {
            const oldPath = pathFromPublicUrl(prev, "menu-images")
            if (oldPath) await deleteFromStorage(supabase, "menu-images", [oldPath])
        }
    }

    async function renameCategory(cat: MenuCategory) {
        const next = (catEdits[cat.id] ?? cat.name).trim()
        if (!next || next === cat.name) return
        setCatBusy(cat.id)
        const { error } = await supabase.from("menu_categories").update({ name: next } as never).eq("id", cat.id)
        setCatBusy(null)
        if (error) return toast.error(error.message)
        toast.success(`Renamed to "${next}"`)
        setCatEdits((p) => { const c = { ...p }; delete c[cat.id]; return c })
        refresh()
    }

    async function deleteCategory(cat: MenuCategory) {
        const inCat = items.filter((i) => i.category_id === cat.id)
        const msg = inCat.length > 0
            ? `Delete "${cat.name}"? ${inCat.length} item${inCat.length !== 1 ? "s" : ""} in this category will be archived along with it.`
            : `Delete "${cat.name}"?`
        if (!confirm(msg)) return
        setCatBusy(cat.id)
        const now = new Date().toISOString()
        const catImagePath   = pathFromPublicUrl((cat as MenuCategory & { image_url?: string | null }).image_url ?? null, "menu-images")
        const itemImagePaths = inCat.map((i) => pathFromPublicUrl(i.image_url, "menu-images")).filter((p): p is string => Boolean(p))
        const catPatch: Record<string, string | null> = { deleted_at: now }
        if (catImagePath) catPatch.image_url = null
        const { error: cErr } = await supabase.from("menu_categories").update(catPatch as never).eq("id", cat.id)
        if (cErr) { setCatBusy(null); return toast.error(cErr.message) }
        if (inCat.length > 0) {
            const { error: iErr } = await supabase
                .from("menu_items").update({ deleted_at: now, image_url: null } as never)
                .eq("category_id", cat.id).is("deleted_at", null)
            if (iErr) { setCatBusy(null); return toast.error(`Category deleted, but couldn't archive its items: ${iErr.message}`) }
        }
        const allPaths = catImagePath ? [catImagePath, ...itemImagePaths] : itemImagePaths
        if (allPaths.length > 0) await deleteFromStorage(supabase, "menu-images", allPaths)
        setCatBusy(null)
        toast.success(inCat.length > 0 ? `Deleted, archived ${inCat.length} item${inCat.length !== 1 ? "s" : ""}` : "Deleted")
        if (activeCat === cat.id) setActiveCat("ALL")
        refresh()
    }

    function openCreate() {
        setEditing({
            ...EMPTY_ITEM,
            category_id: activeCat === "ALL" ? categories[0]?.id ?? "" : activeCat,
            // Defaults from Settings → Tax: the tenant's chosen rate (falling
            // back to the country default) and inclusive-pricing preference.
            gst_slab: String(tenantDefaultRate ?? cfg.defaultRate),
            is_tax_inclusive: tenantPricesIncludeTax,
            branch_id: activeBranchId,
            recommendedIds: [],
        })
        setItemDialogOpen(true)
    }

    async function openEdit(it: MenuItem) {
        const { data: recs } = await supabase
            .from("menu_item_recommendations").select("recommended_item_id, sort_order")
            .eq("item_id", it.id).order("sort_order")
        const recommendedIds = ((recs ?? []) as { recommended_item_id: string }[]).map((r) => r.recommended_item_id)
        setEditing({
            id: it.id, name: it.name, description: it.description ?? "",
            category_id: it.category_id ?? "", base_price: String(it.base_price),
            sale_price: it.sale_price != null ? String(it.sale_price) : "",
            food_type: it.food_type, hsn_code: it.hsn_code ?? "996331",
            gst_slab: String(it.gst_slab), is_tax_inclusive: it.is_tax_inclusive,
            is_active: it.is_active, prep_time_minutes: String(it.prep_time_minutes),
            image_url: it.image_url ?? null,
            branch_id: (it as MenuItem & { branch_id?: string | null }).branch_id ?? null,
            recommendedIds,
        })
        setItemDialogOpen(true)
    }

    function toggleRecommendation(id: string) {
        setEditing((prev) => {
            const has = prev.recommendedIds.includes(id)
            if (has) return { ...prev, recommendedIds: prev.recommendedIds.filter((x) => x !== id) }
            if (prev.recommendedIds.length >= MAX_RECOMMENDATIONS) {
                toast.error(`Up to ${MAX_RECOMMENDATIONS} suggestions per item`); return prev
            }
            return { ...prev, recommendedIds: [...prev.recommendedIds, id] }
        })
    }

    async function syncRecommendations(itemId: string, recommendedIds: string[]) {
        await supabase.from("menu_item_recommendations").delete().eq("item_id", itemId)
        if (recommendedIds.length === 0) return
        const rows = recommendedIds.map((rid, i) => ({ tenant_id: tenantId, item_id: itemId, recommended_item_id: rid, sort_order: i }))
        const { error } = await supabase.from("menu_item_recommendations").insert(rows as never)
        if (error) toast.error(`Item saved, but suggestions failed: ${error.message}`)
    }

    async function saveItem(e: React.FormEvent) {
        e.preventDefault()
        if (!editing.name.trim())  return toast.error("Name required")
        if (!editing.category_id) return toast.error("Pick a category")
        const basePrice = Number(editing.base_price)
        let salePrice: number | null = null
        const rawSale = editing.sale_price.trim()
        if (rawSale !== "") {
            const n = Number(rawSale)
            if (!Number.isFinite(n) || n <= 0) return toast.error("Sale price must be a positive number, or leave it blank")
            if (n >= basePrice)                 return toast.error("Sale price must be lower than the regular price")
            salePrice = Number(n.toFixed(2))
        }
        setSavingItem(true)
        const payload = {
            tenant_id: tenantId, category_id: editing.category_id,
            name: editing.name.trim(), description: editing.description.trim() || null,
            base_price: basePrice, sale_price: salePrice, food_type: editing.food_type,
            hsn_code: editing.hsn_code || null, gst_slab: Number(editing.gst_slab),
            is_tax_inclusive: editing.is_tax_inclusive, is_active: editing.is_active,
            prep_time_minutes: Number(editing.prep_time_minutes) || 10,
            image_url: editing.image_url, branch_id: editing.branch_id,
        }
        const previousImage = editing.id ? items.find((x) => x.id === editing.id)?.image_url ?? null : null
        try {
            let itemId = editing.id
            if (editing.id) {
                const { error } = await supabase.from("menu_items").update(payload as never).eq("id", editing.id)
                if (error) throw error
            } else {
                const { data, error } = await supabase.from("menu_items").insert(payload as never).select("id").single()
                if (error) throw error
                itemId = (data as { id: string }).id
            }
            if (itemId) await syncRecommendations(itemId, editing.recommendedIds)
            if (previousImage && previousImage !== editing.image_url) {
                const oldPath = pathFromPublicUrl(previousImage, "menu-images")
                if (oldPath) await deleteFromStorage(supabase, "menu-images", [oldPath])
            }
            toast.success(editing.id ? "Item updated" : "Item created")
            setItemDialogOpen(false); refresh()
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : "Failed to save item")
        } finally {
            setSavingItem(false)
        }
    }

    async function deleteItem(it: MenuItem) {
        if (!confirm(`Archive "${it.name}"? It will no longer appear on the POS.`)) return
        const imagePath = pathFromPublicUrl(it.image_url, "menu-images")
        const patch: Record<string, string | null> = { deleted_at: new Date().toISOString() }
        if (imagePath) patch.image_url = null
        const { error } = await supabase.from("menu_items").update(patch as never).eq("id", it.id)
        if (error) return toast.error(error.message)
        if (imagePath) await deleteFromStorage(supabase, "menu-images", [imagePath])
        toast.success("Archived"); refresh()
    }

    async function toggleSoldOut(it: MenuItem) {
        const next = !it.is_sold_out
        setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, is_sold_out: next } : x))
        const { error } = await supabase.from("menu_items").update({ is_sold_out: next } as never).eq("id", it.id)
        if (error) {
            setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, is_sold_out: !next } : x))
            return toast.error(error.message)
        }
        toast.success(next ? `${it.name} marked sold out` : `${it.name} back in stock`)
    }

    // Sale-price inline feedback
    const salePriceFeedback = (() => {
        const base = Number(editing.base_price)
        const sale = Number(editing.sale_price)
        if (!Number.isFinite(base) || base <= 0 || !editing.sale_price.trim()) return null
        if (!Number.isFinite(sale) || sale <= 0 || sale >= base)
            return <p className="mt-1 text-[11px] text-destructive">Must be lower than the regular price</p>
        const pct = Math.round((1 - sale / base) * 100)
        return <p className="mt-1 text-[11px] text-success">{pct}% off · saves {formatCurrency(base - sale, cfg.currency)}</p>
    })()

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-6">
            <PageTour tourKey="menu" />
            <PageHeader
                kicker="Catalog"
                title="Menu"
                highlight="tax-ready"
                description={`Categories, items, ${cfg.taxShortName} rates${cfg.code === "IN" ? ", HSN codes" : ""}.`}
                actions={
                    <>
                        <Button asChild variant="ghost"><a href="/menu-admin/extras">Variants &amp; modifiers</a></Button>
                        {canManage && categories.length > 0 && (
                            <Button variant="outline" onClick={() => {
                                setCatEdits(Object.fromEntries(categories.map((c) => [c.id, c.name])))
                                setManageCatsOpen(true)
                            }}>
                                <Settings2 className="h-4 w-4" /> Manage categories
                            </Button>
                        )}
                        {canManage && (
                            <Button variant="outline" onClick={() => setCatDialogOpen(true)}>
                                <Plus className="h-4 w-4" /> New category
                            </Button>
                        )}
                        {canManage && branches.length >= 2 && (
                            <Button variant="outline" onClick={() => setImportOpen(true)}>
                                <ArrowRight className="h-4 w-4" /> Import from branch
                            </Button>
                        )}
                        {canManage && (
                            <Button variant="neon" onClick={openCreate} disabled={categories.length === 0} data-tour="menu-add-item">
                                <Plus className="h-4 w-4" /> New item
                            </Button>
                        )}
                        <TourReplayButton tourKey="menu" />
                    </>
                }
            />

            {/* Category chips */}
            <div className="flex flex-wrap gap-2" data-tour="menu-categories">
                <button
                    onClick={() => setActiveCat("ALL")}
                    className={cn(
                        "px-3 py-1.5 rounded-md text-sm transition-colors",
                        activeCat === "ALL"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted/40 text-muted-foreground hover:text-foreground",
                    )}
                >
                    All ({items.length})
                </button>
                {categories.map((c) => (
                    <button
                        key={c.id}
                        onClick={() => setActiveCat(c.id)}
                        className={cn(
                            "px-3 py-1.5 rounded-md text-sm transition-colors",
                            activeCat === c.id
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted/40 text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {c.name} ({items.filter((i) => i.category_id === c.id).length})
                    </button>
                ))}
            </div>

            {/* Item grid */}
            {loading ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-tour="menu-grid">
                    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
                </div>
            ) : visibleItems.length === 0 ? (
                <Card className="neon-border" data-tour="menu-grid">
                    <CardContent className="text-center py-16 text-muted-foreground">
                        {categories.length === 0 ? "Add a category first, then items." : "No items yet — click 'New item' to add one."}
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-tour="menu-grid">
                    {visibleItems.map((it) => {
                        const dot = FOOD_TYPES.find((f) => f.value === it.food_type)
                        return (
                            <Card
                                key={it.id}
                                className={cn(
                                    "neon-border flex flex-col overflow-hidden shadow-sm",
                                    "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:border-primary/40",
                                    it.is_sold_out && "opacity-75",
                                )}
                            >
                                {/* Image area: always rendered with a fixed 16:9
                                  * aspect so every card in the grid lines up,
                                  * regardless of whether an image was uploaded. */}
                                <div className="relative aspect-video w-full bg-muted/40 overflow-hidden">
                                    {it.image_url ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={it.image_url}
                                            alt={it.name}
                                            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 hover:scale-[1.03]"
                                            loading="lazy"
                                        />
                                    ) : (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground/60">
                                            <UtensilsCrossed className="h-7 w-7" />
                                            <span className="text-[10px] uppercase tracking-wide">No photo</span>
                                        </div>
                                    )}
                                    {it.is_sold_out && (
                                        <div className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-sm">
                                            <Badge variant="destructive" className="text-xs">Sold out</Badge>
                                        </div>
                                    )}
                                    {!it.is_active && !it.is_sold_out && (
                                        <Badge variant="warning" className="absolute top-2 right-2 text-[10px]">Inactive</Badge>
                                    )}
                                </div>
                                <CardHeader className="pb-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", dot?.dot)} />
                                            <CardTitle className="text-base leading-tight truncate">{it.name}</CardTitle>
                                        </div>
                                        <Badge variant="outline" className="shrink-0">{cfg.taxShortName} {it.gst_slab}%</Badge>
                                    </div>
                                </CardHeader>
                                {/* flex-1 makes this section absorb the extra
                                  * vertical space so every card in the row
                                  * ends up the same height. */}
                                <CardContent className="space-y-2 flex-1 flex flex-col">
                                    <div className="flex items-end justify-between">
                                        <div className="text-2xl font-semibold">{formatCurrency(it.base_price)}</div>
                                        {it.hsn_code && <span className="text-xs text-muted-foreground">HSN {it.hsn_code}</span>}
                                    </div>
                                    {it.description && <p className="text-sm text-muted-foreground line-clamp-2">{it.description}</p>}
                                    <div className="flex items-center gap-2 pt-2 mt-auto flex-wrap">
                                        <Button size="sm" variant="outline" onClick={() => openEdit(it)}>
                                            <Pencil className="h-3.5 w-3.5" /> Edit
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant={it.is_sold_out ? "destructive" : "ghost"}
                                            onClick={() => toggleSoldOut(it)}
                                            title={it.is_sold_out ? "Mark back in stock" : "Mark sold out for today"}
                                        >
                                            <Ban className="h-3.5 w-3.5" />
                                            {it.is_sold_out ? "In stock" : "Sold out"}
                                        </Button>
                                        <Button size="sm" variant="ghost" onClick={() => deleteItem(it)} className="text-destructive ml-auto">
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}

            {/* ════════════ NEW CATEGORY ════════════ */}
            <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>New category</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={saveCategory} className="space-y-4 pt-1">
                        <div className="space-y-1.5">
                            <Label htmlFor="catName">Name</Label>
                            <Input id="catName" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="e.g. Starters" autoFocus />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setCatDialogOpen(false)}>Cancel</Button>
                            <Button type="submit" variant="neon" disabled={savingCat}>
                                {savingCat && <Loader2 className="h-4 w-4 animate-spin" />} Create
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* ════════════ MANAGE CATEGORIES ════════════ */}
            <Dialog open={manageCatsOpen} onOpenChange={setManageCatsOpen}>
                <DialogContent className="flex flex-col max-w-lg max-h-[90vh] overflow-hidden">
                    <DialogHeader className="shrink-0">
                        <DialogTitle>Manage categories</DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5 scrollbar-thin">
                        {categories.length === 0 && (
                            <p className="text-sm text-muted-foreground py-6 text-center">No categories yet.</p>
                        )}
                        {categories.map((c) => {
                            const inCat     = items.filter((i) => i.category_id === c.id).length
                            const busy      = catBusy === c.id
                            const draftName = catEdits[c.id] ?? c.name
                            const dirty     = draftName.trim() !== c.name
                            const catImage  = (c as MenuCategory & { image_url?: string | null }).image_url ?? null
                            return (
                                <div key={c.id} className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-2.5">
                                    <ImageUploader
                                        value={catImage}
                                        onChange={(url) => updateCategoryImage(c, url)}
                                        bucket="menu-images"
                                        path={tenantImagePath(tenantId, "menu-category", c.id)}
                                        aspect="square" size={52} disabled={busy}
                                    />
                                    <div className="flex-1 min-w-0 space-y-0.5">
                                        <Input
                                            value={draftName}
                                            onChange={(e) => setCatEdits((p) => ({ ...p, [c.id]: e.target.value }))}
                                            placeholder="Category name" className="h-8 text-sm"
                                        />
                                        <p className="text-[11px] text-muted-foreground pl-0.5">{inCat} item{inCat !== 1 ? "s" : ""}</p>
                                    </div>
                                    <Button size="sm" variant="outline" disabled={!dirty || busy} onClick={() => renameCategory(c)} title="Rename">
                                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                                        <span className="sr-only sm:not-sr-only sm:ml-1">Rename</span>
                                    </Button>
                                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => deleteCategory(c)} title="Delete">
                                        <Trash2 className="h-4 w-4" />
                                        <span className="sr-only sm:not-sr-only sm:ml-1">Delete</span>
                                    </Button>
                                </div>
                            )
                        })}
                    </div>
                    <DialogFooter className="shrink-0 pt-3">
                        <Button variant="ghost" onClick={() => setManageCatsOpen(false)}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ════════════════════════════════════════════════════════════════════
                NEW / EDIT ITEM DIALOG
                Desktop (md+): two columns, no outer scroll — dialog fits viewport.
                Mobile: single column, body scrolls vertically only.
                No horizontal scroll on any device.
            ════════════════════════════════════════════════════════════════════ */}
            <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
                <DialogContent className="flex flex-col w-full max-w-3xl max-h-[95dvh] overflow-hidden p-0 gap-0">

                    {/* ── Header ── */}
                    <DialogHeader className="shrink-0 px-6 pt-5 pb-4 border-b border-border/40">
                        <DialogTitle className="text-lg font-semibold">
                            {editing.id ? "Edit menu item" : "New menu item"}
                        </DialogTitle>
                    </DialogHeader>

                    <form onSubmit={saveItem} className="flex flex-col flex-1 min-h-0">

                        {/* ── Scrollable body (vertical only) ── */}
                        <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-5 space-y-6">

                            {/* ══ ROW 1: Two-column grid ══ */}
                            <div className="grid grid-cols-1 md:grid-cols-2 md:gap-x-8">

                                {/* ── LEFT: Identity ── */}
                                <div className="space-y-4">
                                    <SectionLabel>Identity</SectionLabel>

                                    {/* Photo — centred, clearly its own block */}
                                    <div className="flex flex-col items-center gap-1">
                                        <ImageUploader
                                            label="Photo"
                                            hint="Auto-compressed · ~250 KB max"
                                            value={editing.image_url}
                                            onChange={(url) => setEditing({ ...editing, image_url: url })}
                                            bucket="menu-images"
                                            path={tenantImagePath(tenantId, "menu-item", editing.id ?? "new")}
                                            aspect="square" size={112} disabled={!tenantId}
                                        />
                                    </div>

                                    {/* Name */}
                                    <div className="space-y-1.5">
                                        <Label>
                                            Name <span className="text-destructive text-xs">*</span>
                                        </Label>
                                        <Input
                                            value={editing.name}
                                            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                                            placeholder="e.g. Paneer Butter Masala"
                                        />
                                    </div>

                                    {/* Description */}
                                    <div className="space-y-1.5">
                                        <Label>Description</Label>
                                        <Textarea
                                            value={editing.description}
                                            onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                                            placeholder="Short description shown on the QR menu…"
                                            rows={3}
                                            className="resize-none"
                                        />
                                    </div>
                                </div>

                                {/* ── RIGHT: Details ── */}
                                <div className="space-y-4 mt-6 md:mt-0">
                                    <SectionLabel>Details</SectionLabel>

                                    {/* Category + Food type — each takes half, both constrained */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1.5 min-w-0">
                                            <Label>
                                                Category <span className="text-destructive text-xs">*</span>
                                            </Label>
                                            <Select value={editing.category_id} onValueChange={(v) => setEditing({ ...editing, category_id: v })}>
                                                <SelectTrigger className="w-full truncate">
                                                    <SelectValue placeholder="Pick category" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {categories.map((c) => (
                                                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5 min-w-0">
                                            <Label>Food type</Label>
                                            <Select value={editing.food_type} onValueChange={(v) => setEditing({ ...editing, food_type: v as FoodType })}>
                                                <SelectTrigger className="w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {FOOD_TYPES.map((f) => (
                                                        <SelectItem key={f.value} value={f.value}>
                                                            <span className="flex items-center gap-2">
                                                                <span className={cn("h-2 w-2 rounded-full shrink-0", f.dot)} />
                                                                {f.label}
                                                            </span>
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    {/* Price + Sale price — 2-col row */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1.5 min-w-0">
                                            <Label>
                                                Price <span className="text-destructive text-xs">*</span>
                                            </Label>
                                            <Input
                                                type="number" step="0.01" min="0"
                                                value={editing.base_price}
                                                onChange={(e) => setEditing({ ...editing, base_price: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-1.5 min-w-0">
                                            <Label className="flex items-baseline gap-1">
                                                Sale price
                                                <span className="text-[10px] text-muted-foreground/60 font-normal">(opt.)</span>
                                            </Label>
                                            <Input
                                                type="number" step="0.01" min="0" placeholder="—"
                                                value={editing.sale_price}
                                                onChange={(e) => setEditing({ ...editing, sale_price: e.target.value })}
                                            />
                                            {salePriceFeedback}
                                        </div>
                                    </div>

                                    {/* GST rate + Prep time — 2-col row */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1.5 min-w-0">
                                            <Label>{cfg.taxShortName} rate</Label>
                                            <Select value={editing.gst_slab} onValueChange={(v) => setEditing({ ...editing, gst_slab: v })}>
                                                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {/* Official slabs + the restaurant's custom rates
                                                      * (Settings → Tax) + this item's current rate. */}
                                                    {mergedTaxRates(cfg, {
                                                        customRates: tenantCustomRates,
                                                        include: [Number(editing.gst_slab)],
                                                    }).map((s) => (
                                                        <SelectItem key={s} value={String(s)}>{s}%</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5 min-w-0">
                                            <Label>Prep time (min)</Label>
                                            <Input
                                                type="number" min="1"
                                                value={editing.prep_time_minutes}
                                                onChange={(e) => setEditing({ ...editing, prep_time_minutes: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    {/* HSN code — full width so long descriptions don't overflow */}
                                    <div className="space-y-1.5">
                                        <Label>HSN / SAC code</Label>
                                        <Select value={editing.hsn_code} onValueChange={(v) => setEditing({ ...editing, hsn_code: v })}>
                                            <SelectTrigger className="w-full truncate">
                                                <SelectValue placeholder="Pick HSN" />
                                            </SelectTrigger>
                                            {/* Render dropdown in a portal so it never clips inside the dialog */}
                                            <SelectContent position="popper" sideOffset={4}>
                                                {hsnCodes.map((h) => (
                                                    <SelectItem key={h.code} value={h.code}>
                                                        <span className="font-mono text-xs mr-2">{h.code}</span>
                                                        <span className="text-muted-foreground">{h.description}</span>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {/* Branch scope (multi-branch only) */}
                                    {branches.length >= 2 && (
                                        <div className="space-y-1.5">
                                            <Label>Branch scope</Label>
                                            <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-sm">
                                                {editing.branch_id
                                                    ? <>Only at <strong>{branches.find((b) => b.id === editing.branch_id)?.name ?? "—"}</strong></>
                                                    : <>Available at <strong>every branch</strong> (shared)</>}
                                            </div>
                                            <p className="text-[11px] text-muted-foreground">
                                                Switch branches in the top-bar dropdown to manage that branch&apos;s catalog.
                                            </p>
                                        </div>
                                    )}

                                    {/* Toggles */}
                                    <div className="space-y-2">
                                        <ToggleRow
                                            label="Tax inclusive"
                                            hint={`Price already includes ${cfg.taxShortName}.`}
                                            checked={editing.is_tax_inclusive}
                                            onCheckedChange={(v) => setEditing({ ...editing, is_tax_inclusive: v })}
                                        />
                                        <ToggleRow
                                            label="Active"
                                            hint="Show on POS & QR menu."
                                            checked={editing.is_active}
                                            onCheckedChange={(v) => setEditing({ ...editing, is_active: v })}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* ══ ROW 2: Recommended add-ons (full width) ══ */}
                            <div>
                                <SectionLabel>Recommended add-ons</SectionLabel>
                                <div className="rounded-lg border border-border/60 bg-muted/10 p-4 space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-2 min-w-0">
                                            <Lightbulb className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                                            <p className="text-xs text-muted-foreground leading-relaxed">
                                                Suggested when this item is added to the cart. Great for &ldquo;want a cold drink with that?&rdquo; upsells.
                                            </p>
                                        </div>
                                        <Badge variant="outline" className="text-[10px] shrink-0">
                                            {editing.recommendedIds.length}/{MAX_RECOMMENDATIONS}
                                        </Badge>
                                    </div>

                                    {/* Selected chips */}
                                    {editing.recommendedIds.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5">
                                            {editing.recommendedIds.map((rid) => {
                                                const r = recById.get(rid)
                                                if (!r) return null
                                                return (
                                                    <button
                                                        key={rid} type="button"
                                                        onClick={() => toggleRecommendation(rid)}
                                                        className="inline-flex items-center gap-1 rounded-full bg-primary/15 border border-primary/30 text-primary px-2.5 py-1 text-xs font-medium hover:bg-primary/25 transition-colors"
                                                    >
                                                        {r.name} <Trash2 className="h-3 w-3 opacity-60" />
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )}

                                    {/* Candidate picker */}
                                    {recCandidates.length === 0 ? (
                                        <p className="text-xs text-muted-foreground italic">Add more active menu items first.</p>
                                    ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-px rounded-md border border-border/40 overflow-hidden bg-border/30 max-h-40 overflow-y-auto">
                                            {recCandidates.map((c) => {
                                                const picked = editing.recommendedIds.includes(c.id)
                                                return (
                                                    <button
                                                        key={c.id} type="button"
                                                        onClick={() => toggleRecommendation(c.id)}
                                                        className={cn(
                                                            "flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors bg-card",
                                                            picked ? "bg-primary/10" : "hover:bg-accent/40",
                                                        )}
                                                    >
                                                        <span className="truncate min-w-0">{c.name}</span>
                                                        <span className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                                                            {formatCurrency(c.base_price)}
                                                            <span className={cn(
                                                                "grid place-items-center h-4 w-4 rounded border text-[10px] shrink-0",
                                                                picked
                                                                    ? "bg-primary border-primary text-primary-foreground"
                                                                    : "border-border bg-background",
                                                            )}>
                                                                {picked && "✓"}
                                                            </span>
                                                        </span>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>

                        </div>{/* end scrollable body */}

                        {/* ── Footer — always pinned at bottom ── */}
                        <DialogFooter className="shrink-0 px-6 py-4 border-t border-border/40 bg-muted/5">
                            <Button type="button" variant="ghost" onClick={() => setItemDialogOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" variant="neon" disabled={savingItem} className="min-w-36">
                                {savingItem ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                {editing.id ? "Save changes" : "Create item"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* ════════════ IMPORT FROM BRANCH ════════════ */}
            <Dialog open={importOpen} onOpenChange={setImportOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader><DialogTitle>Import menu from another branch</DialogTitle></DialogHeader>
                    <div className="space-y-4 pt-1">
                        <p className="text-xs text-muted-foreground rounded-lg bg-muted/40 px-3 py-2.5 leading-relaxed">
                            Copies every active item from the source branch into the target branch as fresh rows.
                            Same-name items already at the target are skipped. Each branch&apos;s sold-out flag stays independent.
                        </p>
                        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                            <div className="space-y-1.5">
                                <Label className="text-xs">From</Label>
                                <Select value={importSource} onValueChange={setImportSource}>
                                    <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
                                    <SelectContent>
                                        {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}{b.is_main ? " (main)" : ""}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <ArrowRight className="h-4 w-4 text-muted-foreground mb-2.5" />
                            <div className="space-y-1.5">
                                <Label className="text-xs">To</Label>
                                <Select value={importTarget} onValueChange={setImportTarget}>
                                    <SelectTrigger><SelectValue placeholder="Target" /></SelectTrigger>
                                    <SelectContent>
                                        {branches.filter((b) => b.id !== importSource).map((b) => (
                                            <SelectItem key={b.id} value={b.id}>{b.name}{b.is_main ? " (main)" : ""}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button>
                        <Button variant="neon" onClick={runImport} disabled={importBusy || !importSource || !importTarget}>
                            {importBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                            Import
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}