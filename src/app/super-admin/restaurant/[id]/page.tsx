import Link from "next/link"
import { notFound } from "next/navigation"
import {
    ArrowLeft, Building2, Calendar, CreditCard, Globe, Hash, Mail, MapPin, Phone,
    QrCode, Receipt, Shield, Sparkles, TrendingUp, Wallet,
} from "lucide-react"
import QRCode from "qrcode"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { formatCurrency, formatDate } from "@/lib/utils"
import { SalesChart, type SalesPoint } from "./sales-chart"
import { DetailActions } from "./detail-actions"

interface TenantDetail {
    tenant: {
        id: string
        name: string | null
        slug: string | null
        plan: string | null
        plan_tier: string | null
        subscription_status: string | null
        trial_ends_at: string | null
        current_period_end: string | null
        gstin: string | null
        fssai: string | null
        pan: string | null
        phone: string | null
        email: string | null
        website: string | null
        logo_url: string | null
        address_line1: string | null
        address_line2: string | null
        city: string | null
        state: string | null
        state_code: string | null
        pincode: string | null
        country: string | null
        currency: string | null
        timezone: string | null
        fy_start_month: number | null
        invoice_prefix: string | null
        service_charge_percent: number | null
        created_at: string
        branch_count: number
        staff_count: number
    }
    owner: {
        id: string
        full_name: string | null
        email: string | null
        phone: string | null
        avatar_url: string | null
        dob: string | null
        created_at: string
    } | null
    sales: {
        today:    { revenue: number; bill_count: number; avg_ticket: number }
        last_7d:  { revenue: number; bill_count: number; avg_ticket: number }
        last_30d: { revenue: number; bill_count: number; avg_ticket: number }
    }
    daily_30d:   { date: string;  revenue: number; bill_count: number }[]
    monthly_12mo:{ month: string; revenue: number; bill_count: number }[]
    branches:    { id: string; name: string; is_main: boolean; is_active: boolean; city: string | null; created_at: string }[]
}

interface TenantPayments {
    total:    { amount: number; count: number }
    last_30d: { amount: number; count: number }
    by_method: { method: string; amount: number; count: number }[]
    recent: {
        id: string
        method: string
        amount: number
        reference: string | null
        created_at: string
        invoice_number: string | null
        bill_status: string | null
    }[]
}

/** Payment-setup columns from `tenants`. */
interface PaymentConfig {
    upi_id: string | null
    upi_payee_name: string | null
    qr_ordering_enabled: boolean | null
    qr_require_payment: boolean | null
    payment_gateway: string | null
}

/** Non-secret gateway config from `tenant_payment_gateways` (the merchant
 *  key / secrets are deliberately never selected). */
interface GatewayConfig {
    paytm_mid: string | null
    paytm_enabled: boolean | null
    paytm_env: string | null
    stripe_connected_account_id: string | null
    stripe_account_enabled: boolean | null
    stripe_charges_enabled: boolean | null
    stripe_payouts_enabled: boolean | null
    stripe_account_country: string | null
}

/** Friendly labels for the `payments.method` enum. */
const METHOD_LABELS: Record<string, string> = {
    CASH: "Cash",
    UPI: "UPI",
    CARD: "Card",
    RAZORPAY: "Razorpay",
    PHONEPE: "PhonePe",
    PAYTM: "Paytm",
    STRIPE: "Stripe",
    BANK_TRANSFER: "Bank transfer",
    CREDIT: "Credit",
    COMPLIMENTARY: "Complimentary",
    OTHER: "Other",
}
function methodLabel(method: string): string {
    return METHOD_LABELS[method] ?? method
}

/**
 * Super-admin restaurant detail.
 *
 * Single RPC `super_admin_tenant_detail(p_tenant_id)` returns the full
 * payload — header, owner, sales KPIs, daily 30d series, monthly 12mo
 * series, branch list. We render server-side so the page is fast on
 * first paint; the only client islands are the two charts and the
 * action buttons (impersonate / delete) which need state + onClick.
 */
export default async function SuperAdminTenantDetailPage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    const service = createServiceRoleClient()
    // Two RPCs in parallel: the core detail payload, and the payments
    // breakdown. Payments is best-effort — if migration 35 isn't applied
    // the Payments card shows a hint and the rest of the page still works.
    const [detailRes, paymentsRes, cfgRes, gatewayRes] = await Promise.all([
        service.rpc("super_admin_tenant_detail" as never, { p_tenant_id: id } as never),
        service.rpc("super_admin_tenant_payments" as never, { p_tenant_id: id } as never),
        service
            .from("tenants")
            .select("upi_id, upi_payee_name, qr_ordering_enabled, qr_require_payment, payment_gateway")
            .eq("id", id)
            .maybeSingle(),
        service
            .from("tenant_payment_gateways")
            .select("paytm_mid, paytm_enabled, paytm_env, stripe_connected_account_id, stripe_account_enabled, stripe_charges_enabled, stripe_payouts_enabled, stripe_account_country")
            .eq("tenant_id", id)
            .maybeSingle(),
    ])
    const { data, error } = detailRes
    if (error || !data) {
        if ((error as { code?: string } | null)?.code === "PGRST116" || /tenant_not_found/i.test(error?.message ?? "")) {
            notFound()
        }
        return (
            <div className="container mx-auto px-4 py-8">
                <Card className="border-destructive/40 bg-destructive/[0.04]">
                    <CardContent className="py-6 text-sm">
                        <div className="font-semibold mb-1">Couldn&apos;t load tenant.</div>
                        <p className="text-muted-foreground">{error?.message ?? "Unknown error"}</p>
                        <p className="text-muted-foreground mt-2 text-xs">
                            Most common cause: migration 25 hasn&apos;t been applied yet. Run{" "}
                            <code>supabase/migrations/25_super_admin_tenant_detail.sql</code> on your DB.
                        </p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    const d = data as TenantDetail
    const t = d.tenant
    const currency = t.currency ?? "INR"
    const money = (v: number | null | undefined) => formatCurrency(v, currency)

    // Payments — null when migration 35 isn't applied yet.
    const payments = paymentsRes.error ? null : (paymentsRes.data as TenantPayments | null)
    const paymentsMissing = !!paymentsRes.error

    // Payment setup the restaurant configured (UPI, gateway, QR ordering).
    const payCfg = (cfgRes.data ?? null) as PaymentConfig | null
    const gateway = (gatewayRes.data ?? null) as GatewayConfig | null
    const upiId = payCfg?.upi_id?.trim() ?? ""
    const upiPayee = payCfg?.upi_payee_name?.trim() || t.name || "Restaurant"
    let upiQr: string | null = null
    if (upiId) {
        // Standard UPI deep-link → QR. Scanning it in any UPI app pays
        // this restaurant directly.
        const uri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiPayee)}`
        try {
            upiQr = await QRCode.toDataURL(uri, { width: 220, margin: 1 })
        } catch {
            upiQr = null
        }
    }
    const fullAddress = [t.address_line1, t.address_line2, t.city, t.state, t.pincode, t.country]
        .filter((x) => x && String(x).trim().length > 0)
        .join(", ")

    const dailyPoints: SalesPoint[] = d.daily_30d.map((p) => ({
        label: p.date.slice(5),  // "MM-DD" — chart-axis friendly
        revenue: Number(p.revenue),
        bill_count: Number(p.bill_count),
    }))
    const monthlyPoints: SalesPoint[] = d.monthly_12mo.map((p) => ({
        label: p.month,  // "YYYY-MM"
        revenue: Number(p.revenue),
        bill_count: Number(p.bill_count),
    }))

    return (
        <div className="container mx-auto px-4 py-6 space-y-6">
            {/* ── Header row: back link + title + top-right actions ──── */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-2 min-w-0 flex-1">
                    <Link
                        href="/super-admin"
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <ArrowLeft className="h-3 w-3" /> All restaurants
                    </Link>
                    <div className="flex items-center gap-3">
                        {t.logo_url ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={t.logo_url} alt="" className="h-14 w-14 rounded-xl object-cover border border-border/60" />
                        ) : (
                            <div className="h-14 w-14 rounded-xl grid place-items-center bg-border/60r from-primary/30 to-[hsl(var(--neon-magenta)/0.25)] text-primary font-bold text-xl">
                                {(t.name ?? "?").slice(0, 1).toUpperCase()}
                            </div>
                        )}
                        <div className="min-w-0">
                            <h1 className="text-2xl font-bold tracking-tight truncate">
                                {t.name ?? "(unnamed restaurant)"}
                            </h1>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                                {t.slug && <span className="font-mono">{t.slug}</span>}
                                {t.country && <span>· {t.country}</span>}
                                {t.currency && <span>· {t.currency}</span>}
                                <SubscriptionBadge status={t.subscription_status} planTier={t.plan_tier} />
                            </div>
                        </div>
                    </div>
                </div>

                <DetailActions
                    tenantId={t.id}
                    tenantName={t.name ?? "(unnamed restaurant)"}
                    ownerEmail={d.owner?.email ?? null}
                    trialEndsAt={t.trial_ends_at}
                />
            </div>

            {/* ── Sales KPIs ─────────────────────────────────────────── */}
            <section className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <KpiCard label="Today" revenue={d.sales.today.revenue} bills={d.sales.today.bill_count} avg={d.sales.today.avg_ticket} money={money} icon={Receipt} />
                <KpiCard label="Last 7 days" revenue={d.sales.last_7d.revenue} bills={d.sales.last_7d.bill_count} avg={d.sales.last_7d.avg_ticket} money={money} icon={Wallet} />
                <KpiCard label="Last 30 days" revenue={d.sales.last_30d.revenue} bills={d.sales.last_30d.bill_count} avg={d.sales.last_30d.avg_ticket} money={money} icon={TrendingUp} />
            </section>

            {/* ── Sales charts ──────────────────────────────────────── */}
            <section className="grid lg:grid-cols-2 gap-4">
                <Card>
                    <CardContent className="p-4 space-y-3">
                        <div>
                            <h2 className="text-sm font-semibold">Daily revenue · last 30 days</h2>
                            <p className="text-xs text-muted-foreground">Hover bars for exact values.</p>
                        </div>
                        <SalesChart points={dailyPoints} currency={currency} />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4 space-y-3">
                        <div>
                            <h2 className="text-sm font-semibold">Monthly revenue · last 12 months</h2>
                            <p className="text-xs text-muted-foreground">Current month accrues to date.</p>
                        </div>
                        <SalesChart points={monthlyPoints} currency={currency} />
                    </CardContent>
                </Card>
            </section>

            {/* ── Payments ───────────────────────────────────────────── */}
            <section>
                <PaymentsCard payments={payments} missing={paymentsMissing} money={money} />
            </section>

            {/* ── Payment setup (UPI / gateway / QR) ─────────────────── */}
            <section>
                <PaymentSetupCard
                    cfg={payCfg}
                    gateway={gateway}
                    upiId={upiId}
                    upiPayee={payCfg?.upi_payee_name ?? null}
                    upiQr={upiQr}
                />
            </section>

            {/* ── Contact + restaurant details ───────────────────────── */}
            <section className="grid lg:grid-cols-2 gap-4">
                <Card>
                    <CardContent className="p-5 space-y-3">
                        <h2 className="text-sm font-semibold flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5" /> Restaurant details
                        </h2>
                        <Separator />
                        <Field icon={Calendar} label="Joined" value={formatDate(t.created_at, { dateStyle: "long" })} />
                        <Field icon={MapPin} label="Address" value={fullAddress || "—"} />
                        <Field icon={Phone} label="Phone" value={t.phone ?? "—"} />
                        <Field icon={Mail} label="Email" value={t.email ?? "—"} />
                        <Field icon={Globe} label="Website" value={t.website ?? "—"} />
                        <Field icon={Hash} label="GSTIN" value={t.gstin ?? "—"} mono />
                        <Field icon={Hash} label="FSSAI" value={t.fssai ?? "—"} mono />
                        <Field icon={Hash} label="PAN" value={t.pan ?? "—"} mono />
                        <Separator />
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <SmallStat label="Branches" value={t.branch_count.toString()} />
                            <SmallStat label="Staff users" value={t.staff_count.toString()} />
                            <SmallStat label="Invoice prefix" value={t.invoice_prefix ?? "INV"} mono />
                            <SmallStat label="FY starts" value={`Month ${t.fy_start_month ?? 4}`} />
                            <SmallStat label="Timezone" value={t.timezone ?? "—"} />
                            <SmallStat
                                label="Service charge"
                                value={`${Number(t.service_charge_percent ?? 0).toFixed(2)}%`}
                            />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-5 space-y-3">
                        <h2 className="text-sm font-semibold flex items-center gap-1.5">
                            <Shield className="h-3.5 w-3.5" /> Owner account
                        </h2>
                        <Separator />
                        {d.owner ? (
                            <>
                                <div className="flex items-center gap-3">
                                    {d.owner.avatar_url ? (
                                        /* eslint-disable-next-line @next/next/no-img-element */
                                        <img src={d.owner.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover border border-border/60" />
                                    ) : (
                                        <div className="h-12 w-12 rounded-full grid place-items-center bg-muted text-base font-semibold">
                                            {(d.owner.full_name ?? d.owner.email ?? "?").slice(0, 1).toUpperCase()}
                                        </div>
                                    )}
                                    <div className="min-w-0">
                                        <div className="font-semibold truncate">{d.owner.full_name ?? "(no name)"}</div>
                                        <div className="text-xs text-muted-foreground font-mono truncate">{d.owner.email ?? "—"}</div>
                                    </div>
                                </div>
                                <Field icon={Phone} label="Phone" value={d.owner.phone ?? "—"} />
                                <Field icon={Calendar} label="Date of birth" value={d.owner.dob ? formatDate(d.owner.dob, { dateStyle: "long" }) : "—"} />
                                <Field icon={Calendar} label="Account created" value={formatDate(d.owner.created_at, { dateStyle: "medium" })} />
                            </>
                        ) : (
                            <p className="text-sm text-muted-foreground">No OWNER on record for this tenant.</p>
                        )}

                        <Separator />
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                            <Sparkles className="h-3 w-3" /> Subscription
                        </h3>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <SmallStat label="Plan" value={t.plan_tier ?? t.plan ?? "—"} />
                            <SmallStat label="Status" value={t.subscription_status ?? "—"} />
                            <SmallStat label="Trial ends" value={t.trial_ends_at ? formatDate(t.trial_ends_at, { dateStyle: "medium" }) : "—"} />
                            <SmallStat label="Period ends" value={t.current_period_end ? formatDate(t.current_period_end, { dateStyle: "medium" }) : "—"} />
                        </div>
                    </CardContent>
                </Card>
            </section>

            {/* ── Branches ───────────────────────────────────────────── */}
            {d.branches.length > 0 && (
                <Card>
                    <CardContent className="p-5 space-y-3">
                        <h2 className="text-sm font-semibold flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5" /> Branches ({d.branches.length})
                        </h2>
                        <Separator />
                        <ul className="space-y-1.5">
                            {d.branches.map((b) => (
                                <li key={b.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border/30 last:border-0">
                                    <div>
                                        <span className="font-medium">{b.name}</span>
                                        {b.is_main && <Badge variant="outline" className="text-[10px] ml-2">main</Badge>}
                                        {!b.is_active && <Badge variant="destructive" className="text-[10px] ml-2">inactive</Badge>}
                                        {b.city && <span className="text-muted-foreground ml-2 text-xs">{b.city}</span>}
                                    </div>
                                    <span className="text-[10px] text-muted-foreground">
                                        Created {formatDate(b.created_at, { dateStyle: "medium" })}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}

function KpiCard({
    label, revenue, bills, avg, money, icon: Icon,
}: {
    label: string
    revenue: number
    bills: number
    avg: number
    money: (v: number) => string
    icon: typeof Receipt
}) {
    return (
        <Card>
            <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="text-2xl font-bold tabular-nums">{money(revenue)}</div>
                <div className="text-xs text-muted-foreground">
                    {bills} bill{bills === 1 ? "" : "s"} · avg {money(avg)}
                </div>
            </CardContent>
        </Card>
    )
}

function Field({
    icon: Icon, label, value, mono,
}: { icon: typeof Phone; label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex items-start gap-2 text-sm">
            <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
                <div className={mono ? "font-mono text-xs break-all" : "break-words"}>{value}</div>
            </div>
        </div>
    )
}

function SmallStat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="rounded-md bg-muted/30 border border-border/40 px-2.5 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className={mono ? "font-mono text-xs" : "text-sm font-medium"}>{value}</div>
        </div>
    )
}

function SubscriptionBadge({ status, planTier }: { status: string | null; planTier: string | null }) {
    if (!status && !planTier) return null
    const variant = status === "ACTIVE" ? "success"
        : status === "TRIAL" ? "default"
        : status === "PAST_DUE" ? "warning"
        : status ? "destructive"
        : "outline"
    return (
        <span className="flex items-center gap-1">
            {planTier && <Badge variant="outline" className="text-[10px] capitalize">{planTier}</Badge>}
            {status && <Badge variant={variant} className="text-[10px]">{status}</Badge>}
        </span>
    )
}

/**
 * Payment details for the restaurant: all-time + last-30-day totals, a
 * per-method breakdown, and the most recent transactions. Fed by the
 * `super_admin_tenant_payments` RPC (migration 35); degrades to a hint
 * if that RPC isn't deployed.
 */
function PaymentsCard({
    payments, missing, money,
}: {
    payments: TenantPayments | null
    missing: boolean
    money: (v: number | null | undefined) => string
}) {
    return (
        <Card>
            <CardContent className="p-5 space-y-4">
                <h2 className="text-sm font-semibold flex items-center gap-1.5">
                    <CreditCard className="h-3.5 w-3.5" /> Payments
                </h2>
                <Separator />

                {missing || !payments ? (
                    <p className="text-sm text-muted-foreground">
                        Payment details aren&apos;t available — apply migration 35{" "}
                        (<code className="text-xs">35_super_admin_tenant_payments.sql</code>) to the database.
                    </p>
                ) : payments.total.count === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No payments recorded for this restaurant yet.
                    </p>
                ) : (
                    <>
                        {/* Headline totals */}
                        <div className="grid grid-cols-2 gap-3">
                            <PayStat
                                label="All-time collected"
                                value={money(Number(payments.total.amount))}
                                sub={`${payments.total.count} payment${payments.total.count === 1 ? "" : "s"}`}
                            />
                            <PayStat
                                label="Last 30 days"
                                value={money(Number(payments.last_30d.amount))}
                                sub={`${payments.last_30d.count} payment${payments.last_30d.count === 1 ? "" : "s"}`}
                            />
                        </div>

                        {/* By method */}
                        {payments.by_method.length > 0 && (
                            <div className="space-y-2">
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    By payment method
                                </h3>
                                {payments.by_method.map((m) => {
                                    const total = Number(payments.total.amount)
                                    const amt = Number(m.amount)
                                    const pct = total > 0 ? Math.round((amt / total) * 100) : 0
                                    return (
                                        <div key={m.method} className="space-y-1">
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="font-medium">{methodLabel(m.method)}</span>
                                                <span className="tabular-nums text-muted-foreground">
                                                    {money(amt)} · {m.count} · {pct}%
                                                </span>
                                            </div>
                                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                                <div
                                                    className="h-full rounded-full bg-primary"
                                                    style={{ width: `${pct}%` }}
                                                />
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}

                        {/* Recent payments */}
                        {payments.recent.length > 0 && (
                            <div className="space-y-2">
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Recent payments
                                </h3>
                                <div className="overflow-x-auto rounded-md border border-border/40">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Invoice</TableHead>
                                                <TableHead>Method</TableHead>
                                                <TableHead className="text-right">Amount</TableHead>
                                                <TableHead>Reference</TableHead>
                                                <TableHead>When</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {payments.recent.map((p) => (
                                                <TableRow key={p.id}>
                                                    <TableCell className="font-mono text-xs">
                                                        {p.invoice_number ?? "—"}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" className="text-[10px]">
                                                            {methodLabel(p.method)}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right tabular-nums">
                                                        {money(Number(p.amount))}
                                                    </TableCell>
                                                    <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">
                                                        {p.reference ?? "—"}
                                                    </TableCell>
                                                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                                        {formatDate(p.created_at, { dateStyle: "medium", timeStyle: "short" })}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    )
}

function PayStat({ label, value, sub }: { label: string; value: string; sub: string }) {
    return (
        <div className="rounded-md bg-muted/30 border border-border/40 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="text-xl font-bold tabular-nums">{value}</div>
            <div className="text-xs text-muted-foreground">{sub}</div>
        </div>
    )
}

/**
 * Payment setup the restaurant configured — its UPI ID (with a scannable
 * QR generated from it), the online gateway it picked (Paytm / Stripe /
 * manual), and the QR-ordering switches. Secrets (merchant key, Stripe
 * keys) are never fetched, so nothing sensitive is shown.
 */
function PaymentSetupCard({
    cfg, gateway, upiId, upiPayee, upiQr,
}: {
    cfg: PaymentConfig | null
    gateway: GatewayConfig | null
    upiId: string
    upiPayee: string | null
    upiQr: string | null
}) {
    const gw = cfg?.payment_gateway ?? "manual"
    return (
        <Card>
            <CardContent className="p-5 space-y-4">
                <h2 className="text-sm font-semibold flex items-center gap-1.5">
                    <QrCode className="h-3.5 w-3.5" /> Payment setup
                </h2>
                <Separator />

                {/* UPI */}
                <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        UPI
                    </h3>
                    {upiId ? (
                        <div className="flex items-start gap-4 flex-wrap">
                            <div className="space-y-2 text-sm min-w-[180px]">
                                <div>
                                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">UPI ID</div>
                                    <div className="font-mono break-all">{upiId}</div>
                                </div>
                                <div>
                                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Payee name</div>
                                    <div>{upiPayee || "—"}</div>
                                </div>
                            </div>
                            {upiQr && (
                                <div className="text-center">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={upiQr}
                                        alt="UPI payment QR code"
                                        className="h-36 w-36 rounded-md border border-border/60 bg-white p-1"
                                    />
                                    <div className="text-[10px] text-muted-foreground mt-1">Scan to pay</div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">No UPI ID configured.</p>
                    )}
                </div>

                <Separator />

                {/* Online gateway */}
                <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Online payment gateway
                    </h3>
                    {gw === "paytm" ? (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <SmallStat label="Gateway" value="Paytm" />
                            <SmallStat label="Status" value={gateway?.paytm_enabled ? "Enabled" : "Not enabled"} />
                            <SmallStat label="Merchant ID" value={gateway?.paytm_mid || "—"} mono />
                            <SmallStat
                                label="Environment"
                                value={gateway?.paytm_env === "production" ? "Production" : "Staging"}
                            />
                        </div>
                    ) : gw === "stripe" ? (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <SmallStat label="Gateway" value="Stripe" />
                            <SmallStat
                                label="Status"
                                value={gateway?.stripe_charges_enabled ? "Active" : "Incomplete"}
                            />
                            <SmallStat label="Connected account" value={gateway?.stripe_connected_account_id || "—"} mono />
                            <SmallStat label="Country" value={gateway?.stripe_account_country || "—"} />
                            <SmallStat label="Charges" value={gateway?.stripe_charges_enabled ? "Enabled" : "Off"} />
                            <SmallStat label="Payouts" value={gateway?.stripe_payouts_enabled ? "Enabled" : "Off"} />
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            Manual — cash / UPI only, no online payment gateway connected.
                        </p>
                    )}
                </div>

                <Separator />

                {/* QR ordering */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                    <SmallStat label="QR ordering" value={cfg?.qr_ordering_enabled ? "Enabled" : "Disabled"} />
                    <SmallStat
                        label="Payment required on QR order"
                        value={cfg?.qr_require_payment ? "Yes" : "No"}
                    />
                </div>
            </CardContent>
        </Card>
    )
}
