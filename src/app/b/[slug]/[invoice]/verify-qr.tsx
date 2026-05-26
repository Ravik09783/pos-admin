"use client"

import { useEffect, useState } from "react"
import QRCode from "qrcode"

import { BillPreview } from "@/components/bill/bill-preview"
import type { BillDesign } from "@/lib/bill/templates"
import type { RenderedBillData } from "@/lib/bill/render"
import type { Tenant } from "@/types/database"

/**
 * Client wrapper around <BillPreview /> that owns the "scan-to-verify"
 * QR. Generating the QR requires `window.location.href`, so the
 * receipt body has to render inside a client boundary — but every
 * other piece of state (design, tenant, render data) comes from the
 * server-cached fetch in the parent route.
 */
export function PublicBillPreview({
    design,
    tenant,
    data,
    className,
}: {
    design: BillDesign
    tenant: Tenant
    data: RenderedBillData
    className?: string
}) {
    const [qrDataUrl, setQrDataUrl] = useState("")

    useEffect(() => {
        QRCode.toDataURL(window.location.href, {
            margin: 1,
            width: 220,
            color: { dark: "#0a0e1a", light: "#ffffff" },
        })
            .then(setQrDataUrl)
            .catch(() => { /* QR is best-effort — receipt still renders */ })
    }, [])

    return (
        <BillPreview
            design={design}
            tenant={tenant}
            data={data}
            verifyQrUrl={qrDataUrl}
            className={className}
        />
    )
}
