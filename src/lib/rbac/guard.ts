import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { canWithTemplate, type Permission } from "./permissions"
import type { UserRole } from "@/types/database"

/**
 * Server-side route guard. Call at the top of a page/layout's `default`
 * export to refuse rendering for users whose assigned role template
 * doesn't include the given permission. Pairs with RLS — RLS is the
 * real fence, this just gives a friendlier UX than letting users land
 * on a page that 403s everything.
 *
 * Resolution rule (matches `canWithTemplate`): if the user has a
 * `role_template_id`, the template's permissions are absolute. If not,
 * fall back to the role default — only happens for unmigrated rows
 * since migration 47 backfills every user with a template.
 *
 * Returns the user's role on success.
 */
export async function requirePermission(permission: Permission): Promise<UserRole> {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) redirect("/login")

    const { data: appUser } = await supabase
        .from("users")
        .select("role, tenant_id, role_template:role_templates!users_role_template_id_fkey(permissions)")
        .eq("id", user.id)
        .maybeSingle() as { data: UserWithTemplateRow | null }

    const role = (appUser?.role as UserRole | undefined) ?? null
    const tpl = Array.isArray(appUser?.role_template)
        ? appUser?.role_template[0]
        : appUser?.role_template
    const perms = Array.isArray(tpl?.permissions) ? tpl?.permissions : null

    if (!appUser?.tenant_id) redirect("/onboarding")
    if (!canWithTemplate(role, permission, perms)) redirect("/dashboard")

    return role as UserRole
}

/** Variant that returns the role without redirecting, for conditional rendering. */
export async function getCurrentRole(): Promise<UserRole | null> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle()
    return (data?.role as UserRole | undefined) ?? null
}

interface UserWithTemplateRow {
    role: UserRole | null
    tenant_id: string | null
    role_template: { permissions: string[] | null } | { permissions: string[] | null }[] | null
}
