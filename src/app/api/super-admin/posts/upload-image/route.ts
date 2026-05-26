import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { requireSuperAdmin } from "@/lib/super-admin/guard"
import { logError } from "@/lib/errors"

/**
 * POST /api/super-admin/posts/upload-image  (multipart form, field "file")
 *
 * Uploads an image used inside an announcement post and returns its
 * public URL. The composer inserts that URL into the post body as an
 * <img> tag.
 *
 * Images live in the platform-level `admin-post-images` storage bucket
 * (public read) — separate from the tenant-scoped buckets. The bucket is
 * created on first use, so no extra migration is needed.
 *
 * When a post is deleted, /api/super-admin/posts/[id] sweeps the images
 * it referenced back out of this bucket.
 */
const BUCKET = "admin-post-images"
const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]

export async function POST(req: Request) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    const form = await req.formData().catch(() => null)
    const file = form?.get("file")
    if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file uploaded" }, { status: 400 })
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json({ error: "Use a JPG, PNG, WebP or GIF image" }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: "Image must be under 5 MB" }, { status: 400 })
    }

    const admin = createServiceRoleClient()

    // Ensure the public bucket exists. createBucket returns an error (not
    // a throw) when it already exists — which is the expected steady
    // state, so we just ignore it and let the upload below surface any
    // real problem.
    await admin.storage.createBucket(BUCKET, { public: true })

    const ext = (file.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") || "png"
    const path = `${crypto.randomUUID()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buffer, {
        contentType: file.type,
        upsert: false,
    })
    if (upErr) {
        logError(upErr, { route: "/api/super-admin/posts/upload-image" })
        return NextResponse.json({ error: upErr.message }, { status: 500 })
    }

    const { data } = admin.storage.from(BUCKET).getPublicUrl(path)
    return NextResponse.json({ ok: true, url: data.publicUrl, path })
}
