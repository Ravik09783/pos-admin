"use client"

import { useState } from "react"
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"

/**
 * Inline change-password form for the super-admin profile page.
 *
 * Uses `supabase.auth.updateUser({ password })` which Supabase
 * accepts for already-signed-in users — no current-password
 * verification required because the user already has a valid
 * session. We add a confirm field client-side so a fat-fingered
 * new password doesn't lock the operator out.
 */
export function ChangePasswordForm() {
    const supabase = createClient()
    const [pw, setPw] = useState("")
    const [confirm, setConfirm] = useState("")
    const [showPw, setShowPw] = useState(false)
    const [busy, setBusy] = useState(false)

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (pw.length < 8) {
            toast.error("Use at least 8 characters.")
            return
        }
        if (pw !== confirm) {
            toast.error("Both fields must match.")
            return
        }
        setBusy(true)
        try {
            const { error } = await supabase.auth.updateUser({ password: pw })
            if (error) throw error
            toast.success("Password updated. Use it on your next sign-in.")
            setPw("")
            setConfirm("")
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't change password")
        } finally {
            setBusy(false)
        }
    }

    return (
        <form onSubmit={onSubmit} className="space-y-3 max-w-md">
            <div className="space-y-1.5">
                <Label htmlFor="new-pw">New password</Label>
                <div className="relative">
                    <Input
                        id="new-pw"
                        type={showPw ? "text" : "password"}
                        value={pw}
                        onChange={(e) => setPw(e.target.value)}
                        placeholder="At least 8 characters"
                        autoComplete="new-password"
                        className="pr-10"
                    />
                    <button
                        type="button"
                        onClick={() => setShowPw((s) => !s)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label={showPw ? "Hide password" : "Show password"}
                        tabIndex={-1}
                    >
                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                </div>
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="confirm-pw">Confirm new password</Label>
                <Input
                    id="confirm-pw"
                    type={showPw ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Re-type the same password"
                    autoComplete="new-password"
                />
            </div>
            <Button type="submit" variant="neon" disabled={busy || !pw || !confirm} className="gap-1.5">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Update password
            </Button>
            <p className="text-[11px] text-muted-foreground">
                Your existing session stays signed in. The new password takes effect the next time you sign in.
            </p>
        </form>
    )
}
