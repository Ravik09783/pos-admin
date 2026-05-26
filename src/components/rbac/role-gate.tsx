"use client"

import { useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { can, type Permission } from "@/lib/rbac/permissions"
import type { UserRole } from "@/types/database"

/**
 * Client-side permission gate. Hides children unless the signed-in user's
 * role grants the given permission. The RLS policies in Postgres are the
 * real authority — this just avoids showing buttons that would 403 anyway.
 *
 * Pass `fallback` to render a read-only label or upsell instead of nothing.
 */
export function RoleGate({
    permission,
    children,
    fallback = null,
}: {
    permission: Permission
    children: React.ReactNode
    fallback?: React.ReactNode
}) {
    const role = useCurrentRole()
    if (role === undefined) return null // still loading — render nothing
    return can(role, permission) ? <>{children}</> : <>{fallback}</>
}

/** Hook for inline conditionals: `const canEdit = useCan("menu.write")`. */
export function useCan(permission: Permission): boolean {
    const role = useCurrentRole()
    return can(role ?? null, permission)
}

/**
 * Reads the current user's role from public.users. Cached at the module
 * level for the lifetime of the page so multiple gates don't refetch.
 */
let cachedRole: UserRole | null | undefined = undefined
const subscribers = new Set<(r: UserRole | null) => void>()

export function useCurrentRole(): UserRole | null | undefined {
    const [role, setRole] = useState<UserRole | null | undefined>(cachedRole)

    useEffect(() => {
        if (cachedRole !== undefined) return
        const supabase = createClient()
        let mounted = true
        ;(async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                cachedRole = null
                if (mounted) setRole(null)
                subscribers.forEach((fn) => fn(null))
                return
            }
            const { data } = await supabase
                .from("users")
                .select("role")
                .eq("id", user.id)
                .maybeSingle()
            const r = (data?.role as UserRole | undefined) ?? null
            cachedRole = r
            if (mounted) setRole(r)
            subscribers.forEach((fn) => fn(r))
        })()
        const sub = (r: UserRole | null) => mounted && setRole(r)
        subscribers.add(sub)
        return () => {
            mounted = false
            subscribers.delete(sub)
        }
    }, [])

    return role
}
