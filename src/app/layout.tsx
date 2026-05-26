import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import { DM_Sans, Lora } from "next/font/google"
import { Suspense } from "react"
import "./globals.css"

import { Providers } from "@/lib/providers"
import { SITE_URL, SITE_NAME, SITE_TAGLINE, SITE_DESCRIPTION } from "@/lib/site"
import { ServiceWorkerRegistrar } from "@/components/app-shell/sw-register"
import { RouteProgress } from "@/components/app-shell/route-progress"
import { FestivalAmbient } from "@/components/app-shell/festival-ambient"
import { ThemeProvider } from "@/lib/theme/provider"
import { themeInitScript } from "@/lib/theme/themes"

// Body / UI typeface — clean, geometric, legible at every size we render.
// Variable font means we get the whole weight range in one download.
const dmSans = DM_Sans({
    subsets: ["latin"],
    variable: "--font-dm-sans",
    display: "swap",
    weight: ["400", "500", "600", "700"],
})

// Lora — a humanist serif kept ONLY for the opt-in serif BILL templates
// (Tailwind's `font-serif`). The app UI itself is all DM Sans — headings
// included — so no "Times New Roman" serif fallback ever shows.
const lora = Lora({
    subsets: ["latin"],
    variable: "--font-lora",
    display: "swap",
    weight: ["400", "500", "600", "700"],
})

// Mono is kept for tabular numerics + code (invoice numbers, totals).
const geistMono = localFont({
    src: "./fonts/GeistMonoVF.woff",
    variable: "--font-geist-mono",
    weight: "100 900",
})

export const metadata: Metadata = {
    // Absolute base for canonical / OpenGraph / sitemap URLs. Set
    // NEXT_PUBLIC_APP_URL to the production domain.
    metadataBase: new URL(SITE_URL),
    // `default` is used where a route sets no title; `template` wraps any
    // child route's title as "Page — RestoPOS".
    title: {
        default: `${SITE_NAME} — ${SITE_TAGLINE}`,
        template: `%s — ${SITE_NAME}`,
    },
    description: SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    manifest: "/manifest.json",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: SITE_NAME },
    formatDetection: { telephone: false, address: false, email: false },
    // Search-engine site-ownership verification. Paste the codes from
    // Google Search Console / Bing Webmaster Tools into these env vars —
    // the meta tags then render automatically (nothing shows if unset).
    verification: {
        google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
        other: process.env.BING_SITE_VERIFICATION
            ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION }
            : {},
    },
    icons: {
        icon: [
            { url: "/favicon.ico", sizes: "any" },
            { url: "/icon.svg", type: "image/svg+xml" },
        ],
        apple: "/icon.svg",
    },
}

export const viewport: Viewport = {
    themeColor: "#0a0e1a",
    width: "device-width",
    initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className="dark" data-theme="neon" suppressHydrationWarning>
            <head>
                {/* Apply the saved theme BEFORE React hydrates, so users who
                 *  picked a non-default theme don't see a flash of the default. */}
                <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
            </head>
            <body className={`${dmSans.variable} ${lora.variable} ${geistMono.variable}`}>
                <ThemeProvider>
                    <Providers>
                        <Suspense fallback={null}><RouteProgress /></Suspense>
                        {children}
                        {/* Festive ambient emoji rain when the user picks a
                         *  festival theme. Renders nothing for non-festival
                         *  themes; desktop-only with reduced-motion respect. */}
                        <FestivalAmbient />
                        <ServiceWorkerRegistrar />
                    </Providers>
                </ThemeProvider>
            </body>
        </html>
    )
}
