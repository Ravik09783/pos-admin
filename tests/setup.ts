// Global test setup. Stubs env vars that downstream modules expect at
// import time (Supabase client construction, Razorpay creds, etc.) so
// pure-logic tests don't need a real .env.
import { vi } from "vitest"

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://test.supabase.co"
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "test-anon-key"
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key"

// Next's `unstable_cache` needs a request/incrementalCache context that Vitest
// doesn't provide — calling a cached route handler under test otherwise throws
// "Invariant: incrementalCache missing in unstable_cache". Mock next/cache so
// the cache wrapper just runs the underlying function directly.
vi.mock("next/cache", () => ({
    unstable_cache: <A extends unknown[], R>(fn: (...args: A) => R) => fn,
    revalidateTag: () => {},
    revalidatePath: () => {},
    unstable_noStore: () => {},
}))
