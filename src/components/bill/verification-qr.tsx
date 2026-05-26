"use client"

import { useEffect, useState } from "react"
import QRCode from "qrcode"

export function VerificationQr({ url, size = 96 }: { url: string; size?: number }) {
    const [data, setData] = useState<string>("")

    useEffect(() => {
        QRCode.toDataURL(url, {
            margin: 1,
            width: size * 2,
            color: { dark: "#000000", light: "#ffffff" },
        })
            .then(setData)
            .catch(() => {})
    }, [url, size])

    if (!data) return <div style={{ width: size, height: size }} className="bg-muted rounded" />
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={data} alt="Verification QR" style={{ width: size, height: size }} className="border border-border" />
}
