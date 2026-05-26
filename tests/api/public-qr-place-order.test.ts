import { beforeEach, describe, expect, it, vi } from "vitest"

import { mockSupabase, resetMocks } from "../helpers/route-test"
import type { MockSupabase } from "../helpers/supabase-mock"

let db: MockSupabase
beforeEach(() => {
    resetMocks()
    db = mockSupabase()
    // Fresh in-memory rate-limit buckets per test
    vi.resetModules()
})

function buildReq(body: Record<string, unknown>, ip = "1.2.3.4") {
    return new Request("http://localhost/api/public/qr/place-order", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify(body),
    })
}

async function callPost(body: Record<string, unknown>, ip?: string) {
    const { POST } = await import("@/app/api/public/qr/place-order/route")
    return POST(buildReq(body, ip))
}

function seedManualTenant(opts: Partial<Record<string, unknown>> = {}) {
    db.seed("tenants", [{
        id: "t1", slug: "open-spot", name: "Open Spot",
        qr_ordering_enabled: true, payment_gateway: "manual",
        upi_id: "spot@upi", upi_payee_name: "Open Spot Restaurant",
        service_charge_percent: 0,
        ...opts,
    }])
}

function seedItem(opts: Partial<Record<string, unknown>> = {}) {
    db.seed("menu_items", [{
        id: "item-1", tenant_id: "t1", name: "Paneer Tikka",
        base_price: 250, gst_slab: 5, hsn_code: "21069099",
        is_active: true, is_sold_out: false, is_tax_inclusive: false,
        deleted_at: null,
        ...opts,
    }])
}

describe("POST /api/public/qr/place-order — input validation", () => {
    it("returns 400 if tenant_slug or items missing", async () => {
        const r = await callPost({})
        expect(r.status).toBe(400)
    })

    it("returns 400 if cart has > 50 items", async () => {
        seedManualTenant()
        const items = Array.from({ length: 51 }, () => ({ menu_item_id: "x", quantity: 1 }))
        const r = await callPost({ tenant_slug: "open-spot", table_number: "5", items })
        expect(r.status).toBe(400)
    })

    it("returns 400 if any line quantity is < 1 or > 99", async () => {
        seedManualTenant()
        const r = await callPost({
            tenant_slug: "open-spot", table_number: "5",
            items: [{ menu_item_id: "x", quantity: 100 }],
        })
        expect(r.status).toBe(400)
    })
})

describe("POST /api/public/qr/place-order — tenant + ordering gate", () => {
    it("returns 404 when tenant slug is unknown", async () => {
        const r = await callPost({
            tenant_slug: "nope", table_number: "1",
            items: [{ menu_item_id: "x", quantity: 1 }],
        })
        expect(r.status).toBe(404)
    })

    it("returns 403 when qr_ordering_enabled is false", async () => {
        db.seed("tenants", [{
            id: "t1", slug: "closed", name: "X",
            qr_ordering_enabled: false, payment_gateway: "manual",
            upi_id: "x@upi", upi_payee_name: null,
        }])
        const r = await callPost({
            tenant_slug: "closed", table_number: "1",
            items: [{ menu_item_id: "x", quantity: 1 }],
        })
        expect(r.status).toBe(403)
    })

    it("returns 400 when manual gateway but no UPI configured", async () => {
        seedManualTenant({ upi_id: null })
        seedItem()
        const r = await callPost({
            tenant_slug: "open-spot", table_number: "5",
            items: [{ menu_item_id: "item-1", quantity: 1 }],
        })
        expect(r.status).toBe(400)
    })
})

describe("POST /api/public/qr/place-order — item validation", () => {
    it("returns 409 sold_out when any item is sold out", async () => {
        seedManualTenant()
        seedItem({ is_sold_out: true })
        const r = await callPost({
            tenant_slug: "open-spot", table_number: "5",
            items: [{ menu_item_id: "item-1", quantity: 1 }],
        })
        expect(r.status).toBe(409)
        const body = await r.json()
        expect(body.error).toBe("sold_out")
        expect(body.sold_out_items).toContain("Paneer Tikka")
    })

    it("returns 409 missing_items when item id isn't in menu", async () => {
        seedManualTenant()
        seedItem()
        const r = await callPost({
            tenant_slug: "open-spot", table_number: "5",
            items: [{ menu_item_id: "ghost-item", quantity: 1 }],
        })
        expect(r.status).toBe(409)
        const body = await r.json()
        expect(body.error).toBe("missing_items")
    })

    it("returns 409 missing_items when item is_active=false", async () => {
        seedManualTenant()
        seedItem({ is_active: false })
        const r = await callPost({
            tenant_slug: "open-spot", table_number: "5",
            items: [{ menu_item_id: "item-1", quantity: 1 }],
        })
        expect(r.status).toBe(409)
    })
})

describe("POST /api/public/qr/place-order — stale price guard", () => {
    it("voids the order and returns 409 price_changed when expected_total drifts > tolerance", async () => {
        seedManualTenant()
        seedItem({ base_price: 250, gst_slab: 5 }) // 250 + 5% GST = 262.50

        const r = await callPost({
            tenant_slug: "open-spot", table_number: "5",
            expected_total: 100,    // way off
            items: [{ menu_item_id: "item-1", quantity: 1 }],
        })
        expect(r.status).toBe(409)
        const body = await r.json()
        expect(body.error).toBe("price_changed")

        // The placed order should be marked VOID
        const orders = db.tables["orders"]
        expect(orders?.length).toBe(1)
        expect(orders?.[0]?.status).toBe("VOID")
    })

    it("accepts expected_total within tolerance (0.5% or ₹2)", async () => {
        seedManualTenant()
        seedItem({ base_price: 250, gst_slab: 5 }) // computed = 262.50

        const r = await callPost({
            tenant_slug: "open-spot", table_number: "5",
            expected_total: 262.50,
            items: [{ menu_item_id: "item-1", quantity: 1 }],
        })
        expect(r.status).toBe(200)
    })
})

describe("POST /api/public/qr/place-order — manual UPI happy path", () => {
    it("creates order + order_items, persists totals, returns manual payload", async () => {
        seedManualTenant()
        seedItem({ base_price: 200, gst_slab: 5 }) // total = 210
        db.seed("dining_tables", [{ id: "table-uuid", tenant_id: "t1", number: "5" }])

        const r = await callPost({
            tenant_slug: "open-spot", table_number: "5",
            customer_name: "Asha", customer_phone: "9999988888",
            items: [{ menu_item_id: "item-1", quantity: 1 }],
        })
        expect(r.status).toBe(200)
        const body = await r.json()
        expect(body.gateway).toBe("manual")
        expect(body.amount).toBeCloseTo(210, 2)
        expect(body.manual.upi_id).toBe("spot@upi")
        expect(body.order_number).toMatch(/^QR-/)

        // Order row written + linked to table + customer
        const orders = db.tables["orders"]
        expect(orders?.length).toBe(1)
        expect(orders?.[0]?.source).toBe("QR")
        expect(orders?.[0]?.status).toBe("ON_HOLD")
        expect(orders?.[0]?.awaiting_confirmation).toBe(true)
        expect(orders?.[0]?.table_id).toBe("table-uuid")
        expect(orders?.[0]?.grand_total).toBeCloseTo(210, 2)

        // Order items written
        const items = db.tables["order_items"]
        expect(items?.length).toBe(1)
        expect(items?.[0]?.item_name).toBe("Paneer Tikka")
        expect(items?.[0]?.quantity).toBe(1)

        // Table flipped to OCCUPIED
        const tables = db.tables["dining_tables"]
        expect(tables?.[0]?.status).toBe("OCCUPIED")
    })

    it("works without customer phone (no upsert into customers)", async () => {
        seedManualTenant()
        seedItem()
        const r = await callPost({
            tenant_slug: "open-spot", table_number: "5",
            items: [{ menu_item_id: "item-1", quantity: 1 }],
        })
        expect(r.status).toBe(200)
        expect((db.tables["customers"] ?? []).length).toBe(0)
    })
})

describe("POST /api/public/qr/place-order — rate limiting", () => {
    it("rejects with 429 after 20 requests in the same minute from the same IP", async () => {
        seedManualTenant()
        seedItem()
        for (let i = 0; i < 20; i++) {
            const r = await callPost({
                tenant_slug: "open-spot", table_number: String(i + 1),
                items: [{ menu_item_id: "item-1", quantity: 1 }],
            }, "5.5.5.5")
            expect(r.status).not.toBe(429)
        }
        const blocked = await callPost({
            tenant_slug: "open-spot", table_number: "21",
            items: [{ menu_item_id: "item-1", quantity: 1 }],
        }, "5.5.5.5")
        expect(blocked.status).toBe(429)
    })
})
