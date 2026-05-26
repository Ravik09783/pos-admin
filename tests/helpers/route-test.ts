import { vi } from "vitest"

import { MockSupabase } from "./supabase-mock"

/**
 * Per-test Supabase mock factory. Call this BEFORE importing the route under
 * test — it stubs `@/lib/supabase/server` so the route gets our in-memory
 * client instead of a real Supabase connection.
 *
 * Returns the mock instance so the test can seed tables, install RPC stubs,
 * and assert on lastInsert / lastUpdate.
 */
export function mockSupabase(): MockSupabase {
    const db = new MockSupabase()
    vi.doMock("@/lib/supabase/server", () => ({
        createServiceRoleClient: () => db,
        createClient: () => db,
    }))
    return db
}

/** Reset all module-mock state between tests. */
export function resetMocks() {
    vi.resetModules()
    vi.clearAllMocks()
}
