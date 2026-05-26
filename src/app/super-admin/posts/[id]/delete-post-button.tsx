"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"

/**
 * Deletes an announcement post. The DELETE route also sweeps any images
 * the post used out of Supabase storage, so nothing is left orphaned.
 */
export function DeletePostButton({ postId, postTitle }: { postId: string; postTitle: string }) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)

    async function del() {
        setBusy(true)
        try {
            const r = await fetch(`/api/super-admin/posts/${postId}`, { method: "DELETE" })
            const data = await r.json() as { ok?: boolean; error?: string; images_removed?: number }
            if (!r.ok || !data.ok) throw new Error(data.error ?? "Delete failed")
            toast.success("Announcement deleted", {
                description: data.images_removed
                    ? `${data.images_removed} image${data.images_removed === 1 ? "" : "s"} removed from storage`
                    : undefined,
            })
            router.push("/super-admin/posts")
            router.refresh()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Delete failed")
            setBusy(false)
        }
    }

    return (
        <>
            <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/40"
                onClick={() => setOpen(true)}
            >
                <Trash2 className="h-3.5 w-3.5" />
                Delete post
            </Button>

            <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o) }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-destructive">
                            <AlertTriangle className="h-5 w-5" />
                            Delete this announcement?
                        </DialogTitle>
                        <DialogDescription className="pt-1">
                            <span className="font-medium text-foreground">{postTitle}</span> will be
                            permanently removed for every restaurant — along with its read receipts
                            and any images it used (deleted from storage). This can&apos;t be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
                        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={del} disabled={busy}>
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            {busy ? "Deleting…" : "Delete permanently"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
