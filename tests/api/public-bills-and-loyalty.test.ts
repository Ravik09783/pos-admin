import { beforeEach, describe, expect, it } from "vitest"

import { mockSupabase, resetMocks } from "../helpers/route-test"
import type { MockSupabase } from "../helpers/supabase-mock"

let db: MockSupabase

beforeEach(() => {
    resetMocks()
    db = mockSupabase()
})

// =============================================================================
// /api/public/bills/[slug]/[invoice]
// =============================================================================
describe("GET /api/public/bills/[slug]/[invoice]", () => {
    async function callGet(slug: string, invoice: string) {
        const { GET } = await import("@/app/api/public/bills/[slug]/[invoice]/route")
        return GET(new Request(`http://localhost/api/public/bills/${slug}/${invoice}`), {
            params: Promise.resolve({ slug, invoice }),
        })
    }

    it("returns 404 when tenant slug is unknown", async () => {
        const r = await callGet("ghost", "INV-2026-00001")
        expect(r.status).toBe(404)
    })

    it("returns 404 when invoice doesn't exist in the tenant", async () => {
        db.seed("tenants", [{ id: "t1", slug: "spot", name: "Spot" }])
        const r = await callGet("spot", "INV-DOES-NOT-EXIST")
        expect(r.status).toBe(404)
    })

    it("returns the bill + items when found", async () => {
        db.seed("tenants", [{
            id: "t1", slug: "spot", name: "Spot",
            gstin: "29ABCDE1234F1Z5", fssai: null, address_line1: null,
            city: null, pincode: null, phone: null,
        }])
        db.seed("bills", [{
            id: "bill-1", tenant_id: "t1", order_id: "order-1",
            invoice_number: "INV-2026-00001", grand_total: 210, bill_status: "PAID",
        }])
        db.seed("order_items", [
            { id: "li1", order_id: "order-1", item_name: "Samosa", hsn_code: "21069099", quantity: 2, unit_price: 50, gst_slab: 5, line_total: 105, is_void: false },
            { id: "li2", order_id: "order-1", item_name: "Chai", hsn_code: null, quantity: 1, unit_price: 100, gst_slab: 5, line_total: 105, is_void: false },
        ])
        const r = await callGet("spot", "INV-2026-00001")
        expect(r.status).toBe(200)
        const body = await r.json()
        expect(body.tenant.name).toBe("Spot")
        expect(body.bill.invoice_number).toBe("INV-2026-00001")
        expect(body.items).toHaveLength(2)
    })

    it("scopes invoice to tenant — same invoice number in another tenant is invisible", async () => {
        db.seed("tenants", [
            { id: "t1", slug: "spot", name: "Spot" },
            { id: "t2", slug: "other", name: "Other" },
        ])
        db.seed("bills", [{
            id: "bill-1", tenant_id: "t2", order_id: "order-1",
            invoice_number: "INV-2026-00001", grand_total: 210, bill_status: "PAID",
        }])
        const r = await callGet("spot", "INV-2026-00001")
        expect(r.status).toBe(404)
    })
})

// =============================================================================
// /api/public/loyalty/[slug]?phone=...
// =============================================================================
describe("GET /api/public/loyalty/[slug]", () => {
    async function callGet(slug: string, phone?: string) {
        const { GET } = await import("@/app/api/public/loyalty/[slug]/route")
        const url = phone
            ? `http://localhost/api/public/loyalty/${slug}?phone=${phone}`
            : `http://localhost/api/public/loyalty/${slug}`
        return GET(new Request(url), { params: Promise.resolve({ slug }) })
    }

    it("returns 400 without ?phone= param", async () => {
        const r = await callGet("spot")
        expect(r.status).toBe(400)
    })

    it("returns 404 for unknown tenant", async () => {
        const r = await callGet("ghost", "9999999999")
        expect(r.status).toBe(404)
    })

    it("returns loyalty_enabled=false when tenant has loyalty disabled", async () => {
        db.seed("tenants", [{
            id: "t1", slug: "spot", name: "Spot",
            loyalty_enabled: false, loyalty_earn_per_100: 0, loyalty_redeem_value: 0,
        }])
        const r = await callGet("spot", "9999999999")
        expect(r.status).toBe(200)
        const body = await r.json()
        expect(body.loyalty_enabled).toBe(false)
    })

    it("returns customer=null when phone isn't registered yet", async () => {
        db.seed("tenants", [{
            id: "t1", slug: "spot", name: "Spot",
            loyalty_enabled: true, loyalty_earn_per_100: 1, loyalty_redeem_value: 1,
        }])
        const r = await callGet("spot", "9999999999")
        const body = await r.json()
        expect(body.customer).toBeNull()
        expect(body.transactions).toEqual([])
    })

    it("returns customer + transactions when phone is registered", async () => {
        db.seed("tenants", [{
            id: "t1", slug: "spot", name: "Spot",
            loyalty_enabled: true, loyalty_earn_per_100: 1, loyalty_redeem_value: 1,
        }])
        db.seed("customers", [{
            id: "cust-1", tenant_id: "t1", phone: "9999999999",
            name: "Asha", loyalty_points: 250, total_visits: 5, total_spent: 1200,
            deleted_at: null,
        }])
        db.seed("loyalty_transactions", [
            { tenant_id: "t1", customer_id: "cust-1", type: "EARN", points: 10, notes: null, created_at: "2026-01-01T00:00:00Z" },
            { tenant_id: "t1", customer_id: "cust-1", type: "REDEEM", points: -50, notes: null, created_at: "2026-02-01T00:00:00Z" },
        ])
        const r = await callGet("spot", "9999999999")
        const body = await r.json()
        expect(body.customer.name).toBe("Asha")
        expect(body.customer.loyalty_points).toBe(250)
        expect(body.transactions).toHaveLength(2)
        // Sorted descending by created_at
        expect(body.transactions[0].type).toBe("REDEEM")
    })
})
