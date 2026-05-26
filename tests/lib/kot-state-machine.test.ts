import { describe, expect, it } from "vitest"

import { canTransition, isTerminal, nextStatuses, type KotStatus } from "@/lib/kot/state-machine"

describe("KOT state machine — mirror of migration 027 update_kot_status", () => {
    it("PENDING can go to PREPARING or CANCELLED only", () => {
        expect(nextStatuses("PENDING").sort()).toEqual(["CANCELLED", "PREPARING"])
    })
    it("PREPARING can go to READY or CANCELLED only", () => {
        expect(nextStatuses("PREPARING").sort()).toEqual(["CANCELLED", "READY"])
    })
    it("READY can only be SERVED", () => {
        expect(nextStatuses("READY")).toEqual(["SERVED"])
    })
    it("SERVED and CANCELLED are terminal", () => {
        expect(isTerminal("SERVED")).toBe(true)
        expect(isTerminal("CANCELLED")).toBe(true)
        expect(nextStatuses("SERVED")).toEqual([])
        expect(nextStatuses("CANCELLED")).toEqual([])
    })
    it("canTransition agrees with nextStatuses for every pair", () => {
        const all: KotStatus[] = ["PENDING","PREPARING","READY","SERVED","CANCELLED"]
        for (const from of all) for (const to of all) {
            expect(canTransition(from, to), `${from}→${to}`).toBe(nextStatuses(from).includes(to))
        }
    })
    it("no transition skips a step (no PENDING → READY, no PREPARING → SERVED)", () => {
        expect(canTransition("PENDING", "READY")).toBe(false)
        expect(canTransition("PENDING", "SERVED")).toBe(false)
        expect(canTransition("PREPARING", "SERVED")).toBe(false)
    })
    it("no resurrection: CANCELLED / SERVED can't move", () => {
        for (const to of ["PENDING","PREPARING","READY","SERVED","CANCELLED"] as KotStatus[]) {
            expect(canTransition("CANCELLED", to), `CANCELLED→${to}`).toBe(false)
            if (to !== "SERVED") expect(canTransition("SERVED", to), `SERVED→${to}`).toBe(false)
        }
    })
})
