import type { Metadata } from "next"

import { LandingPage } from "./_landing/landing"
import {
    SITE_URL, SITE_NAME, SITE_TAGLINE, SITE_DESCRIPTION,
    SITE_KEYWORDS, SITE_FEATURES, SITE_FAQ,
} from "@/lib/site"

// `proxy.ts` handles "logged-in user lands on / → bounce to /dashboard"
// before this component ever renders, so the page itself is a pure
// server component with zero data access — fully prerenderable, which is
// exactly what a search-indexed marketing page wants.
//
// This `/` route is the ONLY public, indexable page (see robots.ts). All
// the SEO weight — title, description, keywords, OpenGraph, Twitter card,
// canonical URL and JSON-LD structured data — is concentrated here.

const PAGE_TITLE = `${SITE_NAME} — ${SITE_TAGLINE}`

export const metadata: Metadata = {
    // `absolute` opts out of the layout's "%s — RestoPOS" template, since
    // the homepage title already ends with the brand.
    title: { absolute: PAGE_TITLE },
    description: SITE_DESCRIPTION,
    keywords: SITE_KEYWORDS,
    category: "Business Software",
    applicationName: SITE_NAME,
    authors: [{ name: SITE_NAME }],
    creator: SITE_NAME,
    publisher: SITE_NAME,
    alternates: { canonical: "/" },
    // Explicitly invite every crawler — search engines AND AI crawlers
    // (GPTBot, ClaudeBot, PerplexityBot, Google-Extended all honour this).
    robots: {
        index: true,
        follow: true,
        googleBot: {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
            "max-video-preview": -1,
        },
    },
    openGraph: {
        type: "website",
        url: "/",
        siteName: SITE_NAME,
        title: PAGE_TITLE,
        description: SITE_DESCRIPTION,
        locale: "en_US",
        // `images` is auto-populated from app/opengraph-image.tsx.
    },
    twitter: {
        card: "summary_large_image",
        title: PAGE_TITLE,
        description: SITE_DESCRIPTION,
    },
}

/**
 * JSON-LD structured data — the machine-readable description of the
 * product. Google uses it for rich results; AI crawlers parse it to
 * understand and cite the site accurately. One `@graph` ties the
 * Organization, the WebSite and the SoftwareApplication together.
 */
const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
        {
            "@type": "Organization",
            "@id": `${SITE_URL}/#organization`,
            name: SITE_NAME,
            url: SITE_URL,
            logo: `${SITE_URL}/icon.svg`,
            description: SITE_DESCRIPTION,
        },
        {
            "@type": "WebSite",
            "@id": `${SITE_URL}/#website`,
            url: SITE_URL,
            name: SITE_NAME,
            description: SITE_DESCRIPTION,
            publisher: { "@id": `${SITE_URL}/#organization` },
            inLanguage: "en",
        },
        {
            "@type": "SoftwareApplication",
            "@id": `${SITE_URL}/#software`,
            name: SITE_NAME,
            url: SITE_URL,
            description: SITE_DESCRIPTION,
            applicationCategory: "BusinessApplication",
            applicationSubCategory: "Point of Sale (POS) Software",
            operatingSystem: "Web browser (PWA) — Windows, macOS, Android, iOS",
            featureList: SITE_FEATURES,
            softwareHelp: `${SITE_URL}/`,
            offers: {
                "@type": "AggregateOffer",
                priceCurrency: "INR",
                lowPrice: "3500",
                offerCount: 3,
                availability: "https://schema.org/InStock",
            },
            publisher: { "@id": `${SITE_URL}/#organization` },
            inLanguage: "en",
        },
        {
            // Mirrors the visible FAQ section on the page — lets Google
            // and AI answer-engines lift the Q&A directly.
            "@type": "FAQPage",
            "@id": `${SITE_URL}/#faq`,
            mainEntity: SITE_FAQ.map((f) => ({
                "@type": "Question",
                name: f.q,
                acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
        },
    ],
}

export default function Home() {
    return (
        <>
            <script
                type="application/ld+json"
                // Structured data — safe to inline; it's our own static object.
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
            />
            <LandingPage />
        </>
    )
}
