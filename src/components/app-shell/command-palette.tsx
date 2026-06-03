"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
    BarChart3,
    Boxes,
    Building2,
    CalendarDays,
    ChefHat,
    Coins,
    FileText,
    LayoutDashboard,
    Receipt,
    Search,
    Settings,
    ShoppingCart,
    Sparkles,
    UserCircle,
    Users,
    UtensilsCrossed,
} from "lucide-react"

import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
    CommandShortcut,
} from "@/components/ui/command"
import { createClient } from "@/lib/supabase/client"
import type { UserRole } from "@/types/database"

/**
 * Global command palette — ⌘K / Ctrl+K (or "/" outside an input).
 *
 * Mounted once at the AppShell level. Searches across:
 *   • Pages — the app's navigable routes, filtered to what this
 *     role can actually open.
 *   • Quick actions — common one-tap intents (new bill, switch
 *     branch, sign out, …).
 *   • Menu items — searched against the tenant's catalog as the
 *     OWNER types (case-insensitive `ilike`).
 *   • Customers — searched by name or phone.
 *   • Bills — searched by invoice number prefix.
 *
 * Performance:
 *   • Pages + quick actions are in-memory (instant).
 *   • Menu items / customers / bills are remote queries fired
 *     ~180 ms after the last keystroke. The palette is happy to
 *     render in three stages — pages immediately, then remote rows
 *     filling in as they arrive.
 */

type Page = {
    kind: "page"
    href: string
    label: string
    keywords?: string
    icon: React.ComponentType<{ className?: string }>
    roles?: ReadonlySet<UserRole>
}

const ALL_ROLES = new Set<UserRole>([
    "OWNER", "MANAGER", "CASHIER", "CAPTAIN", "KITCHEN", "DELIVERY", "AUDITOR",
])
const ADMIN = new Set<UserRole>(["OWNER", "MANAGER"])
const FRONT_OF_HOUSE = new Set<UserRole>(["OWNER", "MANAGER", "CASHIER", "CAPTAIN"])
const KITCHEN_ROLES = new Set<UserRole>(["OWNER", "MANAGER", "KITCHEN"])

const PAGES: Page[] = [
    { kind: "page", href: "/dashboard", label: "Dashboard",         keywords: "home overview kpi analytics today", icon: LayoutDashboard, roles: ADMIN },
    { kind: "page", href: "/pos",        label: "POS",               keywords: "point of sale checkout cashier till bill",      icon: ShoppingCart,    roles: FRONT_OF_HOUSE },
    { kind: "page", href: "/tables",     label: "Tables",            keywords: "floor plan seating dining tables",              icon: Building2,       roles: FRONT_OF_HOUSE },
    { kind: "page", href: "/orders",     label: "Sales",             keywords: "orders transactions revenue list",               icon: Receipt,         roles: ALL_ROLES },
    { kind: "page", href: "/bills",      label: "Bills",             keywords: "invoices receipts history print",                icon: FileText,        roles: ALL_ROLES },
    { kind: "page", href: "/kds",        label: "Kitchen display",   keywords: "kds kitchen orders prep chef cook",              icon: ChefHat,         roles: KITCHEN_ROLES },
    { kind: "page", href: "/menu-admin", label: "Menu admin",        keywords: "catalog items categories prices food drinks",    icon: UtensilsCrossed, roles: ADMIN },
    { kind: "page", href: "/ai",         label: "AI menu import",    keywords: "ai photo upload extract menu image gemini ocr", icon: Sparkles,        roles: ADMIN },
    { kind: "page", href: "/inventory",  label: "Inventory",         keywords: "stock ingredients suppliers purchase",            icon: Boxes,           roles: ADMIN },
    { kind: "page", href: "/customers",  label: "Customers",         keywords: "guests crm loyalty phone book",                   icon: Users,           roles: FRONT_OF_HOUSE },
    { kind: "page", href: "/reservations", label: "Reservations",    keywords: "bookings waitlist seating arrive",                icon: CalendarDays,    roles: FRONT_OF_HOUSE },
    { kind: "page", href: "/reports",    label: "Reports",           keywords: "analytics charts export csv",                     icon: BarChart3,       roles: ADMIN },
    { kind: "page", href: "/my-collections", label: "My collections", keywords: "shift cash reconcile end-of-day",                icon: Coins,           roles: FRONT_OF_HOUSE },
    { kind: "page", href: "/settings",   label: "Settings",          keywords: "preferences config",                              icon: Settings,        roles: ADMIN },
    { kind: "page", href: "/settings/profile", label: "My profile",  keywords: "name email avatar password",                       icon: UserCircle,      roles: ALL_ROLES },
]

const QUICK_ACTIONS: Page[] = [
    { kind: "page", href: "/pos",            label: "Start a new sale",   keywords: "new bill checkout open pos", icon: ShoppingCart, roles: FRONT_OF_HOUSE },
    { kind: "page", href: "/customers/new",  label: "Add a customer",     keywords: "new customer create",        icon: Users,        roles: FRONT_OF_HOUSE },
    { kind: "page", href: "/ai",             label: "Import menu from a photo", keywords: "ai photo upload",     icon: Sparkles,     roles: ADMIN },
]

type ItemHit = { kind: "menu-item"; id: string; name: string; price: number }
type CustomerHit = { kind: "customer"; id: string; name: string | null; phone: string | null }
type BillHit = { kind: "bill"; id: string; invoice_number: string; grand_total: number }

export function CommandPalette({ role }: { role: UserRole }) {
    const router = useRouter()
    const supabase = useMemo(() => createClient(), [])
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState("")
    const [debouncedQ, setDebouncedQ] = useState("")
    const [items, setItems] = useState<ItemHit[]>([])
    const [customers, setCustomers] = useState<CustomerHit[]>([])
    const [bills, setBills] = useState<BillHit[]>([])

    // ── Global ⌘K / Ctrl+K binding + "/" outside form fields ────────
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            const isMac = navigator.platform.toLowerCase().includes("mac")
            const cmdK = (isMac ? e.metaKey : e.ctrlKey) && (e.key === "k" || e.key === "K")
            if (cmdK) {
                e.preventDefault()
                setOpen((o) => !o)
                return
            }
            // `/` opens too, unless the user is typing in a field.
            if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
                const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase()
                const editable = (e.target as HTMLElement | null)?.isContentEditable
                if (tag === "input" || tag === "textarea" || tag === "select" || editable) return
                e.preventDefault()
                setOpen(true)
            }
        }
        window.addEventListener("keydown", onKeyDown)
        // Also listen for a custom event so a topbar button (or any
        // other discoverable trigger) can pop the palette open
        // without re-implementing the keyboard plumbing.
        function onOpenEvent() { setOpen(true) }
        window.addEventListener("command-palette:open", onOpenEvent)
        return () => {
            window.removeEventListener("keydown", onKeyDown)
            window.removeEventListener("command-palette:open", onOpenEvent)
        }
    }, [])

    // Debounce the query so we're not hammering Supabase on every keystroke.
    useEffect(() => {
        const t = window.setTimeout(() => setDebouncedQ(query.trim()), 180)
        return () => window.clearTimeout(t)
    }, [query])

    // Reset query each time the palette closes so re-opening starts
    // fresh — feels more like Spotlight / Linear than a search box
    // that "remembers" what was last typed.
    useEffect(() => {
        if (!open) setQuery("")
    }, [open])

    // Remote search — fires when the debounced query has at least 2 chars.
    // Three parallel queries; we don't wait for each other.
    const reqIdRef = useRef(0)
    useEffect(() => {
        if (!open) {
            setItems([]); setCustomers([]); setBills([])
            return
        }
        if (debouncedQ.length < 2) {
            setItems([]); setCustomers([]); setBills([])
            return
        }
        const myReq = ++reqIdRef.current
        const q = debouncedQ
        void (async () => {
            const [itemsRes, customersRes, billsRes] = await Promise.all([
                supabase.from("menu_items")
                    .select("id, name, base_price, sale_price")
                    .ilike("name", `%${q}%`)
                    .is("deleted_at", null)
                    .eq("is_active", true)
                    .limit(8),
                supabase.from("customers")
                    .select("id, name, phone")
                    .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
                    .is("deleted_at", null)
                    .limit(8),
                supabase.from("bills")
                    .select("id, invoice_number, grand_total")
                    .ilike("invoice_number", `%${q}%`)
                    .limit(8),
            ])
            // Ignore stale responses — a newer keystroke might have
            // already fired the next query.
            if (myReq !== reqIdRef.current) return
            type ItemRow = { id: string; name: string; base_price: number | string; sale_price: number | string | null }
            type CustomerRow = { id: string; name: string | null; phone: string | null }
            type BillRow = { id: string; invoice_number: string; grand_total: number | string }
            setItems((itemsRes.data ?? []).map((r) => {
                const row = r as ItemRow
                const sale = row.sale_price != null ? Number(row.sale_price) : null
                const base = Number(row.base_price)
                return {
                    kind: "menu-item" as const,
                    id: row.id,
                    name: row.name,
                    price: sale != null && sale > 0 && sale < base ? sale : base,
                }
            }))
            setCustomers((customersRes.data ?? []).map((r) => {
                const row = r as CustomerRow
                return { kind: "customer" as const, id: row.id, name: row.name, phone: row.phone }
            }))
            setBills((billsRes.data ?? []).map((r) => {
                const row = r as BillRow
                return { kind: "bill" as const, id: row.id, invoice_number: row.invoice_number, grand_total: Number(row.grand_total) }
            }))
        })()
    }, [debouncedQ, open, supabase])

    const visiblePages = useMemo(
        () => PAGES.filter((p) => !p.roles || p.roles.has(role)),
        [role],
    )
    const visibleActions = useMemo(
        () => QUICK_ACTIONS.filter((p) => !p.roles || p.roles.has(role)),
        [role],
    )

    const navigate = useCallback((href: string) => {
        setOpen(false)
        router.push(href)
    }, [router])

    const isMacish = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac")
    const shortcutLabel = isMacish ? "⌘K" : "Ctrl K"

    return (
        <CommandDialog open={open} onOpenChange={setOpen} label="Search the app">
            <CommandInput
                placeholder="Search pages, menu items, customers, bills…"
                value={query}
                onValueChange={setQuery}
            />
            <CommandList>
                <CommandEmpty>
                    {debouncedQ.length < 2
                        ? "Type to search."
                        : `Nothing matches "${debouncedQ}".`}
                </CommandEmpty>

                {visibleActions.length > 0 && (
                    <CommandGroup heading="Quick actions">
                        {visibleActions.map((a) => (
                            <CommandItem
                                key={`action:${a.href}:${a.label}`}
                                value={`${a.label} ${a.keywords ?? ""}`}
                                onSelect={() => navigate(a.href)}
                            >
                                <a.icon className="h-4 w-4 text-primary" />
                                <span>{a.label}</span>
                                <CommandShortcut>→</CommandShortcut>
                            </CommandItem>
                        ))}
                    </CommandGroup>
                )}

                <CommandSeparator />

                <CommandGroup heading="Pages">
                    {visiblePages.map((p) => (
                        <CommandItem
                            key={`page:${p.href}`}
                            value={`${p.label} ${p.keywords ?? ""}`}
                            onSelect={() => navigate(p.href)}
                        >
                            <p.icon className="h-4 w-4 text-muted-foreground" />
                            <span>{p.label}</span>
                            <CommandShortcut className="font-mono">{p.href}</CommandShortcut>
                        </CommandItem>
                    ))}
                </CommandGroup>

                {items.length > 0 && (
                    <>
                        <CommandSeparator />
                        <CommandGroup heading="Menu items">
                            {items.map((it) => (
                                <CommandItem
                                    key={`item:${it.id}`}
                                    value={`item ${it.name}`}
                                    onSelect={() => navigate(`/menu-admin#${it.id}`)}
                                >
                                    <UtensilsCrossed className="h-4 w-4 text-muted-foreground" />
                                    <span>{it.name}</span>
                                    <CommandShortcut className="tabular-nums">{it.price.toFixed(2)}</CommandShortcut>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </>
                )}

                {customers.length > 0 && (
                    <>
                        <CommandSeparator />
                        <CommandGroup heading="Customers">
                            {customers.map((c) => (
                                <CommandItem
                                    key={`customer:${c.id}`}
                                    value={`customer ${c.name ?? ""} ${c.phone ?? ""}`}
                                    onSelect={() => navigate(`/customers?id=${c.id}`)}
                                >
                                    <Users className="h-4 w-4 text-muted-foreground" />
                                    <span>{c.name ?? c.phone ?? "Unnamed"}</span>
                                    {c.phone && <CommandShortcut>{c.phone}</CommandShortcut>}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </>
                )}

                {bills.length > 0 && (
                    <>
                        <CommandSeparator />
                        <CommandGroup heading="Bills">
                            {bills.map((b) => (
                                <CommandItem
                                    key={`bill:${b.id}`}
                                    value={`bill ${b.invoice_number}`}
                                    onSelect={() => navigate(`/bills/${b.id}`)}
                                >
                                    <FileText className="h-4 w-4 text-muted-foreground" />
                                    <span className="font-mono">{b.invoice_number}</span>
                                    <CommandShortcut className="tabular-nums">{b.grand_total.toFixed(2)}</CommandShortcut>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </>
                )}
            </CommandList>
            {/* Hint footer — shows the shortcut so first-timers learn it. */}
            <div className="flex items-center justify-between border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                    <Search className="h-3 w-3" />
                    Universal search
                </span>
                <span>
                    Open with <kbd className="font-mono text-[10px] bg-muted/60 border border-border/60 rounded px-1.5 py-0.5">{shortcutLabel}</kbd> or{" "}
                    <kbd className="font-mono text-[10px] bg-muted/60 border border-border/60 rounded px-1.5 py-0.5">/</kbd>
                </span>
            </div>
        </CommandDialog>
    )
}
