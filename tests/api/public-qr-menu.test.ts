import { beforeEach, describe, expect, it } from "vitest"

import { mockSupabase, resetMocks } from "../helpers/route-test"
import type { MockSupabase } from "../helpers/supabase-mock"

let db: MockSupabase
beforeEach(() => {
    resetMocks()
    db = mockSupabase()
})

async function callGet(slug: string) {
    const { GET } = await import("@/app/api/public/qr/menu/[slug]/route")
    return GET(new Request(`http://localhost/api/public/qr/menu/${slug}`), { params: Promise.resolve({ slug }) })
}

describe("GET /api/public/qr/menu/[slug]", () => {
    it("returns 404 when no tenant has this slug", async () => {
        const r = await callGet("unknown")
        expect(r.status).toBe(404)
    })

    it("returns 403 when qr_ordering_enabled is false", async () => {
        db.seed("tenants", [{ id: "t1", slug: "closed-spot", name: "X", qr_ordering_enabled: false }])
        const r = await callGet("closed-spot")
        expect(r.status).toBe(403)
        const body = await r.json()
        expect(body.error).toMatch(/disabled/i)
    })

    it("returns the menu when ordering is enabled", async () => {
        db.seed("tenants", [{
            id: "t1", slug: "open-spot", name: "Open Spot",
            qr_ordering_enabled: true, qr_require_payment: true,
            logo_url: null, upi_id: "spot@upi", upi_payee_name: null,
            address_line1: null, city: null, phone: null,
        }])
        db.seed("menu_categories", [
            { id: "c1", tenant_id: "t1", name: "Starters", sort_order: 1, icon: null, deleted_at: null, is_active: true },
            { id: "c2", tenant_id: "t1", name: "Mains", sort_order: 2, icon: null, deleted_at: null, is_active: true },
        ])
        db.seed("menu_items", [
            { id: "i1", tenant_id: "t1", category_id: "c1", name: "Samosa", base_price: 50, gst_slab: 5, food_type: "VEG", is_active: true, is_sold_out: false, sort_order: 1, deleted_at: null, hsn_code: "21069099", is_tax_inclusive: false, description: null, image_url: null },
            { id: "i2", tenant_id: "t1", category_id: "c2", name: "Paneer Tikka", base_price: 250, gst_slab: 5, food_type: "VEG", is_active: true, is_sold_out: false, sort_order: 1, deleted_at: null, hsn_code: null, is_tax_inclusive: false, description: null, image_url: null },
        ])
        const r = await callGet("open-spot")
        expect(r.status).toBe(200)
        const body = await r.json()
        expect(body.tenant.slug).toBe("open-spot")
        expect(body.categories).toHaveLength(2)
        expect(body.items).toHaveLength(2)
    })
})
