/**
 * Structured error logger.
 *
 * Output today:
 *   1. JSON-shaped console output (always on) — pickup-friendly for any log
 *      scraper (Vercel Logs, Datadog, Logtail, Cloud Run, …).
 *   2. Optional Sentry forwarding — lazy-loaded ONLY if `@sentry/nextjs` is
 *      installed AND `NEXT_PUBLIC_SENTRY_DSN` is set. The lazy import means
 *      this module compiles + ships fine with the Sentry dep absent; no
 *      "Cannot find module" errors. Add the dep when you're ready:
 *
 *          npm install @sentry/nextjs
 *          # set NEXT_PUBLIC_SENTRY_DSN in your env
 *          npx @sentry/wizard@latest -i nextjs   # optional, generates configs
 *
 * Once installed + DSN-set, every `logError()` call also captures to Sentry
 * with the structured context attached — no code changes needed at the
 * call sites.
 *
 * Usage:
 *   logError(err, { route: "/api/webhooks/phonepe", tenantId, eventId })
 */

export interface LogContext {
    [key: string]: unknown
    route?: string
    userId?: string
    tenantId?: string
    requestId?: string
}

// ── Sentry hook (lazy + optional) ─────────────────────────────────────────
type SentryLike = {
    captureException: (e: unknown, hint?: { extra?: Record<string, unknown>; tags?: Record<string, string> }) => unknown
    captureMessage:   (m: string,    hint?: { level?: string; extra?: Record<string, unknown> }) => unknown
}
let sentry: SentryLike | null = null
let sentryProbed = false

async function getSentry(): Promise<SentryLike | null> {
    if (sentryProbed) return sentry
    sentryProbed = true
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return null
    try {
        // The package name is assembled at runtime so Vite / webpack /
        // Turbopack can't try to resolve it statically. Without this
        // indirection the test runner fails to even load this file when
        // `@sentry/nextjs` isn't installed. If the package IS installed
        // the dynamic import works normally.
        const name: string = ["@sentry", "nextjs"].join("/")
        const mod = (await import(/* @vite-ignore */ /* webpackIgnore: true */ name)) as unknown as SentryLike
        sentry = mod
    } catch {
        // Dep not installed — silently fall through to console-only logging.
        sentry = null
    }
    return sentry
}

// ── Public API ────────────────────────────────────────────────────────────

export function logError(error: unknown, context: LogContext = {}): void {
    const requestId = context.requestId ?? cryptoRandom()
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    const payload = { level: "error", message, stack, ...context, requestId, ts: new Date().toISOString() }
    // eslint-disable-next-line no-console
    console.error("[restopos:error]", JSON.stringify(payload))

    // Forward to Sentry if available. Fire-and-forget — don't await; we
    // never want telemetry to slow down the caller.
    void getSentry().then((s) => {
        if (!s) return
        try {
            s.captureException(error, {
                extra: { ...context, requestId },
                tags: {
                    ...(context.route ? { route: String(context.route) } : {}),
                    ...(context.tenantId ? { tenant_id: String(context.tenantId) } : {}),
                },
            })
        } catch { /* best effort */ }
    })
}

export function logWarn(message: string, context: LogContext = {}): void {
    const payload = { level: "warn", message, ...context, ts: new Date().toISOString() }
    // eslint-disable-next-line no-console
    console.warn("[restopos:warn]", JSON.stringify(payload))

    void getSentry().then((s) => {
        if (!s) return
        try { s.captureMessage(message, { level: "warning", extra: context }) } catch { /* */ }
    })
}

export function logInfo(message: string, context: LogContext = {}): void {
    const payload = { level: "info", message, ...context, ts: new Date().toISOString() }
    // eslint-disable-next-line no-console
    console.log("[restopos:info]", JSON.stringify(payload))
}

function cryptoRandom(): string {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
    return Math.random().toString(36).slice(2, 12)
}
