/*
 * k6 load test for RestoPOS.
 *
 * Quick start (PowerShell):
 *   $env:BASE_URL = "http://localhost:3000"
 *   k6 run load-test/restopos-load.js                # smoke (default)
 *   k6 run --env SCENARIO=load   load-test/restopos-load.js
 *   k6 run --env SCENARIO=stress load-test/restopos-load.js
 *   k6 run --env SCENARIO=spike  load-test/restopos-load.js
 *
 * IMPORTANT: never point this at production.
 *   BASE_URL=https://staging.your-domain.com   OK
 *   BASE_URL=http://localhost:3000             OK
 *   BASE_URL=https://your-real-restopos.com    NOT OK
 *
 * This v1 hammers PUBLIC endpoints only (no auth, no money). It tells you
 * how the landing page, login page, customer QR menu and verify-bill page
 * hold up under load — which is the surface that takes the most anonymous
 * traffic in a real launch. Authenticated load (POS billing, dashboard) is
 * the v2 — see the comment at the bottom for how to add it.
 */

import http from "k6/http"
import { check, group, sleep } from "k6"
import { Counter, Trend } from "k6/metrics"

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "")
const SCENARIO = __ENV.SCENARIO || "smoke"

// Customise these to a slug + invoice that exists in your staging DB.
// (Use the seed migration / SQL editor to make one.)
const SAMPLE_TENANT_SLUG = __ENV.SAMPLE_TENANT_SLUG || "demo-cafe"
const SAMPLE_INVOICE     = __ENV.SAMPLE_INVOICE     || "INV-2025-26-00001"
const SAMPLE_TABLE_NO    = __ENV.SAMPLE_TABLE_NO    || "1"

// ── Custom metrics ──────────────────────────────────────────────────────
const appErrors = new Counter("app_errors")
const ttfbLanding = new Trend("ttfb_landing", true)
const ttfbQrMenu = new Trend("ttfb_qr_menu", true)
const ttfbBill = new Trend("ttfb_public_bill", true)

// ── Scenarios — pick one with SCENARIO env var ──────────────────────────
const scenarios = {
    // 1 user, 30s — sanity check. Should pass cleanly on a working stack.
    smoke: {
        executor: "constant-vus",
        vus: 1,
        duration: "30s",
        exec: "browse",
    },
    // Sustained 50 req/s for 3 minutes — a "is this OK at moderate scale".
    load: {
        executor: "constant-arrival-rate",
        rate: 50,
        timeUnit: "1s",
        duration: "3m",
        preAllocatedVUs: 30,
        maxVUs: 100,
        exec: "browse",
    },
    // Ramps from 10 -> 300 req/s over 5 minutes — find the cliff.
    stress: {
        executor: "ramping-arrival-rate",
        startRate: 10,
        timeUnit: "1s",
        preAllocatedVUs: 50,
        maxVUs: 400,
        stages: [
            { target: 50, duration: "1m" },
            { target: 150, duration: "2m" },
            { target: 300, duration: "2m" },
            { target: 0, duration: "30s" },
        ],
        exec: "browse",
    },
    // Sudden spike, e.g. a QR code goes viral mid-shift.
    spike: {
        executor: "ramping-arrival-rate",
        startRate: 5,
        timeUnit: "1s",
        preAllocatedVUs: 50,
        maxVUs: 400,
        stages: [
            { target: 5, duration: "30s" },
            { target: 250, duration: "10s" },   // jump
            { target: 250, duration: "1m" },    // hold
            { target: 5, duration: "30s" },     // recover
        ],
        exec: "browse",
    },
}

export const options = {
    scenarios: { [SCENARIO]: scenarios[SCENARIO] || scenarios.smoke },
    // Thresholds — k6 exits non-zero if any of these are violated. Tighten
    // these as the app gets faster; loosen them and you're hiding regressions.
    thresholds: {
        // 95% of requests under 800 ms; 99% under 1.5 s
        http_req_duration: ["p(95)<800", "p(99)<1500"],
        // < 1% HTTP-level failures
        http_req_failed: ["rate<0.01"],
        // Page-specific budgets
        ttfb_landing: ["p(95)<400"],
        ttfb_qr_menu: ["p(95)<500"],
        ttfb_public_bill: ["p(95)<600"],
    },
}

// ── The user journey one VU performs ───────────────────────────────────
export function browse() {
    group("landing", () => {
        const r = http.get(`${BASE_URL}/`, { tags: { name: "landing" } })
        ttfbLanding.add(r.timings.waiting)
        if (!check(r, { "landing 200": (res) => res.status === 200 })) appErrors.add(1)
    })

    group("login page (public)", () => {
        const r = http.get(`${BASE_URL}/login`, { tags: { name: "login" } })
        if (!check(r, { "login 200": (res) => res.status === 200 })) appErrors.add(1)
    })

    group("QR menu API (anonymous customer hitting a table page)", () => {
        const r = http.get(`${BASE_URL}/api/public/qr/menu/${SAMPLE_TENANT_SLUG}`, { tags: { name: "qr_menu" } })
        ttfbQrMenu.add(r.timings.waiting)
        if (!check(r, { "qr menu 200/404": (res) => res.status === 200 || res.status === 404 })) appErrors.add(1)
    })

    group("QR ordering page (full HTML)", () => {
        const r = http.get(`${BASE_URL}/qr/${SAMPLE_TENANT_SLUG}/${SAMPLE_TABLE_NO}`, { tags: { name: "qr_page" } })
        if (!check(r, { "qr 200": (res) => res.status === 200 })) appErrors.add(1)
    })

    group("public bill page (verified-receipt link)", () => {
        const r = http.get(`${BASE_URL}/api/public/bills/${SAMPLE_TENANT_SLUG}/${SAMPLE_INVOICE}`, { tags: { name: "public_bill" } })
        ttfbBill.add(r.timings.waiting)
        if (!check(r, { "bill 200/404": (res) => res.status === 200 || res.status === 404 })) appErrors.add(1)
    })

    // Real users pause between clicks. Without this you're not modelling
    // a load; you're modelling a denial-of-service.
    sleep(Math.random() * 2 + 0.5)
}

/*
 * Adding authenticated load (v2 — needs a seed step):
 *
 * 1. Pre-create N test users + tenants in your STAGING Supabase project
 *    using the service-role key. One row per user in auth.users + a tenant
 *    each. Save the resulting (email, password) pairs to load-test/users.csv.
 *
 * 2. In a `setup()` here, load that CSV, log each user in via the Supabase
 *    REST `/auth/v1/token?grant_type=password` endpoint, and stash the
 *    access_token + tenant_id per VU.
 *
 * 3. Add a new exec function `staffShift()` that hits authenticated paths
 *    with `Authorization: Bearer <access_token>` and `apikey: <anon_key>`:
 *       - GET /rest/v1/menu_items?tenant_id=eq.<id>
 *       - POST /rest/v1/orders (create an order)
 *       - POST /rest/v1/rpc/generate_bill (the heaviest write path)
 *
 *    Beware: every successful generate_bill creates a real row. Either
 *    purge after the run or test against an ephemeral Supabase branch.
 */
