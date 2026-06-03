"use client"

import { useState } from "react"
import { Copy, ExternalLink, Loader2, MessageCircle, Phone } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatCurrency } from "@/lib/utils"
import type { Bill, Tenant } from "@/types/database"

export function PaymentLinkDialog({
    bill,
    tenant,
    open,
    onOpenChange,
    onPaid,
}: {
    bill: Bill
    tenant: Tenant
    open: boolean
    onOpenChange: (v: boolean) => void
    onPaid: () => void
}) {
    const [phone, setPhone] = useState(bill.customer_phone ?? "")
    const [busy, setBusy] = useState<string | null>(null)
    const publicUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/b/${tenant.slug}/${bill.invoice_number}`
    // `onPaid` is wired so callers can refresh once a payment is reported;
    // referenced here to keep the prop meaningful for future channels.
    void onPaid

    async function stripeCheckout() {
        setBusy("stripe")
        try {
            const r = await fetch("/api/payments/stripe/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bill_id: bill.id }),
            })
            const data = await r.json()
            if (!r.ok) throw new Error(data.error)
            window.open(data.url, "_blank")
            onOpenChange(false)
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Stripe failed")
        } finally {
            setBusy(null)
        }
    }

    async function sendNotif(channel: "whatsapp" | "sms") {
        if (!phone.trim()) return toast.error("Phone number required")
        setBusy(channel)
        try {
            const r = await fetch("/api/notifications/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    template: "billGenerated",
                    channel,
                    to: phone.trim(),
                    args: {
                        restaurantName: tenant.name,
                        invoiceNumber: bill.invoice_number,
                        grandTotal: bill.grand_total,
                        publicBillUrl: publicUrl,
                    },
                }),
            })
            const data = await r.json()
            if (!r.ok) throw new Error(data.error)
            toast.success(`Sent via ${channel === "whatsapp" ? "WhatsApp" : "SMS"}`)
            onOpenChange(false)
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Send failed")
        } finally {
            setBusy(null)
        }
    }

    async function copyLink() {
        try {
            await navigator.clipboard.writeText(publicUrl)
            toast.success("Link copied")
        } catch {
            toast.message(publicUrl)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Get paid for {bill.invoice_number}</DialogTitle>
                    <DialogDescription>Amount due: <span className="font-semibold text-foreground">{formatCurrency(bill.grand_total)}</span></DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="link">
                    <TabsList className="grid grid-cols-2 w-full">
                        <TabsTrigger value="link">Send link</TabsTrigger>
                        <TabsTrigger value="online">Card checkout</TabsTrigger>
                    </TabsList>

                    <TabsContent value="link" className="space-y-3 mt-3">
                        <div className="space-y-1.5">
                            <Label>Customer phone</Label>
                            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 ..." />
                        </div>
                        <Button variant="success" className="w-full" onClick={() => sendNotif("whatsapp")} disabled={busy !== null}>
                            {busy === "whatsapp" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                            Send via WhatsApp
                        </Button>
                        <Button variant="outline" className="w-full" onClick={() => sendNotif("sms")} disabled={busy !== null}>
                            {busy === "sms" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                            Send via SMS
                        </Button>
                        <Button variant="ghost" className="w-full" onClick={copyLink}>
                            <Copy className="h-4 w-4" /> Copy public bill link
                        </Button>
                        <p className="text-xs text-muted-foreground break-all">
                            Link: {publicUrl}
                        </p>
                    </TabsContent>

                    <TabsContent value="online" className="space-y-2 mt-3">
                        <Button variant="outline" className="w-full" onClick={stripeCheckout} disabled={busy !== null}>
                            {busy === "stripe" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                            Open Stripe Checkout (international cards)
                        </Button>
                        <p className="text-xs text-muted-foreground pt-2">
                            For UPI payments, the customer scans the PhonePe QR on the POS customer screen.
                            Once they pay, our webhook marks the bill paid automatically.
                        </p>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    )
}
