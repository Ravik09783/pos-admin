"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { ArrowRight, Calendar, CheckCircle2, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

interface FormState {
    name: string
    email: string
    phone: string
    city: string
    restaurant: string
    message: string
}

const EMPTY: FormState = { name: "", email: "", phone: "", city: "", restaurant: "", message: "" }

export function DemoForm() {
    const [form, setForm] = useState<FormState>(EMPTY)
    const [submitting, setSubmitting] = useState(false)
    const [done, setDone] = useState(false)

    const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
        setForm((prev) => ({ ...prev, [k]: v }))

    async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        if (submitting) return

        if (form.name.trim().length < 2) { toast.error("Please enter your name."); return }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) { toast.error("Please enter a valid email address."); return }
        if (form.phone.replace(/\D/g, "").length < 7) { toast.error("Please enter a valid phone number."); return }

        setSubmitting(true)
        try {
            const res = await fetch("/api/marketing/demo-request", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            })
            if (!res.ok) {
                const j = await res.json().catch(() => ({}))
                toast.error(j.error ?? "Couldn't submit your request. Please try again.")
                return
            }
            setDone(true)
            setForm(EMPTY)
        } catch {
            toast.error("Network error — please try again.")
        } finally {
            setSubmitting(false)
        }
    }

    if (done) {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-2xl glass-strong border border-success/40 p-8 md:p-10 text-center"
            >
                <div className="mx-auto mb-4 grid place-items-center h-14 w-14 rounded-full bg-success/15">
                    <CheckCircle2 className="h-7 w-7 text-success" />
                </div>
                <h3 className="text-2xl font-bold mb-2">Thanks — we got your request.</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                    Our team will reach out within one business day to schedule a free, no-obligation walkthrough of RestoPOS for your restaurant.
                </p>
                <Button
                    variant="outline"
                    className="mt-6"
                    onClick={() => setDone(false)}
                >
                    Submit another request
                </Button>
            </motion.div>
        )
    }

    return (
        <motion.form
            onSubmit={onSubmit}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-2xl glass-strong border border-border/60 p-6 md:p-8"
        >
            <div className="flex items-center gap-2 mb-1">
                <Badge variant="neon"><Calendar className="h-3 w-3 mr-1" /> Free 30-min walkthrough</Badge>
            </div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight mt-3">Schedule a free demo</h2>
            <p className="text-sm text-muted-foreground mt-2 mb-6">
                Tell us a little about your restaurant — we&apos;ll call you back within one business day.
            </p>

            <div className="grid sm:grid-cols-2 gap-4">
                <Field id="name" label="Your name" required>
                    <Input
                        id="name"
                        value={form.name}
                        onChange={(e) => update("name", e.target.value)}
                        placeholder="Rahul Sharma"
                        autoComplete="name"
                        required
                    />
                </Field>
                <Field id="email" label="Email" required>
                    <Input
                        id="email"
                        type="email"
                        value={form.email}
                        onChange={(e) => update("email", e.target.value)}
                        placeholder="you@restaurant.com"
                        autoComplete="email"
                        required
                    />
                </Field>
                <Field id="phone" label="Phone / WhatsApp" required>
                    <Input
                        id="phone"
                        type="tel"
                        value={form.phone}
                        onChange={(e) => update("phone", e.target.value)}
                        placeholder="+91 98765 43210"
                        autoComplete="tel"
                        required
                    />
                </Field>
                <Field id="city" label="City">
                    <Input
                        id="city"
                        value={form.city}
                        onChange={(e) => update("city", e.target.value)}
                        placeholder="Mumbai"
                        autoComplete="address-level2"
                    />
                </Field>
                <div className="sm:col-span-2">
                    <Field id="restaurant" label="Restaurant name">
                        <Input
                            id="restaurant"
                            value={form.restaurant}
                            onChange={(e) => update("restaurant", e.target.value)}
                            placeholder="Spice Junction Cafe"
                            autoComplete="organization"
                        />
                    </Field>
                </div>
                <div className="sm:col-span-2">
                    <Field id="message" label="Anything you'd like us to know? (optional)">
                        <Textarea
                            id="message"
                            value={form.message}
                            onChange={(e) => update("message", e.target.value)}
                            placeholder="e.g. 2 outlets, looking to switch from Petpooja, want a CA-friendly setup…"
                            rows={3}
                        />
                    </Field>
                </div>
            </div>

            <Button
                type="submit"
                variant="neon"
                size="xl"
                className="w-full mt-6 text-base"
                disabled={submitting}
            >
                {submitting ? (
                    <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Sending request…
                    </>
                ) : (
                    <>
                        Request my free demo <ArrowRight className="h-4 w-4" />
                    </>
                )}
            </Button>

            <p className="text-xs text-muted-foreground mt-4 text-center">
                No credit card. No obligations. We&apos;ll never share your details.
            </p>
        </motion.form>
    )
}

function Field({ id, label, required, children }: { id: string; label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <Label htmlFor={id} className="text-sm">
                {label} {required && <span className="text-destructive">*</span>}
            </Label>
            {children}
        </div>
    )
}
