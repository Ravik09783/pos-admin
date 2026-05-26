import { notFound } from "next/navigation"
import { Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { ThemeToggle } from "@/components/app-shell/theme-toggle"
import { billToRenderData } from "@/lib/bill/render"
import { resolveBillDesign } from "@/lib/bill/templates"
import { getPublicBill } from "@/lib/bill/public-bill"
import { getTaxConfig } from "@/lib/tax/locale-config"
import { PublicBillPrintButton } from "./print-button"
import { PublicBillPreview } from "./verify-qr"

// Server-rendered with a cached fetch (5-min TTL + tag-based
// invalidation on bill writes from the webhooks). The QR for
// "scan to view" and the Print button live in tiny client
// components below since they need browser context.
//
// Next 16 removed the `experimental_ppr` segment opt-in — PPR now
// rides along with the `cacheComponents` config (deferred). Until
// then this route is a fully-dynamic server component that benefits
// from the cached data loader.

export default async function PublicBillPage({
    params,
}: {
    params: Promise<{ slug: string; invoice: string }>
}) {
    const { slug, invoice } = await params
    const payload = await getPublicBill(slug, invoice)
    if (!payload) notFound()

    const { tenant, bill, items } = payload
    const cfg = getTaxConfig(tenant.country)
    const design = resolveBillDesign(
        tenant.settings as Parameters<typeof resolveBillDesign>[0],
    )
    const renderData = billToRenderData({ bill, items, cfg, design })

    const fullyPaid = bill.bill_status === "PAID"
    const voided = bill.bill_status === "VOID"

    return (
        <div className="min-h-screen py-8 px-4">
            <div className="max-w-3xl mx-auto space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2 no-print">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-primary" />
                        <span className="font-semibold">RestoPOS</span>
                        <span className="text-xs text-muted-foreground">· Verified bill</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {fullyPaid ? (
                            <Badge variant="success">PAID</Badge>
                        ) : voided ? (
                            <Badge variant="destructive">VOID</Badge>
                        ) : (
                            <Badge variant="warning">UNPAID</Badge>
                        )}
                        <ThemeToggle />
                        <PublicBillPrintButton />
                    </div>
                </div>

                <PublicBillPreview
                    design={design}
                    tenant={tenant}
                    data={renderData}
                    className="neon-border print:shadow-none print:border-black"
                />


                <p className="text-center text-xs text-muted-foreground no-print">
                    Powered by RestoPOS · this page is the canonical, verifiable copy of your bill.
                </p>
            </div>
        </div>
    )
}
