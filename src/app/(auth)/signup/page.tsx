"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import {
    BarChart3,
    Check,
    CheckCircle2,
    Eye,
    EyeOff,
    FileSpreadsheet,
    Loader2,
    Mail,
    ShieldCheck,
    Sparkles,
    Zap,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"

type Stage = "form" | "check_email"

export default function SignupPage() {
    const router = useRouter()
    const supabase = createClient()
    const [stage, setStage] = useState<Stage>("form")
    const [fullName, setFullName] = useState("")
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [showPassword, setShowPassword] = useState(false)
    const [busy, setBusy] = useState(false)
    const [resending, setResending] = useState(false)

    function validate(): string | null {
        if (!fullName.trim()) return "Please enter your name"
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email"
        if (password.length < 8) return "Password must be at least 8 characters"
        if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
            return "Password must include a letter and a number"
        }
        return null
    }

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault()
        const err = validate()
        if (err) return toast.error(err)
        setBusy(true)
        try {
            const { data, error } = await supabase.auth.signUp({
                email: email.trim().toLowerCase(),
                password,
                options: {
                    data: { full_name: fullName.trim() },
                    // Send the confirmation link back to the SAME origin the
                    // user signed up from (localhost in dev, production in
                    // prod, preview domain on a preview deploy). For this to
                    // actually be honoured the origin must be on the
                    // Supabase Auth → URL Configuration → Redirect URLs
                    // allow-list — otherwise Supabase silently substitutes
                    // the project's Site URL. See `.env.example` for the
                    // recommended allow-list entries.
                    emailRedirectTo: `${location.origin}/auth/callback`,
                },
            })
            if (error) throw error

            // If email confirmation is enabled on the Supabase project, signUp
            // succeeds but no session is returned — user must click the link
            // in their email. Show the "check email" stage instead of
            // redirecting (which would just bounce them back to /login).
            if (!data.session) {
                setStage("check_email")
                return
            }

            // Otherwise we're signed in — proceed to onboarding.
            toast.success("Account created — let's set up your restaurant.")
            router.push("/onboarding")
            router.refresh()
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Sign up failed"
            if (/already registered|user already|already exists/i.test(msg)) {
                toast.error("That email is already registered. Try signing in instead.")
            } else if (/weak password|password.*requirements/i.test(msg)) {
                toast.error("Password is too weak. Use 8+ characters with a letter and a number.")
            } else if (/rate limit|too many/i.test(msg)) {
                toast.error("Too many attempts — please wait a few minutes and try again.")
            } else {
                toast.error(msg)
            }
        } finally {
            setBusy(false)
        }
    }

    async function resendConfirmation() {
        setResending(true)
        try {
            const { error } = await supabase.auth.resend({
                type: "signup",
                email: email.trim().toLowerCase(),
                // Same origin-allowlist caveat as the initial signup —
                // see the comment on `onSubmit` above and the Supabase
                // setup notes in `.env.example`.
                options: { emailRedirectTo: `${location.origin}/auth/callback` },
            })
            if (error) throw error
            toast.success("Confirmation email resent. Check your inbox + spam folder.")
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

    if (stage === "check_email") {
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
                        className="mx-auto grid place-items-center h-16 w-16 rounded-full bg-gradient-to-br from-primary/30 to-[hsl(var(--neon-magenta)/0.3)] text-primary backdrop-blur"
                    >
                        <Mail className="h-7 w-7" />
                    </motion.div>
                    <h1 className="mt-5 text-2xl md:text-3xl font-bold tracking-tight">
                        Check your <span className="text-gradient">email</span>
                    </h1>
                    <p className="mt-3 text-muted-foreground text-sm text-balance">
                        We sent a confirmation link to{" "}
                        <span className="font-medium text-foreground">{email}</span>.
                        Click it to activate your account.
                    </p>
                    <div className="mt-5 rounded-md border border-border/50 bg-card/40 p-3 text-xs text-muted-foreground text-left">
                        Didn&apos;t get it? Check your spam folder. The email comes from <code className="text-foreground/80">noreply@mail.app.supabase.io</code>.
                    </div>
                    <Button variant="outline" onClick={resendConfirmation} disabled={resending} className="w-full mt-4">
                        {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Resend confirmation email
                    </Button>
                    <p className="text-sm text-muted-foreground mt-6">
                        Already confirmed?{" "}
                        <Link href="/login" className="text-primary hover:underline">Sign in</Link>
                    </p>
                </motion.div>
            </div>
        )
    }

    return (
        <div className="container mx-auto">
            <div className="grid lg:grid-cols-[1.05fr_1fr] gap-10 lg:gap-16 items-center max-w-6xl mx-auto">
                {/* Left: form */}
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    className="order-2 lg:order-1"
                >
                    <Badge variant="neon" className="mb-4">
                        <Sparkles className="h-3 w-3 mr-1" /> 14-day free trial · No card needed
                    </Badge>
                    <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.05] text-balance">
                        Run your restaurant.{" "}
                        <span className="text-gradient">Skip the CA chaos.</span>
                    </h1>
                    <p className="mt-4 text-muted-foreground text-balance">
                        Sign up in 60 seconds. Add your restaurant details next, and start taking GST-compliant orders today.
                    </p>

                    <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                        <li className="flex items-center gap-1.5"><Check className="h-4 w-4 text-success" /> No credit card</li>
                        <li className="flex items-center gap-1.5"><Check className="h-4 w-4 text-success" /> Setup in 15 min</li>
                        <li className="flex items-center gap-1.5"><Check className="h-4 w-4 text-success" /> Cancel anytime</li>
                    </ul>

                    <div className="mt-8 glass-strong rounded-2xl border border-border/50 neon-border p-6 md:p-8">
                        <form onSubmit={onSubmit} className="space-y-4" noValidate>
                            <div className="space-y-1.5">
                                <Label htmlFor="fullName">Your name</Label>
                                <Input id="fullName" required autoComplete="name" placeholder="Asha Sharma"
                                       value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={busy} />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="email">Email</Label>
                                <Input id="email" type="email" required autoComplete="email" placeholder="you@restaurant.in"
                                       value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="password">Password</Label>
                                <div className="relative">
                                    <Input
                                        id="password"
                                        type={showPassword ? "text" : "password"}
                                        required autoComplete="new-password" minLength={8}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
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
                                <p className="text-xs text-muted-foreground">
                                    8+ characters, with at least one letter and one number.
                                </p>
                            </div>
                            <Button type="submit" variant="neon" size="lg" className="w-full" disabled={busy}>
                                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                                Create account
                            </Button>
                        </form>
                        <p className="mt-5 text-center text-sm text-muted-foreground">
                            Already have an account?{" "}
                            <Link href="/login" className="text-primary hover:underline font-medium">
                                Sign in
                            </Link>
                        </p>
                    </div>
                </motion.div>

                {/* Right: value props (hidden on mobile to keep above-the-fold tight) */}
                <motion.aside
                    initial={{ opacity: 0, y: 32 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
                    className="hidden lg:block order-1 lg:order-2"
                >
                    <div className="relative">
                        <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-primary/10 via-transparent to-[hsl(var(--neon-magenta)/0.1)] blur-2xl" />
                        <div className="relative space-y-3">
                            <ValueProp
                                icon={FileSpreadsheet}
                                title="One-click CA Export"
                                desc="GSTR-1, GSTR-3B, P&L, and balance-sheet inputs in a single ZIP — formatted for Tally, Excel, and the GST portal."
                                accent="primary"
                            />
                            <ValueProp
                                icon={ShieldCheck}
                                title="Bill-lock + audit log"
                                desc="Every edit after a bill is generated is captured, signed, and only the Owner can override. No silent revenue leaks."
                                accent="magenta"
                            />
                            <ValueProp
                                icon={Zap}
                                title="Setup in 15 minutes"
                                desc="Pre-seeded HSN codes, India state codes, GST slabs. Add your menu, print QR codes, take your first order today."
                                accent="primary"
                            />
                            <ValueProp
                                icon={BarChart3}
                                title="Live reports + AI insights"
                                desc="Hourly heatmaps, top items, churn risk, demand forecast — driven by your own data, no paid LLMs."
                                accent="magenta"
                            />
                        </div>
                    </div>
                </motion.aside>
            </div>
        </div>
    )
}

function ValueProp({
    icon: Icon,
    title,
    desc,
    accent,
}: {
    icon: React.ComponentType<{ className?: string }>
    title: string
    desc: string
    accent: "primary" | "magenta"
}) {
    return (
        <motion.div
            whileHover={{ y: -2 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            className="group relative rounded-2xl glass border border-border/50 p-5 transition-all hover:border-primary/40 hover:shadow-glow"
        >
            <div className="flex items-start gap-3">
                <div
                    className="grid place-items-center h-10 w-10 rounded-lg shrink-0"
                    style={{
                        background: accent === "primary"
                            ? "linear-gradient(135deg, hsl(var(--primary)/0.25), hsl(var(--neon-magenta)/0.2))"
                            : "linear-gradient(135deg, hsl(var(--neon-magenta)/0.25), hsl(var(--primary)/0.2))",
                    }}
                >
                    <Icon className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                    <h3 className="font-semibold leading-tight">{title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground leading-snug">{desc}</p>
                </div>
            </div>
        </motion.div>
    )
}
