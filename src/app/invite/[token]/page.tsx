"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { AlertCircle, CheckCircle2, Loader2, LogOut, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/client"
import { ROLE_LABELS } from "@/lib/rbac/permissions"
import type { UserRole } from "@/types/database"

type InviteState =
    | { kind: "loading" }
    | { kind: "error"; message: string; subtitle?: string }
    | { kind: "valid"; invite: InviteData; tenant: TenantData; userStatus: UserStatus }
    | { kind: "accepted_redirect" }

interface InviteData {
    email: string
    role: UserRole
    full_name: string | null
    expires_at: string
    branch_id: string | null
}
interface TenantData { name: string; logo_url?: string; city?: string }
type UserStatus =
    | { kind: "anon" }                              // not signed in
    | { kind: "right_user" }                        // signed in as the invitee
    | { kind: "wrong_user"; email: string }         // signed in as someone else

export default function InvitePage() {
    const params = useParams<{ token: string }>()
    const router = useRouter()
    const supabase = createClient()

    const [state, setState] = useState<InviteState>({ kind: "loading" })
    const [fullName, setFullName] = useState("")
    const [password, setPassword] = useState("")
    const [busy, setBusy] = useState(false)

    // ---- Bootstrap: fetch invite + current auth user ----
    useEffect(() => {
        ;(async () => {
            try {
                const r = await fetch(`/api/public/invite/${params.token}`, { cache: "no-store" })
                const data = await r.json()
                if (!r.ok) {
                    setState({ kind: "error", message: data.error === "not_found" ? "Invite not found" : "This invite link is invalid", subtitle: "Ask your manager for a fresh invite link." })
                    return
                }
                if (data.status === "accepted") {
                    setState({ kind: "error", message: "Invite already accepted", subtitle: "Try signing in instead." })
                    return
                }
                if (data.status === "revoked") {
                    setState({ kind: "error", message: "Invite revoked", subtitle: "Your manager cancelled this invite. Ask for a new one." })
                    return
                }
                if (data.status === "expired") {
                    setState({ kind: "error", message: "Invite expired", subtitle: "Ask your manager for a fresh invite link." })
                    return
                }

                const invite: InviteData = data.invite
                const tenant: TenantData = data.tenant ?? { name: "Restaurant" }
                setFullName(invite.full_name ?? "")

                // Check current auth user
                const { data: { user } } = await supabase.auth.getUser()
                let userStatus: UserStatus
                if (!user) {
                    userStatus = { kind: "anon" }
                } else if (user.email && user.email.toLowerCase() === invite.email.toLowerCase()) {
                    userStatus = { kind: "right_user" }
                } else {
                    userStatus = { kind: "wrong_user", email: user.email ?? "" }
                }

                setState({ kind: "valid", invite, tenant, userStatus })
            } catch {
                setState({ kind: "error", message: "Couldn't load this invite", subtitle: "Check your internet and try again." })
            }
        })()
    }, [params.token, supabase])

    async function callAccept(): Promise<boolean> {
        const { data, error } = await supabase.rpc("accept_staff_invite" as never, { p_token: params.token } as never)
        if (error) {
            const msg = error.message ?? "Could not accept invite"
            if (/not_authenticated/.test(msg)) toast.error("Please sign in first.")
            else if (/invite_not_found/.test(msg)) toast.error("Invite not found.")
            else if (/invite_already_accepted/.test(msg)) toast.error("This invite was already accepted.")
            else if (/invite_revoked/.test(msg)) toast.error("This invite was revoked.")
            else if (/invite_expired/.test(msg)) toast.error("This invite has expired.")
            else if (/email_mismatch/.test(msg)) toast.error("Your account email doesn't match the invite. Sign out and sign in with the right account.")
            else if (/already_in_another_tenant/.test(msg)) toast.error("Your account is already part of another restaurant. Contact support.")
            else toast.error(msg)
            return false
        }
        const r = data as { ok: boolean }
        return r.ok
    }

    // For an EXISTING user who's signed in with the right email — one-click accept
    async function acceptAsExistingUser() {
        setBusy(true)
        const ok = await callAccept()
        setBusy(false)
        if (ok) {
            toast.success("Welcome to the team!")
            setState({ kind: "accepted_redirect" })
            setTimeout(() => { router.push("/dashboard"); router.refresh() }, 700)
        }
    }

    // For a NEW user signing up + accepting in one flow
    async function signUpAndAccept(e: React.FormEvent) {
        e.preventDefault()
        if (state.kind !== "valid") return
        if (password.length < 8) return toast.error("Password must be at least 8 characters")
        if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
            return toast.error("Password must include a letter and a number")
        }
        setBusy(true)
        try {
            const { data, error } = await supabase.auth.signUp({
                email: state.invite.email,
                password,
                options: { data: { full_name: fullName.trim() || state.invite.full_name } },
            })
            if (error) {
                const msg = error.message
                if (/already registered|user already|already exists/i.test(msg)) {
                    // Existing account — they need to sign in first, then come back
                    toast.error("You already have an account. Sign in first, then click the invite link.")
                    router.push("/login")
                    return
                }
                throw error
            }
            if (!data.session) {
                toast.message(
                    "Check your email to confirm your account, then click this invite link again.",
                    { duration: 8000 },
                )
                return
            }
            // Session created — call accept_staff_invite immediately
            const ok = await callAccept()
            if (ok) {
                toast.success("Welcome to the team!")
                setState({ kind: "accepted_redirect" })
                setTimeout(() => { router.push("/dashboard"); router.refresh() }, 700)
            } else {
                // accept failed — they're in a half-state. Send to dashboard
                // which will detect orphan + auto-redirect them back here.
                router.push("/dashboard")
            }
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Sign up failed")
        } finally {
            setBusy(false)
        }
    }

    async function signOut() {
        await supabase.auth.signOut()
        location.reload()
    }

    // ============ RENDER STATES ============

    if (state.kind === "loading") {
        return (
            <div className="min-h-screen grid place-items-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
        )
    }
    if (state.kind === "error") {
        return (
            <div className="min-h-screen grid place-items-center p-6">
                <Card className="max-w-md w-full">
                    <CardContent className="py-10 text-center space-y-3">
                        <div className="mx-auto grid place-items-center h-14 w-14 rounded-full bg-destructive/15 text-destructive">
                            <AlertCircle className="h-7 w-7" />
                        </div>
                        <CardTitle>{state.message}</CardTitle>
                        {state.subtitle && <CardDescription>{state.subtitle}</CardDescription>}
                        <Button asChild variant="outline"><Link href="/login">Back to sign in</Link></Button>
                    </CardContent>
                </Card>
            </div>
        )
    }
    if (state.kind === "accepted_redirect") {
        return (
            <div className="min-h-screen grid place-items-center p-6">
                <Card className="max-w-md w-full neon-border">
                    <CardContent className="py-10 text-center space-y-3">
                        <CheckCircle2 className="h-14 w-14 text-success mx-auto" />
                        <CardTitle>You&apos;re in!</CardTitle>
                        <CardDescription>Loading your workspace…</CardDescription>
                    </CardContent>
                </Card>
            </div>
        )
    }

    const { invite, tenant, userStatus } = state

    // Common header for the valid-invite views
    const header = (
        <CardHeader>
            <Sparkles className="h-7 w-7 text-primary mb-2" />
            <CardTitle className="text-2xl">Join {tenant.name}</CardTitle>
            <CardDescription>
                You&apos;ve been invited as{" "}
                <span className="text-foreground font-semibold">{ROLE_LABELS[invite.role]}</span>
                {tenant.city && <span> in {tenant.city}</span>}.
            </CardDescription>
            <div className="flex flex-wrap items-center gap-1.5 mt-2 text-xs">
                <Badge variant="outline">{invite.email}</Badge>
                <Badge variant="outline">{ROLE_LABELS[invite.role]}</Badge>
            </div>
        </CardHeader>
    )

    if (userStatus.kind === "wrong_user") {
        return (
            <div className="min-h-screen grid place-items-center p-6">
                <Card className="max-w-md w-full neon-border">
                    {header}
                    <CardContent className="space-y-3">
                        <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
                            <div className="font-medium">You&apos;re signed in as a different account</div>
                            <div className="text-xs text-muted-foreground mt-1">
                                This invite is for <span className="font-medium">{invite.email}</span> but you&apos;re currently signed in as <span className="font-medium">{userStatus.email}</span>.
                            </div>
                        </div>
                        <Button onClick={signOut} variant="outline" className="w-full">
                            <LogOut className="h-4 w-4" /> Sign out and try again
                        </Button>
                    </CardContent>
                </Card>
            </div>
        )
    }

    if (userStatus.kind === "right_user") {
        // Just one click to accept
        return (
            <div className="min-h-screen grid place-items-center p-6">
                <Card className="max-w-md w-full neon-border">
                    {header}
                    <CardContent className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                            You&apos;re already signed in as <span className="font-medium text-foreground">{invite.email}</span>. One click to join the team.
                        </p>
                        <Button onClick={acceptAsExistingUser} variant="neon" className="w-full" disabled={busy}>
                            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                            Accept invite &amp; join {tenant.name}
                        </Button>
                        <button onClick={signOut} className="block w-full text-xs text-muted-foreground hover:text-foreground transition-colors">
                            Use a different account
                        </button>
                    </CardContent>
                </Card>
            </div>
        )
    }

    // userStatus.kind === "anon" — show signup form (or sign-in link if they have an account)
    return (
        <div className="min-h-screen grid place-items-center p-6">
            <Card className="max-w-md w-full neon-border">
                {header}
                <CardContent>
                    <form onSubmit={signUpAndAccept} className="space-y-4" noValidate>
                        <div className="space-y-1.5">
                            <Label>Email</Label>
                            <Input value={invite.email} disabled />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="name">Your name</Label>
                            <Input
                                id="name"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                placeholder="Display name"
                                disabled={busy}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="password">Set a password</Label>
                            <Input
                                id="password"
                                type="password"
                                required
                                minLength={8}
                                autoComplete="new-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                disabled={busy}
                            />
                            <p className="text-xs text-muted-foreground">8+ characters, one letter, one number.</p>
                        </div>
                        <Button type="submit" variant="neon" className="w-full" disabled={busy}>
                            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                            Accept invite &amp; join
                        </Button>
                    </form>
                    <p className="mt-4 text-center text-xs text-muted-foreground">
                        Already have an account?{" "}
                        <Link href="/login" className="text-primary hover:underline">Sign in</Link>{" "}
                        and then come back to this link.
                    </p>
                </CardContent>
            </Card>
        </div>
    )
}
