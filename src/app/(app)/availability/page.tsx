"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { Ban, CheckCircle2, Flame, Loader2, Search, Soup, UtensilsCrossed } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { PageHeader } from "@/components/app-shell/page-header"
import { createClient } from "@/lib/supabase/client"
import { scopeMenuToBranch, useActiveBranch } from "@/lib/branch/active-branch"
import { cn, formatCurrency } from "@/lib/utils"
import type { FoodType, MenuCategory, MenuItem } from "@/types/database"

const FOOD_DOT: Record<FoodType, string> = {
    VEG: "#22c55e",
    NON_VEG: "#ef4444",
    EGG: "#f59e0b",
    VEGAN: "#10b981",
}
const FOOD_LABEL: Record<FoodType, string> = {
    VEG: "Veg", NON_VEG: "Non-veg", EGG: "Egg", VEGAN: "Vegan",
}

type Filter = "ALL" | "AVAILABLE" | "SOLD_OUT"

export default function AvailabilityPage() {
    const supabase = useMemo(() => createClient(), [])
    const [loading, setLoading] = useState(true)
    const [categories, setCategories] = useState<MenuCategory[]>([])
    const [items, setItems] = useState<MenuItem[]>([])
    const [search, setSearch] = useState("")
    const [filter, setFilter] = useState<Filter>("ALL")
    const [busyId, setBusyId] = useState<string | null>(null)
    const { activeBranchId } = useActiveBranch()

    async function load() {
        setLoading(true)
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) return
        const { data: row } = await supabase.from("users").select("tenant_id").eq("id", u.user.id).maybeSingle()
        if (!row?.tenant_id) return
        let itemsQ = supabase.from("menu_items").select("*").is("deleted_at", null).eq("is_active", true).order("sort_order")
        // Menu items: NULL branch_id means "available at every branch",
        // so we use scopeMenuToBranch to include those + this branch's
        // own items. Sold-out toggles affect only the one row, which is
        // naturally per-branch.
        itemsQ = scopeMenuToBranch(itemsQ, activeBranchId)
        const [{ data: cats }, { data: its }] = await Promise.all([
            supabase.from("menu_categories").select("*").is("deleted_at", null).eq("is_active", true).order("sort_order"),
            itemsQ,
        ])
        setCategories((cats ?? []) as MenuCategory[])
        setItems((its ?? []) as MenuItem[])
        setLoading(false)
    }
    useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeBranchId])

    async function toggle(it: MenuItem) {
        const next = !it.is_sold_out
        setBusyId(it.id)
        // optimistic
        setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, is_sold_out: next } : x))
        const { error } = await supabase.rpc("set_item_sold_out" as never, {
            p_item_id: it.id,
            p_sold_out: next,
        } as never)
        setBusyId(null)
        if (error) {
            setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, is_sold_out: !next } : x))
            return toast.error(error.message ?? "Couldn't update")
        }
        toast.success(next ? `${it.name} marked sold out` : `${it.name} is available again`)
    }

    const q = search.trim().toLowerCase()
    const filtered = useMemo(() => {
        return items.filter((i) => {
            if (filter === "AVAILABLE" && i.is_sold_out) return false
            if (filter === "SOLD_OUT" && !i.is_sold_out) return false
            if (q && !i.name.toLowerCase().includes(q)) return false
            return true
        })
    }, [items, q, filter])

    const grouped = useMemo(() => {
        const byCat = new Map<string, { name: string; items: MenuItem[] }>()
        for (const c of categories) byCat.set(c.id, { name: c.name, items: [] })
        const orphans: MenuItem[] = []
        for (const it of filtered) {
            if (it.category_id && byCat.has(it.category_id)) byCat.get(it.category_id)!.items.push(it)
            else orphans.push(it)
        }
        const out = Array.from(byCat.values()).filter((g) => g.items.length > 0)
        if (orphans.length) out.push({ name: "Uncategorised", items: orphans })
        return out
    }, [filtered, categories])

    const soldOutCount = items.filter((i) => i.is_sold_out).length
    const availableCount = items.length - soldOutCount

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-6xl space-y-6">
            <PageHeader
                kicker="Operations"
                title="Availability"
                highlight="86 a dish in one tap"
                description="Out of paneer? Sold out the biryani? Flip it here and it instantly disappears from the POS and the table-QR menu."
            />

            {/* ── Stat strip ────────────────────────────────────────────
              * Three quick-glance KPI cards so the kitchen lead can see
              * "what's the floor look like?" without scanning the list. */}
            <div className="grid grid-cols-3 gap-3">
                <StatCard
                    label="Available now"
                    value={availableCount}
                    icon={CheckCircle2}
                    tone="success"
                />
                <StatCard
                    label="Sold out"
                    value={soldOutCount}
                    icon={Ban}
                    tone={soldOutCount > 0 ? "warning" : "muted"}
                />
                <StatCard
                    label="On menu"
                    value={items.length}
                    icon={Soup}
                    tone="primary"
                />
            </div>

            {/* ── Search + filter chips ────────────────────────────────
              * Search is wide on its own row; chips below keep "Sold out"
              * one tap away — the most common reason to open this page. */}
            <Card>
                <CardContent className="p-3 flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Find an item…"
                            className="pl-9"
                        />
                    </div>
                    <div className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-card/40 p-0.5">
                        {([
                            { id: "ALL" as Filter,       label: "All",       count: items.length },
                            { id: "AVAILABLE" as Filter, label: "Available", count: availableCount },
                            { id: "SOLD_OUT" as Filter,  label: "Sold out",  count: soldOutCount },
                        ]).map((opt) => (
                            <button
                                key={opt.id}
                                onClick={() => setFilter(opt.id)}
                                className={cn(
                                    "px-3 py-1.5 text-xs font-medium rounded transition-colors inline-flex items-center gap-1.5",
                                    filter === opt.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {opt.label}
                                <span className={cn(
                                    "rounded-full px-1.5 py-0 text-[10px] tabular-nums",
                                    filter === opt.id ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
                                )}>
                                    {opt.count}
                                </span>
                            </button>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {loading ? (
                <div className="grid sm:grid-cols-2 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
                </div>
            ) : grouped.length === 0 ? (
                <Card>
                    <CardContent className="py-16 text-center text-muted-foreground">
                        <UtensilsCrossed className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        {q
                            ? <>No items match <span className="font-semibold text-foreground">&ldquo;{search}&rdquo;</span>.</>
                            : filter === "SOLD_OUT"
                                ? "Nothing is sold out right now."
                                : filter === "AVAILABLE"
                                    ? "Every item is currently sold out."
                                    : "No menu items yet — a manager can add them under Menu."}
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-6">
                    {grouped.map((g) => (
                        <section key={g.name}>
                            <h3 className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground mb-2.5 flex items-center gap-2">
                                <span className="inline-block h-1 w-6 rounded-full bg-primary/15" />
                                {g.name}
                                <span className="text-[10px] font-medium normal-case tracking-normal text-muted-foreground/70">
                                    · {g.items.length} item{g.items.length === 1 ? "" : "s"}
                                </span>
                            </h3>
                            <div className="grid gap-2 sm:grid-cols-2">
                                {g.items.map((it) => (
                                    <ItemRow
                                        key={it.id}
                                        item={it}
                                        busy={busyId === it.id}
                                        onToggle={() => toggle(it)}
                                    />
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            )}
        </div>
    )
}

function StatCard({
    label, value, icon: Icon, tone,
}: {
    label: string
    value: number
    icon: React.ComponentType<{ className?: string }>
    tone: "primary" | "success" | "warning" | "muted"
}) {
    const toneClass = {
        primary: { ring: "from-primary/25 to-primary/5",       text: "text-primary",      border: "border-primary/30" },
        success: { ring: "from-success/25 to-success/5",       text: "text-success",      border: "border-success/30" },
        warning: { ring: "from-warning/30 to-warning/5",       text: "text-warning",      border: "border-warning/40" },
        muted:   { ring: "from-muted-foreground/15 to-muted-foreground/5", text: "text-muted-foreground", border: "border-border/50" },
    }[tone]
    return (
        <Card className={cn("relative overflow-hidden", toneClass.border)}>
            <CardContent className="p-4 flex items-center gap-3">
                <span className={cn("grid place-items-center h-11 w-11 rounded-xl bg-border/60r", toneClass.ring)}>
                    <Icon className={cn("h-5 w-5", toneClass.text)} />
                </span>
                <div className="min-w-0">
                    <div className="text-2xl font-bold tabular-nums leading-none">{value}</div>
                    <div className="text-xs text-muted-foreground mt-1">{label}</div>
                </div>
            </CardContent>
        </Card>
    )
}

function ItemRow({
    item, busy, onToggle,
}: {
    item: MenuItem
    busy: boolean
    onToggle: () => void
}) {
    const sold = item.is_sold_out
    const onSale = item.sale_price != null && item.sale_price < item.base_price
    return (
        <div
            className={cn(
                "group relative flex items-center gap-3 rounded-xl border p-3 transition-all",
                sold
                    ? "border-destructive/30 bg-destructive/[0.04]"
                    : "border-border/50 bg-card/40 hover:border-primary/40 hover:shadow-glow",
            )}
        >
            {/* Left accent bar — strong visual cue for sold-out without
              * relying on text colour alone (kitchen lighting is rough). */}
            <span
                className={cn(
                    "absolute left-0 top-2 bottom-2 w-1 rounded-r",
                    sold ? "bg-destructive" : "bg-transparent",
                )}
                aria-hidden
            />

            {/* Thumbnail or food-type swatch */}
            {item.image_url ? (
                <div className="relative h-12 w-12 rounded-lg overflow-hidden shrink-0 border border-border/40 bg-muted">
                    <Image
                        src={item.image_url}
                        alt=""
                        fill
                        sizes="48px"
                        className={cn("object-cover transition-opacity", sold && "opacity-50 grayscale")}
                    />
                </div>
            ) : (
                <div
                    className={cn(
                        "h-12 w-12 rounded-lg shrink-0 grid place-items-center border border-border/40",
                        sold ? "bg-destructive/10" : "bg-muted/40",
                    )}
                    title={FOOD_LABEL[item.food_type]}
                >
                    <span
                        className="h-3 w-3 rounded-full"
                        style={{ background: FOOD_DOT[item.food_type] }}
                    />
                </div>
            )}

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={cn("font-medium text-sm truncate", sold && "line-through text-muted-foreground")}>
                        {item.name}
                    </span>
                    {onSale && !sold && (
                        <Badge variant="warning" className="text-[9px] px-1 py-0">
                            <Flame className="h-2.5 w-2.5 mr-0.5" /> Sale
                        </Badge>
                    )}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                    {onSale ? (
                        <>
                            <span className="text-foreground font-medium">{formatCurrency(item.sale_price!)}</span>
                            <span className="line-through ml-1.5">{formatCurrency(item.base_price)}</span>
                        </>
                    ) : (
                        formatCurrency(item.base_price)
                    )}
                    {" · GST "}{item.gst_slab}%
                </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
                {busy
                    ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    : (
                        <span className={cn(
                            "text-[10px] font-semibold uppercase tracking-wider",
                            sold ? "text-destructive" : "text-success",
                        )}>
                            {sold ? "Sold out" : "On menu"}
                        </span>
                    )}
                <Switch
                    checked={!sold}
                    onCheckedChange={onToggle}
                    disabled={busy}
                    aria-label={sold ? `Mark ${item.name} as available` : `Mark ${item.name} as sold out`}
                />
            </div>
        </div>
    )
}
