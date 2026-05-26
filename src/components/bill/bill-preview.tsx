"use client"

/**
 * Renders a printed bill for a given `BillDesign`. Used three ways:
 *   1. the Bill Designer's live preview (no `data` → sample bill)
 *   2. the public verified-bill page  (`data` from the real bill)
 *   3. the in-app bill detail / print  (`data` from the real bill)
 *
 * Six layouts (see `BillLayout`): thermal-classic, thermal-modern, qsr-token,
 * invoice-a4, invoice-grid, card-boutique. Tax wording follows the tenant's
 * country (GST / VAT / Sales Tax / TVA …) — never a hard-coded "GST".
 */

import { getTaxConfig } from "@/lib/tax/locale-config"
import type { BillDesign } from "@/lib/bill/templates"
import type { RenderedBillData } from "@/lib/bill/render"
import { cn, formatCurrency, formatDate } from "@/lib/utils"

interface PreviewTenant {
    name: string
    address_line1?: string | null
    city?: string | null
    pincode?: string | null
    phone?: string | null
    gstin?: string | null
    fssai?: string | null
    logo_url?: string | null
    country?: string | null
}

const SAMPLE_ITEMS = [
    { name: "Margherita Pizza", hsn: "996331", qty: 1, rate: 320, taxPct: 5, lineTotal: 320 },
    { name: "Garlic Bread", hsn: "996331", qty: 2, rate: 110, taxPct: 5, lineTotal: 220 },
    { name: "Iced Latte", hsn: "996331", qty: 2, rate: 180, taxPct: 5, lineTotal: 360 },
    { name: "Tiramisu", hsn: "996331", qty: 1, rate: 240, taxPct: 5, lineTotal: 240 },
]

export function BillPreview({
    design,
    tenant,
    data,
    verifyQrUrl,
    id,
    className,
}: {
    design: BillDesign
    tenant: PreviewTenant
    /** Real bill data. Omit for the designer's sample preview. */
    data?: RenderedBillData
    /** Data-URL of the verification QR (real bills); the preview shows a placeholder if absent. */
    verifyQrUrl?: string
    id?: string
    className?: string
}) {
    const cfg = getTaxConfig(tenant.country)
    const money = (v: number) => formatCurrency(v, cfg.currency)
    const isIndia = cfg.code === "IN"
    const taxIdLabel = cfg.taxIdLabel
    const sampleTaxId = isIndia ? "29ABCDE1234F1Z5" : cfg.code === "AE" ? "100123456700003" : cfg.code === "SA" ? "300123456700003" : cfg.code === "GB" ? "GB123456789" : "TAX-123456"
    const taxId = tenant.gstin || sampleTaxId

    // ── Resolve the bill being rendered (real `data`, or a sample) ──────────
    const rate = isIndia ? 5 : (cfg.defaultRate || 5)
    const sampleSubtotal = SAMPLE_ITEMS.reduce((s, i) => s + i.lineTotal, 0)
    const sampleTax = Math.round(sampleSubtotal * rate) / 100
    const sampleSvc = cfg.serviceChargeAllowed && design.show_service_charge_line ? Math.round(sampleSubtotal * 5) / 100 : 0
    const sampleTaxLines: { label: string; amount: number }[] = !design.show_tax_breakup || cfg.taxModel === "none"
        ? []
        : cfg.taxModel === "split" && design.tax_breakup === "split"
            ? (() => { const half = Math.round(sampleTax * 50) / 100; return [{ label: cfg.taxLabels.cgst ?? "CGST", amount: half }, { label: cfg.taxLabels.sgst ?? "SGST", amount: sampleTax - half }] })()
            : [{ label: cfg.taxModel === "split" ? "GST" : (cfg.taxLabels.single ?? cfg.taxShortName), amount: sampleTax }]

    const b: RenderedBillData = data ?? {
        invoiceNumber: `${isIndia ? "INV-2025-26-" : "INV-"}00042`,
        // a fixed sample date — must be deterministic so this client component
        // doesn't trip a hydration mismatch when it SSRs in the Designer.
        date: "2026-01-15T12:30:00.000Z",
        fyLabel: isIndia ? "2025-26" : null,
        status: "PAID",
        taxExcluded: !design.show_tax_breakup || cfg.taxModel === "none",
        items: SAMPLE_ITEMS,
        subtotal: sampleSubtotal,
        discount: 0,
        taxableAmount: sampleSubtotal,
        taxLines: sampleTaxLines,
        serviceCharge: sampleSvc,
        roundOff: 0,
        grandTotal: sampleSubtotal + sampleTaxLines.reduce((s, l) => s + l.amount, 0) + sampleSvc,
        customer: null,
        tableNo: "T7",
        serverName: "Aanya",
    }

    const dateStr = typeof b.date === "string" ? formatDate(b.date) : b.date.toLocaleDateString(cfg.locale)
    const showHsn = isIndia && design.show_hsn
    const showTaxCol = design.show_item_tax_col && !b.taxExcluded
    const showSvc = (b.serviceCharge ?? 0) > 0
    const showRound = (b.roundOff ?? 0) !== 0
    const headerTitle = b.taxExcluded ? "INVOICE" : "TAX INVOICE"

    const fontClass = design.font === "mono" ? "font-mono" : design.font === "serif" ? "font-serif" : "font-sans"
    const padClass = design.density === "compact" ? "p-2.5" : design.density === "roomy" ? "p-6" : "p-4"
    const gapClass = design.density === "compact" ? "space-y-1" : design.density === "roomy" ? "space-y-3" : "space-y-2"
    const maxW = design.width === "58mm" ? "260px" : design.width === "80mm" ? "340px" : design.width === "A5" ? "460px" : "100%"

    // ── Shared bits ────────────────────────────────────────────────────────
    const Logo = () =>
        design.show_logo ? (
            tenant.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tenant.logo_url} alt="" className="mx-auto h-12 w-12 rounded object-cover mb-1" />
            ) : (
                <div className="mx-auto h-12 w-12 rounded-full grid place-items-center mb-1 text-white text-lg font-bold" style={{ background: design.accent_color }}>
                    {tenant.name.slice(0, 1).toUpperCase()}
                </div>
            )
        ) : null

    const TaxLines = () => <>{b.taxLines.map((l, i) => <Line key={i} l={l.label} v={money(l.amount)} />)}</>

    const HeaderBlock = ({ centered = true }: { centered?: boolean }) => (
        <div className={cn(centered ? "text-center" : "text-left")}>
            {centered && <Logo />}
            <div className={cn("font-bold", design.layout === "invoice-a4" || design.layout === "invoice-grid" ? "text-xl" : "text-lg")}>{tenant.name}</div>
            {design.bilingual_ar && <div className="text-sm" dir="rtl">{tenant.name}</div>}
            {tenant.address_line1 && <div className="text-xs">{tenant.address_line1}</div>}
            {(tenant.city || tenant.pincode) && <div className="text-xs">{tenant.city} {tenant.pincode}</div>}
            {tenant.phone && <div className="text-xs">{tenant.phone}</div>}
            {design.show_tax_id && <div className="text-xs">{taxIdLabel}: <span className="font-medium">{taxId}</span>{design.bilingual_ar ? " / الرقم الضريبي" : ""}</div>}
            {isIndia && design.show_fssai && (tenant.fssai || !data) && <div className="text-xs">FSSAI: {tenant.fssai ?? "12345678901234"}</div>}
        </div>
    )

    const MetaRows = () => (
        <div className="text-xs space-y-0.5">
            <Line l="Bill #" v={b.invoiceNumber} />
            <Line l="Date" v={dateStr} />
            {b.tableNo && <Line l="Table" v={b.tableNo} />}
            {b.serverName && <Line l="Server" v={b.serverName} />}
            {b.fyLabel && <Line l="FY" v={b.fyLabel} />}
        </div>
    )

    const CustomerBlock = () =>
        b.customer ? (
            <div className="rounded border border-gray-300 p-2 text-xs">
                <div className="text-gray-500 uppercase text-[10px]">Bill to</div>
                <div className="font-medium">{b.customer.name}</div>
                {b.customer.phone && <div>{b.customer.phone}</div>}
                {b.customer.taxId && <div className="text-[10px]">{taxIdLabel}: {b.customer.taxId}</div>}
            </div>
        ) : null

    const ItemTable = ({ ruled }: { ruled: "dashed" | "solid" | "none" }) => {
        const rule = ruled === "dashed" ? "border-dashed border-gray-400" : ruled === "solid" ? "border-gray-300" : "border-transparent"
        return (
            <table className={cn("w-full text-xs border-t", rule, "pt-1")}>
                <thead>
                    <tr className={cn("border-b", rule)}>
                        {design.show_serial && <th className="text-left py-1 pr-1">#</th>}
                        <th className="text-left py-1">Item</th>
                        {showHsn && <th className="text-left px-1">HSN</th>}
                        <th className="text-right px-1">Qty</th>
                        <th className="text-right px-1">Rate</th>
                        {showTaxCol && <th className="text-right px-1">{cfg.taxModel === "split" ? "GST%" : `${cfg.taxShortName}%`}</th>}
                        <th className="text-right pl-1">Amt</th>
                    </tr>
                </thead>
                <tbody>
                    {b.items.map((it, i) => (
                        <tr key={i} className={ruled !== "none" ? "" : "border-b border-gray-100"}>
                            {design.show_serial && <td className="py-0.5 pr-1 align-top">{i + 1}</td>}
                            <td className="py-0.5">
                                <div>{it.name}</div>
                                {it.notes && <div className="text-[10px] text-gray-500 italic">{it.notes}</div>}
                            </td>
                            {showHsn && <td className="px-1 align-top text-[10px]">{it.hsn ?? "—"}</td>}
                            <td className="text-right px-1 align-top">{it.qty}</td>
                            <td className="text-right px-1 align-top">{money(it.rate)}</td>
                            {showTaxCol && <td className="text-right px-1 align-top">{it.taxPct}%</td>}
                            <td className="text-right pl-1 align-top">{money(it.lineTotal)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        )
    }

    const TotalsBlock = ({ emphasis }: { emphasis: "plain" | "box" | "rule" }) => (
        <div className="text-xs space-y-0.5">
            <Line l="Subtotal" v={money(b.subtotal)} />
            {(b.discount ?? 0) > 0 && <Line l="Discount" v={`- ${money(b.discount!)}`} />}
            {!b.taxExcluded && b.taxableAmount != null && b.taxLines.length > 0 && <Line l="Taxable amount" v={money(b.taxableAmount)} />}
            {showSvc && <Line l="Service charge" v={money(b.serviceCharge!)} />}
            <TaxLines />
            {showRound && <Line l="Round off" v={money(b.roundOff!)} />}
            <div
                className={cn(
                    "flex justify-between font-bold text-sm mt-1",
                    emphasis === "box" && "border rounded px-2 py-1",
                    emphasis === "rule" && "border-t pt-1",
                )}
                style={emphasis === "box" ? { borderColor: design.accent_color, color: design.accent_color } : undefined}
            >
                <span>{design.bilingual_ar ? "TOTAL / الإجمالي" : "TOTAL"}</span>
                <span>{money(b.grandTotal)}</span>
            </div>
            {(b.paid ?? 0) > 0 && <Line l="Paid" v={money(b.paid!)} />}
            {(b.balanceDue ?? 0) > 0 && <div className="flex justify-between font-semibold pt-0.5"><span>Balance due</span><span>{money(b.balanceDue!)}</span></div>}
        </div>
    )

    const VerifyQr = ({ small = false }: { small?: boolean }) => {
        const cls = small ? "h-14 w-14" : "h-16 w-16"
        return verifyQrUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={verifyQrUrl} alt="Verification QR" className={cn(cls, "border border-gray-300 mx-auto")} />
        ) : (
            <div className={cn(cls, "inline-grid place-items-center bg-gray-200 text-[7px] font-mono text-gray-500 mx-auto")}>VERIFY QR</div>
        )
    }

    const QrBlock = () => (
        <>
            {design.show_qr_upi && isIndia && (
                <div className="text-center mt-2 pt-2 border-t border-dashed border-gray-400">
                    <div className="inline-grid place-items-center h-16 w-16 bg-gray-200 text-[7px] font-mono mx-auto">UPI QR</div>
                    <div className="text-[10px]">Scan to pay via UPI</div>
                </div>
            )}
            {design.show_qr_verify && (
                <div className="text-center mt-2 pt-2 border-t border-dashed border-gray-400">
                    <VerifyQr />
                    <div className="text-[10px] text-gray-500">Scan to verify this bill</div>
                </div>
            )}
        </>
    )

    const FooterMsg = () => (
        <div className="text-center text-xs mt-2 pt-2 border-t border-dashed border-gray-400 whitespace-pre-line">{design.footer_message}</div>
    )

    // ── Layout switch ──────────────────────────────────────────────────────
    let bodyContent: React.ReactNode

    if (design.layout === "thermal-classic") {
        bodyContent = (
            <div className={gapClass}>
                <div className="pb-2 border-b border-dashed border-gray-400"><HeaderBlock /></div>
                <MetaRows />
                <CustomerBlock />
                <ItemTable ruled="dashed" />
                <div className="border-t border-dashed border-gray-400 pt-1"><TotalsBlock emphasis="rule" /></div>
                <QrBlock />
                <FooterMsg />
            </div>
        )
    } else if (design.layout === "thermal-modern") {
        bodyContent = (
            <div className={gapClass}>
                <div className="pb-2"><HeaderBlock /></div>
                <div className="h-0.5 rounded" style={{ background: design.accent_color }} />
                <MetaRows />
                <CustomerBlock />
                <ItemTable ruled="solid" />
                <TotalsBlock emphasis="box" />
                <QrBlock />
                <FooterMsg />
            </div>
        )
    } else if (design.layout === "qsr-token") {
        bodyContent = (
            <div className={gapClass}>
                {design.show_logo && <div className="text-center"><Logo /></div>}
                <div className="text-center"><div className="text-sm font-semibold">{tenant.name}</div></div>
                <div className="rounded-lg text-center py-3 text-white" style={{ background: design.accent_color }}>
                    <div className="text-[10px] uppercase tracking-widest opacity-90">Order</div>
                    <div className="text-4xl font-extrabold leading-none">{b.invoiceNumber.replace(/^INV-(2025-26-)?0*/, "") || "42"}</div>
                    <div className="text-[10px] opacity-90 mt-0.5">{b.tableNo ? `Table ${b.tableNo} · ` : ""}{dateStr}</div>
                </div>
                <ItemTable ruled="solid" />
                <TotalsBlock emphasis="box" />
                <QrBlock />
                <FooterMsg />
            </div>
        )
    } else if (design.layout === "invoice-a4") {
        bodyContent = (
            <div className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                    <HeaderBlock centered={false} />
                    <div className="text-right">
                        <div className="inline-block px-3 py-1 text-white text-sm font-bold rounded" style={{ background: design.accent_color }}>
                            {design.bilingual_ar ? `${headerTitle} · فاتورة ضريبية` : headerTitle}
                        </div>
                        <div className="text-xs mt-2 space-y-0.5">
                            <Line l="No." v={b.invoiceNumber} />
                            <Line l="Date" v={dateStr} />
                            {b.fyLabel && <Line l="FY" v={b.fyLabel} />}
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded border border-gray-300 p-2">
                        <div className="text-gray-500 uppercase text-[10px]">Bill to</div>
                        <div className="font-medium">{b.customer?.name ?? "Walk-in guest"}</div>
                        {b.customer?.phone && <div>{b.customer.phone}</div>}
                        {b.customer?.taxId && <div>{taxIdLabel}: {b.customer.taxId}</div>}
                        {!b.customer && (b.tableNo || b.serverName) && <div>{b.tableNo ? `Table ${b.tableNo}` : ""}{b.serverName ? ` · ${b.serverName}` : ""}</div>}
                    </div>
                    <div className="rounded border border-gray-300 p-2">
                        <div className="text-gray-500 uppercase text-[10px]">Status</div>
                        <div className="font-medium">{b.status ?? "—"}</div>
                    </div>
                </div>
                <ItemTable ruled="solid" />
                <div className="flex justify-end"><div className="w-1/2 min-w-[220px]"><TotalsBlock emphasis="rule" /></div></div>
                <div className="flex justify-between items-end gap-3 pt-2 border-t border-gray-300">
                    <FooterMsg />
                    {design.show_qr_verify && <div className="text-center shrink-0"><VerifyQr small /></div>}
                </div>
            </div>
        )
    } else if (design.layout === "invoice-grid") {
        const banner = design.show_logo && design.accent_color
        bodyContent = (
            <div className="space-y-3">
                {banner && (
                    <div className="-mx-4 -mt-4 mb-1 px-4 py-3 text-white" style={{ background: design.accent_color }}>
                        <div className="text-lg font-bold">{tenant.name}</div>
                    </div>
                )}
                <div className="flex items-start justify-between gap-4">
                    <div className="text-xs">
                        {!banner && <div className="font-bold text-base mb-0.5">{tenant.name}</div>}
                        {tenant.address_line1 && <div>{tenant.address_line1}</div>}
                        {(tenant.city || tenant.pincode) && <div>{tenant.city} {tenant.pincode}</div>}
                        {tenant.phone && <div>{tenant.phone}</div>}
                        {design.show_tax_id && <div>{taxIdLabel}: {taxId}</div>}
                    </div>
                    <div className="text-right">
                        <div className="text-lg font-semibold tracking-wide" style={{ color: design.accent_color }}>{b.taxExcluded ? "INVOICE" : "TAX INVOICE"}</div>
                        <div className="text-xs mt-1 space-y-0.5">
                            <Line l="No." v={b.invoiceNumber} />
                            <Line l="Date" v={dateStr} />
                        </div>
                    </div>
                </div>
                {b.customer && (
                    <div className="text-xs"><span className="text-gray-500">Bill to: </span>{b.customer.name}{b.customer.phone ? ` · ${b.customer.phone}` : ""}{b.customer.taxId ? ` · ${taxIdLabel} ${b.customer.taxId}` : ""}</div>
                )}
                <ItemTable ruled="none" />
                <div className="flex justify-end"><div className="w-1/2 min-w-[220px]"><TotalsBlock emphasis="rule" /></div></div>
                <FooterMsg />
            </div>
        )
    } else {
        // card-boutique
        bodyContent = (
            <div className={gapClass}>
                <div className="text-center">
                    <Logo />
                    <div className="text-xl font-semibold tracking-wide">{tenant.name}</div>
                    <div className="mx-auto mt-1 h-px w-16" style={{ background: design.accent_color }} />
                    {tenant.city && <div className="text-xs text-gray-500 mt-1">{tenant.city}</div>}
                    {design.show_tax_id && <div className="text-[10px] text-gray-400 mt-0.5">{taxIdLabel}: {taxId}</div>}
                </div>
                <div className="text-xs text-gray-500 text-center">
                    {b.invoiceNumber}{b.tableNo ? ` · Table ${b.tableNo}` : ""} · {dateStr}
                </div>
                <table className="w-full text-sm">
                    <tbody>
                        {b.items.map((it, i) => (
                            <tr key={i}>
                                <td className="py-1">{design.show_serial ? `${i + 1}. ` : ""}{it.name}{it.qty > 1 ? ` ×${it.qty}` : ""}</td>
                                {showTaxCol && <td className="text-right text-[10px] text-gray-400 px-2">{it.taxPct}%</td>}
                                <td className="py-1 text-right tabular-nums">{money(it.lineTotal)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="border-t pt-2" style={{ borderColor: design.accent_color }}>
                    <div className="text-xs space-y-0.5">
                        <Line l="Subtotal" v={money(b.subtotal)} />
                        {(b.discount ?? 0) > 0 && <Line l="Discount" v={`- ${money(b.discount!)}`} />}
                        {showSvc && <Line l="Service" v={money(b.serviceCharge!)} />}
                        <TaxLines />
                        {showRound && <Line l="Round off" v={money(b.roundOff!)} />}
                        <div className="flex justify-between text-base font-semibold pt-1"><span>Total</span><span>{money(b.grandTotal)}</span></div>
                        {(b.paid ?? 0) > 0 && <Line l="Paid" v={money(b.paid!)} />}
                        {(b.balanceDue ?? 0) > 0 && <div className="flex justify-between font-semibold"><span>Balance due</span><span>{money(b.balanceDue!)}</span></div>}
                    </div>
                </div>
                {design.show_qr_verify && <div className="text-center pt-1"><VerifyQr small /></div>}
                <div className="text-center text-xs text-gray-500 italic whitespace-pre-line pt-1">{design.footer_message}</div>
            </div>
        )
    }

    return (
        <div id={id} className={cn("bg-white text-black rounded-lg shadow-sm", fontClass, className)}>
            <div className={padClass} style={{ maxWidth: maxW, margin: "0 auto" }}>{bodyContent}</div>
        </div>
    )
}

function Line({ l, v }: { l: string; v: string }) {
    return (
        <div className="flex justify-between gap-3">
            <span className="text-gray-600">{l}</span>
            <span className="tabular-nums">{v}</span>
        </div>
    )
}
