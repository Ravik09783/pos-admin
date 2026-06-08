import { describe, expect, it } from "vitest"

import {
    generatePaytmSignature,
    verifyPaytmSignature,
    verifyPaytmWebhook,
    paytmParamsToString,
} from "@/lib/billing/paytm"

// Paytm merchant keys are 16 chars (AES-128). Any 16-char string works for
// the round-trip property tests below.
const KEY = "abcdef0123456789"

describe("Paytm checksum (PaytmChecksum AES algorithm)", () => {
    it("verifies a signature it generated (round-trip)", () => {
        const data = JSON.stringify({ mid: "MID123", orderId: "ord-1", amount: "100.00" })
        const sig = generatePaytmSignature(data, KEY)
        expect(sig.length).toBeGreaterThan(0)
        expect(verifyPaytmSignature(data, KEY, sig)).toBe(true)
    })

    it("rejects a signature when the data was tampered with", () => {
        const sig = generatePaytmSignature("amount=100", KEY)
        expect(verifyPaytmSignature("amount=999", KEY, sig)).toBe(false)
    })

    it("rejects a signature verified with the wrong key", () => {
        const data = "order=abc"
        const sig = generatePaytmSignature(data, KEY)
        expect(verifyPaytmSignature(data, "0000000000000000", sig)).toBe(false)
    })

    it("never throws on a garbage checksum", () => {
        expect(verifyPaytmSignature("x", KEY, "not-base64-!!")).toBe(false)
        expect(verifyPaytmSignature("x", KEY, "")).toBe(false)
    })

    it("produces a different salt each call (non-deterministic ciphertext)", () => {
        const a = generatePaytmSignature("same", KEY)
        const b = generatePaytmSignature("same", KEY)
        // Different salts → different ciphertext, but both verify.
        expect(a).not.toBe(b)
        expect(verifyPaytmSignature("same", KEY, a)).toBe(true)
        expect(verifyPaytmSignature("same", KEY, b)).toBe(true)
    })
})

describe("paytmParamsToString", () => {
    it("sorts keys, joins values with '|', and excludes the checksum", () => {
        const s = paytmParamsToString({ ORDERID: "o1", MID: "m1", CHECKSUMHASH: "sig", STATUS: "TXN_SUCCESS" })
        // sorted keys: MID, ORDERID, STATUS → values joined
        expect(s).toBe("m1|o1|TXN_SUCCESS")
    })
    it("treats null/undefined/'null' as empty", () => {
        expect(paytmParamsToString({ A: "x", B: null, C: undefined, D: "null" })).toBe("x|||")
    })
})

describe("verifyPaytmWebhook", () => {
    it("accepts a correctly-signed callback param map", () => {
        const params: Record<string, string> = { MID: "m1", ORDERID: "o1", STATUS: "TXN_SUCCESS", TXNAMOUNT: "100.00" }
        const sig = generatePaytmSignature(paytmParamsToString(params), KEY)
        expect(verifyPaytmWebhook({ ...params, CHECKSUMHASH: sig }, KEY)).toBe(true)
    })
    it("rejects a callback with no checksum", () => {
        expect(verifyPaytmWebhook({ MID: "m1", ORDERID: "o1" }, KEY)).toBe(false)
    })
    it("rejects a tampered amount", () => {
        const params: Record<string, string> = { MID: "m1", ORDERID: "o1", STATUS: "TXN_SUCCESS", TXNAMOUNT: "100.00" }
        const sig = generatePaytmSignature(paytmParamsToString(params), KEY)
        // attacker bumps the amount but keeps the old signature
        expect(verifyPaytmWebhook({ ...params, TXNAMOUNT: "1.00", CHECKSUMHASH: sig }, KEY)).toBe(false)
    })
})
