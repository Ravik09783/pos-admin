/**
 * HTML helpers for announcement-post bodies.
 *
 * A post body is authored as HTML by a super-admin (a trusted, fully-
 * privileged role) but rendered in restaurant users' browsers — so
 * `sanitizeHtml` is defence-in-depth, not a hard security boundary. It is
 * pure string work (no DOMParser), so it runs identically on the server
 * and the client and the same cleaned markup is shown everywhere.
 */

/**
 * Strip the genuinely dangerous bits out of admin-authored HTML while
 * leaving all formatting tags (<b>, <h2>, <ul>, <a>, <img>, <table>, …)
 * intact, so the admin keeps full HTML expressiveness.
 *
 * Removes: <script>/<style>/<iframe>/<object>/<embed>/<noscript> blocks
 * and stray <link>/<meta>/<base>/<form>/<input>/<button> tags; inline
 * event-handler attributes (onclick, onerror, …); and javascript:/
 * vbscript: URLs in href/src.
 */
export function sanitizeHtml(html: string | null | undefined): string {
    if (!html) return ""
    let s = String(html)
    // Whole dangerous blocks — opening tag through matching close.
    s = s.replace(/<(script|style|iframe|object|embed|noscript)\b[\s\S]*?<\/\1\s*>/gi, "")
    // Any leftover or self-closing dangerous tags.
    s = s.replace(
        /<\/?(script|style|iframe|object|embed|noscript|link|meta|base|form|input|button|textarea)\b[^>]*>/gi,
        "",
    )
    // Inline event-handler attributes: onclick="…", onerror='…', onload=… .
    s = s.replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    s = s.replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    s = s.replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    // Neutralise script-y URL schemes in href/src.
    s = s.replace(/(\s(?:href|src)\s*=\s*)"\s*(?:javascript|vbscript):[^"]*"/gi, '$1"#"')
    s = s.replace(/(\s(?:href|src)\s*=\s*)'\s*(?:javascript|vbscript):[^']*'/gi, "$1'#'")
    return s
}

/**
 * Pull the storage object paths of post-bucket images referenced in an
 * HTML body. Used when a post is deleted, to clean its images out of the
 * `admin-post-images` bucket.
 */
export function extractStoredImagePaths(html: string | null | undefined): string[] {
    if (!html) return []
    const out: string[] = []
    const re = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi
    const marker = "/admin-post-images/"
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) !== null) {
        const idx = m[1].indexOf(marker)
        if (idx >= 0) {
            const path = m[1].slice(idx + marker.length).split(/[?#]/)[0]
            if (path) out.push(decodeURIComponent(path))
        }
    }
    return out
}

/**
 * Tailwind classes for a container holding a post body — keeps the
 * rendered HTML readable and on-theme. Shared by the composer preview,
 * the restaurant Announcements page, and the super-admin views.
 */
export const RICH_TEXT_CLASS =
    "text-sm leading-relaxed space-y-2 break-words " +
    "[&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-1 " +
    "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-1 " +
    "[&_h3]:text-sm [&_h3]:font-semibold " +
    "[&_p]:text-sm " +
    "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-0.5 " +
    "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-0.5 " +
    "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 " +
    "[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-mono " +
    "[&_pre]:bg-muted [&_pre]:rounded [&_pre]:p-3 [&_pre]:overflow-auto [&_pre]:text-xs " +
    "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground " +
    "[&_hr]:border-border [&_hr]:my-3 " +
    "[&_img]:max-w-full [&_img]:rounded-md [&_img]:my-2 " +
    "[&_strong]:font-semibold [&_b]:font-semibold " +
    "[&_table]:w-full [&_table]:text-xs " +
    "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 " +
    "[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-muted/50"
