import type { MetadataRoute } from "next"

import { SITE_URL } from "@/lib/site"

/**
 * `/robots.txt` — generated.
 *
 * Public marketing surface ( `/`, `/features`, `/pricing`, `/demo` ) is
 * indexable. Everything else is either the authenticated app or a
 * per-tenant / per-customer surface (live bills, QR ordering, the
 * customer display) that must NOT appear in search results — so each is
 * explicitly disallowed.
 *
 * Note: AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended,
 * Applebot-Extended, …) are intentionally NOT blocked — they fall under
 * `User-agent: *` and are welcome to index the marketing pages.
 */
export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: "*",
            allow: ["/", "/features", "/pricing", "/demo"],
            disallow: [
                "/api/",
                // Public-but-private surfaces — never index customer data.
                "/b/",            // verified public bill pages
                "/qr/",           // customer QR self-ordering
                "/display/",      // POS customer-facing display
                "/loyalty/",
                "/invite/",
                "/auth/",
                "/locked",
                "/offline",
                "/onboarding",
                "/super-admin",
                // The authenticated app (auth-gated, no SEO value).
                "/dashboard", "/pos", "/kds", "/tables", "/orders", "/bills",
                "/menu", "/menu-admin", "/inventory", "/settings", "/reports", "/ca-export",
                "/my-collections", "/marketing", "/customers", "/reservations",
                "/gift-cards", "/pending-orders", "/accounting", "/availability",
                "/forecast", "/insights", "/purchases", "/vendors", "/setup-guide",
                // Auth screens.
                "/login", "/signup", "/forgot-password", "/reset-password",
            ],
        },
        sitemap: `${SITE_URL}/sitemap.xml`,
        host: SITE_URL,
    }
}
