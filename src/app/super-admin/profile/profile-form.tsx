"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Camera, Loader2, Save, Trash2, User as UserIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

/**
 * Profile editor for the super-admin — name + avatar.
 *
 * The avatar upload goes through `/api/super-admin/upload-avatar`
 * (server-side, service-role) because the `user-avatars` storage
 * bucket RLS requires a tenant-prefixed path and super-admins don't
 * have a tenant. The name save uses the regular Supabase client +
 * `users_update_self` RLS — no extra plumbing needed.
 */

interface Props {
    userId: string
    initialFullName: string
    initialAvatarUrl: string | null
}

export function SuperAdminProfileForm({ userId, initialFullName, initialAvatarUrl }: Props) {
    const router = useRouter()
    const supabase = createClient()

    const [fullName, setFullName] = useState(initialFullName)
    const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl)
    const [busy, setBusy] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [dirty, setDirty] = useState(false)
    const fileRef = useRef<HTMLInputElement | null>(null)

    // Track dirtiness so the Save button is only enabled when the
    // form actually has changes.
    useEffect(() => {
        setDirty(
            fullName.trim() !== initialFullName.trim() ||
            (avatarUrl ?? "") !== (initialAvatarUrl ?? ""),
        )
    }, [fullName, avatarUrl, initialFullName, initialAvatarUrl])

    async function onPickFile(file: File | null | undefined) {
        if (!file) return
        if (!file.type.startsWith("image/")) {
            toast.error("Pick an image file (PNG, JPG, or WEBP).")
            return
        }
        if (file.size > 5 * 1024 * 1024) {
            toast.error("Image must be under 5 MB.")
            return
        }
        setUploading(true)
        try {
            const fd = new FormData()
            fd.append("image", file)
            const r = await fetch("/api/super-admin/upload-avatar", {
                method: "POST",
                body: fd,
            })
            const data = await r.json().catch(() => null) as { ok?: boolean; url?: string; error?: string } | null
            if (!r.ok || !data?.ok || !data.url) {
                throw new Error(data?.error ?? `Upload failed (${r.status})`)
            }
            setAvatarUrl(data.url)
            toast.success("Photo uploaded — remember to Save changes.")
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Upload failed")
        } finally {
            setUploading(false)
            if (fileRef.current) fileRef.current.value = ""
        }
    }

    async function save() {
        const trimmed = fullName.trim()
        setBusy(true)
        try {
            const { error } = await supabase
                .from("users")
                .update({
                    full_name: trimmed.length === 0 ? null : trimmed,
                    avatar_url: avatarUrl,
                } as never)
                .eq("id", userId)
            if (error) throw error
            toast.success("Profile updated")
            router.refresh()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't save profile")
        } finally {
            setBusy(false)
        }
    }

    // Two-letter initials for the placeholder when no avatar is set.
    const initials = (fullName.trim() || "?")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? "")
        .join("") || "?"

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-start gap-5">
                {/* Avatar tile + upload affordances */}
                <div className="flex flex-col items-center gap-2 shrink-0">
                    <div
                        className={cn(
                            "relative h-28 w-28 rounded-full overflow-hidden ring-2 ring-border bg-muted/40 grid place-items-center",
                        )}
                    >
                        {avatarUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                                src={avatarUrl}
                                alt=""
                                className="absolute inset-0 h-full w-full object-cover"
                            />
                        ) : (
                            <span
                                aria-hidden
                                className="text-2xl font-bold text-muted-foreground"
                            >
                                {initials !== "?" ? initials : <UserIcon className="h-8 w-8" />}
                            </span>
                        )}
                        {uploading && (
                            <div className="absolute inset-0 bg-background/70 grid place-items-center">
                                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                            </div>
                        )}
                    </div>
                    <div className="flex gap-1.5">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => fileRef.current?.click()}
                            disabled={uploading || busy}
                            title="Choose a new profile photo"
                        >
                            <Camera className="h-3.5 w-3.5" />
                            {avatarUrl ? "Change" : "Upload"}
                        </Button>
                        {avatarUrl && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setAvatarUrl(null)}
                                disabled={uploading || busy}
                                className="text-destructive hover:bg-destructive/10"
                                title="Remove profile photo"
                                aria-label="Remove profile photo"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        )}
                    </div>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                    />
                </div>

                {/* Name field */}
                <div className="flex-1 min-w-[220px] space-y-1.5">
                    <Label htmlFor="sa-full-name">Display name</Label>
                    <Input
                        id="sa-full-name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="e.g. Riya from RestoPOS"
                        maxLength={80}
                        disabled={busy}
                    />
                    <p className="text-[11px] text-muted-foreground">
                        Shown in the super-admin avatar dropdown and any audit log entries you generate.
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
                <Button
                    type="button"
                    variant="neon"
                    onClick={save}
                    disabled={!dirty || busy || uploading}
                    className="min-w-32"
                >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save changes
                </Button>
                {dirty && (
                    <span className="text-[11px] text-warning">Unsaved changes</span>
                )}
            </div>
        </div>
    )
}
