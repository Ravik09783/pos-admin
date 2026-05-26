/**
 * Paytm Payment Gateway client — India dynamic-QR rail.
 *
 * No SDK: like `stripe.ts`, this talks to Paytm's REST API directly and
 * implements Paytm's checksum (signature) algorithm with `node:crypto`.
 * That keeps the bundle lean and the crypto auditable in one place.
 *
 * Used by:
 *   - the create-QR route  → `paytmCreateQr()`   (issue a dynamic UPI QR)
 *   - the webhook handler  → `paytmVerifySignature()` (verify callbacks)
 *   - reconciliation       → `paytmTransactionStatus()` (poll status)
 *
 * Per-tenant: each restaurant's MID + merchant key live on
 * `tenant_payment_gateways`; callers pass them in. `env` switches
 * between Paytm's staging (test) and production hosts — so a tenant
 * tests with staging credentials, then flips `paytm_env` to
 * 'production' after KYC with no code change.
 */
import crypto from "node:crypto"

export type PaytmEnv = "staging" | "production"

/** Paytm's fixed AES IV for the checksum cipher (from PaytmChecksum). */
const PAYTM_IV = "@@@@&&&&####$$$$"

function hostFor(env: PaytmEnv): string {
    return env === "production"
        ? "https://securegw.paytm.in"
        : "https://securegw-stage.paytm.in"
}

/* ──────────────────────────────────────────────────────────────────────────
 *  Checksum (signature) — faithful port of Paytm's PaytmChecksum.
 *  AES-128-CBC over a salted SHA-256 hash. The merchant key is the AES
 *  key (Paytm keys are 16 chars = 16 bytes = AES-128).
 * ────────────────────────────────────────────────────────────────────────── */
function aesEncrypt(input: string, key: string): string {
    const cipher = crypto.createCipheriv("aes-128-cbc", key, PAYTM_IV)
    return cipher.update(input, "binary", "base64") + cipher.final("base64")
}

function aesDecrypt(encrypted: string, key: string): string {
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, PAYTM_IV)
    return decipher.update(encrypted, "base64", "binary") + decipher.final("binary")
}

/** Sorted, pipe-joined values — Paytm's canonical string form of a
 *  param object. NULL / "null" values collapse to empty, as Paytm does. */
function paramString(params: Record<string, unknown>): string {
    return Object.keys(params)
        .sort()
        .map((k) => {
            const v = params[k]
            if (v === null || v === undefined) return ""
            return String(v).toLowerCase() === "null" ? "" : String(v)
        })
        .join("|")
}

function hashWithSalt(data: string, salt: string): string {
    const sha = crypto.createHash("sha256").update(`${data}|${salt}`).digest("hex")
    return sha + salt
}

/**
 * Generate a Paytm checksum signature.
 *
 * `data` is either a JSON-string (for the v3 / QR APIs, which sign
 * `JSON.stringify(body)`) or a param object (for form-style calls).
 */
export function paytmGenerateSignature(
    data: string | Record<string, unknown>,
    merchantKey: string,
): string {
    const str = typeof data === "string" ? data : paramString(data)
    // 4-char random salt — base64 of random bytes, alnum only.
    const salt = crypto.randomBytes(6).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4)
    return aesEncrypt(hashWithSalt(str, salt), merchantKey)
}

/**
 * Verify a Paytm checksum. Decrypt → recover the salt from the tail →
 * recompute the hash and compare. Returns false on any crypto error
 * (malformed checksum, wrong key) rather than throwing.
 */
export function paytmVerifySignature(
    data: string | Record<string, unknown>,
    merchantKey: string,
    checksum: string,
): boolean {
    try {
        const str = typeof data === "string" ? data : paramString(data)
        const decrypted = aesDecrypt(checksum, merchantKey)
        const salt = decrypted.slice(-4)
        return decrypted === hashWithSalt(str, salt)
    } catch {
        return false
    }
}

/* ──────────────────────────────────────────────────────────────────────────
 *  API calls
 * ────────────────────────────────────────────────────────────────────────── */
export interface PaytmCreds {
    env: PaytmEnv
    mid: string
    merchantKey: string
}

/**
 * Platform-level Paytm credentials from environment variables.
 *
 * The real model is PER-TENANT — each restaurant's MID + key live on
 * `tenant_payment_gateways`. These env vars are a FALLBACK used only
 * when a tenant hasn't connected its own Paytm, which is handy for
 * single-restaurant dev / testing. Returns null when unset.
 */
export function paytmEnvCreds(): PaytmCreds | null {
    const mid = process.env.PAYTM_MID
    const merchantKey = process.env.PAYTM_MERCHANT_KEY
    if (!mid || !merchantKey) return null
    return {
        env: process.env.PAYTM_ENV === "production" ? "production" : "staging",
        mid,
        merchantKey,
    }
}

interface PaytmResult<T> {
    ok: boolean
    status: number
    data: T | null
    /** Paytm's resultMsg / resultStatus when the call returned a body. */
    message: string
    rawText: string
}

async function paytmPost<T>(
    url: string,
    body: Record<string, unknown>,
    merchantKey: string,
): Promise<PaytmResult<T>> {
    const signature = paytmGenerateSignature(JSON.stringify(body), merchantKey)
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 15000)
    try {
        const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ head: { signature }, body }),
            signal: ac.signal,
        })
        const rawText = await r.text()
        let parsed: unknown
        try { parsed = JSON.parse(rawText) } catch { parsed = null }
        const resultInfo = (parsed as { body?: { resultInfo?: { resultMsg?: string; resultStatus?: string } } } | null)
            ?.body?.resultInfo
        return {
            ok: r.ok,
            status: r.status,
            data: (parsed as { body?: T } | null)?.body ?? null,
            message: resultInfo?.resultMsg ?? resultInfo?.resultStatus ?? rawText.slice(0, 200),
            rawText,
        }
    } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError"
        return {
            ok: false,
            status: aborted ? 504 : 502,
            data: null,
            message: aborted ? "Paytm timed out" : "Couldn't reach Paytm",
            rawText: "",
        }
    } finally {
        clearTimeout(timer)
    }
}

export interface PaytmQrResult {
    qrCodeId?: string
    /** The UPI intent string — render this as a QR for the customer. */
    qrData?: string
    /** Base64 PNG of the QR, if you'd rather use Paytm's own image. */
    image?: string
}

/**
 * Create a dynamic UPI QR for an exact amount.
 *
 * `orderId` must be unique per QR — it's what Paytm echoes in the
 * webhook so we can map the payment back to a bill. `posId` is a
 * point-of-sale identifier Paytm requires (we pass the branch/tenant).
 */
export async function paytmCreateQr(
    creds: PaytmCreds,
    args: { orderId: string; amount: number; posId: string },
): Promise<PaytmResult<PaytmQrResult>> {
    return paytmPost<PaytmQrResult>(
        `${hostFor(creds.env)}/paymentservices/qr/create`,
        {
            mid: creds.mid,
            orderId: args.orderId,
            amount: args.amount.toFixed(2),
            businessType: "UPI_QR_CODE",
            posId: args.posId,
        },
        creds.merchantKey,
    )
}

export interface PaytmTxnStatus {
    resultInfo?: { resultStatus?: string; resultCode?: string; resultMsg?: string }
    txnId?: string
    orderId?: string
    txnAmount?: string
    /** TXN_SUCCESS | TXN_FAILURE | PENDING */
    txnStatus?: string
}

/**
 * Poll the status of an order. Used as the reconciliation fallback when
 * a webhook is missed — NEVER trust a client "success", always confirm
 * server-side with this or the (signed) webhook.
 */
export async function paytmTransactionStatus(
    creds: PaytmCreds,
    orderId: string,
): Promise<PaytmResult<PaytmTxnStatus>> {
    return paytmPost<PaytmTxnStatus>(
        `${hostFor(creds.env)}/v3/order/status`,
        { mid: creds.mid, orderId },
        creds.merchantKey,
    )
}
