import { beforeEach, describe, expect, it } from "vitest"

import { mockSupabase, resetMocks } from "../helpers/route-test"
import type { MockSupabase } from "../helpers/supabase-mock"

let db: MockSupabase

beforeEach(() => {
    resetMocks()
    db = mockSupabase()
})

async function callGet(token: string) {
    const { GET } = await import("@/app/api/public/invite/[token]/route")
    return GET(new Request(`http://localhost/api/public/invite/${token}`), { params: Promise.resolve({ token }) })
}

describe("GET /api/public/invite/[token]", () => {
    it("returns 400 for tokens shorter than 8 chars", async () => {
        const r = await callGet("abc")
        expect(r.status).toBe(400)
    })

    it("returns 404 with error=not_found when token isn't in DB", async () => {
        const r = await callGet("nonexistent-token-1234")
        expect(r.status).toBe(404)
        const body = await r.json()
        expect(body.error).toBe("not_found")
    })

    it("returns status=valid for a fresh pending invite", async () => {
        db.seed("staff_invites", [{
            id: "invite-1",
            email: "newhire@example.com",
            role: "CASHIER",
            full_name: "New Hire",
            status: "PENDING",
            expires_at: new Date(Date.now() + 86400_000).toISOString(),
            branch_id: null,
            tenant_id: "tenant-1",
            created_at: new Date().toISOString(),
            token: "valid-token-xyz",
        }])
        db.seed("tenants", [{ id: "tenant-1", name: "RestoTest", logo_url: null, city: "Mumbai" }])

        const r = await callGet("valid-token-xyz")
        expect(r.status).toBe(200)
        const body = await r.json()
        expect(body.status).toBe("valid")
        expect(body.invite.email).toBe("newhire@example.com")
        expect(body.invite.role).toBe("CASHIER")
        expect(body.tenant.name).toBe("RestoTest")
        expect(body.tenant.city).toBe("Mumbai")
    })

    it("returns status=expired when expires_at is in the past", async () => {
        db.seed("staff_invites", [{
            id: "invite-2",
            email: "x@example.com",
            role: "CASHIER",
            full_name: null,
            status: "PENDING",
            expires_at: new Date(Date.now() - 1000).toISOString(),
            branch_id: null,
            tenant_id: "tenant-1",
            created_at: new Date().toISOString(),
            token: "expired-token-xyz",
        }])
        db.seed("tenants", [{ id: "tenant-1", name: "T" }])
        const r = await callGet("expired-token-xyz")
        const body = await r.json()
        expect(body.status).toBe("expired")
    })

    it("returns status=accepted when invite has been accepted", async () => {
        db.seed("staff_invites", [{
            id: "invite-3",
            email: "x@example.com",
            role: "OWNER",
            full_name: null,
            status: "ACCEPTED",
            expires_at: new Date(Date.now() + 86400_000).toISOString(),
            branch_id: null,
            tenant_id: "tenant-1",
            created_at: new Date().toISOString(),
            token: "accepted-token-xyz",
        }])
        db.seed("tenants", [{ id: "tenant-1", name: "T" }])
        const r = await callGet("accepted-token-xyz")
        const body = await r.json()
        expect(body.status).toBe("accepted")
    })

    it("returns status=revoked when invite was revoked", async () => {
        db.seed("staff_invites", [{
            id: "invite-4",
            email: "x@example.com",
            role: "CASHIER",
            full_name: null,
            status: "REVOKED",
            expires_at: new Date(Date.now() + 86400_000).toISOString(),
            branch_id: null,
            tenant_id: "tenant-1",
            created_at: new Date().toISOString(),
            token: "revoked-token-xyz",
        }])
        db.seed("tenants", [{ id: "tenant-1", name: "T" }])
        const r = await callGet("revoked-token-xyz")
        const body = await r.json()
        expect(body.status).toBe("revoked")
    })
})
