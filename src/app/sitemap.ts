import type { MetadataRoute } from "next"

import { SITE_URL } from "@/lib/site"

/**
 * `/sitemap.xml` — generated.
 *
 * RestoPOS has a small set of indexable marketing pages: home, features,
 * pricing, and the demo request page. The rest of the site is the
 * authenticated app, excluded in `robots.ts`. Home stays the top-priority
 * entry; the rest are secondary.
 */
export default function sitemap(): MetadataRoute.Sitemap {
    const now = new Date()
    return [
        { url: `${SITE_URL}/`,         lastModified: now, changeFrequency: "weekly",  priority: 1 },
        { url: `${SITE_URL}/features`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/pricing`,  lastModified: now, changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/demo`,     lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    ]
}
