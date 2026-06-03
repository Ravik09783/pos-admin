import "server-only"

import { createHash } from "node:crypto"

/**
 * PhonePe Payment Gateway — Standard Checkout (v1) helpers.
 *
 * SERVER ONLY — the salt key never leaves the server. Every call here
 * either runs on the server during a route handler (the cashier flow,
 * the QR-ordering flow), inside the webhook (signature verification),
 * or inside the reconcile cron (poll-status safety net).
 *
 * THE THREE OPERATIONS WE DO
 *   1. `createPayment()` — POST /pg/v1/pay. Given a merchantTransactionId
 *      and an amount, mints either a hosted PAY_PAGE redirect URL or a
 *      dynamic UPI QR (PAY_PAGE returns intentUri + deeplink for "open
 *      any UPI app"). PhonePe responds with `instrumentResponse`; we
 *      stash the response in `phonepe_payment_events.raw` and return
 *      what the caller needs to show the customer.
 *   2. `pollStatus()` — GET /pg/v1/status/{merchantId}/{txnId}. Used by
 *      the every-10-min reconcile cron to recover from a missed webhook.
 *      Same shape as the webhook payload, idempotent.
 *   3. `verifyWebhookSignature()` — recomputes the X-VERIFY header and
 *      compares with the one PhonePe sent. Webhook handler refuses any
 *      request that fails this check.
 *
 * SIGNATURE FORMAT (this is the entire crypto, no SDK needed)
 *   For POST endpoints:
 *     payloadB64 = base64(JSON.stringify(body))
 *     hash       = SHA256(payloadB64 + "/pg/v1/pay" + saltKey)
 *     X-VERIFY   = hash + "###" + saltIndex
 *     Request body sent over the wire = { request: payloadB64 }
 *   For GET status:
 *     hash     = SHA256("/pg/v1/status/" + merchantId + "/" + txnId + saltKey)
 *     X-VERIFY = hash + "###" + saltIndex
 *   For webhook callback (PhonePe → us):
 *     received header = X-VERIFY
 *     received body   = { response: payloadB64 } (same shape as request)
 *     compute        = SHA256(payloadB64 + saltKey) + "###" + saltIndex
 *     reject if mismatch.
 */

// ─────────────────────────────────────────────────────────────────────
// Endpoints — UAT vs production picked per-tenant via `env` ("staging"
// vs "production"). The platform-level fallback uses whatever the
// PHONEPE_ENV env var says (defaults to "staging" so a misconfigured
// dev deploy never accidentally hits live PhonePe).
// ─────────────────────────────────────────────────────────────────────
const ENDPOINTS = {
    staging:    "https://api-preprod.phonepe.com/apis/pg-sandbox",
    production: "https://api.phonepe.com/apis/hermes",
} as const

export type PhonePeEnv = "staging" | "production"

export interface PhonePeCreds {
    merchantId: string
    saltKey: string
    saltIndex: string
    env: PhonePeEnv
}

/** Per-tenant row shape we expect from `tenant_payment_gateways`. */
export interface TenantPhonePeRow {
    phonepe_mid: string | null
    phonepe_merchant_key: string | null
    phonepe_salt_index: string | null
    phonepe_mid_staging: string | null
    phonepe_merchant_key_staging: string | null
    phonepe_salt_index_staging: string | null
    phonepe_enabled: boolean | null
    phonepe_env: string | null
}

/**
 * Resolve tenant-stored credentials → an active PhonePeCreds, picking
 * the prod or staging pair based on `phonepe_env`. Returns null when
 * the active pair is incomplete (so the caller can fall back to the
 * platform .env defaults via `phonepeEnvCreds()`).
 */
export function resolveTenantPhonePeCreds(
    row: TenantPhonePeRow | null,
): PhonePeCreds | null {
    if (!row) return null
    if (!row.phonepe_enabled) return null
    const env: PhonePeEnv = row.phonepe_env === "production" ? "production" : "staging"
    if (env === "production") {
        if (!row.phonepe_mid || !row.phonepe_merchant_key || !row.phonepe_salt_index) return null
        return {
            merchantId: row.phonepe_mid,
            saltKey: row.phonepe_merchant_key,
            saltIndex: row.phonepe_salt_index,
            env: "production",
        }
    }
    if (!row.phonepe_mid_staging || !row.phonepe_merchant_key_staging || !row.phonepe_salt_index_staging) {
        return null
    }
    return {
        merchantId: row.phonepe_mid_staging,
        saltKey: row.phonepe_merchant_key_staging,
        saltIndex: row.phonepe_salt_index_staging,
        env: "staging",
    }
}

/**
 * Platform-level credentials from .env — used when a tenant hasn't
 * connected their own PhonePe yet. Useful for single-restaurant
 * deployments and for local development against PhonePe's public UAT
 * sandbox (merchantId = `PGTESTPAYUAT`, saltKey = `…test…`).
 *
 * Returns null when no env-level creds are configured at all.
 */
export function phonepeEnvCreds(): PhonePeCreds | null {
    const env: PhonePeEnv = process.env.PHONEPE_ENV === "production" ? "production" : "staging"
    const mid = process.env.PHONEPE_MERCHANT_ID?.trim()
    const saltKey = process.env.PHONEPE_SALT_KEY?.trim()
    const saltIndex = process.env.PHONEPE_SALT_INDEX?.trim() || "1"
    if (!mid || !saltKey) return null
    return { merchantId: mid, saltKey, saltIndex, env }
}

// ─────────────────────────────────────────────────────────────────────
// Signature helpers — pure functions, exported for unit-testability.
// ─────────────────────────────────────────────────────────────────────

function sha256Hex(input: string): string {
    return createHash("sha256").update(input).digest("hex")
}

/**
 * Compute the X-VERIFY header for a POST request to PhonePe.
 *
 *   xVerify = SHA256(base64(body) + path + saltKey) + "###" + saltIndex
 */
export function computeXVerifyForPost(
    base64Body: string,
    path: string,
    creds: PhonePeCreds,
): string {
    const hash = sha256Hex(base64Body + path + creds.saltKey)
    return `${hash}###${creds.saltIndex}`
}

/**
 * Compute the X-VERIFY header for a GET status request.
 *
 *   xVerify = SHA256(path + saltKey) + "###" + saltIndex
 */
export function computeXVerifyForGet(path: string, creds: PhonePeCreds): string {
    const hash = sha256Hex(path + creds.saltKey)
    return `${hash}###${creds.saltIndex}`
}

/**
 * Verify an incoming webhook's X-VERIFY against the body PhonePe sent.
 *
 * Webhook body shape:  { response: "<base64>" }
 *   xVerify = SHA256(base64Body + saltKey) + "###" + saltIndex
 *
 * Returns true ONLY when the recomputed value matches exactly. Constant-
 * time compare so attempted tampering can't be timing-attacked.
 */
export function verifyWebhookSignature(
    receivedXVerify: string,
    rawBodyBase64: string,
    creds: PhonePeCreds,
): boolean {
    const expected = `${sha256Hex(rawBodyBase64 + creds.saltKey)}###${creds.saltIndex}`
    if (expected.length !== receivedXVerify.length) return false
    let diff = 0
    for (let i = 0; i < expected.length; i++) {
        diff |= expected.charCodeAt(i) ^ receivedXVerify.charCodeAt(i)
    }
    return diff === 0
}

// ─────────────────────────────────────────────────────────────────────
// API calls
// ─────────────────────────────────────────────────────────────────────

/** Subset of PhonePe's createPayment response we actually consume. */
export interface CreatePaymentResult {
    ok: boolean
    /** Free-text error message when ok=false. */
    message?: string
    /** Echoed merchantTransactionId — null on hard failure. */
    txnId?: string
    /** Hosted checkout URL — PAY_PAGE flow ONLY. The customer-screen QR
     *  branch uses `intentUri` + `qrData` from the same response. */
    redirectUrl?: string
    /** UPI deep-link the customer's UPI app opens (`upi://…`). */
    intentUri?: string
    /** Raw QR image data (base64 PNG) when PhonePe returned one. */
    qrData?: string
    /** Whatever PhonePe sent back — stashed in phonepe_payment_events.raw. */
    raw?: unknown
}

interface CreatePaymentArgs {
    /** Unique-per-tenant transaction id we own. PhonePe echoes it back
     *  on the webhook so we can map the payment to our order/bill. */
    merchantTransactionId: string
    /** Amount in MAJOR units — we convert to paise inside. */
    amount: number
    /** Stable id we use to correlate the customer-facing user. We pass
     *  the orderId or the tenant_id when there's no order yet. */
    merchantUserId: string
    /** Where the customer is sent after a hosted PAY_PAGE flow. */
    redirectUrl: string
    /** Where PhonePe POSTs the success/failure webhook. */
    callbackUrl: string
    /** Optional customer phone (10 digits, no +91). PhonePe pre-fills
     *  the UPI app's recipient mobile field with this. */
    mobile?: string | null
    /** PAY_PAGE = hosted redirect (QR shown on PhonePe's page).
     *  UPI_INTENT = our customer screen renders the intent / QR itself
     *               (used for both the staff POS dynamic-QR display AND
     *               the QR-ordering page's "open any UPI app" link). */
    instrument: "PAY_PAGE" | "UPI_INTENT"
}

/**
 * Mint a new PhonePe transaction.
 *
 * 30 s AbortController timeout — PhonePe's create-payment usually
 * responds in 200-600 ms; anything over 30 s is wedged and worth
 * giving up on (we fall back to manual UPI in the caller).
 */
export async function createPhonePePayment(
    creds: PhonePeCreds,
    args: CreatePaymentArgs,
): Promise<CreatePaymentResult> {
    const path = "/pg/v1/pay"
    const url = `${ENDPOINTS[creds.env]}${path}`

    // Amount in paise (PhonePe accepts integer paise only).
    const amountPaise = Math.round(args.amount * 100)
    if (amountPaise <= 0) {
        return { ok: false, message: "Amount must be greater than zero." }
    }

    const payload = {
        merchantId: creds.merchantId,
        merchantTransactionId: args.merchantTransactionId,
        merchantUserId: args.merchantUserId,
        amount: amountPaise,
        redirectUrl: args.redirectUrl,
        redirectMode: "REDIRECT" as const,
        callbackUrl: args.callbackUrl,
        ...(args.mobile ? { mobileNumber: args.mobile.replace(/\D/g, "").slice(-10) } : {}),
        paymentInstrument: args.instrument === "PAY_PAGE"
            ? { type: "PAY_PAGE" }
            : {
                  type: "UPI_INTENT",
                  // Empty target = "open the system UPI chooser". PhonePe
                  // also returns a QR string in the response we can render.
                  targetApp: "",
              },
    }
    const base64Body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64")
    const xVerify = computeXVerifyForPost(base64Body, path, creds)

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 30_000)
    let r: Response
    try {
        r = await fetch(url, {
            method: "POST",
            signal: ac.signal,
            headers: {
                "Content-Type": "application/json",
                "X-VERIFY": xVerify,
                "Accept": "application/json",
            },
            body: JSON.stringify({ request: base64Body }),
        })
    } catch (e) {
        clearTimeout(timer)
        if (e instanceof Error && e.name === "AbortError") {
            return { ok: false, message: "PhonePe timed out (>30 s) — please retry." }
        }
        return { ok: false, message: e instanceof Error ? e.message : "Couldn't reach PhonePe." }
    }
    clearTimeout(timer)

    const data = await r.json().catch(() => null) as {
        success?: boolean
        code?: string
        message?: string
        data?: {
            merchantTransactionId?: string
            instrumentResponse?: {
                type?: string
                redirectInfo?: { url?: string; method?: string }
                intentUrl?: string
                qrData?: string
            }
        }
    } | null

    if (!r.ok || !data || data.success !== true) {
        return {
            ok: false,
            message: data?.message ?? `PhonePe error ${r.status}`,
            raw: data,
        }
    }

    const instr = data.data?.instrumentResponse
    return {
        ok: true,
        txnId: data.data?.merchantTransactionId,
        redirectUrl: instr?.redirectInfo?.url,
        intentUri: instr?.intentUrl,
        qrData: instr?.qrData,
        raw: data,
    }
}

/** Status of a single PhonePe transaction, as returned by `pollStatus()`. */
export interface PollStatusResult {
    ok: boolean
    message?: string
    /** PhonePe state — only used internally; we map to PENDING/SUCCESS/FAILED. */
    state?: "COMPLETED" | "FAILED" | "PENDING" | string
    /** PhonePe-side transaction id, populated once the payment lands. */
    providerTxnId?: string
    /** Settled amount in MAJOR units (we convert back from paise). */
    amount?: number
    raw?: unknown
}

/**
 * Poll PhonePe for the latest state of a transaction we created. Used
 * by the reconcile cron to recover stuck PENDING events when a
 * webhook was dropped.
 */
export async function pollPhonePeStatus(
    creds: PhonePeCreds,
    merchantTransactionId: string,
): Promise<PollStatusResult> {
    const path = `/pg/v1/status/${creds.merchantId}/${merchantTransactionId}`
    const url = `${ENDPOINTS[creds.env]}${path}`
    const xVerify = computeXVerifyForGet(path, creds)

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 20_000)
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
            return { ok: false, message: "PhonePe status check timed out." }
        }
        return { ok: false, message: e instanceof Error ? e.message : "Couldn't reach PhonePe." }
    }
    clearTimeout(timer)

    const data = await r.json().catch(() => null) as {
        success?: boolean
        code?: string
        message?: string
        data?: {
            state?: string
            transactionId?: string
            amount?: number
        }
    } | null
    if (!r.ok || !data) {
        return { ok: false, message: `PhonePe status error ${r.status}`, raw: data }
    }
    const stateRaw = data.data?.state
    return {
        ok: data.success === true,
        message: data.message,
        state: stateRaw as PollStatusResult["state"],
        providerTxnId: data.data?.transactionId,
        amount: data.data?.amount != null ? data.data.amount / 100 : undefined,
        raw: data,
    }
}
