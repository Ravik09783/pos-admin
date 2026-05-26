import { NextResponse } from "next/server"

import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { paytmTransactionStatus, type PaytmEnv } from "@/lib/billing/paytm"
import { createClient } from "@/lib/supabase/server"

/**
 * POST /api/payments/paytm/test
 *
 * Body: { mid: string, merchant_key: string, env: "staging" | "production" }
 *
 * Pings Paytm's order-status endpoint with a deliberately-bogus order id
 * just so the credentials get exercised end-to-end:
 *   - signature is generated with the supplied merchant key,
 *   - request is signed and posted to the env-matched Paytm host,
 *   - response code tells us whether the MID/key were accepted.
 *
 * What we look for:
 *   - HTTP 200 + a "no record found" style body  → credentials valid ✅
 *   - HTTP 200 + "invalid signature / merchant"  → credentials bad ❌
 *   - HTTP 4xx / network failure                 → unknown / try again
 *
 * No money moves, no order is created. This is the cheapest way to
 * answer "do these keys work?" without staging a real ₹1 transaction.
 *
 * Authorization: OWNER only — the credentials being tested are
 * tenant-secret. The server doesn't persist them; it only calls Paytm
 * with whatever the OWNER pastes. (Save still goes through the form
 * upsert, which RLS limits to OWNER anyway.)
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    // OWNER-only — the credentials are sensitive, and a non-owner has
    // no business poking the merchant's gateway. Mirrors the RLS gate
    // on `tenant_payment_gateways` (tpg_owner_all).
    const { data: u } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle() as { data: { role: string | null } | null }
    if (u?.role !== "OWNER") {
        return NextResponse.json({ error: "Only the Owner can test the payment gateway." }, { status: 403 })
    }

    const body = await req.json().catch(() => null) as {
        mid?: string
        merchant_key?: string
        env?: PaytmEnv
    } | null
    if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 })

    const mid = (body.mid ?? "").trim()
    const key = (body.merchant_key ?? "").trim()
    const env: PaytmEnv = body.env === "staging" ? "staging" : "production"

    if (!mid || !key) {
        return NextResponse.json({
            ok: false,
            error: "Paste both the MID and the Merchant Key before testing.",
        }, { status: 400 })
    }
    if (/\s/.test(mid) || /\s/.test(key)) {
        return NextResponse.json({
            ok: false,
            error: "MID / Merchant Key shouldn't contain spaces — re-copy from Paytm.",
        }, { status: 400 })
    }

    try {
        // Deliberately impossible orderId so we exercise auth without
        // touching a real order. UUID-based so Paytm can't pre-match.
        const probeOrderId = `restopos-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const r = await paytmTransactionStatus({ mid, merchantKey: key, env }, probeOrderId)

        // Paytm result-code semantics we care about:
        //   "01"          → "Order not found"        — signature OK, MID OK ✅
        //   "0002"/"0008" → "Invalid Signature"      — merchant key wrong ❌
        //   "0005"/"227"  → "Merchant ID not found"  — MID wrong ❌
        //   "501" / HTTP 501 / "System Error" — Paytm's generic blow-up.
        //                   We DO NOT treat this as failure: Paytm
        //                   returns 501 for transient hiccups AND for
        //                   real config issues, and we can't tell from
        //                   our side which is which. Mark it
        //                   INDETERMINATE so the UI shows a soft "we
        //                   couldn't confirm, try a real ₹1 payment"
        //                   instead of a misleading "credentials are
        //                   broken".
        //   HTTP 400 + empty body — same story; treat as indeterminate.
        // Anything else → ambiguous; surface Paytm's own message.
        const msg = (r.data?.resultInfo?.resultMsg ?? r.message ?? "").trim()
        const code = (r.data?.resultInfo?.resultCode ?? "").trim()
        const httpStatus = r.status
        const envLabel = env === "production" ? "Production" : "Test"
        const otherEnvLabel = env === "production" ? "Test" : "Production"

        const looksValid =
            r.ok && (
                code === "01" ||
                /not found|no record/i.test(msg)
            )

        const looksAuthBad =
            /invalid signature|invalid checksum|invalid merchant|inactive merchant|merchant.*not.*found/i.test(msg)
            || ["0002", "0005", "0008", "227"].includes(code)

        // "Indeterminate" — Paytm couldn't process our request and we
        // can't tell whether that's because the credentials are wrong
        // or because Paytm's API just had a moment. This is by far
        // the most common test outcome with valid keys.
        const looksIndeterminate =
            httpStatus === 501 ||
            httpStatus === 400 ||
            httpStatus === 502 || httpStatus === 503 || httpStatus === 504 ||
            code === "501" ||
            /system error/i.test(msg) ||
            (httpStatus >= 200 && httpStatus < 300 && !code && !msg)

        if (looksValid) {
            return NextResponse.json({
                ok: true,
                env,
                message: `Paytm accepted your ${envLabel} credentials.`,
            })
        }
        if (looksAuthBad) {
            return NextResponse.json({
                ok: false,
                env,
                error: `Paytm rejected the credentials: ${msg || code || "unknown error"}. Make sure you copied them from the ${envLabel} API Details tab in the Paytm dashboard.`,
            }, { status: 200 }) // 200 so the frontend can render the message inline; success/failure is in `ok`.
        }
        if (looksIndeterminate) {
            const paytmDetail = msg || (code ? `code ${code}` : "") || `HTTP ${httpStatus}`
            return NextResponse.json({
                ok: false,
                indeterminate: true,
                env,
                error:
                    `Paytm couldn't confirm one way or the other (${paytmDetail}). This DOES NOT mean your keys are wrong — Paytm's verification API returns this for several unrelated reasons. Best next step is to save your settings and run a small real payment from POS — that's the only conclusive check.\n` +
                    `\n` +
                    `If you suspect a config mismatch, the usual culprits are:\n` +
                    `• Keys came from your ${otherEnvLabel} tab in Paytm but you tested ${envLabel}. Re-copy from the ${envLabel} API Details tab.\n` +
                    `• MID isn't activated for ${envLabel} yet (Production unlocks only after Paytm finishes KYC).\n` +
                    `• Transient Paytm-side hiccup — wait a minute and try again.`,
            }, { status: 200 })
        }
        // Ambiguous — return what Paytm said so the OWNER can decide.
        return NextResponse.json({
            ok: false,
            indeterminate: true,
            env,
            error: `Unexpected response from Paytm: ${msg || "no message"} (code ${code || "—"}). Save your settings and try a real payment — that's the conclusive test.`,
        }, { status: 200 })
    } catch (e) {
        logError(e, { route: "/api/payments/paytm/test", env })
        return NextResponse.json({
            ok: false,
            env,
            error: e instanceof Error ? e.message : "Couldn't reach Paytm — check your network and try again.",
        }, { status: 200 })
    }
}
