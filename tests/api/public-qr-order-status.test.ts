import { beforeEach, describe, expect, it } from "vitest"

import { mockSupabase, resetMocks } from "../helpers/route-test"
import type { MockSupabase } from "../helpers/supabase-mock"

let db: MockSupabase

beforeEach(() => {
    resetMocks()
    db = mockSupabase()
})

async function callGet(id: string) {
    const { GET } = await import("@/app/api/public/qr/order-status/[id]/route")
    return GET(new Request(`http://localhost/api/public/qr/order-status/${id}`), { params: Promise.resolve({ id }) })
}

function seedOrder(overrides: Record<string, unknown> = {}) {
    db.seed("orders", [{
        id: "order-id-100",
        tenant_id: "t1",
        order_number: "QR-1234567",
        status: "ON_HOLD",
        source: "QR",
        payment_gateway: "manual",
        awaiting_confirmation: true,
        confirmed_at: null,
        rejected_reason: null,
        subtotal: 200,
        taxable_amount: 200,
        cgst_amount: 0,
        sgst_amount: 0,
        grand_total: 210,
        table_id: null,
        customer_id: null,
        notes: null,
        created_at: new Date().toISOString(),
        paid_at: null,
        ...overrides,
    }])
    db.seed("tenants", [{ id: "t1", name: "T", slug: "t", upi_id: "t@upi", upi_payee_name: null, payment_gateway: "manual" }])
}

describe("GET /api/public/qr/order-status/[id]", () => {
    it("returns 400 for an obviously bogus short id", async () => {
        const r = await callGet("x")
        expect(r.status).toBe(400)
    })

    it("returns 404 when no order matches the id", async () => {
        const r = await callGet("not-a-real-uuid-xx")
        expect(r.status).toBe(404)
    })

    it("refuses to leak non-QR orders even if the UUID matches", async () => {
        // Defense in depth — POS-source order should not be readable by the public endpoint
        seedOrder({ source: "POS" })
        const r = await callGet("order-id-100")
        expect(r.status).toBe(404)
    })

    it("returns stage=pay_manual for manual order with no proof yet", async () => {
        seedOrder({ payment_gateway: "manual", status: "ON_HOLD", awaiting_confirmation: true })
        const r = await callGet("order-id-100")
        expect(r.status).toBe(200)
        const body = await r.json()
        expect(body.stage).toBe("pay_manual")
    })

    it("returns stage=awaiting_confirmation once a proof is uploaded", async () => {
        seedOrder({ payment_gateway: "manual" })
        db.seed("qr_payment_proofs", [{
            order_id: "order-id-100", status: "PENDING",
            screenshot_url: "https://example/proof.jpg", created_at: new Date().toISOString(),
        }])
        const r = await callGet("order-id-100")
        const body = await r.json()
        expect(body.stage).toBe("awaiting_confirmation")
        expect(body.proof.status).toBe("PENDING")
    })

    it("returns stage=awaiting_confirmation for razorpay even before webhook", async () => {
        // Razorpay path: customer paid client-side, no proof row but webhook pending
        seedOrder({ payment_gateway: "razorpay", awaiting_confirmation: true })
        const r = await callGet("order-id-100")
        const body = await r.json()
        expect(body.stage).toBe("awaiting_confirmation")
    })

    it("returns stage=confirmed when order status is PAID", async () => {
        seedOrder({ status: "PAID", awaiting_confirmation: false, paid_at: new Date().toISOString() })
        const r = await callGet("order-id-100")
        const body = await r.json()
        expect(body.stage).toBe("confirmed")
    })

    it("returns stage=rejected when order status is VOID with reason", async () => {
        seedOrder({ status: "VOID", awaiting_confirmation: false, rejected_reason: "Payment didn't match" })
        const r = await callGet("order-id-100")
        const body = await r.json()
        expect(body.stage).toBe("rejected")
        expect(body.order.rejected_reason).toBe("Payment didn't match")
    })

    it("includes order items in the response", async () => {
        seedOrder()
        db.seed("order_items", [
            { id: "li1", order_id: "order-id-100", item_name: "Samosa", quantity: 2, unit_price: 50, gst_slab: 5, taxable_amount: 100, line_total: 100, is_void: false, created_at: new Date().toISOString() },
            { id: "li2", order_id: "order-id-100", item_name: "Voided", quantity: 1, unit_price: 100, gst_slab: 5, taxable_amount: 100, line_total: 100, is_void: true, created_at: new Date().toISOString() },
        ])
        const r = await callGet("order-id-100")
        const body = await r.json()
        // Voided lines filtered out
        expect(body.items).toHaveLength(1)
        expect(body.items[0].item_name).toBe("Samosa")
        expect(body.items[0].quantity).toBe(2)
    })

    it("includes linked customer info when customer_id is set", async () => {
        seedOrder({ customer_id: "cust-1" })
        db.seed("customers", [{ id: "cust-1", name: "Asha", phone: "999" }])
        const r = await callGet("order-id-100")
        const body = await r.json()
        expect(body.customer.name).toBe("Asha")
        expect(body.customer.phone).toBe("999")
    })

    it("returns null customer when no customer_id linked", async () => {
        seedOrder()
        const r = await callGet("order-id-100")
        const body = await r.json()
        expect(body.customer).toBeNull()
    })

    it("includes tenant info for UPI re-display on reload", async () => {
        seedOrder()
        const r = await callGet("order-id-100")
        const body = await r.json()
        expect(body.tenant.name).toBe("T")
        expect(body.tenant.upi_id).toBe("t@upi")
    })
})
