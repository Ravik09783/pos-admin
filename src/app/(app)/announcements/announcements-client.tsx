"use client"

import { useEffect, useRef, useState } from "react"
import { Megaphone } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/app-shell/page-header"
import { refreshUnreadPosts } from "@/components/app-shell/nav"
import { createClient } from "@/lib/supabase/client"
import { formatDate, timeAgo } from "@/lib/utils"
import { RICH_TEXT_CLASS, sanitizeHtml } from "@/lib/post-html"

export interface AnnouncementPost {
    id: string
    title: string
    body: string
    created_at: string
    is_read: boolean
}

/**
 * Renders the tenant's announcement posts and marks the unread ones read
 * the moment the page is viewed — viewing the list IS reading them.
 * After marking, it refreshes the sidebar's unread badge.
 *
 * The unread highlight on each card uses the read state from the initial
 * server fetch, so "New" stays visible for this visit even as the read
 * receipts are written in the background.
 */
export function AnnouncementsClient({
    posts,
    unavailable,
}: {
    posts: AnnouncementPost[]
    unavailable: boolean
}) {
    const marked = useRef(false)

    // "now" drives the relative "x ago" label. Null on the server + first
    // client paint so SSR and hydration agree (no relative text yet); set
    // after mount, then ticked every minute so "2 minutes ago" stays fresh.
    const [now, setNow] = useState<Date | null>(null)
    useEffect(() => {
        setNow(new Date())
        const id = window.setInterval(() => setNow(new Date()), 60_000)
        return () => window.clearInterval(id)
    }, [])

    useEffect(() => {
        if (marked.current) return
        marked.current = true
        const unread = posts.filter((p) => !p.is_read)
        if (unread.length === 0) return
        const supabase = createClient()
        void (async () => {
            await Promise.all(
                unread.map((p) =>
                    supabase.rpc("mark_admin_post_read" as never, { p_post_id: p.id } as never),
                ),
            )
            // Drop the sidebar unread badge to reflect what was just read.
            void refreshUnreadPosts()
        })()
    }, [posts])

    return (
        <div className="container mx-auto px-4 py-6 space-y-6">
            <PageHeader
                kicker="Updates"
                title="Announcements"
                description="Messages and product updates from the RestoPOS team."
            />

            {unavailable ? (
                <Card>
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">
                        Announcements aren&apos;t available right now.
                    </CardContent>
                </Card>
            ) : posts.length === 0 ? (
                <Card>
                    <CardContent className="py-14 text-center text-sm text-muted-foreground">
                        <Megaphone className="h-8 w-8 mx-auto mb-3 opacity-40" />
                        No announcements yet. Platform updates and messages will show up here.
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {posts.map((p) => (
                        <Card key={p.id} className={p.is_read ? undefined : "border-primary/40"}>
                            <CardContent className="p-5 space-y-2">
                                <div className="flex items-start justify-between gap-3">
                                    <h2 className="font-semibold text-base">{p.title}</h2>
                                    {!p.is_read && (
                                        <Badge variant="default" className="text-[10px] shrink-0">New</Badge>
                                    )}
                                </div>
                                <div
                                    className={RICH_TEXT_CLASS}
                                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(p.body) }}
                                />
                                <div className="text-[11px] text-muted-foreground pt-1">
                                    Posted {formatDate(p.created_at, { dateStyle: "long", timeStyle: "short" })}
                                    {now && (
                                        <span className="text-muted-foreground/80">
                                            {" · "}{timeAgo(p.created_at, now)}
                                        </span>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}
