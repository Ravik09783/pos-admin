/**
 * Client-side image compression + Supabase Storage upload.
 *
 * Why DIY instead of pulling in `browser-image-compression`:
 *   - canvas + toBlob does the job in ~80 lines
 *   - keeps the bundle ~30 KB lighter on every page
 *   - we don't need EXIF rotation handling (modern browsers auto-rotate
 *     via image-orientation: from-image, which canvas honours when the
 *     image is drawn)
 *
 * Default profile: max 1200 px on the longest edge, JPEG quality 0.85.
 * That keeps menu photos under ~250 KB while still looking sharp on a
 * customer's phone. PNGs with transparency (logos!) are kept as PNG so
 * the alpha channel survives the round-trip.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export interface CompressOptions {
    /** Longest edge in pixels — the image is downscaled to fit. */
    maxEdge?: number
    /** JPEG quality, 0-1. Ignored for PNG output. */
    quality?: number
    /** Preserve transparency by writing PNG instead of JPEG. Defaults to
     *  auto-detect from the input MIME type. */
    keepAlpha?: boolean
}

export interface CompressResult {
    blob: Blob
    width: number
    height: number
    mimeType: "image/jpeg" | "image/png"
    /** Bytes saved vs. the original (negative if compression made it bigger,
     *  which can happen for already-tiny inputs — we still use the smaller). */
    savedBytes: number
}

export async function compressImage(file: File, opts: CompressOptions = {}): Promise<CompressResult> {
    const maxEdge = opts.maxEdge ?? 1200
    const quality = opts.quality ?? 0.85
    const keepAlpha = opts.keepAlpha ?? /png$/i.test(file.type)

    const bitmap = await loadBitmap(file)
    try {
        const { width, height } = fitInto(bitmap.width, bitmap.height, maxEdge)
        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("Canvas not supported")
        ctx.imageSmoothingQuality = "high"
        ctx.drawImage(bitmap, 0, 0, width, height)

        const mimeType: "image/jpeg" | "image/png" = keepAlpha ? "image/png" : "image/jpeg"
        const blob = await canvasToBlob(canvas, mimeType, quality)
        // If compression made the file bigger (tiny originals), prefer the
        // original — caller still gets the canonical mime type they wanted.
        const finalBlob = blob.size < file.size ? blob : file
        return {
            blob: finalBlob,
            width,
            height,
            mimeType,
            savedBytes: file.size - finalBlob.size,
        }
    } finally {
        // ImageBitmap holds GPU memory until closed.
        if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close()
    }
}

function fitInto(w: number, h: number, maxEdge: number): { width: number; height: number } {
    const longest = Math.max(w, h)
    if (longest <= maxEdge) return { width: w, height: h }
    const scale = maxEdge / longest
    return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
    // createImageBitmap is faster and avoids the HTMLImageElement load
    // ceremony, but Safari < 14 doesn't support it for File. Falls back.
    if (typeof createImageBitmap === "function") {
        try { return await createImageBitmap(file) } catch { /* fall through */ }
    }
    const url = URL.createObjectURL(file)
    try {
        const img = new Image()
        img.decoding = "async"
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve()
            img.onerror = () => reject(new Error("Failed to load image"))
            img.src = url
        })
        return img
    } finally {
        URL.revokeObjectURL(url)
    }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob returned null"))),
            type,
            quality,
        )
    })
}

// =========================================================================
//  Supabase upload
// =========================================================================

export interface UploadOptions {
    bucket: "menu-images" | "tenant-logos" | "user-avatars"
    /** Object key under the bucket. Must start with the caller's tenant_id
     *  to satisfy the storage RLS policy (see migration 024). */
    path: string
    file: File | Blob
    /** Optional MIME type override (useful when uploading a Blob with no
     *  inherent type, e.g. from canvas). */
    contentType?: string
}

export interface UploadResult {
    publicUrl: string
    path: string
}

export async function uploadToStorage(
    supabase: SupabaseClient,
    opts: UploadOptions,
): Promise<UploadResult> {
    const { data, error } = await supabase.storage.from(opts.bucket).upload(opts.path, opts.file, {
        cacheControl: "31536000",                              // 1 year — paths embed a uuid so cache-bust is the new path
        upsert: true,
        contentType: opts.contentType ?? (opts.file instanceof File ? opts.file.type : "image/jpeg"),
    })
    if (error) throw new Error(`Upload failed: ${error.message}`)
    const finalPath = data.path
    const { data: pub } = supabase.storage.from(opts.bucket).getPublicUrl(finalPath)
    return { publicUrl: pub.publicUrl, path: finalPath }
}

/** Compress (if it's an image) then upload — convenience wrapper covering
 *  the path most callers want. Returns the public URL to save on the row. */
export async function compressAndUpload(
    supabase: SupabaseClient,
    file: File,
    opts: {
        bucket: "menu-images" | "tenant-logos" | "user-avatars"
        path: string
        compress?: CompressOptions | false
    },
): Promise<UploadResult & { compression: CompressResult | null }> {
    let toUpload: File | Blob = file
    let result: CompressResult | null = null
    if (opts.compress !== false && /^image\//.test(file.type)) {
        result = await compressImage(file, opts.compress ?? {})
        toUpload = result.blob
    }
    // Stamp the extension on the path based on what we actually upload —
    // the bucket cache and CDN sniff the URL's extension for image type.
    const ext = result?.mimeType === "image/png" ? ".png"
              : result?.mimeType === "image/jpeg" ? ".jpg"
              : /\.\w{2,4}$/.test(opts.path) ? "" : guessExt(file)
    const finalPath = ext && !opts.path.endsWith(ext) ? opts.path.replace(/\.[a-zA-Z0-9]+$/, "") + ext : opts.path
    const up = await uploadToStorage(supabase, {
        bucket: opts.bucket,
        path: finalPath,
        file: toUpload,
        contentType: result?.mimeType ?? file.type,
    })
    return { ...up, compression: result }
}

function guessExt(file: File): string {
    if (/png$/i.test(file.type)) return ".png"
    if (/jpe?g$/i.test(file.type)) return ".jpg"
    if (/webp$/i.test(file.type)) return ".webp"
    if (/gif$/i.test(file.type)) return ".gif"
    return ".jpg"
}

/** Extract the object path inside a Supabase Storage bucket from a public URL.
 *
 *  Supabase public URLs look like:
 *    `https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path...>`
 *
 *  We slice off everything up to and including the bucket segment and return
 *  the path the way the storage API expects it in `remove([...])`. Returns
 *  null if the URL doesn't look like a bucket URL — caller should treat that
 *  as "nothing to delete" rather than an error. */
export function pathFromPublicUrl(url: string | null | undefined, bucket: string): string | null {
    if (!url) return null
    const marker = `/storage/v1/object/public/${bucket}/`
    const i = url.indexOf(marker)
    if (i < 0) return null
    const path = url.slice(i + marker.length)
    // Strip query string (signed URL params, cache-busters) and trailing slash.
    return path.replace(/[?#].*$/, "").replace(/\/$/, "") || null
}

/** Delete one or more objects from a Supabase Storage bucket. Best-effort —
 *  storage failures shouldn't block the parent operation (e.g. menu-item
 *  archive succeeds even if the image cleanup hits a transient error).
 *  Returns the number of paths successfully removed. */
export async function deleteFromStorage(
    supabase: SupabaseClient,
    bucket: "menu-images" | "tenant-logos" | "user-avatars",
    paths: (string | null | undefined)[],
): Promise<number> {
    const clean = paths.filter((p): p is string => Boolean(p && p.trim()))
    if (clean.length === 0) return 0
    try {
        const { error } = await supabase.storage.from(bucket).remove(clean)
        if (error) {
            // eslint-disable-next-line no-console
            console.warn(`[storage] failed to remove ${clean.length} object(s) from ${bucket}:`, error.message)
            return 0
        }
        return clean.length
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[storage] remove threw for ${bucket}:`, e)
        return 0
    }
}

/** Build a tidy object key for a tenant-scoped upload. */
export function tenantImagePath(
    tenantId: string,
    kind: "logo" | "menu-item" | "menu-category",
    id: string,
): string {
    const uniq = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36)
    if (kind === "logo") return `${tenantId}/logo-${uniq}.jpg`
    if (kind === "menu-item") return `${tenantId}/items/${id}-${uniq}.jpg`
    return `${tenantId}/categories/${id}-${uniq}.jpg`
}
