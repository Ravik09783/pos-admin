import { describe, expect, it } from "vitest"

import { resolveGateway, getGatewayForCountry, gatewayLabel } from "@/lib/payments/gateway"

describe("getGatewayForCountry", () => {
    it("routes India to phonepe and everyone else to stripe", () => {
        expect(getGatewayForCountry("India")).toBe("phonepe")
        expect(getGatewayForCountry("IN")).toBe("phonepe")
        expect(getGatewayForCountry("United Kingdom")).toBe("stripe")
        expect(getGatewayForCountry(null)).toBe("phonepe") // defaults to India config
    })
})

describe("resolveGateway — single active method", () => {
    it("honours the India admin choice among phonepe/paytm/manual", () => {
        expect(resolveGateway("India", "phonepe")).toBe("phonepe")
        expect(resolveGateway("India", "paytm")).toBe("paytm")
        expect(resolveGateway("India", "manual")).toBe("manual")
    })
    it("defaults India to phonepe when the choice is empty/unknown", () => {
        expect(resolveGateway("India", null)).toBe("phonepe")
        expect(resolveGateway("India", "")).toBe("phonepe")
        expect(resolveGateway("India", "stripe")).toBe("phonepe") // stripe isn't a valid India pick
    })
    it("ignores the column outside India — always stripe", () => {
        expect(resolveGateway("United Kingdom", "paytm")).toBe("stripe")
        expect(resolveGateway("United States", "manual")).toBe("stripe")
        expect(resolveGateway("Germany", "phonepe")).toBe("stripe")
    })
})

describe("gatewayLabel", () => {
    it("labels every gateway", () => {
        expect(gatewayLabel("phonepe")).toBe("PhonePe UPI")
        expect(gatewayLabel("paytm")).toBe("Paytm UPI")
        expect(gatewayLabel("stripe")).toBe("Stripe")
        expect(gatewayLabel("manual")).toBe("Manual UPI")
    })
})
