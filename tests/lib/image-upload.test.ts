import { describe, expect, it } from "vitest"

import { tenantImagePath } from "@/lib/storage/image-upload"

describe("tenantImagePath", () => {
    const TENANT = "0e8f1234-5678-90ab-cdef-1234567890ab"

    it("puts the tenant id at the start of the path (RLS pre-condition)", () => {
        expect(tenantImagePath(TENANT, "logo", TENANT)).toMatch(new RegExp("^" + TENANT + "/"))
        expect(tenantImagePath(TENANT, "menu-item", "i1")).toMatch(new RegExp("^" + TENANT + "/items/"))
        expect(tenantImagePath(TENANT, "menu-category", "c1")).toMatch(new RegExp("^" + TENANT + "/categories/"))
    })

    it("includes the row id for menu-item / menu-category so paths stay tidy", () => {
        expect(tenantImagePath(TENANT, "menu-item", "item-uuid-1")).toContain("/items/item-uuid-1-")
        expect(tenantImagePath(TENANT, "menu-category", "cat-uuid-1")).toContain("/categories/cat-uuid-1-")
    })

    it("appends a uniqueness suffix so re-uploads don't collide in the bucket cache", () => {
        const a = tenantImagePath(TENANT, "menu-item", "i1")
        const b = tenantImagePath(TENANT, "menu-item", "i1")
        expect(a).not.toBe(b)
    })

    it("uses .jpg by default (logos / menu items run through canvas → JPEG)", () => {
        expect(tenantImagePath(TENANT, "logo", TENANT)).toMatch(/\.jpg$/)
        expect(tenantImagePath(TENANT, "menu-item", "i1")).toMatch(/\.jpg$/)
    })
})
