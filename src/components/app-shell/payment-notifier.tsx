"use client"

import { useEffect, useRef } from "react"
import { CircleDollarSign } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { uniqueChannelName } from "@/lib/supabase/realtime"
import { useActiveBranch } from "@/lib/branch/active-branch"
import { playOrderChime } from "@/lib/notifications/sound"
import { formatCurrency } from "@/lib/utils"

/**
 * Global notifier for incoming online payments.
 *
 * Two surfaces:
 *   1. An in-app Sonner toast — appears whenever the dashboard tab is
 *      focused. Catches every online-method payment row (RAZORPAY /
 *      STRIPE / PHONEPE / PAYTM) so cashiers see split-pay landings,
 *      cash-back refunds, etc.
 *   2. A browser OS notification ("new paid order from Table 4") — only
 *      for **QR-source orders**, because that's the case where staff
 *      may have walked away from the screen and the kitchen needs to be
 *      pinged. POS-initiated card payments don't fire OS notifications;
 *      the cashier who took the payment is already looking at the
 *      screen.
 *
 * Mounted once in the authenticated app shell so it works regardless of
 * which page the admin is on. Renders nothing.
 *
 * Why on `payments` INSERT instead of `orders` INSERT? Because an order
 * is created BEFORE payment captures — if we fired on order-insert, the
 * staff would get pinged for abandoned carts too. The payment row only
 * appears AFTER the webhook confirms money landed, so it's the right
 * "this needs attention now" moment.
 */
const ONLINE_METHODS = new Set(["RAZORPAY", "STRIPE", "PHONEPE", "PAYTM"])

export function PaymentNotifier({ tenantId }: { tenantId: string }) {
    // Dedupe across the StrictMode double-mount and across multiple
    // postgres_changes deliveries for the same row id.
    const seenRef = useRef<Set<string>>(new Set())
    /** Active branch — used to filter both the realtime subscription
     *  (server-side via the `filter` clause) AND the QR-order lookup
     *  inside the callback. "All branches" (null) leaves subscription
     *  unfiltered so the toast fires for every branch's payments. */
    const { activeBranchId } = useActiveBranch()

    // Ask for browser notification permission once on mount. The browser
    // remembers the answer across sessions, so the prompt only appears
    // the first time. Wrapped in a try because some environments (older
    // browsers, http://) don't expose the API at all.
    useEffect(() => {
        if (typeof window === "undefined" || !("Notification" in window)) return
        try {
            if (Notification.permission === "default") {
                Notification.requestPermission().catch(() => {})
            }
        } catch { /* ignore */ }
    }, [])

    useEffect(() => {
        if (!tenantId) return
        const supabase = createClient()
        // Postgres-realtime filter only accepts one `col=op.value` clause
        // per subscription; we use it for branch when set, falling back
        // to tenant_id otherwise.
        const filter = activeBranchId
            ? `branch_id=eq.${activeBranchId}`
            : `tenant_id=eq.${tenantId}`
        const channel = supabase
            .channel(uniqueChannelName("payments-notifier"))
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "payments",
                    filter,
                },
                async (payload) => {
                    const row = payload.new as {
                        id?: string
                        method?: string
                        amount?: number | string
                        platform_fee?: number | string | null
                        bill_id?: string | null
                    }
                    if (!row?.id) return
                    if (seenRef.current.has(row.id)) return
                    seenRef.current.add(row.id)

                    // Online gateways only. Cash / counter UPI / card-machine
                    // payments don't need a ping — the staff member who took
                    // the payment is right there.
                    if (!row.method || !ONLINE_METHODS.has(row.method)) return

                    const amt = Number(row.amount ?? 0)
                    const fee = Number(row.platform_fee ?? 0)

                    // Always show the in-app toast for online payments.
                    toast.success("Payment received", {
                        icon: <CircleDollarSign className="h-4 w-4 text-success" />,
                        description: fee > 0
                            ? `${formatCurrency(amt)} via ${row.method} · ${formatCurrency(fee)} platform fee`
                            : `${formatCurrency(amt)} via ${row.method}`,
                    })

                    // Browser notification — gated on QR-source so it
                    // doesn't fire for POS-initiated card payments where
                    // the cashier doesn't need an OS-level ping.
                    if (!row.bill_id) return
                    const ctx = await loadQrOrderContext(supabase, row.bill_id)
                    if (!ctx?.isQrOrder) return

                    // Audible chime so staff hears the ping even if the
                    // OS notification volume is muted.
                    playOrderChime()

                    fireBrowserNotification({
                        title: ctx.tableNumber
                            ? `🛎️ New QR order — Table ${ctx.tableNumber}`
                            : "🛎️ New QR order paid",
                        body: `${formatCurrency(amt)} received · ${row.method}`,
                        tag: row.id,
                        url: `/bills/${row.bill_id}`,
                    })
                },
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [tenantId, activeBranchId])

    return null
}

interface QrOrderContext {
    isQrOrder: boolean
    tableNumber: string | null
}

/** Look up whether the bill's parent order came from the QR channel, and
 *  fetch the table number for a friendlier notification body. Two small
 *  queries — only runs when an online payment lands, so traffic is sparse. */
async function loadQrOrderContext(
    supabase: ReturnType<typeof createClient>,
    billId: string,
): Promise<QrOrderContext | null> {
    const { data: bill } = await supabase
        .from("bills")
        .select("order_id")
        .eq("id", billId)
        .maybeSingle()
    const orderId = (bill as { order_id?: string } | null)?.order_id
    if (!orderId) return null

    const { data: order } = await supabase
        .from("orders")
        .select("source, table_id")
        .eq("id", orderId)
        .maybeSingle()
    const o = order as { source?: string; table_id?: string | null } | null
    if (!o || o.source !== "QR") return { isQrOrder: false, tableNumber: null }

    let tableNumber: string | null = null
    if (o.table_id) {
        const { data: table } = await supabase
            .from("dining_tables")
            .select("number")
            .eq("id", o.table_id)
            .maybeSingle()
        tableNumber = (table as { number?: string } | null)?.number ?? null
    }
    return { isQrOrder: true, tableNumber }
}

/** Fire a browser-native OS notification. No-op if the API isn't
 *  available or permission hasn't been granted. `tag` collapses
 *  duplicate notifications (e.g. on Supabase redelivery) into one.
 *  `requireInteraction: true` keeps the notification on screen until
 *  the user dismisses it — important for kitchen / counter staff who
 *  may step away. Clicking the notification focuses the tab and
 *  navigates to the bill detail. */
function fireBrowserNotification({
    title, body, tag, url,
}: { title: string; body: string; tag: string; url: string }) {
    if (typeof window === "undefined") return
    if (!("Notification" in window)) return
    if (Notification.permission !== "granted") return
    try {
        const n = new Notification(title, {
            body,
            tag,
            requireInteraction: true,
            icon: "/icon.svg",
            badge: "/icon.svg",
        })
        n.onclick = () => {
            try {
                window.focus()
                window.location.href = url
                n.close()
            } catch { /* ignore */ }
        }
        // Safety net — if staff somehow doesn't see it, the OS
        // notification still expires on its own.
        setTimeout(() => { try { n.close() } catch { /* ignore */ } }, 60_000)
    } catch {
        // Some browsers throw on certain permission states; swallow.
    }
}
