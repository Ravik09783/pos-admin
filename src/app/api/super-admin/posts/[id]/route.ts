import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"
import { assertSameOrigin } from "@/lib/csrf"
import { requireSuperAdmin } from "@/lib/super-admin/guard"
import { extractStoredImagePaths } from "@/lib/post-html"
import { logError, logInfo } from "@/lib/errors"

/**
 * DELETE /api/super-admin/posts/[id]
 *
 * Permanently deletes an announcement post. The DB delete cascades to its
 * target rows and read receipts (FK ON DELETE CASCADE).
 *
 * Before deleting, the post body is scanned for images stored in the
 * `admin-post-images` bucket, and those objects are removed from storage
 * too — so deleting a post leaves nothing orphaned behind.
 */
export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const origin = assertSameOrigin(req)
    if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 })

    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    const { id } = await params
    const admin = createServiceRoleClient()

    // Read the body first so we know which images to sweep afterwards.
    const { data: postRow, error: readErr } = await admin
        .from("admin_posts")
        .select("body")
        .eq("id", id)
        .maybeSingle()
    if (readErr) {
        logError(readErr, { route: "DELETE /api/super-admin/posts/[id]", step: "read" })
        return NextResponse.json({ error: readErr.message }, { status: 400 })
    }
    if (!postRow) {
        return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }
    const imagePaths = extractStoredImagePaths((postRow as { body?: string }).body ?? "")

    // Delete the post — cascades to admin_post_targets + admin_post_reads.
    const { error: delErr } = await admin.from("admin_posts").delete().eq("id", id)
    if (delErr) {
        logError(delErr, { route: "DELETE /api/super-admin/posts/[id]", step: "delete" })
        return NextResponse.json({ error: delErr.message }, { status: 400 })
    }

    // Best-effort image cleanup — a storage hiccup must not fail the
    // delete (the post row is already gone).
    let imagesRemoved = 0
    if (imagePaths.length > 0) {
        const { data: removed, error: rmErr } = await admin.storage
            .from("admin-post-images")
            .remove(imagePaths)
        if (rmErr) {
            logError(rmErr, { route: "DELETE /api/super-admin/posts/[id]", step: "storage" })
        } else {
            imagesRemoved = removed?.length ?? 0
        }
    }

    logInfo("super-admin post deleted", {
        superAdminEmail: guard.email,
        postId: id,
        imagesRemoved,
    })
    return NextResponse.json({ ok: true, images_removed: imagesRemoved })
}
