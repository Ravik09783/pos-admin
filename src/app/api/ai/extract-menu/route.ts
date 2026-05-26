import { NextResponse } from "next/server"

import { extractMenuWithGemini } from "@/lib/ai/gemini-menu"
import { assertSameOrigin } from "@/lib/csrf"
import { logError } from "@/lib/errors"
import { createClient } from "@/lib/supabase/server"

/**
 * POST /api/ai/extract-menu
 *
 * Multipart form upload of a menu image. Server proxies to Gemini's
 * vision API and returns the parsed sections in our existing shape:
 *   { ok: true, sections: [{ category, items: [{ name, description, price, food_type }] }] }
 *
 * The API key sits in `GEMINI_API_KEY` (server-only). The image stays
 * server-side too — the only thing the client sees is the parsed
 * sections.
 *
 * Authorization: OWNER or MANAGER. Staff don't manage the catalog.
 *
 * Rate-limiting: relies on Gemini's free-tier limits (15 req/min,
 * 1500/day per project). A user mashing the button gets a friendly
 * 429 from Gemini, which we surface verbatim.
 */
export const runtime = "nodejs"

const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB — Gemini accepts up to ~20 MB, but 10 MB is plenty for a menu photo and protects against accidental huge uploads.

export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    // OWNER / MANAGER only — staff have no business writing menu items.
    const { data: row } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle() as { data: { role: string | null } | null }
    if (row?.role !== "OWNER" && row?.role !== "MANAGER") {
        return NextResponse.json({
            error: "Only Owners and Managers can use the AI menu extractor.",
        }, { status: 403 })
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim()
    if (!apiKey) {
        return NextResponse.json({
            error: "GEMINI_API_KEY isn't set on the server. Add it to .env (see .env.example) and restart, or stick with Local mode on /ai.",
        }, { status: 503 })
    }

    let formData: FormData
    try {
        formData = await req.formData()
    } catch {
        return NextResponse.json({ error: "Couldn't parse the upload — try again." }, { status: 400 })
    }
    const file = formData.get("image")
    if (!(file instanceof File)) {
        return NextResponse.json({ error: "No image was uploaded." }, { status: 400 })
    }
    if (file.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({
            error: `Image is over ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB — scale it down before uploading.`,
        }, { status: 413 })
    }
    if (!file.type.startsWith("image/")) {
        return NextResponse.json({
            error: "That doesn't look like an image — upload a JPG or PNG.",
        }, { status: 400 })
    }

    try {
        const buffer = Buffer.from(await file.arrayBuffer())
        const base64 = buffer.toString("base64")
        const sections = await extractMenuWithGemini(base64, file.type, apiKey)
        return NextResponse.json({ ok: true, sections })
    } catch (e) {
        // The helper throws human-readable errors. Surface them
        // verbatim so the UI can show them inline. Also log so we
        // get a Sentry trail on real outages.
        logError(e, { route: "/api/ai/extract-menu" })
        return NextResponse.json({
            ok: false,
            error: e instanceof Error ? e.message : "Couldn't extract the menu.",
        }, { status: 500 })
    }
}
