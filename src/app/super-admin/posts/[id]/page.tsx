import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Clock, Eye } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { formatDate } from "@/lib/utils"
import { RICH_TEXT_CLASS, sanitizeHtml } from "@/lib/post-html"
import { DeletePostButton } from "./delete-post-button"

interface PostRow {
    id: string
    title: string
    body: string
    audience: "ALL" | "SPECIFIC"
    created_by: string | null
    created_at: string
    expires_at: string | null
    admin_post_targets: { tenant_id: string }[]
}

interface ReaderRow {
    read_at: string
    reader: {
        id: string
        full_name: string | null
        email: string | null
        restaurant: { name: string | null } | null
    } | null
}

/**
 * Super-admin post detail — shows one announcement and its read receipts:
 * which staff member, at which restaurant, opened it and when. Gated by
 * `super-admin/layout.tsx`; reads with the service-role client.
 */
export default async function SuperAdminPostDetailPage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    const service = createServiceRoleClient()

    const { data: postData, error: postErr } = await service
        .from("admin_posts")
        .select("id, title, body, audience, created_by, created_at, expires_at, admin_post_targets(tenant_id)")
        .eq("id", id)
        .maybeSingle()

    if (postErr) {
        return (
            <div className="container mx-auto px-4 py-8">
                <Card className="border-warning/40 bg-warning/[0.04]">
                    <CardContent className="py-6 text-sm text-muted-foreground">
                        Announcements aren&apos;t enabled yet — apply migration 36
                        (<code className="text-xs">36_admin_posts.sql</code>).
                    </CardContent>
                </Card>
            </div>
        )
    }
    if (!postData) notFound()
    const post = postData as PostRow

    const { data: readerData } = await service
        .from("admin_post_reads")
        .select("read_at, reader:users(id, full_name, email, restaurant:tenants(name))")
        .eq("post_id", id)
        .order("read_at", { ascending: false })
    // PostgREST returns these many-to-one embeds as objects at runtime;
    // the untyped client infers them as arrays, hence the unknown cast.
    const readers = (readerData ?? []) as unknown as ReaderRow[]

    const expired = !!post.expires_at && new Date(post.expires_at).getTime() < Date.now()
    const audienceLabel = post.audience === "ALL"
        ? "All restaurants"
        : `${post.admin_post_targets?.length ?? 0} restaurant${(post.admin_post_targets?.length ?? 0) === 1 ? "" : "s"}`

    return (
        <div className="container mx-auto px-4 py-8 space-y-6">
            <div className="flex items-center justify-between gap-3">
                <Link
                    href="/super-admin/posts"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ArrowLeft className="h-3 w-3" /> Back to announcements
                </Link>
                <DeletePostButton postId={post.id} postTitle={post.title} />
            </div>

            {/* The post */}
            <Card>
                <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                        <h1 className="text-xl font-bold tracking-tight">{post.title}</h1>
                        <div className="flex items-center gap-1.5 shrink-0">
                            {expired && (
                                <Badge variant="destructive" className="text-[10px]">Expired</Badge>
                            )}
                            <Badge
                                variant={post.audience === "ALL" ? "default" : "outline"}
                                className="text-[10px]"
                            >
                                {audienceLabel}
                            </Badge>
                        </div>
                    </div>
                    <div
                        className={RICH_TEXT_CLASS}
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(post.body) }}
                    />
                    <Separator />
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                        <span>
                            Sent {formatDate(post.created_at, { dateStyle: "long", timeStyle: "short" })}
                            {post.created_by ? ` · by ${post.created_by}` : ""}
                        </span>
                        <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {post.expires_at
                                ? `${expired ? "Expired" : "Expires"} ${formatDate(post.expires_at, { dateStyle: "long" })}`
                                : "No expiry"}
                        </span>
                    </div>
                </CardContent>
            </Card>

            {/* Read receipts */}
            <div className="space-y-3">
                <h2 className="text-sm font-semibold flex items-center gap-1.5">
                    <Eye className="h-4 w-4" />
                    Seen by {readers.length} {readers.length === 1 ? "person" : "people"}
                </h2>
                <Card className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Restaurant</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Seen at</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {readers.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center text-muted-foreground py-10">
                                        No one has opened this announcement yet.
                                    </TableCell>
                                </TableRow>
                            ) : readers.map((r, i) => (
                                <TableRow key={r.reader?.id ?? i}>
                                    <TableCell className="font-medium">
                                        {r.reader?.restaurant?.name ?? "—"}
                                    </TableCell>
                                    <TableCell>{r.reader?.full_name ?? "—"}</TableCell>
                                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                                        {r.reader?.email ?? "—"}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                        {formatDate(r.read_at, { dateStyle: "medium", timeStyle: "short" })}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Card>
            </div>
        </div>
    )
}
