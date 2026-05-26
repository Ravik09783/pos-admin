import { beforeEach, describe, expect, it } from "vitest"

import { mockSupabase, resetMocks } from "../helpers/route-test"
import type { MockSupabase } from "../helpers/supabase-mock"

let db: MockSupabase

beforeEach(() => {
    resetMocks()
    db = mockSupabase()
})

function buildFormReq(fields: Record<string, string | File>) {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.append(k, v as Blob | string)
    return new Request("http://localhost/api/public/qr/upload-proof", {
        method: "POST",
        body: fd,
    })
}

async function callPost(req: Request) {
    const { POST } = await import("@/app/api/public/qr/upload-proof/route")
    return POST(req)
}

function pngFile(size = 1024): File {
    return new File([new Uint8Array(size)], "proof.png", { type: "image/png" })
}

describe("POST /api/public/qr/upload-proof", () => {
    it("returns 400 when required fields are missing", async () => {
        const r = await callPost(buildFormReq({}))
        expect(r.status).toBe(400)
    })

    it("returns 413 when file > 5MB", async () => {
        const r = await callPost(buildFormReq({
            file: new File([new Uint8Array(6 * 1024 * 1024)], "huge.png", { type: "image/png" }),
            order_id: "order-1",
            amount: "210",
        }))
        expect(r.status).toBe(413)
    })

    it("returns 415 when file is not an image", async () => {
        const r = await callPost(buildFormReq({
            file: new File(["pdf-bytes"], "doc.pdf", { type: "application/pdf" }),
            order_id: "order-1",
            amount: "210",
        }))
        expect(r.status).toBe(415)
    })

    it("returns 404 when order doesn't exist", async () => {
        const r = await callPost(buildFormReq({
            file: pngFile(),
            order_id: "missing-order",
            amount: "210",
        }))
        expect(r.status).toBe(404)
    })

    it("returns 409 when order is not awaiting_confirmation", async () => {
        db.seed("orders", [{ id: "order-1", tenant_id: "t1", awaiting_confirmation: false }])
        const r = await callPost(buildFormReq({
            file: pngFile(),
            order_id: "order-1",
            amount: "210",
        }))
        expect(r.status).toBe(409)
    })

    it("uploads file + writes qr_payment_proofs row on happy path", async () => {
        db.seed("orders", [{ id: "order-1", tenant_id: "t1", awaiting_confirmation: true }])
        const r = await callPost(buildFormReq({
            file: pngFile(2048),
            order_id: "order-1",
            amount: "210",
            customer_name: "Asha",
            customer_phone: "9999988888",
            upi_id_used: "spot@upi",
        }))
        expect(r.status).toBe(200)
        const body = await r.json()
        expect(body.ok).toBe(true)
        expect(body.proof_id).toBeTruthy()
        expect(body.screenshot_url).toMatch(/https:\/\/storage\.test\/payment-proofs/)

        // The proof row was written with PENDING status
        const proofs = db.tables["qr_payment_proofs"]
        expect(proofs?.length).toBe(1)
        expect(proofs?.[0]?.status).toBe("PENDING")
        expect(proofs?.[0]?.amount).toBe(210)
        expect(proofs?.[0]?.customer_name).toBe("Asha")

        // File made it to storage
        const uploads = db.storage.list("payment-proofs")
        expect(uploads.length).toBe(1)
        expect(uploads[0]?.size).toBe(2048)
    })
})
