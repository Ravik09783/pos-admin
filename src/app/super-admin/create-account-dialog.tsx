"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff, Loader2, UserPlus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { COUNTRY_OPTIONS } from "@/lib/tax/locale-config"

/**
 * "Create restaurant" — lets a super-admin provision a complete restaurant
 * (owner login account + tenant) from the console, without the public
 * /signup email-verification step.
 *
 * The form mirrors /signup + the essentials of /onboarding (owner name,
 * email, password, restaurant name, country). The behavioural difference
 * lives server-side: /api/super-admin/create-account stamps
 * `email_confirm: true`, so no confirmation email is sent and the owner
 * can sign in immediately. We spell that out in the dialog copy so the
 * operator knows to hand the credentials over directly.
 *
 * Self-contained: renders its own trigger button + controlled dialog so
 * the parent (a server component) can drop it in with no extra wiring.
 */
export function CreateAccountButton() {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [fullName, setFullName] = useState("")
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [restaurantName, setRestaurantName] = useState("")
    const [country, setCountry] = useState("IN")
    const [showPassword, setShowPassword] = useState(false)
    const [busy, setBusy] = useState(false)

    function validate(): string | null {
        if (!fullName.trim()) return "Please enter the owner's name"
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email"
        if (password.length < 8) return "Password must be at least 8 characters"
        if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
            return "Password must include a letter and a number"
        }
        if (restaurantName.trim().length < 2) return "Enter the restaurant name"
        return null
    }

    function reset() {
        setFullName("")
        setEmail("")
        setPassword("")
        setRestaurantName("")
        setCountry("IN")
        setShowPassword(false)
    }

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault()
        const err = validate()
        if (err) return toast.error(err)
        setBusy(true)
        try {
            const r = await fetch("/api/super-admin/create-account", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    full_name: fullName.trim(),
                    email: email.trim().toLowerCase(),
                    password,
                    restaurant_name: restaurantName.trim(),
                    country,
                }),
            })
            const data = (await r.json()) as { ok?: boolean; error?: string; restaurant_name?: string }
            if (!r.ok || !data.ok) throw new Error(data.error ?? "Failed to create restaurant")
            toast.success(`${data.restaurant_name ?? "Restaurant"} created`, {
                description:
                    "No verification email was sent — share the password with the owner directly. They can sign in straight away.",
                duration: 7000,
            })
            reset()
            setOpen(false)
            router.refresh()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to create restaurant")
        } finally {
            setBusy(false)
        }
    }

    return (
        <>
            <Button onClick={() => setOpen(true)} className="shrink-0">
                <UserPlus className="h-4 w-4" />
                Create restaurant
            </Button>

            <Dialog
                open={open}
                onOpenChange={(o) => {
                    if (busy) return
                    setOpen(o)
                    if (!o) reset()
                }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <UserPlus className="h-5 w-5 text-primary" />
                            Create a restaurant
                        </DialogTitle>
                        <DialogDescription className="pt-1">
                            Same as the public sign-up — but{" "}
                            <span className="font-medium text-foreground">no verification email is sent</span>.
                            The account is active immediately; hand the password to the
                            owner so they can sign in. The owner can fine-tune tax
                            details, address and staff later in Settings.
                        </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={onSubmit} className="space-y-4" noValidate>
                        <div className="space-y-1.5">
                            <Label htmlFor="sa-name">Owner&apos;s name</Label>
                            <Input
                                id="sa-name"
                                required
                                autoComplete="off"
                                placeholder="Asha Sharma"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                disabled={busy}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="sa-email">Email</Label>
                            <Input
                                id="sa-email"
                                type="email"
                                required
                                autoComplete="off"
                                placeholder="owner@restaurant.in"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                disabled={busy}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="sa-password">Password</Label>
                            <div className="relative">
                                <Input
                                    id="sa-password"
                                    type={showPassword ? "text" : "password"}
                                    required
                                    autoComplete="new-password"
                                    minLength={8}
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
                        <div className="space-y-1.5">
                            <Label htmlFor="sa-restaurant">Restaurant name</Label>
                            <Input
                                id="sa-restaurant"
                                required
                                autoComplete="off"
                                placeholder="Spice Junction"
                                value={restaurantName}
                                onChange={(e) => setRestaurantName(e.target.value)}
                                disabled={busy}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Country</Label>
                            <Select value={country} onValueChange={setCountry} disabled={busy}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {COUNTRY_OPTIONS.map((o) => (
                                        <SelectItem key={o.code} value={o.code}>
                                            {o.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Sets the tax model, currency and fiscal year.
                            </p>
                        </div>

                        <DialogFooter className="gap-2">
                            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={busy}>
                                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                                {busy ? "Creating…" : "Create restaurant"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    )
}
