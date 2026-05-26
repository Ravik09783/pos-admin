import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

/**
 * Supabase client wired up for Next.js middleware.
 *
 * Reads cookies from the incoming request and writes any refreshed
 * session cookies onto a `NextResponse` we hand back to the caller.
 * The caller MUST return the returned `response` (or copy its cookies)
 * so the rotated tokens reach the browser — otherwise the session
 * silently expires faster than necessary.
 */
export function createMiddlewareClient(req: NextRequest) {
    let response = NextResponse.next({ request: req })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return req.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    // Apply cookies onto both the incoming request (so any
                    // downstream auth.getUser() in the same middleware
                    // invocation sees them) and the outgoing response (so
                    // the browser receives them).
                    cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
                    response = NextResponse.next({ request: req })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options),
                    )
                },
            },
        },
    )

    return { supabase, response }
}
