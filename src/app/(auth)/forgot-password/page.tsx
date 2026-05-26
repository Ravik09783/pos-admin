"use client"

import { useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowLeft, CheckCircle2, KeyRound, Loader2, Mail } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"

export default function ForgotPasswordPage() {
    const supabase = createClient()
    const [email, setEmail] = useState("")
    const [busy, setBusy] = useState(false)
    const [sent, setSent] = useState(false)

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error("Enter a valid email")
        setBusy(true)
        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
                // Reset link lands back on THIS origin's /reset-password.
                // Requires the origin to be on Supabase Auth → URL
                // Configuration → Redirect URLs, otherwise Supabase
                // falls back to the project's Site URL. See `.env.example`.
                redirectTo: `${location.origin}/reset-password`,
            })
            if (error) throw error
            // Show success regardless of whether the email exists
            // (don't leak account existence).
            setSent(true)
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed to send reset email"
            if (/rate limit/i.test(msg)) {
                toast.error("Please wait a minute before requesting another email.")
            } else {
                toast.error(msg)
            }
        } finally {
            setBusy(false)
        }
    }

    if (sent) {
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
                        className="mx-auto grid place-items-center h-16 w-16 rounded-full bg-gradient-to-br from-success/30 to-primary/30 text-success backdrop-blur"
                    >
                        <CheckCircle2 className="h-7 w-7" />
                    </motion.div>
                    <h1 className="mt-5 text-2xl md:text-3xl font-bold tracking-tight">
                        Check your <span className="text-gradient">email</span>
                    </h1>
                    <p className="mt-3 text-sm text-muted-foreground text-balance">
                        If an account exists for <span className="font-medium text-foreground">{email}</span>,
                        you&apos;ll receive a password-reset link within a minute.
                    </p>
                    <div className="mt-5 rounded-md border border-border/50 bg-card/40 p-3 text-xs text-muted-foreground text-left">
                        The link works for 1 hour. Not seeing it? Check spam, or click resend.
                    </div>
                    <Button variant="outline" onClick={() => setSent(false)} className="w-full mt-4">
                        Send to a different email
                    </Button>
                    <Link href="/login" className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-5">
                        <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
                    </Link>
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
                    <KeyRound className="h-3 w-3 mr-1" /> Account recovery
                </Badge>
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                    Reset your <span className="text-gradient">password</span>
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Enter your email and we&apos;ll send you a link to set a new one.
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
                        <Input id="email" type="email" required autoComplete="email" placeholder="you@restaurant.in"
                               value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
                    </div>
                    <Button type="submit" variant="neon" size="lg" className="w-full" disabled={busy}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                        Send reset link
                    </Button>
                </form>
                <Link href="/login" className="mt-6 inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
                </Link>
            </motion.div>
        </div>
    )
}
