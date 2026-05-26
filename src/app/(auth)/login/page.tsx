"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { AlertCircle, Eye, EyeOff, Loader2, Mail, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"

type ErrorKind =
    | { type: "invalid_credentials" }
    | { type: "email_not_confirmed" }
    | { type: "rate_limit"; retryIn?: string }
    | { type: "deactivated" }
    | { type: "other"; message: string }

function classifyError(msg: string): ErrorKind {
    const m = msg.toLowerCase()
    if (m.includes("email not confirmed") || m.includes("not confirmed")) return { type: "email_not_confirmed" }
    // Supabase returns "User is banned" / "user_banned" when the auth user
    // has a non-zero ban_duration. We use ban_duration for deactivation, so
    // surface it as the friendlier "your account is deactivated" message.
    if (m.includes("banned") || m.includes("user is banned") || m.includes("user_banned")) {
        return { type: "deactivated" }
    }
    if (m.includes("invalid login credentials") || m.includes("invalid credentials") || m.includes("invalid email or password")) {
        return { type: "invalid_credentials" }
    }
    if (m.includes("rate limit") || m.includes("too many")) return { type: "rate_limit" }
    return { type: "other", message: msg }
}

export default function LoginPage() {
    const router = useRouter()
    const supabase = createClient()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [showPassword, setShowPassword] = useState(false)
    const [busy, setBusy] = useState(false)
    const [resending, setResending] = useState(false)
    const [err, setErr] = useState<ErrorKind | null>(null)

    // If we arrived from /(app)/layout's defensive check ("you have a JWT but
    // is_active=false"), clear the stale cookie and show the notice. Using
    // window.location.search avoids the Suspense boundary that useSearchParams
    // would require in App Router.
    useEffect(() => {
        if (typeof window === "undefined") return
        const params = new URLSearchParams(window.location.search)
        if (params.get("inactive") === "1") {
            setErr({ type: "deactivated" })
            supabase.auth.signOut().catch(() => { /* best effort */ })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!email.trim()) return toast.error("Enter your email")
        if (!password) return toast.error("Enter your password")
        setBusy(true)
        setErr(null)
        try {
            const { error } = await supabase.auth.signInWithPassword({
                email: email.trim().toLowerCase(),
                password,
            })
            if (error) throw error
            // Hold the spinner through the navigation. Resetting `busy` to
            // false here would let the button revert to "Sign in" while the
            // server still renders /menu — the user sees a frozen form
            // for ~1s before the redirect. The component unmounts on push,
            // so we never need to flip busy back.
            //
            // Land at /menu — the role-aware launcher grid — instead of
            // /dashboard, so admin AND staff (cashier, captain, kitchen)
            // see the same "what would you like to do next" tile set on
            // sign-in. Admins can still hit Dashboard from the launcher;
            // staff who never look at numbers don't have to.
            router.push("/menu")
            router.refresh()
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Sign in failed"
            setErr(classifyError(msg))
            setBusy(false)
        }
    }

    async function loginWithGoogle() {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            // Google → Supabase → back to THIS origin. The origin must be
            // on the Supabase Auth allow-list (Dashboard → URL
            // Configuration → Redirect URLs) or Supabase substitutes the
            // Site URL. See `.env.example` for the recommended setup.
            options: { redirectTo: `${location.origin}/auth/callback` },
        })
        if (error) toast.error(error.message)
    }

    async function resendConfirmation() {
        if (!email.trim()) return toast.error("Enter your email first")
        setResending(true)
        try {
            const { error } = await supabase.auth.resend({
                type: "signup",
                email: email.trim().toLowerCase(),
                // Same origin-allowlist caveat as `loginWithGoogle`.
                options: { emailRedirectTo: `${location.origin}/auth/callback` },
            })
            if (error) throw error
            toast.success("Confirmation email resent — check your inbox and spam folder.")
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Resend failed"
            if (/rate limit/i.test(msg)) {
                toast.error("Please wait a minute before requesting another email.")
            } else {
                toast.error(msg)
            }
        } finally {
            setResending(false)
        }
    }

    return (
        <div className="container mx-auto max-w-md">
            <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="text-center mb-6"
            >
                <Badge variant="neon" className="mb-3">
                    <Sparkles className="h-3 w-3 mr-1" /> Welcome back
                </Badge>
                <h1 className="text-4xl font-bold tracking-tight">
                    Sign in to <span className="text-gradient">RestoPOS</span>
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Pick up where you left off — orders, kitchen, and CA exports are all waiting.
                </p>
            </motion.div>

            <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                className="glass-strong rounded-2xl border border-border/50 neon-border p-6 md:p-8"
            >
                <form onSubmit={onSubmit} className="space-y-4" noValidate>
                    <div className="space-y-1.5">
                        <Label htmlFor="email">Email</Label>
                        <Input
                            id="email" type="email" required autoComplete="email" placeholder="you@restaurant.in"
                            value={email}
                            onChange={(e) => { setEmail(e.target.value); setErr(null) }}
                            disabled={busy}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="password">Password</Label>
                            <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                                Forgot?
                            </Link>
                        </div>
                        <div className="relative">
                            <Input
                                id="password"
                                type={showPassword ? "text" : "password"}
                                required autoComplete="current-password"
                                value={password}
                                onChange={(e) => { setPassword(e.target.value); setErr(null) }}
                                disabled={busy}
                                className="pr-10"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword((v) => !v)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                                aria-label={showPassword ? "Hide password" : "Show password"}
                                tabIndex={-1}
                            >
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>
                    </div>

                    {err && (
                        <motion.div
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm space-y-2"
                        >
                            <div className="flex items-start gap-2">
                                <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                                <div className="flex-1">
                                    {err.type === "invalid_credentials" && (
                                        <>
                                            <div className="font-medium">Wrong email or password</div>
                                            <div className="text-xs text-muted-foreground mt-0.5">
                                                Double-check your credentials, or{" "}
                                                <Link href="/forgot-password" className="text-primary hover:underline">reset your password</Link>.
                                            </div>
                                        </>
                                    )}
                                    {err.type === "email_not_confirmed" && (
                                        <>
                                            <div className="font-medium">Email not confirmed</div>
                                            <div className="text-xs text-muted-foreground mt-0.5">
                                                Click the link we sent to <span className="text-foreground">{email}</span>. Can&apos;t find it?
                                            </div>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                onClick={resendConfirmation}
                                                disabled={resending}
                                                className="mt-2"
                                            >
                                                {resending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                                                Resend confirmation email
                                            </Button>
                                        </>
                                    )}
                                    {err.type === "deactivated" && (
                                        <>
                                            <div className="font-medium">Your admin has disabled this account</div>
                                            <div className="text-xs text-muted-foreground mt-0.5">
                                                Sign-in is blocked while your account is inactive. Please contact your admin to re-enable it.
                                            </div>
                                        </>
                                    )}
                                    {err.type === "rate_limit" && (
                                        <>
                                            <div className="font-medium">Too many attempts</div>
                                            <div className="text-xs text-muted-foreground mt-0.5">
                                                Wait a few minutes and try again. If you forgot your password, use the link above.
                                            </div>
                                        </>
                                    )}
                                    {err.type === "other" && (
                                        <>
                                            <div className="font-medium">Sign-in failed</div>
                                            <div className="text-xs text-muted-foreground mt-0.5">{err.message}</div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    )}

                    <Button type="submit" variant="neon" size="lg" className="w-full" disabled={busy}>
                        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                        {busy ? "Signing in…" : "Sign in"}
                    </Button>
                </form>

                <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                    <div className="h-px bg-border/60 flex-1" /> OR <div className="h-px bg-border/60 flex-1" />
                </div>
                <Button variant="outline" className="w-full" onClick={loginWithGoogle} disabled={busy}>
                    Continue with Google
                </Button>
                <p className="mt-6 text-center text-sm text-muted-foreground">
                    No account?{" "}
                    <Link href="/signup" className="text-primary hover:underline font-medium">
                        Start free trial
                    </Link>
                </p>
            </motion.div>
        </div>
    )
}
