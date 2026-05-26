import { beforeEach, describe, expect, it } from "vitest"

import {
    enqueue, gcSynced, listPending, markFailed, markSynced, pendingCount, remove,
    type PendingBillPayload,
} from "@/lib/offline/pending-bills"

const TENANT = "tenant-uuid"

function payload(idx: number, overrides: Partial<PendingBillPayload> = {}): PendingBillPayload {
    return {
        client_request_id: `req-${idx}`,
        created_at: new Date().toISOString(),
        reserved_invoice: `INV-2025-26-${String(idx).padStart(5, "0")}`,
        order_number: `POS-${idx}`,
        order_type: "DINE_IN",
        table_no: null,
        customer_id: null,
        items: [],
        service_charge: 0,
        order_discount: 0,
        round_off: 0,
        no_gst: false,
        tax_model: "split",
        coupon_id: null,
        coupon_discount: 0,
        snapshot: { grand_total: 100, subtotal: 95, items_count: 1 },
        ...overrides,
    }
}

beforeEach(() => {
    window.localStorage.clear()
})

describe("pending-bills queue", () => {
    it("enqueue + listPending round-trip", () => {
        enqueue(TENANT, payload(1))
        enqueue(TENANT, payload(2))
        expect(listPending(TENANT)).toHaveLength(2)
        expect(pendingCount(TENANT)).toBe(2)
    })

    it("enqueue is idempotent on client_request_id", () => {
        enqueue(TENANT, payload(1))
        enqueue(TENANT, payload(1, { snapshot: { grand_total: 999, subtotal: 999, items_count: 1 } }))
        expect(listPending(TENANT)).toHaveLength(1)
        // The first one wins — second insert is dropped.
        expect(listPending(TENANT)[0].snapshot.grand_total).toBe(100)
    })

    it("markSynced moves an entry out of the pendingCount", () => {
        enqueue(TENANT, payload(1))
        enqueue(TENANT, payload(2))
        markSynced(TENANT, "req-1", "bill-uuid-1")
        expect(pendingCount(TENANT)).toBe(1)
        const synced = listPending(TENANT).find((p) => p.client_request_id === "req-1")
        expect(synced?.bill_id).toBe("bill-uuid-1")
        expect(synced?.synced_at).toBeTruthy()
    })

    it("markFailed bumps attempts + records the last error", () => {
        enqueue(TENANT, payload(1))
        markFailed(TENANT, "req-1", "timeout")
        markFailed(TENANT, "req-1", "timeout")
        const row = listPending(TENANT)[0]
        expect(row.attempts).toBe(2)
        expect(row.last_error).toBe("timeout")
        expect(row.synced_at).toBeNull()
    })

    it("remove drops the entry entirely", () => {
        enqueue(TENANT, payload(1))
        enqueue(TENANT, payload(2))
        remove(TENANT, "req-1")
        expect(listPending(TENANT)).toHaveLength(1)
    })

    it("gcSynced purges synced rows older than the max age", () => {
        enqueue(TENANT, payload(1))
        markSynced(TENANT, "req-1", "bill-uuid-1")
        // Tamper synced_at to be 2h old.
        const buf = listPending(TENANT)
        buf[0].synced_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
        window.localStorage.setItem("offline:pending-bills:" + TENANT, JSON.stringify(buf))
        gcSynced(TENANT, 60 * 60 * 1000)  // 1h max age
        expect(listPending(TENANT)).toHaveLength(0)
    })
})
