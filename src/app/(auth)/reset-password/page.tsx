"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"

export default function ResetPasswordPage() {
    const router = useRouter()
    const supabase = createClient()
    const [password, setPassword] = useState("")
    const [confirm, setConfirm] = useState("")
    const [showPassword, setShowPassword] = useState(false)
    const [busy, setBusy] = useState(false)
    const [done, setDone] = useState(false)
    const [hasSession, setHasSession] = useState<boolean | null>(null)

    // Supabase's password-reset link contains a recovery token in the URL hash
    // which the JS SDK auto-consumes to create a temporary session. We just
    // need to wait for it to settle, then call updateUser({ password }).
    useEffect(() => {
        ;(async () => {
            const { data: { session } } = await supabase.auth.getSession()
            setHasSession(!!session)
        })()
    }, [supabase])

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (password.length < 8) return toast.error("Password must be at least 8 characters")
        if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
            return toast.error("Password must include a letter and a number")
        }
        if (password !== confirm) return toast.error("Passwords don't match")
        setBusy(true)
        try {
            const { error } = await supabase.auth.updateUser({ password })
            if (error) throw error
            setDone(true)
            setTimeout(() => router.push("/dashboard"), 1500)
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed to update password"
            if (/auth session missing|not authenticated/i.test(msg)) {
                toast.error("Your reset link has expired. Request a new one.")
                router.push("/forgot-password")
            } else if (/same as the old/i.test(msg)) {
                toast.error("New password must be different from your old one.")
            } else {
                toast.error(msg)
            }
        } finally {
            setBusy(false)
        }
    }

    if (hasSession === false) {
        return (
            <div className="container mx-auto max-w-md">
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    className="glass-strong rounded-2xl border border-border/50 neon-border p-8 text-center"
                >
                    <div className="mx-auto grid place-items-center h-16 w-16 rounded-full bg-destructive/15 text-destructive backdrop-blur">
                        <AlertCircle className="h-7 w-7" />
                    </div>
                    <h1 className="mt-5 text-2xl md:text-3xl font-bold tracking-tight">
                        Invalid or <span className="text-gradient">expired link</span>
                    </h1>
                    <p className="mt-3 text-sm text-muted-foreground text-balance">
                        This password-reset link is no longer valid. Request a fresh one.
                    </p>
                    <Button asChild variant="neon" size="lg" className="w-full mt-6">
                        <Link href="/forgot-password">Request a new link</Link>
                    </Button>
                </motion.div>
            </div>
        )
    }

    if (done) {
        return (
            <div className="container mx-auto max-w-md">
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    className="glass-strong rounded-2xl border border-border/50 neon-border p-8 text-center"
                >
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.15, type: "spring", stiffness: 220, damping: 14 }}
                        className="mx-auto grid place-items-center h-16 w-16 rounded-full bg-success/15 text-success backdrop-blur"
                    >
                        <CheckCircle2 className="h-7 w-7" />
                    </motion.div>
                    <h1 className="mt-5 text-2xl md:text-3xl font-bold tracking-tight">
                        Password <span className="text-gradient">updated</span>
                    </h1>
                    <p className="mt-3 text-sm text-muted-foreground">Signing you in…</p>
                </motion.div>
            </div>
        )
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
                    <KeyRound className="h-3 w-3 mr-1" /> New password
                </Badge>
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                    Set a <span className="text-gradient">new password</span>
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Choose something you don&apos;t use elsewhere.
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
                        <Label htmlFor="password">New password</Label>
                        <div className="relative">
                            <Input
                                id="password"
                                type={showPassword ? "text" : "password"}
                                required minLength={8} autoComplete="new-password"
                                value={password} onChange={(e) => setPassword(e.target.value)}
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
                        <p className="text-xs text-muted-foreground">8+ characters, one letter, one number.</p>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="confirm">Confirm</Label>
                        <Input id="confirm" type={showPassword ? "text" : "password"} required autoComplete="new-password"
                               value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} />
                    </div>
                    <Button type="submit" variant="neon" size="lg" className="w-full" disabled={busy || hasSession === null}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                        Update password
                    </Button>
                </form>
            </motion.div>
        </div>
    )
}
