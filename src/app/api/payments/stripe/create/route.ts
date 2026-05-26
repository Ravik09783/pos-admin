import { NextResponse } from "next/server"

import { appOrigin } from "@/lib/app-origin"
import { createClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"

/**
 * POST /api/payments/stripe/create
 * Body: { bill_id }
 *
 * Creates a Stripe Checkout Session as a **destination charge**: money
 * lands first in the platform's Stripe account, Stripe deducts its
 * processing fee, then the platform's `application_fee_amount` (1% by
 * default), and the remainder is auto-transferred to the restaurant's
 * connected account.
 *
 * Money flow:
 *   Customer pays ₹1000 by card
 *   Stripe deducts its processing fee (e.g. ₹29 = 2.9% + ₹0.50)
 *   Platform retains application_fee_amount = ₹10 (1%)
 *   Restaurant's connected account receives ₹961
 *
 * Required env:
 *   STRIPE_SECRET_KEY            — platform key (sk_live_… or sk_test_…)
 *   STRIPE_PLATFORM_FEE_PERCENT  — optional, defaults to 1
 *
 * Required per-tenant (Settings → Payments):
 *   tenant_payment_gateways.stripe_connected_account_id  (acct_*)
 *
 * Without the connected-account id this route refuses with 400 — no bill
 * gets a Stripe checkout link until the restaurant has finished Stripe
 * Connect onboarding.
 */
export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const secret = process.env.STRIPE_SECRET_KEY
    const appUrl = appOrigin(req)
    if (!secret) return NextResponse.json({ error: "Stripe not configured" }, { status: 500 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    const { bill_id } = (await req.json()) as { bill_id: string }
    if (!bill_id) return NextResponse.json({ error: "bill_id required" }, { status: 400 })

    const { data: bill } = await supabase.from("bills").select("*").eq("id", bill_id).maybeSingle()
    if (!bill) return NextResponse.json({ error: "bill not found" }, { status: 404 })
    const b = bill as {
        id: string
        invoice_number: string
        grand_total: number
        tenant_id: string
        bill_status: string
        order_id: string
        customer_phone: string | null
    }

    // Refuse to spin up another Checkout Session for a settled / voided bill.
    if (b.bill_status === "PAID") return NextResponse.json({ error: "bill already paid" }, { status: 409 })
    if (b.bill_status === "VOID") return NextResponse.json({ error: "bill voided" }, { status: 409 })

    // Tenant currency drives the Stripe Checkout line_items[currency].
    // We also pull the tenant name for the statement descriptor so the
    // charge shows "SPICE JUNCTION" on the customer's card statement
    // instead of a generic platform string.
    const { data: tenantRow } = await supabase
        .from("tenants").select("currency, name").eq("id", b.tenant_id).maybeSingle()
    const tenant = tenantRow as { currency?: string; name?: string } | null
    const currency = String(tenant?.currency ?? "USD").toLowerCase()

    // Best-effort: pre-fill the Stripe Checkout email from the linked
    // customer. Stripe also sends an automatic receipt to this address
    // when the payment succeeds, so the customer gets a Stripe-branded
    // invoice in their inbox without us doing anything.
    let customerEmail: string | null = null
    if (b.order_id) {
        const { data: order } = await supabase
            .from("orders").select("customer_id").eq("id", b.order_id).maybeSingle()
        const customerId = (order as { customer_id?: string } | null)?.customer_id
        if (customerId) {
            const { data: cust } = await supabase
                .from("customers").select("email").eq("id", customerId).maybeSingle()
            customerEmail = (cust as { email?: string } | null)?.email ?? null
        }
    }

    // Look up the restaurant's Stripe-connected account. Without it we
    // can't route the money anywhere — the bill would silently default
    // to "all goes to platform", which is wrong.
    const { data: gw } = await supabase
        .from("tenant_payment_gateways")
        .select("stripe_connected_account_id, stripe_account_enabled")
        .eq("tenant_id", b.tenant_id)
        .maybeSingle()
    const connected = gw as { stripe_connected_account_id?: string; stripe_account_enabled?: boolean } | null
    if (!connected?.stripe_connected_account_id) {
        return NextResponse.json({
            error: "Restaurant has not finished Stripe Connect onboarding. Add the acct_… id in Settings → Payments.",
        }, { status: 400 })
    }
    if (connected.stripe_account_enabled === false) {
        return NextResponse.json({
            error: "Online card payments are temporarily disabled for this restaurant.",
        }, { status: 400 })
    }

    const amount = Math.round(Number(b.grand_total) * 100)

    // Platform commission. Env-configurable; defaults to 1%. Clamped so a
    // typo can't accidentally send 0% to the restaurant or 200% to us.
    const feeRaw = Number(process.env.STRIPE_PLATFORM_FEE_PERCENT ?? "1")
    const feePercent = Number.isFinite(feeRaw) ? Math.min(100, Math.max(0, feeRaw)) : 1
    const applicationFeeAmount = Math.round(amount * feePercent / 100)

    const params = new URLSearchParams()
    params.append("mode", "payment")
    params.append("line_items[0][price_data][currency]", currency)
    params.append("line_items[0][price_data][product_data][name]", `Invoice ${b.invoice_number}`)
    params.append("line_items[0][price_data][unit_amount]", String(amount))
    params.append("line_items[0][quantity]", "1")
    params.append("metadata[bill_id]", b.id)
    params.append("metadata[invoice_number]", b.invoice_number)
    params.append("metadata[tenant_id]", b.tenant_id)
    params.append("metadata[platform_fee]", String(applicationFeeAmount))
    params.append("metadata[connected_account]", connected.stripe_connected_account_id)
    params.append("success_url", `${appUrl}/bills/${b.id}?paid=1`)
    params.append("cancel_url", `${appUrl}/bills/${b.id}?cancelled=1`)

    // ── Customer-facing polish ─────────────────────────────────────────
    //
    // locale=auto    → Checkout renders in the customer's browser
    //                  language. They don't have to read English UI.
    // customer_email → pre-fills the email field; Stripe also sends an
    //                  automatic branded receipt to that address on
    //                  successful payment.
    // phone_number_collection → collect phone for SMS receipt fallback
    //                  and dispute-handling contact info. Disabled when
    //                  we already have one on the bill — no double ask.
    // billing_address_collection → required for cards in many regions
    //                  (3DS strong auth checks the billing address).
    // allow_promotion_codes → lets the customer enter Stripe Promotion
    //                  Codes on Checkout for an extra discount on top
    //                  of any in-app coupon.
    params.append("locale", "auto")
    if (customerEmail) {
        params.append("customer_email", customerEmail)
    } else if (!b.customer_phone) {
        params.append("phone_number_collection[enabled]", "true")
    }
    params.append("billing_address_collection", "auto")
    params.append("allow_promotion_codes", "true")

    // Connect — destination charge. Money lands in the platform, the
    // `application_fee_amount` stays with the platform, and the rest
    // auto-transfers to the connected account. Stripe deducts its own
    // processing fee from the gross BEFORE the application_fee, so the
    // connected account receives (gross − stripe_fee − application_fee).
    //
    // We DELIBERATELY do not pass `payment_method_types[]`. Stripe's
    // "Dynamic payment methods" then drives the list from the merchant's
    // Stripe Dashboard — so Apple Pay, Google Pay, Link, ACH, Klarna,
    // Afterpay/Clearpay, SEPA, iDEAL, Bancontact, etc. all appear
    // automatically based on what the restaurant has enabled, country
    // eligibility, and the customer's device. No code change required to
    // turn a new method on — just flip it in the merchant's Dashboard.
    params.append("payment_intent_data[application_fee_amount]", String(applicationFeeAmount))
    params.append("payment_intent_data[transfer_data][destination]", connected.stripe_connected_account_id)
    // statement_descriptor_suffix appears AFTER the platform's prefix on
    // the customer's card statement. The full descriptor (prefix + suffix)
    // must be ≤ 22 chars and have no special characters. We sanitize the
    // tenant name and clamp the length.
    const suffix = (tenant?.name ?? "Restaurant")
        .toUpperCase()
        .replace(/[^A-Z0-9 ]/g, "")
        .trim()
        .slice(0, 22)
    if (suffix.length > 0) {
        params.append("payment_intent_data[statement_descriptor_suffix]", suffix)
    }
    // Receipt email — Stripe sends a Stripe-hosted branded receipt to
    // this address as soon as the charge succeeds. Cheaper UX win than
    // building our own receipt mailer.
    if (customerEmail) {
        params.append("payment_intent_data[receipt_email]", customerEmail)
    }
    // Mirror the metadata onto the PaymentIntent so the webhook sees it
    // even if Stripe omits the session-level metadata in some events.
    params.append("payment_intent_data[metadata][bill_id]", b.id)
    params.append("payment_intent_data[metadata][tenant_id]", b.tenant_id)
    params.append("payment_intent_data[metadata][platform_fee]", String(applicationFeeAmount))
    params.append("payment_intent_data[metadata][connected_account]", connected.stripe_connected_account_id)

    // 15-second timeout via AbortController so a Stripe outage can't
    // hang the cashier's "Send payment link" click indefinitely. On
    // timeout we surface a clear "Stripe is slow / unreachable" message
    // instead of a stalled fetch.
    const abort = new AbortController()
    const abortTimer = setTimeout(() => abort.abort(), 15000)
    let r: Response
    try {
        r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${secret}`,
                "Content-Type": "application/x-www-form-urlencoded",
                "Stripe-Version": "2024-11-20.acacia",
            },
            body: params,
            signal: abort.signal,
        })
    } catch (err) {
        clearTimeout(abortTimer)
        const aborted = err instanceof Error && err.name === "AbortError"
        logError(err instanceof Error ? err : new Error(String(err)), {
            route: "/api/payments/stripe/create", billId: bill_id, tenantId: b.tenant_id, aborted,
        })
        return NextResponse.json({
            error: aborted
                ? "Stripe is taking too long to respond. Try again in a moment, or record the payment as cash manually."
                : "Couldn't reach Stripe. Check your network and try again.",
        }, { status: 502 })
    } finally {
        clearTimeout(abortTimer)
    }

    if (!r.ok) {
        const txt = await r.text()
        const friendly = humanizeStripeError(txt, currency)
        logError(new Error(`Stripe checkout-session failed: ${txt}`), {
            route: "/api/payments/stripe/create",
            billId: bill_id,
            tenantId: b.tenant_id,
        })
        return NextResponse.json({ error: friendly }, { status: 502 })
    }
    const session = await r.json() as { id: string; url: string }
    return NextResponse.json({ session_id: session.id, url: session.url })
}

/** Turn a raw Stripe error body into something a cashier can act on.
 *  Mostly we just surface the `message` field; the special-case branches
 *  rephrase common "you need to set X on your Stripe account" errors so
 *  the OWNER knows it's a Stripe-side config thing, not our bug. */
function humanizeStripeError(rawBody: string, currency: string): string {
    try {
        const j = JSON.parse(rawBody) as { error?: { message?: string; code?: string; param?: string } }
        const msg = j.error?.message ?? ""
        const code = j.error?.code ?? ""
        if (/currency/i.test(msg)) {
            return `Stripe rejected the currency (${currency.toUpperCase()}). Check that your Stripe Connect account is set up for this currency.`
        }
        if (code === "account_invalid" || /onboarding/i.test(msg)) {
            return "Your Stripe Connect account isn't ready for charges yet. Finish onboarding in Settings → Payments."
        }
        if (code === "payouts_not_enabled" || /payout/i.test(msg)) {
            return "Stripe hasn't enabled payouts on your account yet — usually because verification is incomplete. Open the Stripe dashboard from Settings → Payments to finish."
        }
        return msg || "Stripe rejected the request. Open the Stripe dashboard for details."
    } catch {
        return "Stripe rejected the request."
    }
}
