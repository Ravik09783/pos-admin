import { NextResponse } from "next/server"

import { assertSameOrigin } from "@/lib/csrf"
import { createClient } from "@/lib/supabase/server"
import { logError } from "@/lib/errors"
import { pollPaytmStatus, type PaytmCreds } from "@/lib/billing/paytm"

/**
 * POST /api/payments/paytm/test
 *
 * Verifies a tenant's Paytm MID + Merchant Key WITHOUT committing them or
 * charging anything. We hit the order-status API with a bogus orderId:
 *   • valid key → Paytm answers with a "no record found" resultInfo (200) →
 *                 the signature was accepted → success.
 *   • wrong key → Paytm answers with a checksum/auth failure (resultCode 330
 *                 / 401 / message mentioning checksum) → report invalid.
 *
 * Auth: signed-in OWNER / MANAGER only (the merchant key is a secret).
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

interface TestBody {
    mid?: string
    merchant_key?: string
    env?: "staging" | "production"
}

export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    const { data: row } = await supabase
        .from("users").select("role").eq("id", user.id).maybeSingle() as { data: { role: string | null } | null }
    if (row?.role !== "OWNER" && row?.role !== "MANAGER") {
        return NextResponse.json({ error: "Only Owners + Managers can test payment credentials." }, { status: 403 })
    }

    const body = await req.json().catch(() => null) as TestBody | null
    const mid = body?.mid?.trim()
    const key = body?.merchant_key?.trim()
    const env = body?.env === "production" ? "production" : "staging"
    if (!mid || !key) {
        return NextResponse.json({ ok: false, error: "Merchant ID and Merchant Key are required." }, { status: 400 })
    }
    const creds: PaytmCreds = { mid, key, env }

    const bogusOrderId = `restopos-cred-test-${Date.now().toString(36)}`
    const status = await pollPaytmStatus(creds, bogusOrderId)
    if (!status.ok) {
        return NextResponse.json({ ok: false, error: status.message ?? "Couldn't reach Paytm." })
    }

    // Inspect the raw resultInfo: a checksum/auth failure means the key is wrong.
    const raw = status.raw as { body?: { resultInfo?: { resultCode?: string; resultMsg?: string } } } | null
    const info = raw?.body?.resultInfo
    const code = info?.resultCode ?? ""
    const msg = (info?.resultMsg ?? "").toLowerCase()
    const looksLikeAuthFailure = ["330", "401"].includes(code) || msg.includes("checksum") || msg.includes("unauthorized")
    if (looksLikeAuthFailure) {
        return NextResponse.json({
            ok: false,
            error: "Paytm rejected the signature. Double-check the Merchant Key — it must match the MID for this environment in your Paytm dashboard.",
        })
    }

    logError(`Paytm test ok (code=${code} msg=${info?.resultMsg ?? ""})`, { route: "/api/payments/paytm/test", mid, env })
    return NextResponse.json({
        ok: true,
        env,
        message: `${env === "staging" ? "Sandbox" : "Production"} credentials look good — Paytm accepted the signed call.`,
    })
}
