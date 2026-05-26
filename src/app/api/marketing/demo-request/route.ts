import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { rateLimit } from "@/lib/rate-limit"
import { logError } from "@/lib/errors"

/**
 * POST /api/marketing/demo-request
 *
 * Public, unauthenticated endpoint for the /demo "Schedule a free demo"
 * form. Writes to `public.demo_requests` via the service-role client (the
 * table's RLS is super-admin-only — service-role bypasses that, which is
 * fine because this is the ONLY write path).
 *
 * Hardening:
 *   • Rate-limit by IP (10 / hour) so a script can't fill the table with
 *     junk leads.
 *   • Basic input validation + length caps.
 *   • No raw `Error.message` leaks back to the browser — leads are public
 *     submissions; the response is intentionally generic.
 */

interface Body {
    name?: string
    email?: string
    phone?: string
    city?: string
    restaurant?: string
    message?: string
}

const MAX = { name: 80, email: 200, phone: 32, city: 80, restaurant: 120, message: 2000 }

export async function POST(req: Request) {
    // Best-effort IP for rate-limiting. Falls back to a constant so the limit
    // still applies when the header is missing — at worst a tighter bucket.
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown"
    const rl = await rateLimit(`demo:${ip}`, 10, 60 * 60_000)
    if (!rl.allowed) {
        return NextResponse.json(
            { error: "Too many submissions from this network. Please try again in an hour." },
            { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
        )
    }

    let body: Body
    try { body = (await req.json()) as Body } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }) }

    const name = (body.name ?? "").trim().slice(0, MAX.name)
    const email = (body.email ?? "").trim().slice(0, MAX.email)
    const phone = (body.phone ?? "").trim().slice(0, MAX.phone)
    const city = (body.city ?? "").trim().slice(0, MAX.city) || null
    const restaurant = (body.restaurant ?? "").trim().slice(0, MAX.restaurant) || null
    const message = (body.message ?? "").trim().slice(0, MAX.message) || null

    if (!name || name.length < 2) {
        return NextResponse.json({ error: "Please enter your name." }, { status: 400 })
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 })
    }
    if (!phone || phone.replace(/\D/g, "").length < 7) {
        return NextResponse.json({ error: "Please enter a valid phone number." }, { status: 400 })
    }

    const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null

    try {
        const service = createServiceRoleClient()
        const { error } = await service.from("demo_requests").insert({
            name, email, phone, city, restaurant, message,
            source: "demo_form",
            user_agent: userAgent,
            ip_address: ip !== "unknown" ? ip : null,
        } as never)
        if (error) {
            logError(error, { route: "/api/marketing/demo-request" })
            return NextResponse.json({ error: "Couldn't save your request. Please try again." }, { status: 500 })
        }
        return NextResponse.json({ ok: true })
    } catch (e) {
        logError(e, { route: "/api/marketing/demo-request" })
        return NextResponse.json({ error: "Something went wrong." }, { status: 500 })
    }
}
