"use client"

/**
 * Self-service profile editor.
 *
 * Every signed-in staffer (OWNER, MANAGER, CASHIER, …) lands here from the
 * topbar avatar dropdown to update their own name, phone, DOB, and avatar.
 * Email is read-only — it's the auth.users key; changing it is a separate
 * Supabase auth flow that we don't expose here.
 *
 * The page writes directly to `public.users` via PostgREST — RLS policy
 * `users_update_self` allows a row update where `id = auth.uid()`. No
 * RPC needed.
 *
 * Avatar:
 *   - bucket: `user-avatars`, public read, RLS expects path
 *     `<tenant_id>/<user_id>.jpg`.
 *   - OWNER/MANAGER write anywhere in the tenant folder (storage policy
 *     `user-avatars owner-manager write`).
 *   - For non-admins, only UPDATE of an existing avatar object is allowed
 *     by the self-update storage policy — first-time uploads for plain
 *     staff are currently still expected to come from the admin-side
 *     staff-create flow. (If that ever changes, broaden the policy.)
 */

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Mail, Save, User } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageHeader } from "@/components/app-shell/page-header"
import { ImageUploader } from "@/components/ui/image-uploader"
import { createClient } from "@/lib/supabase/client"
import { ROLE_LABELS } from "@/lib/rbac/permissions"
import { Badge } from "@/components/ui/badge"
import type { UserRole } from "@/types/database"

interface ProfileForm {
    full_name: string
    phone: string
    dob: string // yyyy-mm-dd; empty string = unset
    avatar_url: string | null
}

interface MeRow {
    id: string
    tenant_id: string | null
    role: UserRole
    full_name: string | null
    phone: string | null
    email: string | null
    avatar_url: string | null
    dob: string | null
    created_at: string | null
}

const EMPTY: ProfileForm = { full_name: "", phone: "", dob: "", avatar_url: null }

export default function ProfileSettingsPage() {
    const router = useRouter()
    const supabase = useMemo(() => createClient(), [])

    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [me, setMe] = useState<MeRow | null>(null)
    const [form, setForm] = useState<ProfileForm>(EMPTY)

    useEffect(() => {
        let alive = true
        ;(async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                router.replace("/login")
                return
            }
            const { data, error } = await supabase
                .from("users")
                .select("id, tenant_id, role, full_name, phone, email, avatar_url, dob, created_at")
                .eq("id", user.id)
                .maybeSingle() as { data: MeRow | null; error: { message: string } | null }
            if (!alive) return
            if (error) {
                toast.error(error.message)
                setLoading(false)
                return
            }
            if (!data) {
                toast.error("Profile row not found — try signing out and back in.")
                setLoading(false)
                return
            }
            setMe(data)
            setForm({
                full_name: data.full_name ?? "",
                phone: data.phone ?? "",
                dob: data.dob ?? "",
                avatar_url: data.avatar_url ?? null,
            })
            setLoading(false)
        })()
        return () => { alive = false }
    }, [supabase, router])

    function patch<K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) {
        setForm((f) => ({ ...f, [k]: v }))
    }

    async function save() {
        if (!me) return
        const fullName = form.full_name.trim()
        if (!fullName) {
            return toast.error("Name can't be empty.")
        }
        // Loose phone-format gate — accept E.164-ish or plain digits with
        // common separators. Stricter validation belongs on a checkout /
        // KYC flow, not on a profile update.
        const phone = form.phone.trim()
        if (phone && !/^[+\d][\d\s().-]{5,}$/.test(phone)) {
            return toast.error("Phone number looks off — use digits, spaces, + or -")
        }
        const dob = form.dob || null
        if (dob && Number.isNaN(Date.parse(dob))) {
            return toast.error("Date of birth isn't a valid date.")
        }

        setBusy(true)
        const { error } = await supabase
            .from("users")
            .update({
                full_name: fullName,
                phone: phone || null,
                dob,
                avatar_url: form.avatar_url ?? null,
            } as never)
            .eq("id", me.id)
        setBusy(false)
        if (error) {
            toast.error(error.message)
            return
        }
        toast.success("Profile updated.")
        // Bump the layout so the avatar / name change shows in the topbar
        // straight away (the layout reads users on every navigation, but
        // not without a refresh hint).
        router.refresh()
    }

    if (loading) {
        return (
            <div className="container mx-auto py-10 max-w-3xl">
                <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading your profile…
                </div>
            </div>
        )
    }
    if (!me) {
        return null
    }

    // Avatar storage path: `<tenant_id>/<user_id>.jpg` — RLS-locked to
    // the caller's tenant + auth.uid(). The ImageUploader appends its
    // own random suffix so multiple uploads don't collide.
    const avatarPath = me.tenant_id
        ? `${me.tenant_id}/${me.id}`
        : null

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-3xl space-y-6">
            <PageHeader
                kicker="Account"
                title="My profile"
                description="This is how you appear across the app — to your team, on bills you sign, and on the dashboard."
            />

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <User className="h-4 w-4 text-primary" /> Photo & name
                    </CardTitle>
                    <CardDescription>
                        Your photo shows on the dashboard and next to bills you create. A square crop works best.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="flex flex-wrap items-start gap-5">
                        {avatarPath ? (
                            <ImageUploader
                                value={form.avatar_url}
                                onChange={(url) => patch("avatar_url", url)}
                                bucket="user-avatars"
                                path={avatarPath}
                                aspect="square"
                                size={112}
                                label="Profile photo"
                                hint="PNG or JPG, up to 5 MB. We'll compress it for you."
                                disabled={busy}
                                maxMB={5}
                            />
                        ) : (
                            <div className="text-sm text-muted-foreground">
                                Finish onboarding (your tenant) before adding a profile photo.
                            </div>
                        )}
                        <div className="flex-1 min-w-[220px] space-y-3">
                            <div className="space-y-1.5">
                                <Label htmlFor="full_name">Full name</Label>
                                <Input
                                    id="full_name"
                                    value={form.full_name}
                                    onChange={(e) => patch("full_name", e.target.value)}
                                    placeholder="Asha Sharma"
                                    autoComplete="name"
                                    disabled={busy}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="email" className="flex items-center gap-1.5">
                                    <Mail className="h-3.5 w-3.5 text-muted-foreground" /> Email
                                </Label>
                                <Input
                                    id="email"
                                    value={me.email ?? ""}
                                    readOnly
                                    disabled
                                    className="bg-muted/30 cursor-not-allowed"
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    Email changes go through a separate auth flow — contact your admin if you need to switch.
                                </p>
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                                <Badge variant="outline">{ROLE_LABELS[me.role]}</Badge>
                                {me.created_at && (
                                    <span className="text-[11px] text-muted-foreground">
                                        Joined {new Date(me.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Personal details</CardTitle>
                    <CardDescription>
                        Optional — useful if your team contacts you outside the app.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="phone">Phone</Label>
                        <Input
                            id="phone"
                            value={form.phone}
                            onChange={(e) => patch("phone", e.target.value)}
                            placeholder="+91 98765 43210"
                            autoComplete="tel"
                            disabled={busy}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="dob">Date of birth</Label>
                        <Input
                            id="dob"
                            type="date"
                            value={form.dob}
                            onChange={(e) => patch("dob", e.target.value)}
                            disabled={busy}
                            // Don't let an admin "set" a future birthday by
                            // accident — clamp the upper bound to today.
                            max={new Date().toISOString().slice(0, 10)}
                        />
                    </div>
                </CardContent>
            </Card>

            <div className="flex items-center justify-end gap-2 sticky bottom-3">
                <Button variant="ghost" onClick={() => router.back()} disabled={busy}>
                    Cancel
                </Button>
                <Button variant="neon" onClick={save} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save changes
                </Button>
            </div>
        </div>
    )
}
