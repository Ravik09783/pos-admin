import "server-only"

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

/**
 * Paytm Payment Gateway — Dynamic UPI QR rail (server only).
 *
 * Mirrors the PhonePe helper (src/lib/billing/phonepe.ts) but speaks Paytm's
 * API + its AES-based CHECKSUMHASH signature. The merchant key never leaves
 * the server.
 *
 * THREE OPERATIONS
 *   1. createPaytmQr()      — POST /paymentservices/qr/create. Mints a dynamic
 *                             UPI QR string (`qrData`, a `upi://…` intent) the
 *                             customer screen renders. We pre-insert a
 *                             `paytm_payment_events` row (PENDING) first.
 *   2. pollPaytmStatus()    — POST /v3/order/status. The reconcile cron uses it
 *                             to recover a stuck PENDING event if the webhook
 *                             was missed.
 *   3. verifyPaytmWebhook() — recomputes the CHECKSUMHASH over the callback
 *                             params and compares. The webhook refuses anything
 *                             that fails.
 *
 * CHECKSUM (Paytm's "PaytmChecksum" algorithm — no SDK needed):
 *   salt        = 4 random alphanumerics
 *   hashString  = SHA256(dataString + "|" + salt) + salt
 *   CHECKSUMHASH = AES-128-CBC(hashString, key, iv="@@@@&&&&####$$$$") base64
 *   verify: AES-decrypt → hashString; salt = last 4 chars; recompute + compare.
 *   `dataString` is JSON.stringify(body) for API calls, or the pipe-joined
 *   sorted param values for the form-encoded webhook callback.
 *
 * NOTE: Paytm cannot be exercised without live/sandbox merchant credentials,
 * so the exact head fields + endpoint paths should be confirmed against the
 * tenant's Paytm dashboard during sandbox testing before going to production.
 */

const IV = "@@@@&&&&####$$$$"

const ENDPOINTS = {
    staging:    "https://securegw-stage.paytm.in",
    production: "https://securegw.paytm.in",
} as const

export type PaytmEnv = "staging" | "production"

export interface PaytmCreds {
    mid: string
    key: string
    env: PaytmEnv
}

/** Row shape we read from `tenant_payment_gateways` for Paytm. */
export interface TenantPaytmRow {
    paytm_mid: string | null
    paytm_merchant_key: string | null
    paytm_mid_staging: string | null
    paytm_merchant_key_staging: string | null
    paytm_enabled: boolean | null
    paytm_env: string | null
}

export function resolveTenantPaytmCreds(row: TenantPaytmRow | null): PaytmCreds | null {
    if (!row || !row.paytm_enabled) return null
    const env: PaytmEnv = row.paytm_env === "production" ? "production" : "staging"
    if (env === "production") {
        if (!row.paytm_mid || !row.paytm_merchant_key) return null
        return { mid: row.paytm_mid, key: row.paytm_merchant_key, env }
    }
    if (!row.paytm_mid_staging || !row.paytm_merchant_key_staging) return null
    return { mid: row.paytm_mid_staging, key: row.paytm_merchant_key_staging, env }
}

/** Platform .env fallback (single-restaurant deploys / local sandbox). */
export function paytmEnvCreds(): PaytmCreds | null {
    const env: PaytmEnv = process.env.PAYTM_ENV === "production" ? "production" : "staging"
    const mid = process.env.PAYTM_MID?.trim()
    const key = process.env.PAYTM_MERCHANT_KEY?.trim()
    if (!mid || !key) return null
    return { mid, key, env }
}

// ── Checksum (exported for unit tests) ──────────────────────────────────────
function sha256Hex(s: string): string {
    return createHash("sha256").update(s).digest("hex")
}
function randomAlphaNum(len: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    const bytes = randomBytes(len)
    let out = ""
    for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length]
    return out
}
function calculateHash(data: string, salt: string): string {
    return sha256Hex(`${data}|${salt}`) + salt
}
function aesEncrypt(plain: string, key: string): string {
    const cipher = createCipheriv("aes-128-cbc", key, IV)
    return cipher.update(plain, "utf8", "base64") + cipher.final("base64")
}
function aesDecrypt(encoded: string, key: string): string {
    const decipher = createDecipheriv("aes-128-cbc", key, IV)
    return decipher.update(encoded, "base64", "utf8") + decipher.final("utf8")
}

/** Generate a CHECKSUMHASH over a data string (JSON body or pipe-joined params). */
export function generatePaytmSignature(data: string, key: string): string {
    const salt = randomAlphaNum(4)
    return aesEncrypt(calculateHash(data, salt), key)
}

/** Verify a received CHECKSUMHASH against the data string. Constant-ish; never throws. */
export function verifyPaytmSignature(data: string, key: string, checksum: string): boolean {
    try {
        const decrypted = aesDecrypt(checksum, key)
        const salt = decrypted.slice(-4)
        const expected = calculateHash(data, salt)
        if (expected.length !== decrypted.length) return false
        let diff = 0
        for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ decrypted.charCodeAt(i)
        return diff === 0
    } catch {
        return false
    }
}

/** Build the pipe-joined string Paytm signs for form-callback verification:
 *  values of all params except CHECKSUMHASH, keys sorted, joined with "|". */
export function paytmParamsToString(params: Record<string, string | null | undefined>): string {
    return Object.keys(params)
        .filter((k) => k !== "CHECKSUMHASH" && k !== "CHECKSUM")
        .sort()
        .map((k) => {
            const v = params[k]
            return v === undefined || v === null || v === "null" ? "" : String(v)
        })
        .join("|")
}

/** Verify a Paytm webhook/callback param map. */
export function verifyPaytmWebhook(params: Record<string, string>, key: string): boolean {
    const checksum = params.CHECKSUMHASH ?? params.CHECKSUM
    if (!checksum) return false
    return verifyPaytmSignature(paytmParamsToString(params), key, checksum)
}

// ── API calls ───────────────────────────────────────────────────────────────
export interface CreateQrResult {
    ok: boolean
    message?: string
    /** UPI intent string (`upi://…`) the customer screen renders as a QR. */
    qrData?: string
    qrCodeId?: string
    raw?: unknown
}

/** Mint a dynamic Paytm UPI QR for `orderId`/`amount` (major units). */
export async function createPaytmQr(
    creds: PaytmCreds,
    args: { orderId: string; amount: number },
): Promise<CreateQrResult> {
    if (args.amount <= 0) return { ok: false, message: "Amount must be greater than zero." }
    const body = {
        mid: creds.mid,
        orderId: args.orderId,
        amount: args.amount.toFixed(2),
        businessType: "UPI_QR_CODE",
        posId: creds.mid,
    }
    const signature = generatePaytmSignature(JSON.stringify(body), creds.key)
    const payload = { head: { clientId: "C11", version: "v1", signature }, body }

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 30_000)
    let r: Response
    try {
        r = await fetch(`${ENDPOINTS[creds.env]}/paymentservices/qr/create`, {
            method: "POST",
            signal: ac.signal,
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(payload),
        })
    } catch (e) {
        clearTimeout(timer)
        if (e instanceof Error && e.name === "AbortError") return { ok: false, message: "Paytm timed out — please retry." }
        return { ok: false, message: e instanceof Error ? e.message : "Couldn't reach Paytm." }
    }
    clearTimeout(timer)

    const data = await r.json().catch(() => null) as {
        body?: { resultInfo?: { resultStatus?: string; resultMsg?: string }; qrData?: string; qrCodeId?: string }
    } | null
    const status = data?.body?.resultInfo?.resultStatus
    if (!r.ok || !data?.body?.qrData || (status && status !== "SUCCESS" && status !== "S")) {
        return { ok: false, message: data?.body?.resultInfo?.resultMsg ?? `Paytm error ${r.status}`, raw: data }
    }
    return { ok: true, qrData: data.body.qrData, qrCodeId: data.body.qrCodeId, raw: data }
}

export interface PaytmStatusResult {
    ok: boolean
    message?: string
    /** Normalised: 'COMPLETED' | 'FAILED' | 'PENDING'. */
    state?: "COMPLETED" | "FAILED" | "PENDING"
    providerTxnId?: string
    amount?: number
    raw?: unknown
}

/** Poll Paytm for a transaction's status (reconcile cron safety net). */
export async function pollPaytmStatus(creds: PaytmCreds, orderId: string): Promise<PaytmStatusResult> {
    const body = { mid: creds.mid, orderId }
    const signature = generatePaytmSignature(JSON.stringify(body), creds.key)
    const payload = { head: { version: "v1", signature }, body }

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 20_000)
    let r: Response
    try {
        r = await fetch(`${ENDPOINTS[creds.env]}/v3/order/status`, {
            method: "POST",
            signal: ac.signal,
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(payload),
        })
    } catch (e) {
        clearTimeout(timer)
        if (e instanceof Error && e.name === "AbortError") return { ok: false, message: "Paytm status check timed out." }
        return { ok: false, message: e instanceof Error ? e.message : "Couldn't reach Paytm." }
    }
    clearTimeout(timer)

    const data = await r.json().catch(() => null) as {
        body?: { resultInfo?: { resultStatus?: string }; txnId?: string; txnAmount?: string }
    } | null
    if (!r.ok || !data?.body?.resultInfo) {
        return { ok: false, message: `Paytm status error ${r.status}`, raw: data }
    }
    const rs = data.body.resultInfo.resultStatus
    const state: PaytmStatusResult["state"] =
        rs === "TXN_SUCCESS" ? "COMPLETED" : rs === "TXN_FAILURE" ? "FAILED" : "PENDING"
    return {
        ok: true,
        state,
        providerTxnId: data.body.txnId,
        amount: data.body.txnAmount != null ? Number(data.body.txnAmount) : undefined,
        raw: data,
    }
}

export { ENDPOINTS as PAYTM_ENDPOINTS }
