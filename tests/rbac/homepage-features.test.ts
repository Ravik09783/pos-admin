import { describe, expect, it } from "vitest"

import { can, type Permission } from "@/lib/rbac/permissions"
import type { UserRole } from "@/types/database"

/**
 * Maps every feature advertised on the public homepage / landing page to the
 * smallest set of permissions that role must possess to "use" that feature.
 *
 * When the user lands on /signup as OWNER, they should be able to exercise
 * every homepage feature. Their staff (MANAGER, CASHIER, CAPTAIN, KITCHEN,
 * AUDITOR) get a curated subset — the matrix below makes those subsets
 * explicit so an accidental tightening of PERMISSIONS surfaces as a test
 * failure rather than a CS ticket.
 */

interface FeatureCheck {
    feature: string
    perm: Permission
    /** Roles that the homepage promises can use this feature. */
    rolesThatCanUseIt: UserRole[]
}

const FEATURES: FeatureCheck[] = [
    // POS billing — owner/manager/cashier "ring up an order"
    { feature: "POS — take orders", perm: "order.create", rolesThatCanUseIt: ["OWNER", "MANAGER", "CASHIER", "CAPTAIN"] },
    { feature: "POS — generate bills", perm: "bill.generate", rolesThatCanUseIt: ["OWNER", "MANAGER", "CASHIER"] },
    { feature: "POS — record payments", perm: "payment.record", rolesThatCanUseIt: ["OWNER", "MANAGER", "CASHIER"] },
    { feature: "POS — apply discount", perm: "order.discount", rolesThatCanUseIt: ["OWNER", "MANAGER", "CASHIER"] },

    // Bill security — only OWNER can edit a locked bill or void it
    { feature: "Bill lock security — edit locked bill", perm: "bill.edit_locked", rolesThatCanUseIt: ["OWNER"] },
    { feature: "Bill lock security — void bill", perm: "bill.void", rolesThatCanUseIt: ["OWNER"] },

    // Menu / catalog management
    { feature: "Menu — manage items", perm: "menu.write", rolesThatCanUseIt: ["OWNER", "MANAGER"] },
    { feature: "Menu — read (POS browse)", perm: "menu.read", rolesThatCanUseIt: ["OWNER", "MANAGER", "CASHIER", "CAPTAIN", "KITCHEN", "AUDITOR"] },
    { feature: "Menu — mark item sold out / available", perm: "menu.toggle_availability", rolesThatCanUseIt: ["OWNER", "MANAGER", "CASHIER", "CAPTAIN", "KITCHEN"] },

    // Tables (floor plan)
    { feature: "Tables — floor plan write", perm: "table.write", rolesThatCanUseIt: ["OWNER", "MANAGER"] },

    // Reports + analytics + AI insights
    { feature: "Reports — view dashboard", perm: "reports.view", rolesThatCanUseIt: ["OWNER", "MANAGER", "AUDITOR"] },
    { feature: "Reports — export", perm: "reports.export", rolesThatCanUseIt: ["OWNER", "MANAGER"] },

    // CA Export — owner-only differentiator
    { feature: "CA Export bundle", perm: "ca_export.run", rolesThatCanUseIt: ["OWNER"] },

    // Audit log (compliance / drama detection)
    { feature: "Audit log viewer", perm: "audit_log.view", rolesThatCanUseIt: ["OWNER", "MANAGER", "AUDITOR"] },

    // Staff & settings (owner-only admin)
    { feature: "Staff management — invites", perm: "staff.manage", rolesThatCanUseIt: ["OWNER"] },
    { feature: "Tenant settings — write", perm: "settings.write", rolesThatCanUseIt: ["OWNER"] },

    // Accounting / vendor / expenses
    { feature: "Purchases — record", perm: "purchase.write", rolesThatCanUseIt: ["OWNER", "MANAGER"] },
    { feature: "Expenses — record", perm: "expense.write", rolesThatCanUseIt: ["OWNER", "MANAGER"] },
    { feature: "Balance sheet — write", perm: "balance_sheet.write", rolesThatCanUseIt: ["OWNER"] },
]

const ALL_ROLES: UserRole[] = ["OWNER", "MANAGER", "CASHIER", "CAPTAIN", "KITCHEN", "DELIVERY", "AUDITOR"]

describe("Homepage features → RBAC coverage", () => {
    for (const { feature, perm, rolesThatCanUseIt } of FEATURES) {
        describe(feature, () => {
            for (const role of rolesThatCanUseIt) {
                it(`${role} CAN use it (${perm})`, () => {
                    expect(can(role, perm)).toBe(true)
                })
            }
            for (const role of ALL_ROLES.filter((r) => !rolesThatCanUseIt.includes(r))) {
                it(`${role} CANNOT use it (${perm})`, () => {
                    expect(can(role, perm)).toBe(false)
                })
            }
        })
    }
})

describe("OWNER can use every homepage feature", () => {
    it("has permission for every feature listed on the landing page", () => {
        for (const { feature, perm } of FEATURES) {
            expect(can("OWNER", perm), `OWNER missing perm for: ${feature}`).toBe(true)
        }
    })
})

describe("Each employee role has a meaningful subset of capabilities", () => {
    it("MANAGER can do everything except staff/settings/CA-export/bill-void/balance-sheet", () => {
        const restricted: Permission[] = ["staff.manage", "settings.write", "ca_export.run", "bill.void", "bill.edit_locked", "balance_sheet.write"]
        for (const p of restricted) expect(can("MANAGER", p)).toBe(false)
        // But every operational permission works
        for (const p of ["order.create", "bill.generate", "payment.record", "menu.write", "reports.view"] as Permission[]) {
            expect(can("MANAGER", p)).toBe(true)
        }
    })

    it("CASHIER is a billing/payments role only", () => {
        // Yes
        for (const p of ["order.create", "bill.generate", "payment.record", "order.discount", "menu.read"] as Permission[]) {
            expect(can("CASHIER", p)).toBe(true)
        }
        // No
        for (const p of ["menu.write", "staff.manage", "settings.write", "bill.void", "reports.view"] as Permission[]) {
            expect(can("CASHIER", p)).toBe(false)
        }
    })

    it("CAPTAIN takes orders but cannot bill or discount", () => {
        expect(can("CAPTAIN", "order.create")).toBe(true)
        expect(can("CAPTAIN", "order.modify_open")).toBe(true)
        expect(can("CAPTAIN", "bill.generate")).toBe(false)
        expect(can("CAPTAIN", "order.discount")).toBe(false)
    })

    it("KITCHEN can read the menu + 86 a dish, but not edit items or bill", () => {
        expect(can("KITCHEN", "menu.read")).toBe(true)
        expect(can("KITCHEN", "menu.toggle_availability")).toBe(true)   // can mark sold out
        for (const p of ["menu.write", "order.create", "bill.generate", "payment.record"] as Permission[]) {
            expect(can("KITCHEN", p)).toBe(false)
        }
    })

    it("AUDITOR can review but never write", () => {
        expect(can("AUDITOR", "reports.view")).toBe(true)
        expect(can("AUDITOR", "audit_log.view")).toBe(true)
        expect(can("AUDITOR", "menu.read")).toBe(true)
        for (const p of ["menu.write", "order.create", "bill.generate", "settings.write", "reports.export"] as Permission[]) {
            expect(can("AUDITOR", p)).toBe(false)
        }
    })

    it("DELIVERY is intentionally minimal — no panel writes at all", () => {
        // Delivery role exists for future driver-app work; should hold zero
        // PERMISSIONS keys for now so we don't accidentally grant it admin.
        const perms: Permission[] = [
            "menu.write", "menu.toggle_availability", "order.create", "order.modify_open", "order.discount",
            "bill.generate", "bill.edit_locked", "bill.void", "payment.record",
            "table.write", "staff.manage", "settings.write", "reports.view",
            "reports.export", "ca_export.run", "audit_log.view",
            "purchase.write", "expense.write", "balance_sheet.write",
        ]
        for (const p of perms) {
            expect(can("DELIVERY", p), `DELIVERY should not have ${p}`).toBe(false)
        }
    })
})
