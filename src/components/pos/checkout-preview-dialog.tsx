"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import QRCode from "qrcode"
import { AlertTriangle, Banknote, CheckCircle2, CreditCard, Loader2, QrCode, Receipt, Smartphone, Tag, X, Zap } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { cn, formatCurrency } from "@/lib/utils"
import type { OrderTotals } from "@/lib/gst/calculator"
import type { MenuItem, OrderType } from "@/types/database"

/** Optional customer-side capture the cashier collects at checkout. */
export interface CheckoutCustomerDetails {
    name: string
    phone: string
    email: string
}

/** Payment collected at checkout time. Anti-fraud invariant: generate_bill
 *  and record_payment fire together inside the same handler — there is no
 *  staff-facing UI to add payments after a bill exists. */
export type CheckoutPaymentMethod = "CASH" | "UPI" | "CARD"
/** Older code paths still import this name. Kept as an alias so external
 *  consumers don't break — there's no "Google Pay" pill anymore (Google
 *  Pay in India IS UPI, so it's folded into the UPI button which renders
 *  the dynamic QR that every UPI app scans). */
export type CheckoutPaymentRowMethod = CheckoutPaymentMethod
export interface CheckoutPayment {
    method: CheckoutPaymentMethod
    amount: number
    reference: string
}

interface CartLine { item: MenuItem; quantity: number; notes?: string }

const ORDER_TYPE_LABEL: Record<OrderType, string> = {
    DINE_IN: "Dine-in", TAKEAWAY: "Takeaway", DELIVERY: "Delivery", QSR: "QSR / Counter",
}

/** Method metadata. `needsRef` means the cashier MUST type a reference
 *  before Generate is enabled — used for UPI (the 12-digit UTR proves
 *  the customer actually paid). Card reference (last-4) stays optional.
 *  `india_only` hides the method outside India — UPI is India-specific
 *  (Google Pay, PhonePe, Paytm all sit on UPI rails). */
type PaymentMethodMeta = {
    value: CheckoutPaymentMethod
    label: string
    icon: typeof Banknote
    needsRef: boolean
    refRequired: boolean
    india_only: boolean
}
const ALL_PAYMENT_METHODS: PaymentMethodMeta[] = [
    { value: "CASH", label: "Cash", icon: Banknote, needsRef: false, refRequired: false, india_only: false },
    { value: "UPI",  label: "UPI / Google Pay", icon: QrCode, needsRef: true, refRequired: true, india_only: true },
    { value: "CARD", label: "Card", icon: CreditCard, needsRef: true, refRequired: false, india_only: false },
]

/**
 * Checkout dialog — two columns, one screen, one button.
 *
 *  Left column  → who's paying (customer details + no-GST opt-out)
 *  Right column → what's being paid + how (order summary, coupon, payment)
 *
 * Submitting the form generates the bill AND records every payment row in
 * one shot via the parent's onConfirm. There is no "record payment later"
 * escape hatch — the bill detail page no longer offers it.
 */
export function CheckoutPreviewDialog({
    open,
    cart,
    totals,
    totalsNoGst,
    coupon,
    giftCard = null,
    customer,
    orderType,
    tableNo,
    currency = "INR",
    countryCode = "IN",
    singleTaxLabel,
    defaultNoTax = false,
    busy,
    generationStage = "idle",
    qrPayload = null,
    qrError = null,
    canSetupPayments = false,
    couponBusy = false,
    giftCardBusy = false,
    onClose,
    onConfirm,
    onApplyCoupon,
    onRemoveCoupon,
    onApplyGiftCard,
    onRemoveGiftCard,
    onCustomerDetailsChange,
    onPaymentMethodChange,
    paytmAutoConfirm = false,
}: {
    open: boolean
    cart: CartLine[]
    totals: OrderTotals | null
    totalsNoGst: OrderTotals | null
    coupon: { code: string; description: string | null } | null
    /** Applied gift card. `balance` is the card's remaining balance after
     *  this checkout (i.e. balance BEFORE - amount applied). The dialog
     *  shows `amount` as a non-editable GIFT_CARD payment row that's
     *  pre-pended to whatever the cashier collects in cash/UPI/card. */
    giftCard?: { code: string; balance: number; amount: number } | null
    customer: { name: string | null; phone: string; email?: string | null } | null
    orderType: OrderType
    tableNo: string
    currency?: string
    /** ISO 3166-1 alpha-2 (e.g. "IN", "US"). Drives which payment methods
     *  show up — UPI hides outside India because the rails are India-only. */
    countryCode?: string
    singleTaxLabel?: string
    /** Tenant default for the "bill without tax" toggle (Settings → Tax →
     *  "Charge tax on bills"). The cashier can still flip it per bill. */
    defaultNoTax?: boolean
    busy: boolean
    /** Drives the staged "Recording payment → Generating invoice → Done"
     *  text shown above the Generate button so the cashier can see what
     *  the system is doing while the customer display flips to
     *  Processing. "idle" hides the indicator. */
    generationStage?: "idle" | "verifying" | "generating" | "done"
    /** The resolved scan-to-pay QR payload — the EXACT string the customer
     *  display renders, so the dialog can show an identical QR. A Paytm
     *  dynamic QR when Paytm is connected, else a plain merchant-UPI QR.
     *  Null while still resolving, or when UPI can't produce a QR. */
    qrPayload?: string | null
    /** Non-null when UPI can't produce a QR — a human-readable reason
     *  (Paytm rejected it, nothing configured, …) shown to the cashier. */
    qrError?: string | null
    /** True for OWNER / MANAGER — they get a link to fix the payment
     *  setup when `qrError` is shown; plain staff just get the message. */
    canSetupPayments?: boolean
    /** True while the parent is verifying a coupon via validate_coupon. */
    couponBusy?: boolean
    /** True while the parent is verifying a gift card via
     *  validate_gift_card_for_tenant. */
    giftCardBusy?: boolean
    onClose: () => void
    onConfirm: (
        noGst: boolean,
        details: CheckoutCustomerDetails,
        payments: CheckoutPayment[],
    ) => void
    /** Apply a coupon — parent calls validate_coupon and updates its state.
     *  Optional so callers that don't support coupon entry can omit it. */
    onApplyCoupon?: (code: string) => void
    onRemoveCoupon?: () => void
    /** Apply a gift card. Parent validates via validate_gift_card_for_tenant
     *  and updates `giftCard` state. Optional. */
    onApplyGiftCard?: (code: string) => void
    onRemoveGiftCard?: () => void
    /** Fires as the cashier edits the customer fields (and with empty
     *  values once the dialog closes) — lets the parent mirror the
     *  guest's name + phone onto the live customer-facing display. */
    onCustomerDetailsChange?: (details: CheckoutCustomerDetails) => void
    /** Fires with the cashier's selected payment method. The parent uses
     *  it to decide whether the customer display shows a scan-to-pay QR
     *  (UPI) or no QR at all (Cash / Card). */
    onPaymentMethodChange?: (method: CheckoutPaymentMethod) => void
    /** True when a Paytm scan-to-pay QR is live on the customer display.
     *  While the cashier has UPI selected, the bill is generated by the
     *  webhook when the customer pays — so the dialog swaps the manual
     *  "Generate invoice" button for a "Waiting for payment" state. */
    paytmAutoConfirm?: boolean
}) {
    const [noGst, setNoGst] = useState(defaultNoTax)
    const [name, setName] = useState("")
    const [phone, setPhone] = useState("")
    const [email, setEmail] = useState("")
    const [couponInput, setCouponInput] = useState("")
    const [giftCardInput, setGiftCardInput] = useState("")
    const isIndia = countryCode.toUpperCase() === "IN"
    /** Visible method buttons. UPI is hidden outside India regardless of
     *  tenant settings — Google Pay overseas runs on cards via Stripe, not
     *  UPI, so we'd be misleading the cashier if we showed the QR. */
    const paymentMethods = useMemo(
        () => ALL_PAYMENT_METHODS.filter((m) => !m.india_only || isIndia),
        [isIndia],
    )

    // Single payment row — split payments were removed. The data shape stays
    // an array of one so the parent's `onConfirm(payments: CheckoutPayment[])`
    // signature doesn't change. If we ever bring split-pay back, this is
    // the only place to flip.
    interface PaymentRow { method: CheckoutPaymentMethod; amount: string; reference: string }
    const [payments, setPayments] = useState<PaymentRow[]>([
        { method: "CASH", amount: "", reference: "" },
    ])

    const money = (v: number) => formatCurrency(v, currency)
    const t = noGst ? totalsNoGst : totals

    useEffect(() => {
        if (!open) return
        setName(customer?.name ?? "")
        setPhone(customer?.phone ?? "")
        setEmail(customer?.email ?? "")
        setCouponInput("")
        setGiftCardInput("")
        setPayments([{ method: "CASH", amount: "", reference: "" }])
        // Reset to the tenant's "charge tax on bills" default each open.
        setNoGst(defaultNoTax)
    }, [open, customer, defaultNoTax])

    // Auto-fill the cash/UPI/card row's amount to the bill total MINUS
    // whatever the gift card already covers. Re-runs when the gift card
    // is applied or removed mid-checkout so the cashier doesn't have to
    // do math.
    const giftCardAmount = giftCard?.amount ?? 0
    useEffect(() => {
        if (!open || !t) return
        const target = Math.max(0, t.grand_total - giftCardAmount)
        setPayments((rows) => {
            if (rows.length === 1) {
                return [{ ...rows[0]!, amount: target.toFixed(2) }]
            }
            return rows
        })
    }, [open, t, giftCardAmount])

    const trimmedDetails: CheckoutCustomerDetails = useMemo(() => ({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
    }), [name, phone, email])

    // Mirror the customer fields up to the parent as they're typed, so the
    // customer-facing display can greet the guest by name straight away —
    // not only once the bill is generated. Reports empty values while the
    // dialog is closed so a previous sale's name can't linger on screen.
    useEffect(() => {
        onCustomerDetailsChange?.(open ? trimmedDetails : { name: "", phone: "", email: "" })
    }, [open, trimmedDetails, onCustomerDetailsChange])

    // Mirror the selected payment method up so the customer display only
    // shows a scan-to-pay QR when the cashier has picked UPI.
    const activeMethod = payments[0]?.method ?? "CASH"
    useEffect(() => {
        if (open) onPaymentMethodChange?.(activeMethod)
    }, [open, activeMethod, onPaymentMethodChange])

    const grandTotal = t?.grand_total ?? 0
    // Total covered = gift card amount + cash/UPI/card rows. Used for
    // "is fully paid" / change-to-return / disable-on-incomplete checks.
    const cashLikePaid = payments.reduce((s, p) => s + (Number.isFinite(Number(p.amount)) ? Number(p.amount) : 0), 0)
    const totalPaid = giftCardAmount + cashLikePaid
    // A zero-grand-total bill (100% coupon, gift card fully covering, etc.)
    // counts as fully paid without any payment row — the customer owes
    // nothing and the cashier can't enter a 0-amount payment line. The
    // RPC's gating logic agrees: v_total_paid (0) >= v_grand (0) flips
    // the bill straight to PAID.
    const isZeroBill = grandTotal <= 0.005
    const isFullyPaid = isZeroBill || totalPaid >= grandTotal - 0.005
    const remaining = Math.max(0, grandTotal - totalPaid)
    const change = Math.max(0, totalPaid - grandTotal)

    function updatePayment(idx: number, patch: Partial<PaymentRow>) {
        setPayments((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
    }
    // remainingExcluding kept for the cash quick-tender chips — with a
    // single row it just collapses to the grand total.
    function remainingExcluding(_idx: number): number {
        return grandTotal
    }

    if (!t) return null
    const itemCount = cart.reduce((s, c) => s + c.quantity, 0)
    const taxNoun = singleTaxLabel ?? "GST"

    // Scan-to-pay (India / Paytm Business): a *dynamic* QR is live on the
    // customer display. The Paytm webhook generates the bill when the
    // customer pays — the manual Generate button is replaced by a
    // "waiting" state so the sale can't be billed twice. This is the
    // ONLY auto-confirm path. Plain static UPI has no callback, so the
    // cashier still pastes the UTR to prove the payment landed.
    const scanToPay = paytmAutoConfirm === true && payments[0]?.method === "UPI"

    /** True when any non-zero row requires a reference (UPI) and the
     *  cashier hasn't typed one yet. Drives the disable on the Generate
     *  button so a UPI payment can't be "recorded" without the UTR that
     *  proves it actually landed. (The scan-to-pay path bypasses the
     *  whole form — see `scanToPay` above — so this only fires for the
     *  static-UPI / external-QR case.) */
    const missingRequiredRef = payments.some((p) => {
        const meta = ALL_PAYMENT_METHODS.find((m) => m.value === p.method)
        if (!meta?.refRequired) return false
        const amt = Number(p.amount)
        if (!Number.isFinite(amt) || amt <= 0) return false
        return p.reference.trim().length === 0
    })

    function handleConfirm() {
        const cashLike: CheckoutPayment[] = payments
            .map((p) => ({
                method: p.method,
                amount: Number(p.amount),
                reference: p.reference.trim(),
            }))
            .filter((p) => Number.isFinite(p.amount) && p.amount > 0)
        // Prepend the gift-card "payment" so generate_bill's payment
        // loop sees it FIRST. The server-side handler does the balance
        // decrement + transaction log atomically with the bill insert.
        const gcRow: CheckoutPayment[] = giftCard && giftCard.amount > 0
            ? [{ method: "GIFT_CARD" as unknown as CheckoutPaymentMethod, amount: giftCard.amount, reference: giftCard.code }]
            : []
        onConfirm(noGst, trimmedDetails, [...gcRow, ...cashLike])
    }

    function handleApplyCoupon() {
        if (!onApplyCoupon) return
        const code = couponInput.trim()
        if (!code) return
        onApplyCoupon(code)
    }

    function handleApplyGiftCard() {
        if (!onApplyGiftCard) return
        const code = giftCardInput.trim()
        if (!code) return
        onApplyGiftCard(code)
    }

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
            <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto p-0">
                {/* Visually-hidden DialogTitle for screen readers. The
                  * visible header below has a custom layout (icon + title +
                  * subtitle row) that doesn't fit the default <DialogTitle>
                  * styling, so we render an `sr-only` title separately
                  * just to satisfy Radix's a11y contract. */}
                <DialogTitle className="sr-only">
                    Checkout — {ORDER_TYPE_LABEL[orderType]}
                    {orderType === "DINE_IN" && tableNo ? `, table ${tableNo}` : ""}
                </DialogTitle>

                {/* Visible header — runs full width across both columns */}
                <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-border/40">
                    <span className="grid place-items-center h-10 w-10 rounded-lg bg-gradient-to-br from-primary/25 to-[hsl(var(--neon-magenta)/0.2)]">
                        <Receipt className="h-5 w-5 text-primary" />
                    </span>
                    <div className="min-w-0">
                        <div className="text-lg font-bold tracking-tight">Checkout</div>
                        <div className="text-xs text-muted-foreground">
                            {ORDER_TYPE_LABEL[orderType]}
                            {orderType === "DINE_IN" && tableNo ? ` · Table ${tableNo}` : ""}
                            {" · "}{itemCount} item{itemCount > 1 ? "s" : ""}
                            {noGst ? ` · without ${taxNoun}` : ""}
                        </div>
                    </div>
                </div>

                {/* Two-column body. Stacks to a single column on mobile. */}
                <div className="grid sm:grid-cols-2 gap-0 sm:divide-x divide-border/40">
                    {/* ── LEFT: customer details + opt-outs ─────────────── */}
                    <div className="p-5 space-y-4">
                        <SectionHeader title="Customer details" subtitle="Optional — for SMS receipt or B2B GST" />
                        <div className="space-y-2">
                            <Input
                                placeholder="Name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                autoComplete="name"
                            />
                            <Input
                                placeholder="Mobile number"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                autoComplete="tel"
                                inputMode="tel"
                            />
                            <Input
                                placeholder="Email (optional)"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                autoComplete="email"
                                type="email"
                                inputMode="email"
                            />
                        </div>

                        <div className={cn(
                            "flex items-center justify-between rounded-lg border p-3 mt-2",
                            noGst ? "border-yellow-500/50 bg-yellow-500/10" : "border-border/60",
                        )}>
                            <div className="min-w-0">
                                <Label className="text-sm">Bill without {taxNoun}</Label>
                                <p className="text-[11px] text-muted-foreground">Excluded from the CA export.</p>
                            </div>
                            <Switch checked={noGst} onCheckedChange={setNoGst} />
                        </div>
                    </div>

                    {/* ── RIGHT: order, coupon, payment ─────────────────── */}
                    <div className="p-5 space-y-4 bg-muted/10">
                        {/* Order items — compact, scrolls if very long */}
                        <div>
                            <SectionHeader title="Order" subtitle={`${itemCount} item${itemCount > 1 ? "s" : ""}`} />
                            <div className="rounded-lg border border-border/50 divide-y divide-border/40 max-h-40 overflow-y-auto text-sm">
                                {cart.map((c, i) => (
                                    <div key={i} className="flex items-start gap-2 px-3 py-1.5">
                                        <span className="font-mono text-muted-foreground text-xs shrink-0 pt-0.5">{c.quantity}×</span>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium leading-tight truncate">{c.item.name}</div>
                                            {c.notes && <div className="text-[11px] italic text-amber-500 truncate">⤷ {c.notes}</div>}
                                        </div>
                                        <div className="font-medium tabular-nums shrink-0 text-xs">
                                            {money(
                                                (c.item.sale_price != null && Number(c.item.sale_price) < Number(c.item.base_price)
                                                    ? Number(c.item.sale_price)
                                                    : Number(c.item.base_price)
                                                ) * c.quantity,
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Coupon — only renders the apply/remove UI when the
                          * parent passes the handlers. Without them we just
                          * show the badge when a coupon is already applied. */}
                        {onApplyCoupon && (
                            <div>
                                <SectionHeader title="Coupon" subtitle={coupon ? "Applied" : "Got a discount code?"} />
                                {coupon ? (
                                    <div className="flex items-center justify-between rounded-lg border border-success/40 bg-success/10 px-3 py-2">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <Tag className="h-3.5 w-3.5 text-success shrink-0" />
                                                <span className="font-mono font-semibold text-sm">{coupon.code}</span>
                                            </div>
                                            {coupon.description && (
                                                <div className="text-[11px] text-muted-foreground truncate">{coupon.description}</div>
                                            )}
                                        </div>
                                        {onRemoveCoupon && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                                onClick={onRemoveCoupon}
                                                aria-label="Remove coupon"
                                                disabled={busy}
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex gap-2">
                                        <Input
                                            value={couponInput}
                                            onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleApplyCoupon() } }}
                                            placeholder="CODE"
                                            className="font-mono uppercase"
                                            disabled={busy || couponBusy}
                                        />
                                        <Button
                                            variant="outline"
                                            onClick={handleApplyCoupon}
                                            disabled={!couponInput.trim() || busy || couponBusy}
                                        >
                                            {couponBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Gift card — same shape as Coupon. Applying a card
                          * adds an automatic GIFT_CARD payment row that
                          * generate_bill validates + decrements the balance
                          * for, atomically with the bill insert. The cashier
                          * collects only the remainder via cash/UPI/card. */}
                        {onApplyGiftCard && (
                            <div>
                                <SectionHeader
                                    title="Gift card"
                                    subtitle={giftCard ? `${money(giftCard.amount)} applied` : "Got a gift card?"}
                                />
                                {giftCard ? (
                                    <div className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/10 px-3 py-2">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <Tag className="h-3.5 w-3.5 text-primary shrink-0" />
                                                <span className="font-mono font-semibold text-sm">{giftCard.code}</span>
                                            </div>
                                            <div className="text-[11px] text-muted-foreground">
                                                {money(giftCard.amount)} applied · {money(giftCard.balance)} left after this bill
                                            </div>
                                        </div>
                                        {onRemoveGiftCard && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                                onClick={onRemoveGiftCard}
                                                aria-label="Remove gift card"
                                                disabled={busy}
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex gap-2">
                                        <Input
                                            value={giftCardInput}
                                            onChange={(e) => setGiftCardInput(e.target.value.toUpperCase())}
                                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleApplyGiftCard() } }}
                                            placeholder="GIFT CODE"
                                            className="font-mono uppercase"
                                            disabled={busy || giftCardBusy}
                                        />
                                        <Button
                                            variant="outline"
                                            onClick={handleApplyGiftCard}
                                            disabled={!giftCardInput.trim() || busy || giftCardBusy}
                                        >
                                            {giftCardBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Totals */}
                        <div className="rounded-lg bg-card border border-border/50 p-3 space-y-1 text-sm">
                            <Row label="Subtotal" value={money(t.subtotal)} />
                            {t.order_discount > 0 && (
                                <Row
                                    label={`Coupon${coupon?.code ? ` (${coupon.code})` : ""}`}
                                    value={`− ${money(t.order_discount)}`}
                                    className="text-success"
                                />
                            )}
                            {noGst ? (
                                <Row label={taxNoun} value="Not applicable" className="text-muted-foreground" />
                            ) : singleTaxLabel ? (
                                t.igst_amount > 0 && <Row label={singleTaxLabel} value={money(t.igst_amount)} />
                            ) : (
                                <>
                                    {t.cgst_amount > 0 && <Row label="CGST" value={money(t.cgst_amount)} />}
                                    {t.sgst_amount > 0 && <Row label="SGST" value={money(t.sgst_amount)} />}
                                    {t.igst_amount > 0 && <Row label="IGST" value={money(t.igst_amount)} />}
                                </>
                            )}
                            {t.service_charge > 0 && <Row label="Service charge" value={money(t.service_charge)} />}
                            {t.round_off !== 0 && <Row label="Round off" value={money(t.round_off)} />}
                            <div className="border-t border-border/40 pt-2 mt-1">
                                <Row
                                    label="Grand total"
                                    value={money(grandTotal)}
                                    className="font-bold text-lg"
                                />
                            </div>
                        </div>

                        {/* Payment — gift card applied (if any) shows as a
                          * non-editable tile above the cash/UPI/card row.
                          * The cash row's amount auto-fills to whatever's
                          * left after the gift card so the cashier never
                          * has to do arithmetic. */}
                        <div>
                            <SectionHeader
                                title="Payment"
                                subtitle={
                                    isFullyPaid
                                        ? (change > 0 ? `Change ${money(change)}` : "Fully paid")
                                        : `${money(remaining)} pending`
                                }
                                subtitleClassName={isFullyPaid ? "text-success" : "text-warning"}
                            />
                            {giftCard && giftCard.amount > 0 && (
                                <div className="rounded-md border border-primary/40 bg-primary/[0.06] px-3 py-2 mb-2 flex items-center gap-2 text-sm">
                                    <Tag className="h-3.5 w-3.5 text-primary shrink-0" />
                                    <span className="font-mono text-xs">{giftCard.code}</span>
                                    <span className="text-muted-foreground text-xs ml-1">covers</span>
                                    <span className="font-semibold tabular-nums ml-auto">{money(giftCard.amount)}</span>
                                </div>
                            )}
                            <div className="space-y-3">
                                {payments.map((row, idx) => {
                                    const needsRef = ALL_PAYMENT_METHODS.find((m) => m.value === row.method)?.needsRef ?? false
                                    const rowAmt = Number(row.amount)
                                    const rowRemaining = remainingExcluding(idx)
                                    return (
                                        <div
                                            key={idx}
                                            className="rounded-lg border border-transparent p-2.5 space-y-2"
                                        >
                                            <div className={cn(
                                                "grid gap-1.5",
                                                paymentMethods.length === 2 ? "grid-cols-2" : "grid-cols-3",
                                            )}>
                                                {paymentMethods.map((m) => {
                                                    const active = m.value === row.method
                                                    const Icon = m.icon
                                                    return (
                                                        <button
                                                            type="button"
                                                            key={m.value}
                                                            onClick={() => updatePayment(idx, { method: m.value })}
                                                            className={cn(
                                                                "flex flex-col items-center gap-1 rounded-md border py-1.5 transition-colors text-[11px] font-medium",
                                                                active
                                                                    ? "border-primary bg-primary/10 text-primary"
                                                                    : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border",
                                                            )}
                                                        >
                                                            <Icon className="h-4 w-4" />
                                                            {m.label}
                                                        </button>
                                                    )
                                                })}
                                            </div>

                                            {/* UPI — ONE QR, the SAME one on both
                                              * screens. The server route resolves it
                                              * (Paytm dynamic QR if the owner connected
                                              * Paytm → else a plain merchant-UPI QR)
                                              * and the customer screen + this dialog
                                              * render the identical payload. If
                                              * nothing is configured, the cashier is
                                              * told plainly. */}
                                            {row.method === "UPI" && (
                                                qrPayload ? (
                                                    <div className="rounded-lg border border-primary/30 bg-primary/[0.05] p-3 space-y-2.5">
                                                        <div className="flex items-start gap-2">
                                                            <Smartphone className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                                                            <p className="text-xs leading-snug">
                                                                <span className="font-semibold text-foreground">The customer is scanning this QR on their screen.</span>{" "}
                                                                <span className="text-muted-foreground">
                                                                    {scanToPay
                                                                        ? "The moment they pay, the bill generates itself and this checkout closes — you enter nothing."
                                                                        : "Once they pay, paste the UTR into the reference field below to confirm it."}
                                                                </span>
                                                            </p>
                                                        </div>
                                                        <ScanQrImage
                                                            value={qrPayload}
                                                            amount={Number(row.amount) || grandTotal}
                                                            money={money}
                                                        />
                                                        {/* Static UPI fallback can't push payment events back to us —
                                                          * there's no UPI webhook for a plain `upi://pay?…` intent.
                                                          * Tell the OWNER how to upgrade to a gateway QR that DOES
                                                          * auto-confirm, so the cashier never has to touch Generate. */}
                                                        {!scanToPay && canSetupPayments && (
                                                            <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-[11px] leading-snug flex items-start gap-2">
                                                                <Zap className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                                                                <span>
                                                                    <strong className="text-foreground">Want this to auto-confirm?</strong>{" "}
                                                                    <span className="text-muted-foreground">
                                                                        Connect Paytm Business — once a payment lands on the dynamic QR, the bill generates itself and the cashier doesn&apos;t touch anything.
                                                                    </span>
                                                                    {" "}
                                                                    <Link
                                                                        href="/settings/payments"
                                                                        className="font-medium text-primary hover:underline whitespace-nowrap"
                                                                    >
                                                                        Connect →
                                                                    </Link>
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : qrError ? (
                                                    <div className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2.5 text-xs">
                                                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
                                                        <div className="leading-snug">
                                                            <strong className="text-foreground">UPI QR couldn&apos;t be shown.</strong>
                                                            <p className="text-muted-foreground mt-1">{qrError}</p>
                                                            {canSetupPayments ? (
                                                                <Link
                                                                    href="/settings/payments"
                                                                    className="mt-1.5 inline-block font-medium text-primary hover:underline"
                                                                >
                                                                    Set up the payment gateway →
                                                                </Link>
                                                            ) : (
                                                                <p className="text-muted-foreground mt-1">
                                                                    Take payment by Cash or Card, or ask the owner to set it up.
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                                                        Preparing the customer&apos;s QR…
                                                    </div>
                                                )
                                            )}

                                            <div className={cn("grid gap-2", needsRef ? "grid-cols-2" : "grid-cols-1", scanToPay && "hidden")}>
                                                <div className="space-y-1">
                                                    <Label className="text-xs text-muted-foreground">
                                                        {row.method === "CASH" ? "Cash collected" : "Amount"}
                                                    </Label>
                                                    <Input
                                                        type="number"
                                                        inputMode="decimal"
                                                        step="0.01"
                                                        min="0"
                                                        value={row.amount}
                                                        onChange={(e) => updatePayment(idx, { amount: e.target.value })}
                                                    />
                                                </div>
                                                {needsRef && (
                                                    <div className="space-y-1">
                                                        <Label className={cn(
                                                            "text-xs",
                                                            row.method === "UPI"
                                                                ? "text-foreground font-medium"
                                                                : "text-muted-foreground",
                                                        )}>
                                                            {row.method === "UPI"
                                                                ? "UPI reference *"
                                                                : "Card last-4 (optional)"}
                                                        </Label>
                                                        <Input
                                                            value={row.reference}
                                                            onChange={(e) => updatePayment(idx, { reference: e.target.value })}
                                                            placeholder={row.method === "UPI" ? "12-digit UTR from merchant app" : "1234"}
                                                            className={cn(
                                                                row.method === "UPI" && Number(row.amount) > 0 && !row.reference.trim() &&
                                                                "border-warning/60 focus-visible:ring-warning",
                                                            )}
                                                        />
                                                        {row.method === "UPI" && (
                                                            <p className="text-[10px] text-muted-foreground leading-tight">
                                                                Required — paste the UTR from your UPI merchant app once the payment lands.
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {row.method === "CASH" && rowRemaining > 0 && (
                                                <div className="flex flex-wrap gap-1.5">
                                                    <TenderChip
                                                        label={`Exact ${money(rowRemaining)}`}
                                                        onClick={() => updatePayment(idx, { amount: rowRemaining.toFixed(2) })}
                                                        active={Math.abs(rowAmt - rowRemaining) < 0.005}
                                                    />
                                                    {quickCashTenders(rowRemaining).map((v) => (
                                                        <TenderChip
                                                            key={v}
                                                            label={money(v)}
                                                            onClick={() => updatePayment(idx, { amount: v.toFixed(2) })}
                                                            active={Math.abs(rowAmt - v) < 0.005}
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}

                                {/* Big, prominent change display — the cashier's
                                  * cue to hand cash back to the customer. */}
                                {change > 0 && (
                                    <div className="flex items-center justify-between rounded-lg bg-success/10 border border-success/40 px-3 py-2.5">
                                        <span className="text-sm font-medium text-success">Change to return</span>
                                        <span className="text-2xl font-bold tabular-nums text-success">{money(change)}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Staged progress indicator while the bill is being
                  * generated. Sits above the footer so the cashier reads
                  * left-to-right: status → action button. Mirrors what
                  * the customer display is showing on the 2nd screen. */}
                {generationStage !== "idle" && (
                    <div className="px-5 pt-3">
                        <GenerationStageIndicator stage={generationStage} />
                    </div>
                )}

                {/* Footer — full-width action row */}
                <div className="flex gap-2 px-5 py-4 border-t border-border/40 bg-background sticky bottom-0">
                    <Button variant="ghost" onClick={onClose} disabled={busy} className="shrink-0">
                        ← Back to edit
                    </Button>
                    {scanToPay ? (
                        // Scan-to-pay: no manual Generate button — the webhook
                        // generates the bill when the customer pays, and the
                        // POS closes this dialog the instant it confirms.
                        <div className="flex-1 min-w-0 flex items-center justify-center gap-2.5 rounded-md border border-primary/40 bg-primary/[0.06] px-4 py-2.5 text-sm font-medium">
                            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                            <span className="truncate">Waiting for the customer to pay · {money(grandTotal)}</span>
                        </div>
                    ) : (
                        <Button
                            variant="neon"
                            className="flex-1 min-w-0"
                            size="lg"
                            disabled={busy || !isFullyPaid || missingRequiredRef}
                            onClick={handleConfirm}
                        >
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            {!isFullyPaid
                                ? `Add ${money(remaining)} to continue`
                                : missingRequiredRef
                                    ? "Enter UPI reference to continue"
                                    : `Generate invoice · ${money(grandTotal)}`}
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}

function SectionHeader({ title, subtitle, subtitleClassName }: { title: string; subtitle?: string; subtitleClassName?: string }) {
    return (
        <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider font-semibold text-foreground">{title}</span>
            {subtitle && (
                <span className={cn("text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", subtitleClassName)}>
                    {subtitle}
                </span>
            )}
        </div>
    )
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
    return (
        <div className={cn("flex items-center justify-between", className)}>
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium tabular-nums">{value}</span>
        </div>
    )
}

function TenderChip({
    label, onClick, active,
}: { label: string; onClick: () => void; active: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "px-2.5 py-1 rounded-md border text-xs font-medium tabular-nums transition-colors",
                active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/60 hover:bg-muted/50 text-muted-foreground hover:text-foreground",
            )}
        >
            {label}
        </button>
    )
}

/**
 * Renders a QR image from an already-resolved payment payload.
 *
 * The payload is whatever the POS put on the customer screen — a Paytm
 * dynamic QR string, or a plain `upi://pay?…` intent. We deliberately do
 * NOT build the URL here: rendering the parent's exact payload guarantees
 * the staff screen and the customer screen show the identical QR.
 */
/** Pull the payee UPI ID (the `pa` parameter) out of a `upi://pay?…`
 *  string — works for a plain UPI intent and a Paytm dynamic QR alike. */
function upiIdFromIntent(value: string): string | null {
    const m = /[?&]pa=([^&]+)/i.exec(value)
    if (!m || !m[1]) return null
    try { return decodeURIComponent(m[1]) } catch { return m[1] }
}

function ScanQrImage({
    value, amount, money,
}: {
    value: string
    amount: number
    money: (v: number) => string
}) {
    const [qrCodeUrl, setQrCodeUrl] = useState("")
    const upiId = upiIdFromIntent(value)
    useEffect(() => {
        let cancelled = false
        // High error-correction so the QR stays scannable under screen
        // glare or a slightly misaligned phone camera.
        QRCode.toDataURL(value, {
            margin: 1,
            width: 320,
            errorCorrectionLevel: "H",
            color: { dark: "#0a0e1a", light: "#ffffff" },
        })
            .then((u) => { if (!cancelled) setQrCodeUrl(u) })
            .catch(() => { if (!cancelled) setQrCodeUrl("") })
        return () => { cancelled = true }
    }, [value])

    return (
        <div className="space-y-2">
            <div className="rounded-lg border border-primary/30 bg-white p-3">
                <div className="grid min-h-[200px] place-items-center">
                    {qrCodeUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={qrCodeUrl} alt={`Payment QR for ${money(amount)}`} className="mx-auto max-h-56 w-auto" />
                    ) : (
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    )}
                </div>
            </div>
            {upiId && (
                <div className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-card/60 px-2.5 py-1.5 text-xs">
                    <span className="text-muted-foreground">UPI ID</span>
                    <span className="font-mono font-medium text-foreground truncate">{upiId}</span>
                </div>
            )}
            <p className="text-center text-[11px] text-muted-foreground">
                The exact QR on the customer screen — {money(amount)}
            </p>
        </div>
    )
}

/** Renders the three-stage progress for the cashier while a bill is being
 *  generated. We don't need a fancy progress bar — a horizontal pill with
 *  checkmarks for completed stages + a spinner for the current one is
 *  enough to read at a glance. */
function GenerationStageIndicator({ stage }: { stage: "verifying" | "generating" | "done" }) {
    const stages: { key: "verifying" | "generating" | "done"; label: string }[] = [
        { key: "verifying", label: "Recording payment" },
        { key: "generating", label: "Generating invoice" },
        { key: "done", label: "Done" },
    ]
    const order = stages.map((s) => s.key)
    const currentIdx = order.indexOf(stage)
    return (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/[0.04] px-3 py-2 text-sm">
            {stages.map((s, idx) => {
                const isDone = idx < currentIdx
                const isActive = idx === currentIdx
                return (
                    <div key={s.key} className="flex items-center gap-1.5">
                        <span className={cn(
                            "h-5 w-5 rounded-full grid place-items-center shrink-0 transition-colors",
                            isDone ? "bg-success text-success-foreground" : isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                        )}>
                            {isDone ? <CheckCircle2 className="h-3 w-3" /> : isActive ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="text-[10px] font-bold">{idx + 1}</span>}
                        </span>
                        <span className={cn(
                            "text-xs font-medium",
                            isDone ? "text-success" : isActive ? "text-foreground" : "text-muted-foreground",
                        )}>
                            {s.label}
                        </span>
                        {idx < stages.length - 1 && (
                            <span className={cn(
                                "h-px w-4 mx-0.5",
                                idx < currentIdx ? "bg-success" : "bg-border",
                            )} />
                        )}
                    </div>
                )
            })}
        </div>
    )
}

function quickCashTenders(grandTotal: number): number[] {
    if (!Number.isFinite(grandTotal) || grandTotal <= 0) return []
    const candidates = [
        Math.ceil(grandTotal / 100) * 100,
        Math.ceil(grandTotal / 500) * 500,
        Math.ceil(grandTotal / 1000) * 1000,
    ]
    const out: number[] = []
    for (const c of candidates) {
        if (c > grandTotal && !out.includes(c) && out.length < 3) out.push(c)
    }
    return out
}
