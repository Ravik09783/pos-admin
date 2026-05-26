import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"

export async function createClient() {
    const cookieStore = await cookies()

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options),
                        )
                    } catch {
                        // setAll() is a no-op in Server Components; the middleware
                        // refreshes the session, so silently ignore.
                    }
                },
            },
        },
    )
}

export function createServiceRoleClient() {
    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
            cookies: { getAll: () => [], setAll: () => {} },
            auth: { persistSession: false },
        },
    )
}
