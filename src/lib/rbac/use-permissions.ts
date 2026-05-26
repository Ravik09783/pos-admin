"use client"

/**
 * Client hook that resolves what the SIGNED-IN user can do — their role
 * combined with the absolute permission whitelist on their assigned
 * role template. See `supabase/migrations/_backup_2026-05-20/47_role_templates.sql`.
 *
 * Single source of truth for the front-end. Wire it into nav filtering,
 * card visibility on the launcher, and any place else where a permission
 * check used to call `can(role, perm)` directly.
 */

import { useEffect, useMemo, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { canWithTemplate, type Permission } from "./permissions"
import type { UserRole } from "@/types/database"

export interface MyPermissionsResult {
    role: UserRole | null
    /** Name of the assigned role template, if any. Useful in the topbar
     *  ("signed in as Floor Manager"). */
    templateName: string | null
    /** Absolute whitelist of permissions from the assigned template.
     *  Null when the user has no template — caller should treat that as
     *  "use the role default". */
    templatePermissions: readonly Permission[] | null
    /** Template-aware permission check. */
    can: (p: Permission) => boolean
    /** True until the initial fetch completes; lets callers avoid a brief
     *  "everything hidden" flash before role/template arrive. */
    loading: boolean
}

export function useMyPermissions(): MyPermissionsResult {
    const [role, setRole] = useState<UserRole | null>(null)
    const [templateName, setTemplateName] = useState<string | null>(null)
    const [templatePermissions, setTemplatePermissions] = useState<readonly Permission[] | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const supabase = createClient()
        let cancelled = false
        ;(async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (cancelled) return
            if (!user) {
                setRole(null)
                setTemplateName(null)
                setTemplatePermissions(null)
                setLoading(false)
                return
            }
            // One round-trip via an embed: pull the user's role plus their
            // assigned template's name + permissions in one read. RLS on
            // role_templates lets every tenant member SELECT, so this is
            // safe through the regular client.
            const { data } = await supabase
                .from("users")
                .select("role, role_template:role_templates!users_role_template_id_fkey(name, permissions)")
                .eq("id", user.id)
                .maybeSingle() as { data: UserWithTemplate | null }
            if (cancelled) return
            const r = data?.role ?? null
            const tpl = Array.isArray(data?.role_template) ? data?.role_template[0] : data?.role_template
            setRole(r)
            setTemplateName(tpl?.name ?? null)
            setTemplatePermissions(
                Array.isArray(tpl?.permissions) ? (tpl?.permissions as Permission[]) : null,
            )
            setLoading(false)
        })()
        return () => { cancelled = true }
    }, [])

    const check = useMemo(
        () => (p: Permission) => canWithTemplate(role, p, templatePermissions ?? undefined),
        [role, templatePermissions],
    )
    return { role, templateName, templatePermissions, can: check, loading }
}

interface UserWithTemplate {
    role: UserRole | null
    role_template: { name: string | null; permissions: string[] | null } | { name: string | null; permissions: string[] | null }[] | null
}
