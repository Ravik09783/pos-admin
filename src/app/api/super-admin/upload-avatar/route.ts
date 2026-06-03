import { NextResponse } from "next/server"

import { assertSameOrigin } from "@/lib/csrf"
import { requireSuperAdmin } from "@/lib/super-admin/guard"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { logError } from "@/lib/errors"

/**
 * POST /api/super-admin/upload-avatar
 *
 * Multipart form upload (`image` field) for a super-admin's profile
 * photo. Why this exists as a dedicated route instead of letting the
 * client hit Supabase Storage directly:
 *
 *   The `user-avatars` bucket RLS requires the first path segment to
 *   equal `current_tenant_id()`. Super-admins don't have a tenant
 *   (they live outside the multi-tenant model), so a direct upload
 *   from the browser using the user's JWT is rejected by storage.
 *
 *   This endpoint runs server-side with the service-role client which
 *   bypasses RLS, but the route is gated by `requireSuperAdmin()` so
 *   only platform operators can call it. Uploaded files are placed
 *   under `super-admin/<user_id>/<timestamp>.<ext>` — outside the
 *   tenant-prefixed path space so they can never be mistaken for
 *   tenant-owned content.
 *
 * The route returns the public URL of the uploaded object; the
 * caller writes it back to `public.users.avatar_url` via the regular
 * `users_update_self` RLS (no separate API needed for the row update).
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    // Resolve the signed-in user so we can name the upload by user id.
    const service = createServiceRoleClient()
    const { data: userList, error: userErr } = await service
        .from("users")
        .select("id")
        .eq("email", guard.email)
        .limit(1)
        .maybeSingle() as { data: { id: string } | null; error: unknown }
    if (userErr || !userList) {
        logError(userErr ?? "no user row for super-admin email", { route: "/api/super-admin/upload-avatar", email: guard.email })
        return NextResponse.json({ error: "Could not resolve super-admin user row." }, { status: 500 })
    }
    const userId = userList.id

    let form: FormData
    try {
        form = await req.formData()
    } catch {
        return NextResponse.json({ error: "Couldn't parse upload." }, { status: 400 })
    }
    const file = form.get("image")
    if (!(file instanceof File)) {
        return NextResponse.json({ error: "No image uploaded." }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
        return NextResponse.json({
            error: `Image is over ${Math.round(MAX_BYTES / (1024 * 1024))} MB.`,
        }, { status: 413 })
    }
    if (!file.type.startsWith("image/")) {
        return NextResponse.json({ error: "Not an image file." }, { status: 400 })
    }

    // Derive a stable extension from the MIME type. Avoids the user-
    // supplied filename being part of the storage path (which would
    // open path-traversal questions) while still letting the CDN
    // serve a sensible Content-Type.
    const ext = (() => {
        if (file.type === "image/png") return "png"
        if (file.type === "image/webp") return "webp"
        // jpeg / jpg / anything else → jpg
        return "jpg"
    })()
    const path = `super-admin/${userId}/${Date.now()}.${ext}`

    const { error: uploadErr } = await service
        .storage
        .from("user-avatars")
        .upload(path, file, {
            contentType: file.type,
            upsert: false,
        })
    if (uploadErr) {
        logError(uploadErr, { route: "/api/super-admin/upload-avatar", path })
        return NextResponse.json({ error: uploadErr.message }, { status: 500 })
    }

    const { data: pub } = service.storage.from("user-avatars").getPublicUrl(path)
    return NextResponse.json({ ok: true, url: pub.publicUrl, path })
}
