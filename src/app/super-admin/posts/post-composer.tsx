"use client"

import { useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
    AlertCircle, Bold, Check, Clock, Code, Eye, Heading2, ImagePlus, Italic,
    Link2, List, Loader2, Search, Send, Users,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { RICH_TEXT_CLASS, sanitizeHtml } from "@/lib/post-html"

export interface TenantOption {
    id: string
    name: string | null
    country: string | null
}

/**
 * Super-admin announcement composer: an HTML editor with a formatting
 * toolbar, inline image upload, and a live preview, an audience picker
 * (every restaurant or a specific set), an optional expiry date, and a
 * "review & send" confirmation step so the post is checked before it
 * goes out.
 *
 * The body is raw HTML — the admin can use the toolbar or hand-write any
 * markup. The preview (and everywhere the post is shown) runs it through
 * `sanitizeHtml` first.
 */
export function PostComposer({ tenants }: { tenants: TenantOption[] }) {
    const router = useRouter()
    const bodyRef = useRef<HTMLTextAreaElement>(null)
    const fileRef = useRef<HTMLInputElement>(null)

    const [title, setTitle] = useState("")
    const [body, setBody] = useState("")
    const [audience, setAudience] = useState<"ALL" | "SPECIFIC">("ALL")
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [search, setSearch] = useState("")
    const [expiresAt, setExpiresAt] = useState("")
    const [confirmOpen, setConfirmOpen] = useState(false)
    const [sending, setSending] = useState(false)
    const [uploading, setUploading] = useState(false)

    const todayIso = new Date().toISOString().slice(0, 10)
    const previewHtml = useMemo(() => sanitizeHtml(body), [body])
    const recipientCount = audience === "ALL" ? tenants.length : selected.size
    const canSend =
        title.trim().length > 0 &&
        body.trim().length > 0 &&
        (audience === "ALL" || selected.size > 0)

    // What's still missing — surfaced next to the button AND on click, so
    // a not-yet-ready "Review & send" is never an unexplained dead end.
    const missingReason =
        !title.trim() ? "Add a title to send this announcement"
        : !body.trim() ? "Write a message to send this announcement"
        : audience === "SPECIFIC" && selected.size === 0
            ? "Pick at least one restaurant — or choose “Every restaurant”"
            : null

    const filteredTenants = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return tenants
        return tenants.filter((t) =>
            [t.name, t.country].some((v) => v?.toLowerCase().includes(q)),
        )
    }, [tenants, search])

    function toggleTenant(id: string) {
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    // ── Editor helpers ─────────────────────────────────────────────────
    function wrapSelection(before: string, after: string, placeholder: string) {
        const ta = bodyRef.current
        if (!ta) return
        const start = ta.selectionStart
        const end = ta.selectionEnd
        const sel = body.slice(start, end) || placeholder
        const next = body.slice(0, start) + before + sel + after + body.slice(end)
        setBody(next)
        requestAnimationFrame(() => {
            ta.focus()
            ta.setSelectionRange(start + before.length, start + before.length + sel.length)
        })
    }

    function insertAtCursor(snippet: string) {
        const ta = bodyRef.current
        if (!ta) { setBody((b) => b + snippet); return }
        const start = ta.selectionStart
        const end = ta.selectionEnd
        const next = body.slice(0, start) + snippet + body.slice(end)
        setBody(next)
        requestAnimationFrame(() => {
            ta.focus()
            ta.setSelectionRange(start + snippet.length, start + snippet.length)
        })
    }

    async function onImageSelected(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        e.target.value = "" // let the same file be picked again later
        if (!file) return
        setUploading(true)
        try {
            const form = new FormData()
            form.append("file", file)
            const r = await fetch("/api/super-admin/posts/upload-image", {
                method: "POST",
                body: form,
            })
            const data = await r.json() as { ok?: boolean; url?: string; error?: string }
            if (!r.ok || !data.ok || !data.url) throw new Error(data.error ?? "Upload failed")
            insertAtCursor(`\n<img src="${data.url}" alt="" />\n`)
            toast.success("Image uploaded and inserted")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Image upload failed")
        } finally {
            setUploading(false)
        }
    }

    async function send() {
        setSending(true)
        try {
            const r = await fetch("/api/super-admin/posts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: title.trim(),
                    body: body.trim(),
                    audience,
                    tenant_ids: audience === "SPECIFIC" ? [...selected] : [],
                    expires_at: expiresAt || null,
                }),
            })
            const data = await r.json() as { ok?: boolean; error?: string; recipient_count?: number }
            if (!r.ok || !data.ok) throw new Error(data.error ?? "Failed to send post")
            const n = data.recipient_count ?? recipientCount
            toast.success(`Announcement sent to ${n} restaurant${n === 1 ? "" : "s"}`)
            setTitle("")
            setBody("")
            setAudience("ALL")
            setSelected(new Set())
            setSearch("")
            setExpiresAt("")
            setConfirmOpen(false)
            router.refresh()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to send post")
        } finally {
            setSending(false)
        }
    }

    /** Validate before opening the review dialog. The button stays
     *  clickable so the user always gets a clear reason — never a dead,
     *  unexplained "Review & send". */
    function handleReviewClick() {
        if (missingReason) {
            toast.error(missingReason)
            return
        }
        setConfirmOpen(true)
    }

    return (
        <Card>
            <CardContent className="p-5 space-y-4">
                {/* Title */}
                <div className="space-y-1.5">
                    <Label htmlFor="post-title">Title <span className="text-destructive">*</span></Label>
                    <Input
                        id="post-title"
                        placeholder="e.g. New feature: bulk menu import"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        disabled={sending}
                    />
                </div>

                {/* Editor + live preview */}
                <div className="space-y-1.5">
                    <Label>Message</Label>
                    <div className="grid lg:grid-cols-2 gap-3">
                        {/* Editor */}
                        <div className="rounded-md border border-border/60 overflow-hidden">
                            <div className="flex items-center gap-0.5 border-b border-border/60 bg-muted/30 px-1.5 py-1">
                                <ToolbarButton label="Bold" onClick={() => wrapSelection("<strong>", "</strong>", "bold text")}>
                                    <Bold className="h-3.5 w-3.5" />
                                </ToolbarButton>
                                <ToolbarButton label="Italic" onClick={() => wrapSelection("<em>", "</em>", "italic text")}>
                                    <Italic className="h-3.5 w-3.5" />
                                </ToolbarButton>
                                <ToolbarButton label="Heading" onClick={() => wrapSelection("<h2>", "</h2>", "Heading")}>
                                    <Heading2 className="h-3.5 w-3.5" />
                                </ToolbarButton>
                                <ToolbarButton
                                    label="Bullet list"
                                    onClick={() => insertAtCursor("\n<ul>\n  <li>First item</li>\n  <li>Second item</li>\n</ul>\n")}
                                >
                                    <List className="h-3.5 w-3.5" />
                                </ToolbarButton>
                                <ToolbarButton
                                    label="Link"
                                    onClick={() => wrapSelection('<a href="https://example.com">', "</a>", "link text")}
                                >
                                    <Link2 className="h-3.5 w-3.5" />
                                </ToolbarButton>
                                <ToolbarButton
                                    label={uploading ? "Uploading…" : "Insert image"}
                                    onClick={() => fileRef.current?.click()}
                                    disabled={uploading}
                                >
                                    {uploading
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <ImagePlus className="h-3.5 w-3.5" />}
                                </ToolbarButton>
                                <span className="ml-auto pr-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                    <Code className="h-3 w-3" /> HTML
                                </span>
                            </div>
                            <textarea
                                ref={bodyRef}
                                value={body}
                                onChange={(e) => setBody(e.target.value)}
                                disabled={sending}
                                spellCheck={false}
                                placeholder={"Write your announcement in HTML…\n\n<h2>Heading</h2>\n<p>A paragraph with <strong>bold</strong> text and a <a href=\"https://example.com\">link</a>.</p>\n<ul>\n  <li>A bullet point</li>\n</ul>"}
                                className="w-full h-72 resize-y bg-transparent px-3 py-2 text-xs font-mono outline-none placeholder:text-muted-foreground/60"
                            />
                            <input
                                ref={fileRef}
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/gif"
                                className="hidden"
                                onChange={onImageSelected}
                            />
                        </div>
                        {/* Live preview */}
                        <div className="rounded-md border border-border/60 overflow-hidden flex flex-col">
                            <div className="flex items-center gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                <Eye className="h-3 w-3" /> Live preview
                            </div>
                            <div className="p-3 overflow-auto flex-1">
                                {body.trim() ? (
                                    <>
                                        {title.trim() && (
                                            <div className="font-semibold text-base mb-1.5">{title}</div>
                                        )}
                                        <div
                                            className={RICH_TEXT_CLASS}
                                            dangerouslySetInnerHTML={{ __html: previewHtml }}
                                        />
                                    </>
                                ) : (
                                    <p className="text-sm text-muted-foreground/70">
                                        Your formatted post appears here as you type.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Write HTML directly, or use the toolbar. The <strong>image</strong> button uploads
                        a picture and drops it in. Scripts and event handlers are stripped on send.
                    </p>
                </div>

                {/* Audience */}
                <div className="space-y-1.5">
                    <Label>Send to</Label>
                    <div className="flex flex-wrap gap-2">
                        <AudienceChip
                            active={audience === "ALL"}
                            onClick={() => setAudience("ALL")}
                            disabled={sending}
                        >
                            Every restaurant
                            <span className="text-[10px] text-muted-foreground ml-1.5">({tenants.length})</span>
                        </AudienceChip>
                        <AudienceChip
                            active={audience === "SPECIFIC"}
                            onClick={() => setAudience("SPECIFIC")}
                            disabled={sending}
                        >
                            Specific restaurants
                            {audience === "SPECIFIC" && selected.size > 0 && (
                                <span className="text-[10px] text-muted-foreground ml-1.5">({selected.size})</span>
                            )}
                        </AudienceChip>
                    </div>
                </div>

                {/* Recipient picker */}
                {audience === "SPECIFIC" && (
                    <div className="space-y-2 rounded-md border border-border/60 p-3">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search restaurants…"
                                className="pl-8"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                disabled={sending}
                            />
                        </div>
                        <div className="max-h-56 overflow-auto rounded-md border border-border/40 divide-y divide-border/30">
                            {filteredTenants.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-6">
                                    No restaurants match.
                                </p>
                            ) : filteredTenants.map((t) => {
                                const on = selected.has(t.id)
                                return (
                                    <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => toggleTenant(t.id)}
                                        disabled={sending}
                                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted/40 transition-colors"
                                    >
                                        <span className={cn(
                                            "grid place-items-center h-4 w-4 rounded border shrink-0",
                                            on ? "bg-primary border-primary text-primary-foreground" : "border-border",
                                        )}>
                                            {on && <Check className="h-3 w-3" />}
                                        </span>
                                        <span className="flex-1 truncate">{t.name ?? "(unnamed)"}</span>
                                        {t.country && (
                                            <span className="text-[11px] text-muted-foreground shrink-0">{t.country}</span>
                                        )}
                                    </button>
                                )
                            })}
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{selected.size} selected</span>
                            {selected.size > 0 && (
                                <button
                                    type="button"
                                    className="hover:text-foreground underline"
                                    onClick={() => setSelected(new Set())}
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Expiry */}
                <div className="space-y-1.5">
                    <Label htmlFor="post-expiry">
                        Expiry date <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <div className="flex items-center gap-2">
                        <Input
                            id="post-expiry"
                            type="date"
                            className="w-44"
                            min={todayIso}
                            value={expiresAt}
                            onChange={(e) => setExpiresAt(e.target.value)}
                            disabled={sending}
                        />
                        {expiresAt && (
                            <button
                                type="button"
                                className="text-xs text-muted-foreground hover:text-foreground underline"
                                onClick={() => setExpiresAt("")}
                                disabled={sending}
                            >
                                Clear
                            </button>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        After this date the post stops showing to restaurants. Leave blank to keep it indefinitely.
                    </p>
                </div>

                {/* Send */}
                <div className="flex items-center justify-between gap-3 pt-1">
                    <p className={cn(
                        "text-xs flex items-center gap-1.5",
                        missingReason ? "text-warning" : "text-muted-foreground",
                    )}>
                        {missingReason ? (
                            <>
                                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                {missingReason}
                            </>
                        ) : (
                            <>
                                <Users className="h-3.5 w-3.5" />
                                {audience === "ALL"
                                    ? `Goes to all ${tenants.length} restaurant${tenants.length === 1 ? "" : "s"}`
                                    : `${selected.size} restaurant${selected.size === 1 ? "" : "s"} selected`}
                            </>
                        )}
                    </p>
                    <Button disabled={sending} onClick={handleReviewClick}>
                        <Eye className="h-4 w-4" />
                        Review &amp; send
                    </Button>
                </div>
            </CardContent>

            {/* Review-and-send confirmation */}
            <Dialog open={confirmOpen} onOpenChange={(o) => { if (!sending) setConfirmOpen(o) }}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Send this announcement?</DialogTitle>
                        <DialogDescription>
                            Going to{" "}
                            <span className="font-medium text-foreground">
                                {audience === "ALL"
                                    ? `all ${tenants.length} restaurants`
                                    : `${selected.size} selected restaurant${selected.size === 1 ? "" : "s"}`}
                            </span>
                            . They&apos;ll see it on their Announcements page.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {expiresAt
                            ? `Expires ${new Date(`${expiresAt}T00:00:00`).toLocaleDateString()}`
                            : "No expiry — stays until you remove it"}
                    </div>

                    <div className="rounded-md border border-border/60 bg-card/40 p-4 max-h-[50vh] overflow-auto">
                        <div className="font-semibold text-base mb-1.5">{title || "(no title)"}</div>
                        <div
                            className={RICH_TEXT_CLASS}
                            dangerouslySetInnerHTML={{ __html: previewHtml }}
                        />
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={sending}>
                            Keep editing
                        </Button>
                        <Button onClick={send} disabled={sending || !canSend}>
                            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            {sending ? "Sending…" : "Send now"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    )
}

function ToolbarButton({
    label, onClick, disabled, children,
}: {
    label: string
    onClick: () => void
    disabled?: boolean
    children: React.ReactNode
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={label}
            aria-label={label}
            className="grid place-items-center h-7 w-7 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
        >
            {children}
        </button>
    )
}

function AudienceChip({
    active, onClick, disabled, children,
}: {
    active: boolean
    onClick: () => void
    disabled?: boolean
    children: React.ReactNode
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "rounded-md border px-3 py-1.5 text-sm transition-colors",
                active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted/40",
            )}
        >
            {children}
        </button>
    )
}
