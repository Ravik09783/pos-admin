"use client"

import { useEffect, useRef } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Bell } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { uniqueChannelName } from "@/lib/supabase/realtime"

const PENDING_PATH = "/pending-orders"

/**
 * Global notifier that toasts any authenticated staff member when a new QR
 * order lands (or an existing order flips to `awaiting_confirmation = true`).
 *
 * Why a separate notifier from the pending-orders page subscription:
 *   - The page-level subscription fires only while staff are looking at that
 *     page. A waiter doing a KOT round or a cashier on the POS would miss
 *     incoming QR orders entirely.
 *   - The sidebar badge (usePendingCount) updates the count silently — useful
 *     but doesn't actively grab attention.
 *
 * Deduplication:
 *   - If the user is already on /pending-orders, suppress the toast. That
 *     page has its own chime + visual cue; two notifications would just be
 *     noise.
 *   - The toast carries a "View" action that navigates straight to the
 *     pending-orders page.
 *
 * Renders nothing in the DOM. Returns null. */
export function QrOrderNotifier({ tenantId }: { tenantId: string }) {
    const router = useRouter()
    const pathname = usePathname()
    // Refs so we don't have to re-subscribe whenever the route changes —
    // that'd churn the realtime channel.
    const pathnameRef = useRef(pathname)
    pathnameRef.current = pathname

    useEffect(() => {
        if (!tenantId) return
        const supabase = createClient()

        function notify(orderNumber: string | null | undefined) {
            // Page-level subscription on /pending-orders already chimes + shows
            // the order — skip the toast to avoid duplicate notifications.
            if (pathnameRef.current === PENDING_PATH) return
            toast.message("New QR order", {
                description: orderNumber
                    ? `Order ${orderNumber} is awaiting confirmation.`
                    : "A customer just submitted a QR order.",
                icon: <Bell className="h-4 w-4 text-primary" />,
                action: {
                    label: "View",
                    onClick: () => router.push(PENDING_PATH),
                },
            })
        }

        const channel = supabase
            .channel(uniqueChannelName("qr-order-notifier"))
            // New row created → notify if it's a pending QR order.
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "orders",
                    filter: `tenant_id=eq.${tenantId}`,
                },
                (payload) => {
                    const row = payload.new as { awaiting_confirmation?: boolean; order_number?: string }
                    if (!row?.awaiting_confirmation) return
                    notify(row.order_number)
                },
            )
            // Existing row updated → notify if awaiting_confirmation just turned on
            // (e.g. payment proof verified by an async backend job).
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "orders",
                    filter: `tenant_id=eq.${tenantId}`,
                },
                (payload) => {
                    const newRow = payload.new as { awaiting_confirmation?: boolean; order_number?: string }
                    const oldRow = payload.old as { awaiting_confirmation?: boolean }
                    if (newRow?.awaiting_confirmation && !oldRow?.awaiting_confirmation) {
                        notify(newRow.order_number)
                    }
                },
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [tenantId, router])

    return null
}
