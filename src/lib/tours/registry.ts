import type { Step } from "react-joyride"

import type { UserRole } from "@/types/database"

/**
 * Registry of guided product tours. Each entry is a short narrated walk
 * across one surface (Dashboard / Menu / KDS / …) that auto-fires the
 * **first time** that user lands on the page and never again — see
 * migration 53 (`users.completed_tours`) and the `mark_tour_completed`
 * RPC. A "Replay tour" button on each page calls `reset_tour` so the
 * curious user can opt back in without us re-pestering everyone.
 *
 * Step targeting rules (learned the hard way):
 *   • Step 1 ("welcome") of every tour uses `target: 'body'` +
 *     `placement: 'center'` so it renders as a centered modal. We do
 *     **not** anchor it to the whole page container — that pushed the
 *     tooltip off-screen on small viewports because Joyride tried to
 *     place the tooltip "above" a target that started at y=0.
 *   • Subsequent steps target small, well-bounded elements (a button,
 *     a chip, a single tile). Never anchor to a container that wraps
 *     half the page — Joyride's positioning math goes wrong and the
 *     tooltip ends up half off-screen.
 *   • Use explicit `placement: 'bottom' | 'top' | 'left' | 'right'`
 *     where the position matters; reserve `'auto'` for elements that
 *     are always centered in the viewport.
 *
 * Targets reference DOM elements via `data-tour="..."` attributes —
 * never class names, since those churn.
 *
 * Adding a new tour:
 *   1. Pick a short stable key — that becomes the column entry in
 *      `users.completed_tours`. Don't rename existing keys or users
 *      will get re-toured.
 *   2. Decide which roles see it (defaults to "all roles").
 *   3. Define the steps. Keep it short — 4-6 steps lands well; more
 *      than 8 and people start skipping.
 *   4. Sprinkle the `data-tour` markers on the page.
 *   5. Drop `<PageTour tourKey="<key>" />` into the page.
 */
export type TourKey =
    | "dashboard"
    | "menu"
    | "kds"
    | "reservations"
    | "pos"
    | "tables"

export interface TourDef {
    /** Stable storage key. Don't rename. */
    key: TourKey
    /** Steps shown in order. */
    steps: Step[]
    /** Roles allowed to see this tour. Omitted = visible to all roles. */
    roles?: UserRole[]
    /** Human-readable tour label, shown on the Replay button tooltip. */
    label: string
}

// We deliberately don't type these as `Partial<Step>` — that makes
// `target` optional, and TypeScript then refuses to assign the
// spread-result to a Step (whose `target` is required). Plain object
// literals let the spread carry only the fields actually set.

/** Sensible Joyride defaults for an anchored step. */
const anchoredStep = {
    // skipBeacon (Joyride v3 — renamed from disableBeacon) goes
    // straight to the tooltip without a pulsing dot. Less alarming
    // for guided tours that fire on page load.
    skipBeacon: true,
} as const

/** First-step "welcome" — renders as a centered modal regardless of
 *  what's on the page. Pairs with the rule above: never use a giant
 *  container as the first target. */
const welcomeStep = {
    ...anchoredStep,
    target: "body",
    placement: "center",
} as const satisfies Pick<Step, "target" | "placement"> & { skipBeacon: boolean }

export const TOURS: Record<TourKey, TourDef> = {
    dashboard: {
        key: "dashboard",
        label: "Dashboard tour",
        steps: [
            {
                ...welcomeStep,
                title: "Welcome to RestoPOS",
                content: "This is your dashboard — a snapshot of today's sales, orders, and what needs attention. It re-shapes itself depending on whether you're an admin, a captain, or a chef.",
            },
            {
                ...anchoredStep,
                target: '[data-tour="dashboard-kpis"]',
                title: "Today at a glance",
                content: "Live tiles for revenue, bills, top-selling item, and anything outstanding. They refresh on their own — no manual reload needed.",
                placement: "bottom",
            },
            {
                ...anchoredStep,
                target: '[data-tour="dashboard-charts"]',
                title: "Trends and breakdowns",
                content: "Charts compare today vs. the rolling 7-day average so you spot a slow morning before it becomes a slow week.",
                placement: "top",
            },
            {
                ...anchoredStep,
                // Anchor at the topbar's "Menu" launcher button — the
                // sidebar was retired (see AppShell), so navigation
                // now lives in this dropdown. Targeting the actual
                // visible navigation entry-point keeps the step
                // useful regardless of whether a sidebar ever comes
                // back.
                target: '[data-tour="topbar-menu"]',
                title: "Everything else lives here",
                content: "Tap Menu in the topbar — POS, Inventory, KDS, Reports, Settings — every screen lives one click away. We'll give each page its own quick tour the first time you visit it.",
                placement: "bottom",
            },
        ],
    },
    menu: {
        key: "menu",
        label: "Menu admin tour",
        roles: ["OWNER", "MANAGER"],
        steps: [
            {
                ...welcomeStep,
                title: "Your menu",
                content: "This is where your catalog lives. Changes apply instantly to the POS and the public QR ordering page.",
            },
            {
                ...anchoredStep,
                target: '[data-tour="menu-categories"]',
                title: "Categories",
                content: "Group items into Starters, Mains, Desserts, and so on. Use the chips to filter the grid below.",
                placement: "bottom",
            },
            {
                ...anchoredStep,
                target: '[data-tour="menu-add-item"]',
                title: "Add an item",
                content: "Name, price, category, photo, tax rule — that's all you need. You can mark items tax-inclusive or exclusive per item.",
                placement: "bottom",
            },
            {
                ...anchoredStep,
                target: '[data-tour="menu-grid"]',
                title: "Item grid",
                content: "Tap any card to edit it. Mark a card sold-out for the day from here without deleting the item.",
                placement: "top",
            },
        ],
    },
    kds: {
        key: "kds",
        label: "Kitchen Display tour",
        roles: ["OWNER", "MANAGER", "KITCHEN"],
        steps: [
            {
                ...welcomeStep,
                title: "Kitchen Display Screen",
                content: "Every card here is one KOT — the batch of items a waiter sent at once. Tables with multiple courses get multiple cards.",
            },
            {
                ...anchoredStep,
                target: '[data-tour="kds-tabs"]',
                title: "Pending → Preparing → Ready",
                content: "Tap a card's button to move it through the flow. The colour changes as a KOT ages so an old one stands out.",
                placement: "bottom",
            },
            {
                ...anchoredStep,
                target: '[data-tour="kds-sound"]',
                title: "Mute or unmute the chime",
                content: "A short ding plays on every new ticket and a different tone if the cashier voids a line. Mute it after hours from here.",
                placement: "bottom",
            },
        ],
    },
    reservations: {
        key: "reservations",
        label: "Reservations tour",
        roles: ["OWNER", "MANAGER", "CASHIER", "CAPTAIN"],
        steps: [
            {
                ...welcomeStep,
                title: "Reservations",
                content: "Take, edit, and seat bookings here. Each row shows the table, party size, and ETA so you know who's next.",
            },
            {
                ...anchoredStep,
                target: '[data-tour="reservations-new"]',
                title: "New reservation",
                content: "Customer name, phone, party size, time, and table — that's the minimum to lock a slot.",
                placement: "bottom",
            },
            {
                ...anchoredStep,
                target: '[data-tour="reservations-list"]',
                title: "Today's bookings",
                content: "Filter by status — Confirmed, Seated, No-show — and one-click seat a party when they walk in.",
                placement: "top",
            },
        ],
    },
    pos: {
        key: "pos",
        label: "POS tour",
        roles: ["OWNER", "MANAGER", "CASHIER", "CAPTAIN"],
        steps: [
            {
                ...welcomeStep,
                title: "Welcome to the POS",
                content: "This is where you ring up orders. Pick a table (or skip for takeaway), tap items into the cart, then send to the kitchen or bill out.",
            },
            {
                ...anchoredStep,
                target: '[data-tour="pos-table-picker"]',
                title: "Pick a table (or skip it)",
                content: "Choose a dining table for dine-in, or leave it blank for takeaway and QSR. You can also park an order in 'Waiting' if the table isn't decided yet.",
                placement: "bottom",
            },
            {
                ...anchoredStep,
                target: '[data-tour="pos-menu"]',
                title: "Tap to add",
                content: "Tap an item to add it to the cart on the right. Repeat tapping just increments the quantity.",
                placement: "top",
            },
            {
                ...anchoredStep,
                target: '[data-tour="pos-cart"]',
                title: "Cart",
                content: "Adjust quantities, add notes, apply a discount. The total here matches the printed bill exactly.",
                placement: "left",
            },
            {
                ...anchoredStep,
                target: '[data-tour="pos-checkout"]',
                title: "Review & checkout",
                content: "Generates the bill atomically: invoice number, taxes, audit log. From here you record the payment.",
                placement: "left",
            },
        ],
    },
    tables: {
        key: "tables",
        label: "Tables tour",
        roles: ["OWNER", "MANAGER", "CASHIER", "CAPTAIN"],
        steps: [
            {
                ...welcomeStep,
                title: "Floor plan",
                content: "Every table at a glance — green is free, amber is occupied, red is over-due. Tap a table to drill into its current order.",
            },
            {
                ...anchoredStep,
                target: '[data-tour="tables-grid"]',
                title: "Branch-scoped view",
                content: "You see the tables for the branch you're currently working from. Switch branches via the topbar to see another location.",
                placement: "top",
            },
        ],
    },
}

/** Look up a tour by key — returns undefined for an unknown key. */
export function getTour(key: TourKey): TourDef | undefined {
    return TOURS[key]
}

/** Whether this role is allowed to see the tour. Tours with no
 *  `roles` list are visible to everyone. */
export function tourVisibleToRole(def: TourDef, role: UserRole | null | undefined): boolean {
    if (!def.roles || def.roles.length === 0) return true
    if (!role) return false
    return def.roles.includes(role)
}
