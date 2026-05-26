import type { UserRole } from "@/types/database"

/** Single source of truth for what each role can do (matches RLS in 005_rls.sql). */
export const PERMISSIONS = {
    "menu.read":           ["OWNER", "MANAGER", "CASHIER", "CAPTAIN", "KITCHEN", "AUDITOR"],
    "menu.write":          ["OWNER", "MANAGER"],
    // Flipping an item to "sold out" / "available" — an operational call the
    // kitchen + front-of-house make all the time, distinct from editing the
    // item's price/GST (which stays menu.write, owner/manager only).
    "menu.toggle_availability": ["OWNER", "MANAGER", "CASHIER", "CAPTAIN", "KITCHEN"],
    "order.create":        ["OWNER", "MANAGER", "CASHIER", "CAPTAIN"],
    "order.modify_open":   ["OWNER", "MANAGER", "CASHIER", "CAPTAIN"],
    "order.discount":      ["OWNER", "MANAGER", "CASHIER"],
    "bill.generate":       ["OWNER", "MANAGER", "CASHIER"],
    "bill.edit_locked":    ["OWNER"],
    "bill.void":           ["OWNER"],
    "payment.record":      ["OWNER", "MANAGER", "CASHIER"],
    "table.write":         ["OWNER", "MANAGER"],
    "staff.manage":        ["OWNER"],
    /** Gates the create-staff flow and (transitively) the assign-template
     *  dropdown. Owner gets it by default; an Owner can grant it to a
     *  template so a non-owner can create accounts too — but the subset
     *  rule kicks in: they can only assign a template whose permissions
     *  are contained in their own. See role_template_missing_perms RPC. */
    "manage_users":        ["OWNER"],
    "settings.write":      ["OWNER"],
    "reports.view":        ["OWNER", "MANAGER", "AUDITOR"],
    "reports.export":      ["OWNER", "MANAGER"],
    "ca_export.run":       ["OWNER"],
    "audit_log.view":      ["OWNER", "MANAGER", "AUDITOR"],
    "purchase.write":      ["OWNER", "MANAGER"],
    "expense.write":       ["OWNER", "MANAGER"],
    "balance_sheet.write": ["OWNER"],
} as const satisfies Record<string, readonly UserRole[]>

export type Permission = keyof typeof PERMISSIONS

/** Plain-language metadata for the role-template editor UI.
 *
 *   - `category`    — drives the grouping in the editor.
 *   - `enforcement` — where this permission is actually CHECKED:
 *
 *       "ui" → only the front-end gates it (e.g. hiding the Reports page,
 *              hiding a nav card). Removing it from a template fully
 *              removes access from what the assigned user sees.
 *
 *       "db" → Postgres RLS / a SECURITY DEFINER RPC enforces it by ROLE.
 *              Removing it from a template hides the UI but does not yet
 *              change DB behaviour — to actually deny a write to the
 *              backend you have to change the user's base role. The
 *              template editor shows these with a small "DB-enforced"
 *              badge so the OWNER understands the affordance.
 */
export const PERMISSION_META: Record<Permission, {
    label: string
    /** One short sentence — "Lets this user …" — describing exactly what
     *  the user can do when this permission is granted. Shown directly under
     *  the toggle in the per-user permissions editor so the OWNER never has
     *  to guess what flipping a switch will actually let someone do. */
    description: string
    category: PermissionCategory
    enforcement: "ui" | "db"
}> = {
    "menu.read": {
        label: "View the menu",
        description: "Lets this user browse menu items and categories from the catalog screen.",
        category: "Catalog", enforcement: "ui",
    },
    "menu.write": {
        label: "Edit the menu",
        description: "Lets this user create, rename, hide or delete menu items, categories and modifiers — including their prices and tax slabs.",
        category: "Catalog", enforcement: "db",
    },
    "menu.toggle_availability": {
        label: "Mark items sold-out",
        description: "Lets this user flip individual items in and out of stock from the floor, without touching price or tax.",
        category: "Catalog", enforcement: "ui",
    },
    "order.create": {
        label: "Take orders",
        description: "Lets this user open new orders — dine-in, takeaway, delivery or QR pickups.",
        category: "Sales", enforcement: "db",
    },
    "order.modify_open": {
        label: "Edit open orders",
        description: "Lets this user add, remove or change items in an order before it's billed.",
        category: "Sales", enforcement: "db",
    },
    "order.discount": {
        label: "Apply discounts",
        description: "Lets this user add a discount or apply a coupon at checkout.",
        category: "Sales", enforcement: "db",
    },
    "bill.generate": {
        label: "Generate bills",
        description: "Lets this user issue a bill and ring up payment at checkout.",
        category: "Sales", enforcement: "db",
    },
    "bill.edit_locked": {
        label: "Edit locked bills",
        description: "Lets this user reopen and edit a bill that's already been finalised.",
        category: "Sales", enforcement: "db",
    },
    "bill.void": {
        label: "Void a bill",
        description: "Lets this user cancel a bill that was already issued — used to fix mistakes.",
        category: "Sales", enforcement: "db",
    },
    "payment.record": {
        label: "Record payments",
        description: "Lets this user mark a bill paid — cash, card, UPI or gift card.",
        category: "Sales", enforcement: "db",
    },
    "table.write": {
        label: "Manage tables",
        description: "Lets this user add, rename, merge or delete dining tables and floor sections.",
        category: "Operations", enforcement: "db",
    },
    "staff.manage": {
        label: "Manage staff",
        description: "Lets this user invite staff, change roles, deactivate accounts and edit role templates.",
        category: "Settings", enforcement: "db",
    },
    "manage_users": {
        label: "Create & assign user accounts",
        description: "Lets this user create new staff accounts and assign role templates. They can only assign templates whose permissions are a subset of their own — never more access than they have themselves.",
        category: "Settings", enforcement: "ui",
    },
    "settings.write": {
        label: "Edit restaurant settings",
        description: "Lets this user change the restaurant's profile, tax setup, branding, notifications and branches.",
        category: "Settings", enforcement: "db",
    },
    "reports.view": {
        label: "View reports",
        description: "Lets this user see the sales, payments and KPI reports.",
        category: "Reports", enforcement: "ui",
    },
    "reports.export": {
        label: "Export reports",
        description: "Lets this user download report data as Excel, CSV or PDF.",
        category: "Reports", enforcement: "ui",
    },
    "ca_export.run": {
        label: "Run the CA export",
        description: "Lets this user generate the monthly tax-filing bundle for the accountant.",
        category: "Reports", enforcement: "ui",
    },
    "audit_log.view": {
        label: "View the audit log",
        description: "Lets this user see who changed what — bill edits, voids, payments and other sensitive actions.",
        category: "Reports", enforcement: "ui",
    },
    "purchase.write": {
        label: "Record purchases",
        description: "Lets this user record incoming stock, vendor invoices and input-tax-credit eligibility.",
        category: "Finance", enforcement: "db",
    },
    "expense.write": {
        label: "Log expenses",
        description: "Lets this user log operating expenses (rent, salary, utilities) for the books.",
        category: "Finance", enforcement: "db",
    },
    "balance_sheet.write": {
        label: "Edit the balance sheet",
        description: "Lets this user enter or edit balance-sheet entries used by the CA export.",
        category: "Finance", enforcement: "db",
    },
}

export type PermissionCategory =
    | "Sales" | "Catalog" | "Operations" | "Reports" | "Finance" | "Settings"

/** Display order of permission categories in the editor. */
export const PERMISSION_CATEGORIES: PermissionCategory[] = [
    "Sales", "Catalog", "Operations", "Reports", "Finance", "Settings",
]

/** Stable list of all permission keys, in display order. */
export const ALL_PERMISSIONS: Permission[] = Object.keys(PERMISSION_META) as Permission[]

/** Pure role check — kept for everywhere existing code already calls `can`.
 *  Most call sites should prefer canWithTemplate() which honours the
 *  user's assigned role template; this raw form is for code paths that
 *  only have a role in hand (typically server-side gates). */
export function can(role: UserRole | null | undefined, permission: Permission): boolean {
    if (!role) return false
    return (PERMISSIONS[permission] as readonly UserRole[]).includes(role)
}

/** Template-aware check. The template's `permissions` array is an
 *  ABSOLUTE whitelist: the user can do exactly what the template lists,
 *  no more and no less. When no template is assigned (legacy users
 *  pre-migration 47) we fall back to the role default so the app
 *  doesn't lock them out. */
export function canWithTemplate(
    role: UserRole | null | undefined,
    permission: Permission,
    template: readonly string[] | null | undefined,
): boolean {
    if (template && template.length > 0) {
        return template.includes(permission)
    }
    return can(role, permission)
}

/** Returns the permissions present in `target` that are NOT in `caller`.
 *  Used to enforce the subset rule when a non-owner with `manage_users`
 *  tries to assign a template to a new account. Empty array → the
 *  caller can safely assign the template. */
export function templateMissingPermissions(
    callerPerms: readonly string[],
    targetPerms: readonly string[],
): Permission[] {
    const callerSet = new Set(callerPerms)
    const missing: Permission[] = []
    for (const p of targetPerms) {
        if (!callerSet.has(p) && p in PERMISSION_META) {
            missing.push(p as Permission)
        }
    }
    return missing
}

/** Display labels for each role. "Admin" is shown for OWNER everywhere
 *  in the UI because restaurant owners think of themselves as the
 *  admin of the POS, not the "owner" of an abstract tenant — the
 *  database enum stays `OWNER` (load-bearing in RLS + RPCs) but every
 *  surface the user reads says Admin. */
export const ROLE_LABELS: Record<UserRole, string> = {
    OWNER: "Admin",
    MANAGER: "Manager",
    CASHIER: "Cashier",
    CAPTAIN: "Captain / Waiter",
    KITCHEN: "Kitchen Staff",
    DELIVERY: "Delivery",
    AUDITOR: "Auditor",
}
