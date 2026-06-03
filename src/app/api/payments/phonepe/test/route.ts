import { NextResponse } from "next/server"

import { assertSameOrigin } from "@/lib/csrf"
import { createClient } from "@/lib/supabase/server"
import { logError } from "@/lib/errors"
import { computeXVerifyForGet, type PhonePeCreds } from "@/lib/billing/phonepe"

/**
 * POST /api/payments/phonepe/test
 *
 * Verifies a tenant's PhonePe credentials without committing them to
 * the database. The settings form lets an OWNER paste a Merchant ID +
 * Salt Key + Salt Index, hit "Test connection", and see green / red
 * before clicking Save.
 *
 * We deliberately do NOT call `createPhonePePayment()` here — that
 * would issue a real (small) transaction on PhonePe's side that the
 * tenant would then have to reconcile. Instead we call the status
 * endpoint with a deliberately-bogus merchantTransactionId; PhonePe
 * responds:
 *
 *   • 401 + `code: AUTHORIZATION_FAILED` → signing key is wrong
 *   • 200 + `code: TRANSACTION_NOT_FOUND` → signing key is correct,
 *                                            we just asked about a
 *                                            non-existent txn. This is
 *                                            success.
 *   • 4xx other / 5xx → surface the message
 *
 * Auth: signed-in OWNER / MANAGER only. The salt key is a secret —
 * we never want a cashier or auditor accidentally testing this.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const ENDPOINTS = {
    staging:    "https://api-preprod.phonepe.com/apis/pg-sandbox",
    production: "https://api.phonepe.com/apis/hermes",
} as const

interface TestBody {
    merchant_id?: string
    salt_key?: string
    salt_index?: string
    env?: "staging" | "production"
}

export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { data: row } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle() as { data: { role: string | null } | null }
    if (row?.role !== "OWNER" && row?.role !== "MANAGER") {
        return NextResponse.json({ error: "Only Owners + Managers can test payment credentials." }, { status: 403 })
    }

    const body = await req.json().catch(() => null) as TestBody | null
    const merchantId = body?.merchant_id?.trim()
    const saltKey = body?.salt_key?.trim()
    const saltIndex = body?.salt_index?.trim() || "1"
    const env = body?.env === "production" ? "production" : "staging"
    if (!merchantId || !saltKey) {
        return NextResponse.json({
            ok: false,
            error: "Client Id and Client Secret are required.",
        }, { status: 400 })
    }

    const creds: PhonePeCreds = { merchantId, saltKey, saltIndex, env }

    // Bogus-but-well-formed merchantTransactionId. PhonePe will look it
    // up and return TRANSACTION_NOT_FOUND (200) when the signature is
    // valid, AUTHORIZATION_FAILED (401) when it isn't.
    const bogusTxnId = `restopos-cred-test-${Date.now().toString(36)}`
    const path = `/pg/v1/status/${creds.merchantId}/${bogusTxnId}`
    const url = `${ENDPOINTS[creds.env]}${path}`
    const xVerify = computeXVerifyForGet(path, creds)

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 15_000)
    let r: Response
    try {
        r = await fetch(url, {
            method: "GET",
            signal: ac.signal,
            headers: {
                "Content-Type": "application/json",
                "X-VERIFY": xVerify,
                "X-MERCHANT-ID": creds.merchantId,
                "Accept": "application/json",
            },
        })
    } catch (e) {
        clearTimeout(timer)
        if (e instanceof Error && e.name === "AbortError") {
            return NextResponse.json({
                ok: false,
                error: "PhonePe didn't respond within 15 s. Try again, or check that " + (env === "staging" ? "api-preprod.phonepe.com" : "api.phonepe.com") + " is reachable from this server.",
            })
        }
        return NextResponse.json({
            ok: false,
            error: e instanceof Error ? e.message : "Couldn't reach PhonePe.",
        })
    }
    clearTimeout(timer)

    const data = await r.json().catch(() => null) as {
        success?: boolean
        code?: string
        message?: string
    } | null

    // Success: signing worked, PhonePe answered, and the code is one
    // of the two expected "we received your call" replies.
    if (data?.code === "PAYMENT_SUCCESS" || data?.code === "TRANSACTION_NOT_FOUND") {
        return NextResponse.json({
            ok: true,
            env,
            message: `${env === "staging" ? "Sandbox" : "Production"} credentials look good — PhonePe accepted the signed call.`,
        })
    }

    // The most common "wrong key" code. Surface it specifically because
    // it's the one a user with a fat-fingered Salt Key sees.
    if (r.status === 401 || data?.code === "AUTHORIZATION_FAILED") {
        return NextResponse.json({
            ok: false,
            error: "PhonePe rejected the signature. Double-check the Client Secret + Client Version — they must match the pair PhonePe shows in Developer Settings → API Keys for this Client Id, in this environment.",
        })
    }

    // Anything else — surface PhonePe's own message so the operator
    // can copy it into a support ticket if needed.
    logError(`PhonePe test unexpected code: ${data?.code} status=${r.status}`, {
        route: "/api/payments/phonepe/test",
        merchantId,
        env,
    })
    return NextResponse.json({
        ok: false,
        error: data?.message || `PhonePe returned ${r.status} ${data?.code ?? ""}`.trim(),
    })
}
