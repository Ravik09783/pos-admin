import { ImageResponse } from "next/og"

import { SITE_NAME, SITE_TAGLINE } from "@/lib/site"

/**
 * Generated OpenGraph / Twitter card image (1200×630) for the landing
 * page — the preview shown when the site is shared on WhatsApp, Slack,
 * X, LinkedIn, search results, etc. Next.js wires this file to both
 * `og:image` and `twitter:image` automatically.
 */
export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpengraphImage() {
    return new ImageResponse(
        (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    padding: "84px",
                    background: "linear-gradient(135deg,#0a0e1a 0%,#1a1140 55%,#3b0764 100%)",
                    color: "#ffffff",
                    fontFamily: "sans-serif",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "22px" }}>
                    <div
                        style={{
                            width: 88,
                            height: 88,
                            borderRadius: 22,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "linear-gradient(135deg,#22d3ee,#a855f7)",
                            fontSize: 52,
                            fontWeight: 800,
                            color: "#0a0e1a",
                        }}
                    >
                        R
                    </div>
                    <div style={{ fontSize: 66, fontWeight: 800 }}>{SITE_NAME}</div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", marginTop: 44 }}>
                    <div style={{ fontSize: 56, fontWeight: 700 }}>Cloud Restaurant POS</div>
                    <div style={{ fontSize: 56, fontWeight: 700 }}>&amp; GST Billing Software</div>
                </div>

                <div style={{ display: "flex", marginTop: 30, fontSize: 27, color: "#c4b5fd" }}>
                    Billing · QR ordering · Kitchen display · UPI payments · Tax-ready invoices
                </div>
            </div>
        ),
        { ...size },
    )
}
