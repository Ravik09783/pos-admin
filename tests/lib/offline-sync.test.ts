import { beforeEach, describe, expect, it, vi } from "vitest"

import { enqueue, listPending } from "@/lib/offline/pending-bills"
import { syncPendingBills } from "@/lib/offline/sync"

const TENANT = "tenant-uuid"

function makePayload(idx: number) {
    return {
        client_request_id: `req-${idx}`,
        created_at: new Date().toISOString(),
        reserved_invoice: `INV-2025-26-${String(idx).padStart(5, "0")}`,
        order_number: `POS-${idx}`,
        order_type: "DINE_IN" as const,
        table_no: null,
        customer_id: null,
        items: [
            {
                menu_item_id: "item-uuid",
                item_name: "Pizza",
                hsn_code: "996331",
                gst_slab: 5,
                quantity: 1,
                unit_price: 320,
                taxable_amount: 320,
                notes: null,
            },
        ],
        service_charge: 0,
        order_discount: 0,
        round_off: 0,
        no_gst: false,
        tax_model: "split" as const,
        coupon_id: null,
        coupon_discount: 0,
        snapshot: { grand_total: 336, subtotal: 320, items_count: 1 },
    }
}

/** A tiny supabase-shape mock that handles only the chains sync.ts uses. */
function makeSupabase(opts: {
    billExists?: boolean
    orderExists?: boolean
    generateBillResult?: { data: { bill_id: string } | null; error: { message: string; code?: string } | null }
}) {
    const rpc = vi.fn().mockImplementation((fn: string) => {
        if (fn === "generate_bill") {
            return Promise.resolve(opts.generateBillResult ?? { data: { bill_id: "bill-uuid-1" }, error: null })
        }
        return Promise.resolve({ data: null, error: null })
    })

    const ordersInsert = vi.fn().mockReturnValue({
        select: () => ({ single: () => Promise.resolve({ data: { id: "order-uuid-1" }, error: null }) }),
    })
    const itemsInsert = vi.fn().mockReturnValue({
        select: () => ({ single: () => Promise.resolve({ data: { id: "items-batch" }, error: null }) }),
    })

    function selectChain(table: string) {
        return {
            eq() { return this },
            eq2() { return this },
            // .eq().eq().maybeSingle() — what sync.ts uses for both probes
            // The chain is: .select().eq().eq().maybeSingle()
            maybeSingle() {
                if (table === "bills") return Promise.resolve({ data: opts.billExists ? { id: "bill-uuid-1" } : null, error: null })
                if (table === "orders") return Promise.resolve({ data: opts.orderExists ? { id: "order-uuid-1" } : null, error: null })
                return Promise.resolve({ data: null, error: null })
            },
        }
    }

    function from(table: string) {
        const sel = (() => {
            const obj: Record<string, unknown> = {
                eq: () => obj,
                maybeSingle: () => {
                    if (table === "bills") return Promise.resolve({ data: opts.billExists ? { id: "bill-uuid-1" } : null, error: null })
                    if (table === "orders") return Promise.resolve({ data: opts.orderExists ? { id: "order-uuid-1" } : null, error: null })
                    return Promise.resolve({ data: null, error: null })
                },
            }
            return obj
        })()

        return {
            select: () => sel,
            insert: table === "orders" ? ordersInsert : itemsInsert,
        }
    }
    void selectChain  // (unused — kept for readability)

    return {
        from,
        rpc,
        auth: { getUser: () => Promise.resolve({ data: { user: { id: "user-uuid-1" } } }) },
        // exposed for assertions
        _mocks: { rpc, ordersInsert, itemsInsert },
    }
}

beforeEach(() => {
    window.localStorage.clear()
})

describe("syncPendingBills", () => {
    it("fast-path: bill already exists for this client_request_id → mark synced, skip everything else", async () => {
        enqueue(TENANT, makePayload(1))
        const sb = makeSupabase({ billExists: true })
        const r = await syncPendingBills(sb as never, TENANT)
        expect(r.succeeded).toBe(1)
        expect(r.failed).toBe(0)
        // No order / items insert + no RPC — pure dedup short-circuit.
        expect(sb._mocks.ordersInsert).not.toHaveBeenCalled()
        expect(sb._mocks.itemsInsert).not.toHaveBeenCalled()
        expect(sb._mocks.rpc).not.toHaveBeenCalled()
        // Row was marked synced.
        const row = listPending(TENANT)[0]
        expect(row.synced_at).toBeTruthy()
        expect(row.bill_id).toBe("bill-uuid-1")
    })

    it("happy path: order doesn't exist, items insert, generate_bill returns a bill_id", async () => {
        enqueue(TENANT, makePayload(2))
        const sb = makeSupabase({ billExists: false, orderExists: false })
        const r = await syncPendingBills(sb as never, TENANT)
        expect(r.succeeded).toBe(1)
        expect(sb._mocks.ordersInsert).toHaveBeenCalledTimes(1)
        expect(sb._mocks.itemsInsert).toHaveBeenCalledTimes(1)
        expect(sb._mocks.rpc).toHaveBeenCalledWith("generate_bill", expect.objectContaining({
            p_reserved_invoice: "INV-2025-26-00002",
            p_client_request_id: "req-2",
        }))
    })

    it("retry: order already exists (prior attempt got that far) — reuse it instead of duplicating", async () => {
        enqueue(TENANT, makePayload(3))
        const sb = makeSupabase({ billExists: false, orderExists: true })
        const r = await syncPendingBills(sb as never, TENANT)
        expect(r.succeeded).toBe(1)
        expect(sb._mocks.ordersInsert).not.toHaveBeenCalled()   // reused
    })

    it("generate_bill error → marks failed, doesn't touch others", async () => {
        enqueue(TENANT, makePayload(4))
        enqueue(TENANT, makePayload(5))
        const sb = makeSupabase({
            billExists: false,
            orderExists: false,
            generateBillResult: { data: null, error: { message: "RLS denied" } },
        })
        const r = await syncPendingBills(sb as never, TENANT)
        expect(r.succeeded).toBe(0)
        expect(r.failed).toBe(2)
        expect(r.errors[0].error).toBe("RLS denied")
        // Both rows should still be in the queue, unsynced.
        const rows = listPending(TENANT)
        expect(rows.every((p) => !p.synced_at)).toBe(true)
        expect(rows.every((p) => p.attempts === 1)).toBe(true)
    })
})
