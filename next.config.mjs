/** @type {import('next').NextConfig} */

// Security headers applied to every response. Goals:
//   • Stop the page being framed by attackers (clickjacking)
//   • Force HTTPS on production (HSTS)
//   • Disallow MIME-sniffing browsers from "helpfully" reinterpreting payloads
//   • Tighten referer leakage for analytics privacy
//   • Lock down which APIs the page can access (Permissions-Policy)
//
// We do NOT set a strict Content-Security-Policy yet. CSP needs a careful
// nonce-based setup because Next inlines styles + scripts during hydration;
// applying a wrong CSP would silently break the app. Add it once the bundle
// is stable and there's bandwidth to test every page.
const securityHeaders = [
    {
        key: "Strict-Transport-Security",
        // Two years; preload-eligible. HSTS only takes effect over HTTPS, so
        // local http://localhost dev is unaffected.
        value: "max-age=63072000; includeSubDomains; preload",
    },
    {
        key: "X-Content-Type-Options",
        value: "nosniff",
    },
    {
        key: "X-Frame-Options",
        // We don't embed our own UI anywhere; lock framing entirely.
        value: "DENY",
    },
    {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
    },
    {
        key: "Permissions-Policy",
        // Disallow features we never use. Camera stays available so the QR
        // ordering page can scan; geolocation off (we don't ask for it).
        value: [
            "geolocation=()",
            "microphone=()",
            "payment=()",
            "usb=()",
            "interest-cohort=()",
        ].join(", "),
    },
    {
        key: "X-DNS-Prefetch-Control",
        value: "on",
    },
]

const nextConfig = {
    // Apply security headers to every route.
    async headers() {
        return [
            {
                source: "/:path*",
                headers: securityHeaders,
            },
        ]
    },

    images: {
        // Allow Supabase Storage image URLs without a per-tenant config.
        // The pattern matches every Supabase project; tighten to a specific
        // ref if you want to be paranoid.
        remotePatterns: [
            {
                protocol: "https",
                hostname: "*.supabase.co",
                pathname: "/storage/v1/object/public/**",
            },
        ],
    },

    // Build-time hardening: fail the build if TS errors are found.
    // (Default behaviour, but the explicit guard is documented intent.)
    // ESLint is no longer configured via next.config in Next 16 — run
    // `next lint` separately in CI to enforce lint rules.
    typescript: { ignoreBuildErrors: false },

    // Tree-shake big barrel-export packages aggressively. With this set,
    // `import { Plus } from "lucide-react"` only emits the one Plus icon
    // instead of the whole `lucide-react` namespace.
    //
    // Kept to the packages Next.js explicitly supports. framer-motion and
    // @radix-ui/* were tried here too, but framer-motion's runtime
    // initialisation and Radix's internal cross-imports don't always play
    // nicely with aggressive splitting — they were causing the marketing
    // page to fail to bundle correctly. Leaving them off, the lucide-react
    // tree-shake alone is still a meaningful win on this page.
    experimental: {
        optimizePackageImports: [
            "lucide-react",
            "date-fns",
            "sonner",
        ],
        // PPR + the `'use cache'` directive are gated behind
        // `cacheComponents: true` in Next.js 16 (the old
        // `experimental.ppr` flag and `experimental_ppr` route segment
        // are gone — see docs/01-app/02-guides/upgrading/version-16.md).
        //
        // Enabling cacheComponents flips the entire app to "static by
        // default": every cookies()/headers() read must be inside a
        // <Suspense> boundary or the build fails. The authenticated
        // (app)/* tree calls `supabase.auth.getUser()` at the top of
        // every layout/page, so adopting it requires re-architecting
        // every authenticated route. We're deferring that migration —
        // for now `unstable_cache` covers the public-surface caching
        // wins without the global breakage risk.
    },
}

export default nextConfig
