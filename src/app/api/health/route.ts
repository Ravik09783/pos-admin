import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"

/**
 * GET /api/health
 *
 * Lightweight uptime probe. Two response shapes:
 *
 *   1. Plain caller (no Authorization header) — returns 200 with
 *      `{ status: "ok", ts: ... }` if the process is up. Suitable for
 *      generic monitors (Better Stack, UptimeRobot, Pingdom).
 *
 *   2. Authenticated caller (Authorization: Bearer <HEALTH_CHECK_TOKEN>) —
 *      returns extended diagnostics including a Supabase round-trip,
 *      version info, and uptime. Use this from internal dashboards.
 *
 * Never throws — failures become 503 with structured JSON so monitors
 * see a clean state transition instead of a stack trace.
 *
 * The route is intentionally NOT cached. `dynamic = "force-dynamic"` keeps
 * it out of the build's static export and any edge cache.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

interface HealthResponse {
    status: "ok" | "degraded"
    ts: string
    uptime_s?: number
    version?: string
    db?: { ok: boolean; latency_ms?: number; error?: string }
}

const STARTED_AT = Date.now()

export async function GET(req: Request) {
    const auth = req.headers.get("authorization") ?? ""
    const expected = process.env.HEALTH_CHECK_TOKEN ?? ""
    const detailed = expected.length > 0 && auth === `Bearer ${expected}`

    const body: HealthResponse = {
        status: "ok",
        ts: new Date().toISOString(),
    }

    if (detailed) {
        body.uptime_s = Math.round((Date.now() - STARTED_AT) / 1000)
        body.version = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7)
                     ?? process.env.npm_package_version
                     ?? "dev"

        // One cheap DB round-trip — picks up failures the env-var checks miss
        // (revoked service-role key, paused project, network blip).
        const dbStart = Date.now()
        try {
            const sb = createServiceRoleClient()
            const { error } = await sb.from("tenants").select("id", { head: true, count: "exact" }).limit(1)
            const latency = Date.now() - dbStart
            if (error) {
                body.status = "degraded"
                body.db = { ok: false, error: error.message, latency_ms: latency }
            } else {
                body.db = { ok: true, latency_ms: latency }
            }
        } catch (e: unknown) {
            body.status = "degraded"
            body.db = { ok: false, error: e instanceof Error ? e.message : "unknown" }
        }
    }

    return NextResponse.json(body, { status: body.status === "ok" ? 200 : 503 })
}
