import { redirect } from "next/navigation"

import { getCurrentUserAndTenant } from "@/lib/auth/current-user"
import { AnnouncementsClient, type AnnouncementPost } from "./announcements-client"

/**
 * Restaurant-facing Announcements page — lists the platform posts a
 * super-admin has sent to this tenant (broadcast to all, or targeted).
 *
 * Server shell: resolves the authenticated user, then calls the
 * `my_admin_posts` RPC (migration 36) which returns the posts visible to
 * this tenant with a per-user read flag. The client component renders
 * the markdown and marks unread posts read on view.
 */
export default async function AnnouncementsPage() {
    const { user, appUser, supabase } = await getCurrentUserAndTenant()
    if (!user) redirect("/login")
    if (!appUser?.tenant_id) redirect("/onboarding")

    const { data, error } = await supabase.rpc("my_admin_posts" as never)
    const posts = error ? [] : ((data ?? []) as AnnouncementPost[])

    return <AnnouncementsClient posts={posts} unavailable={!!error} />
}
