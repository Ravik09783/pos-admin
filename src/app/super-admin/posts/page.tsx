import Link from "next/link"
import { ArrowLeft, Clock, Eye, Megaphone } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { formatDate } from "@/lib/utils"
import { RICH_TEXT_CLASS, sanitizeHtml } from "@/lib/post-html"
import { PostComposer, type TenantOption } from "./post-composer"

interface SentPost {
    id: string
    title: string
    body: string
    audience: "ALL" | "SPECIFIC"
    created_by: string | null
    created_at: string
    expires_at: string | null
    admin_post_targets: { tenant_id: string }[]
}

/**
 * Super-admin "Announcements" page — compose a markdown post, preview it,
 * pick the audience (all restaurants or a specific set), optionally set
 * an expiry, send, and review everything sent so far. Each sent post
 * links to its detail page (who has read it). Gated by
 * `super-admin/layout.tsx`.
 */
export default async function SuperAdminPostsPage() {
    const service = createServiceRoleClient()
    const [tenantsRes, postsRes] = await Promise.all([
        service.from("tenants").select("id, name, country").order("name", { ascending: true }),
        service
            .from("admin_posts")
            .select("id, title, body, audience, created_by, created_at, expires_at, admin_post_targets(tenant_id)")
            .order("created_at", { ascending: false })
            .limit(50),
    ])

    const tenants = (tenantsRes.data ?? []) as TenantOption[]
    const posts = (postsRes.data ?? []) as SentPost[]
    const postsUnavailable = !!postsRes.error

    return (
        <div className="container mx-auto px-4 py-8 space-y-6">
            <div>
                <Link
                    href="/super-admin"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ArrowLeft className="h-3 w-3" /> Back to console
                </Link>
                <h1 className="text-2xl font-bold tracking-tight mt-2">Announcements</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Send a message to one, several, or every restaurant on the platform.
                    Each restaurant sees it on their Announcements page.
                </p>
            </div>

            <PostComposer tenants={tenants} />

            {/* Sent history */}
            <div className="space-y-3">
                <h2 className="text-sm font-semibold flex items-center gap-1.5">
                    <Megaphone className="h-4 w-4" /> Sent announcements
                </h2>
                {postsUnavailable ? (
                    <Card className="border-warning/40 bg-warning/[0.04]">
                        <CardContent className="py-4 text-sm text-muted-foreground">
                            Announcements aren&apos;t enabled yet — apply migration 36{" "}
                            (<code className="text-xs">36_admin_posts.sql</code>, or re-apply{" "}
                            <code className="text-xs">combined_schema.sql</code>).
                        </CardContent>
                    </Card>
                ) : posts.length === 0 ? (
                    <Card>
                        <CardContent className="py-8 text-center text-sm text-muted-foreground">
                            No announcements sent yet.
                        </CardContent>
                    </Card>
                ) : (
                    posts.map((p) => (
                        <SentPostCard key={p.id} post={p} tenantCount={tenants.length} />
                    ))
                )}
            </div>
        </div>
    )
}

function SentPostCard({ post, tenantCount }: { post: SentPost; tenantCount: number }) {
    const targetCount = post.admin_post_targets?.length ?? 0
    const recipients = post.audience === "ALL"
        ? `All restaurants${tenantCount ? ` · ${tenantCount}` : ""}`
        : `${targetCount} restaurant${targetCount === 1 ? "" : "s"}`
    const expired = !!post.expires_at && new Date(post.expires_at).getTime() < Date.now()

    return (
        <Link href={`/super-admin/posts/${post.id}`} className="block">
            <Card className="transition-colors hover:border-primary/40">
                <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                        <div className="font-semibold">{post.title}</div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            {expired && (
                                <Badge variant="destructive" className="text-[10px]">Expired</Badge>
                            )}
                            <Badge
                                variant={post.audience === "ALL" ? "default" : "outline"}
                                className="text-[10px]"
                            >
                                {recipients}
                            </Badge>
                        </div>
                    </div>
                    <div
                        className={`${RICH_TEXT_CLASS} border-l-2 border-border/50 pl-3 max-h-40 overflow-hidden`}
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(post.body) }}
                    />
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>
                            Sent {formatDate(post.created_at, { dateStyle: "medium", timeStyle: "short" })}
                            {post.created_by ? ` · by ${post.created_by}` : ""}
                        </span>
                        {post.expires_at && (
                            <span className="inline-flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {expired ? "Expired" : "Expires"}{" "}
                                {formatDate(post.expires_at, { dateStyle: "medium" })}
                            </span>
                        )}
                        <span className="inline-flex items-center gap-1 text-primary">
                            <Eye className="h-3 w-3" /> View read receipts
                        </span>
                    </div>
                </CardContent>
            </Card>
        </Link>
    )
}
