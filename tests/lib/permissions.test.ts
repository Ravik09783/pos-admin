import { describe, expect, it } from "vitest"

import { can, PERMISSIONS, ROLE_LABELS, type Permission } from "@/lib/rbac/permissions"
import type { UserRole } from "@/types/database"

const ALL_ROLES: UserRole[] = ["OWNER", "MANAGER", "CASHIER", "CAPTAIN", "KITCHEN", "DELIVERY", "AUDITOR"]
const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]

describe("can() — basic semantics", () => {
    it("returns false for null/undefined role", () => {
        expect(can(null, "menu.write")).toBe(false)
        expect(can(undefined, "menu.write")).toBe(false)
    })

    it("returns true when role is in the permission's allowlist", () => {
        expect(can("OWNER", "menu.write")).toBe(true)
        expect(can("MANAGER", "menu.write")).toBe(true)
    })

    it("returns false when role is NOT in the allowlist", () => {
        expect(can("CASHIER", "menu.write")).toBe(false)
        expect(can("KITCHEN", "menu.write")).toBe(false)
    })
})

describe("can() — OWNER is always allowed for write/admin perms", () => {
    const ownerExpected: Permission[] = [
        "menu.write", "order.create", "order.modify_open", "order.discount",
        "bill.generate", "bill.edit_locked", "bill.void", "payment.record",
        "table.write", "staff.manage", "settings.write", "reports.view",
        "reports.export", "ca_export.run", "audit_log.view",
        "purchase.write", "expense.write", "balance_sheet.write",
    ]
    for (const p of ownerExpected) {
        it(`OWNER → ${p}`, () => {
            expect(can("OWNER", p)).toBe(true)
        })
    }
})

describe("can() — sensitive perms are OWNER-only", () => {
    const ownerOnly: Permission[] = ["staff.manage", "settings.write", "ca_export.run", "bill.edit_locked", "bill.void", "balance_sheet.write"]
    for (const p of ownerOnly) {
        for (const r of ALL_ROLES) {
            it(`${r} can ${p}? expect ${r === "OWNER"}`, () => {
                expect(can(r, p)).toBe(r === "OWNER")
            })
        }
    }
})

describe("can() — CASHIER permissions for the till", () => {
    it("CASHIER can take orders, generate bills, record payments", () => {
        expect(can("CASHIER", "order.create")).toBe(true)
        expect(can("CASHIER", "bill.generate")).toBe(true)
        expect(can("CASHIER", "payment.record")).toBe(true)
        expect(can("CASHIER", "order.discount")).toBe(true)
    })

    it("CASHIER cannot manage staff or edit locked bills", () => {
        expect(can("CASHIER", "staff.manage")).toBe(false)
        expect(can("CASHIER", "bill.edit_locked")).toBe(false)
        expect(can("CASHIER", "bill.void")).toBe(false)
        expect(can("CASHIER", "settings.write")).toBe(false)
    })
})

describe("can() — CAPTAIN/waiter permissions", () => {
    it("CAPTAIN can create + modify open orders but not bill", () => {
        expect(can("CAPTAIN", "order.create")).toBe(true)
        expect(can("CAPTAIN", "order.modify_open")).toBe(true)
        expect(can("CAPTAIN", "bill.generate")).toBe(false)
        expect(can("CAPTAIN", "payment.record")).toBe(false)
    })
})

describe("can() — KITCHEN is read-mostly", () => {
    it("KITCHEN can read menu but cannot create orders or bills", () => {
        expect(can("KITCHEN", "menu.read")).toBe(true)
        expect(can("KITCHEN", "order.create")).toBe(false)
        expect(can("KITCHEN", "bill.generate")).toBe(false)
    })
})

describe("can() — AUDITOR is read-only", () => {
    it("AUDITOR can view reports + audit log but cannot write anything", () => {
        expect(can("AUDITOR", "reports.view")).toBe(true)
        expect(can("AUDITOR", "audit_log.view")).toBe(true)
        expect(can("AUDITOR", "menu.write")).toBe(false)
        expect(can("AUDITOR", "order.create")).toBe(false)
        expect(can("AUDITOR", "bill.generate")).toBe(false)
        expect(can("AUDITOR", "settings.write")).toBe(false)
    })
})

describe("can() — MANAGER tier", () => {
    it("MANAGER can do everything except OWNER-locked actions", () => {
        expect(can("MANAGER", "menu.write")).toBe(true)
        expect(can("MANAGER", "table.write")).toBe(true)
        expect(can("MANAGER", "purchase.write")).toBe(true)
        expect(can("MANAGER", "reports.export")).toBe(true)
        // But NOT
        expect(can("MANAGER", "staff.manage")).toBe(false)
        expect(can("MANAGER", "settings.write")).toBe(false)
        expect(can("MANAGER", "ca_export.run")).toBe(false)
        expect(can("MANAGER", "bill.void")).toBe(false)
    })
})

describe("can() — fully exhaustive role × permission matrix", () => {
    // Snapshot every (role, permission) pair so a future careless edit
    // to the PERMISSIONS table will surface here rather than in prod.
    it("matches the documented matrix exactly", () => {
        const matrix: Record<UserRole, Record<Permission, boolean>> = {} as never
        for (const r of ALL_ROLES) {
            const row: Record<string, boolean> = {}
            for (const p of ALL_PERMISSIONS) row[p] = can(r, p)
            matrix[r] = row as Record<Permission, boolean>
        }
        expect(matrix).toMatchInlineSnapshot(`
          {
            "AUDITOR": {
              "attendance.manage": false,
              "audit_log.view": true,
              "balance_sheet.write": false,
              "bill.edit_locked": false,
              "bill.generate": false,
              "bill.void": false,
              "ca_export.run": false,
              "expense.write": false,
              "manage_users": false,
              "menu.read": true,
              "menu.toggle_availability": false,
              "menu.write": false,
              "order.create": false,
              "order.discount": false,
              "order.modify_open": false,
              "payment.record": false,
              "payroll.manage": false,
              "purchase.write": false,
              "reports.export": false,
              "reports.view": true,
              "settings.write": false,
              "staff.manage": false,
              "table.write": false,
            },
            "CAPTAIN": {
              "attendance.manage": false,
              "audit_log.view": false,
              "balance_sheet.write": false,
              "bill.edit_locked": false,
              "bill.generate": false,
              "bill.void": false,
              "ca_export.run": false,
              "expense.write": false,
              "manage_users": false,
              "menu.read": true,
              "menu.toggle_availability": true,
              "menu.write": false,
              "order.create": true,
              "order.discount": false,
              "order.modify_open": true,
              "payment.record": false,
              "payroll.manage": false,
              "purchase.write": false,
              "reports.export": false,
              "reports.view": false,
              "settings.write": false,
              "staff.manage": false,
              "table.write": false,
            },
            "CASHIER": {
              "attendance.manage": false,
              "audit_log.view": false,
              "balance_sheet.write": false,
              "bill.edit_locked": false,
              "bill.generate": true,
              "bill.void": false,
              "ca_export.run": false,
              "expense.write": false,
              "manage_users": false,
              "menu.read": true,
              "menu.toggle_availability": true,
              "menu.write": false,
              "order.create": true,
              "order.discount": true,
              "order.modify_open": true,
              "payment.record": true,
              "payroll.manage": false,
              "purchase.write": false,
              "reports.export": false,
              "reports.view": false,
              "settings.write": false,
              "staff.manage": false,
              "table.write": false,
            },
            "DELIVERY": {
              "attendance.manage": false,
              "audit_log.view": false,
              "balance_sheet.write": false,
              "bill.edit_locked": false,
              "bill.generate": false,
              "bill.void": false,
              "ca_export.run": false,
              "expense.write": false,
              "manage_users": false,
              "menu.read": false,
              "menu.toggle_availability": false,
              "menu.write": false,
              "order.create": false,
              "order.discount": false,
              "order.modify_open": false,
              "payment.record": false,
              "payroll.manage": false,
              "purchase.write": false,
              "reports.export": false,
              "reports.view": false,
              "settings.write": false,
              "staff.manage": false,
              "table.write": false,
            },
            "KITCHEN": {
              "attendance.manage": false,
              "audit_log.view": false,
              "balance_sheet.write": false,
              "bill.edit_locked": false,
              "bill.generate": false,
              "bill.void": false,
              "ca_export.run": false,
              "expense.write": false,
              "manage_users": false,
              "menu.read": true,
              "menu.toggle_availability": true,
              "menu.write": false,
              "order.create": false,
              "order.discount": false,
              "order.modify_open": false,
              "payment.record": false,
              "payroll.manage": false,
              "purchase.write": false,
              "reports.export": false,
              "reports.view": false,
              "settings.write": false,
              "staff.manage": false,
              "table.write": false,
            },
            "MANAGER": {
              "attendance.manage": true,
              "audit_log.view": true,
              "balance_sheet.write": false,
              "bill.edit_locked": false,
              "bill.generate": true,
              "bill.void": false,
              "ca_export.run": false,
              "expense.write": true,
              "manage_users": false,
              "menu.read": true,
              "menu.toggle_availability": true,
              "menu.write": true,
              "order.create": true,
              "order.discount": true,
              "order.modify_open": true,
              "payment.record": true,
              "payroll.manage": false,
              "purchase.write": true,
              "reports.export": true,
              "reports.view": true,
              "settings.write": false,
              "staff.manage": false,
              "table.write": true,
            },
            "OWNER": {
              "attendance.manage": true,
              "audit_log.view": true,
              "balance_sheet.write": true,
              "bill.edit_locked": true,
              "bill.generate": true,
              "bill.void": true,
              "ca_export.run": true,
              "expense.write": true,
              "manage_users": true,
              "menu.read": true,
              "menu.toggle_availability": true,
              "menu.write": true,
              "order.create": true,
              "order.discount": true,
              "order.modify_open": true,
              "payment.record": true,
              "payroll.manage": true,
              "purchase.write": true,
              "reports.export": true,
              "reports.view": true,
              "settings.write": true,
              "staff.manage": true,
              "table.write": true,
            },
          }
        `)
    })
})

describe("ROLE_LABELS", () => {
    it("has a human-readable label for every UserRole", () => {
        for (const r of ALL_ROLES) {
            expect(ROLE_LABELS[r]).toBeTruthy()
            expect(typeof ROLE_LABELS[r]).toBe("string")
        }
    })
})
