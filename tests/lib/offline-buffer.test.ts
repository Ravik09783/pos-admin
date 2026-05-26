import { beforeEach, describe, expect, it, vi } from "vitest"

import {
    dropReservation,
    listReservations,
    refillIfLow,
    remainingCount,
    returnReservation,
    takeReservation,
    topUp,
    type InvoiceReservation,
} from "@/lib/offline/reservation-buffer"

const TENANT = "tenant-uuid"

function rsv(seq: number, daysAhead = 7): InvoiceReservation {
    return {
        id: `r-${seq}`,
        invoice_number: `INV-2025-26-${String(seq).padStart(5, "0")}`,
        sequence_value: seq,
        fy_label: "2025-26",
        expires_at: new Date(Date.now() + daysAhead * 86_400_000).toISOString(),
    }
}

beforeEach(() => {
    window.localStorage.clear()
})

describe("reservation-buffer — local operations", () => {
    it("takes reservations in sequence order, oldest first", () => {
        // Seed three reservations out of order.
        window.localStorage.setItem(
            "offline:reservations:" + TENANT,
            JSON.stringify([rsv(3), rsv(1), rsv(2)]),
        )
        expect(takeReservation(TENANT)?.sequence_value).toBe(1)
        expect(takeReservation(TENANT)?.sequence_value).toBe(2)
        expect(takeReservation(TENANT)?.sequence_value).toBe(3)
        expect(takeReservation(TENANT)).toBeNull()
    })

    it("returnReservation puts an unused number back without duplicating", () => {
        window.localStorage.setItem("offline:reservations:" + TENANT, JSON.stringify([rsv(2)]))
        const taken = rsv(1)
        returnReservation(TENANT, taken)
        // Returning the same one twice is a no-op.
        returnReservation(TENANT, taken)
        expect(listReservations(TENANT).map((r) => r.sequence_value)).toEqual([1, 2])
    })

    it("drops expired reservations on read", () => {
        const expired = { ...rsv(1), expires_at: new Date(Date.now() - 1000).toISOString() }
        window.localStorage.setItem("offline:reservations:" + TENANT, JSON.stringify([expired, rsv(2)]))
        const remaining = listReservations(TENANT)
        expect(remaining.map((r) => r.sequence_value)).toEqual([2])
    })

    it("dropReservation removes a specific invoice", () => {
        window.localStorage.setItem("offline:reservations:" + TENANT, JSON.stringify([rsv(1), rsv(2)]))
        dropReservation(TENANT, "INV-2025-26-00001")
        expect(listReservations(TENANT).map((r) => r.sequence_value)).toEqual([2])
    })

    it("remainingCount matches what take/return do", () => {
        window.localStorage.setItem("offline:reservations:" + TENANT, JSON.stringify([rsv(1), rsv(2), rsv(3)]))
        expect(remainingCount(TENANT)).toBe(3)
        takeReservation(TENANT)
        expect(remainingCount(TENANT)).toBe(2)
    })
})

describe("reservation-buffer — server top-up", () => {
    function mockSupabase(reply: { data: unknown; error: { message: string } | null }) {
        return { rpc: vi.fn().mockResolvedValue(reply) }
    }

    it("topUp asks the server for the missing count and merges results", async () => {
        // Start with 5; target is 50 → ask for 45.
        const seed = Array.from({ length: 5 }, (_, i) => rsv(i + 1))
        window.localStorage.setItem("offline:reservations:" + TENANT, JSON.stringify(seed))
        const sb = mockSupabase({
            data: {
                ok: true,
                reservations: Array.from({ length: 45 }, (_, i) => rsv(i + 6)),
            },
            error: null,
        })
        const r = await topUp(sb, TENANT)
        expect(sb.rpc).toHaveBeenCalledWith("reserve_invoice_numbers", { p_count: 45 })
        expect(r.ok).toBe(true)
        expect(r.count).toBe(50)
        expect(remainingCount(TENANT)).toBe(50)
    })

    it("topUp is a no-op when the buffer is already at or above target", async () => {
        const seed = Array.from({ length: 55 }, (_, i) => rsv(i + 1))
        window.localStorage.setItem("offline:reservations:" + TENANT, JSON.stringify(seed))
        const sb = mockSupabase({ data: null, error: null })
        const r = await topUp(sb, TENANT)
        expect(sb.rpc).not.toHaveBeenCalled()
        expect(r.count).toBe(55)
    })

    it("topUp surfaces server errors without corrupting the existing buffer", async () => {
        const seed = [rsv(1), rsv(2)]
        window.localStorage.setItem("offline:reservations:" + TENANT, JSON.stringify(seed))
        const sb = mockSupabase({ data: null, error: { message: "forbidden" } })
        const r = await topUp(sb, TENANT)
        expect(r.ok).toBe(false)
        expect(r.error).toBe("forbidden")
        expect(listReservations(TENANT)).toHaveLength(2)
    })

    it("refillIfLow does NOT top up while above the low watermark", async () => {
        const seed = Array.from({ length: 30 }, (_, i) => rsv(i + 1))   // > LOW_WATERMARK (20)
        window.localStorage.setItem("offline:reservations:" + TENANT, JSON.stringify(seed))
        const sb = mockSupabase({ data: null, error: null })
        await refillIfLow(sb, TENANT)
        expect(sb.rpc).not.toHaveBeenCalled()
    })

    it("refillIfLow DOES top up when buffer dips below the watermark", async () => {
        const seed = [rsv(1), rsv(2), rsv(3)]                            // < LOW_WATERMARK (20)
        window.localStorage.setItem("offline:reservations:" + TENANT, JSON.stringify(seed))
        const sb = mockSupabase({
            data: { ok: true, reservations: Array.from({ length: 47 }, (_, i) => rsv(i + 4)) },
            error: null,
        })
        await refillIfLow(sb, TENANT)
        expect(sb.rpc).toHaveBeenCalledWith("reserve_invoice_numbers", { p_count: 47 })
        expect(remainingCount(TENANT)).toBe(50)
    })
})
