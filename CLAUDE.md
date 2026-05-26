# Project map for AI assistants (and humans returning after a break)

> **You're an AI assistant opening this repo cold.** Read this file first.
> It's the fastest way to understand what this project is, how it's
> structured, and the conventions you must keep using as you work.

---

## 1. What this is in three lines

**RestoPOS** — a multi-tenant SaaS Point-of-Sale system for restaurants,
built with **Next.js 16 (App Router) + React 19 + Supabase (Postgres +
Auth + Storage + Realtime)**. One codebase serves many restaurants
("tenants") with strict per-tenant data isolation. Key differentiator:
country-aware tax engine (GST / VAT / Sales Tax) + a one-click
"CA Export" bundle for Indian compliance.

If you only remember three things from this file:

1. **`tenant_id` + RLS is the security boundary** — every business table
   has it, every read query is scoped by it, every write goes through a
   SECURITY DEFINER RPC.
2. **Business writes go through RPCs**, not direct `.insert()` /
   `.update()`. The list is in [`supabase/migrations/`](supabase/migrations/).
3. **Money is `numeric(12,2)`, never `float`. Tax math uses `decimal.js`.**
   Don't introduce JavaScript number arithmetic into bill totals or you
   *will* drift.

---

## 2. The data flow for each core feature

### Bill generation (the money path)

1. POS page builds a cart client-side (`src/app/(app)/pos/page.tsx`).
2. **For dine-in** with a table selected → `Send KOT` button →
   `supabase.rpc("send_kot", {...})` → creates an `orders` row if needed,
   inserts a `kots` row with the next per-tenant `kot_number`, inserts
   `order_items` pointing at the KOT, flips the table to OCCUPIED. Cart
   clears; waiter can send another KOT. *Repeat per course.*
3. **For takeaway/QSR or final checkout** → `Review & checkout` →
   `supabase.rpc("generate_bill", {...})`. Atomically:
   - Locks the order (`for update`)
   - Recomputes line tax based on intra/inter-state + tax_model
   - Allocates `invoice_number` via `next_sequence(tenant_id, 'invoice')`
   - Inserts the `bills` row
   - Audit-logs to `bill_audit_log`
4. Payment via `supabase.rpc("record_payment", ...)` (cash/UPI/card/etc.)
   or the Razorpay/Stripe webhook (server-side, HMAC-verified,
   idempotent on `client_request_id`).
5. When `totalPaid >= grand_total`, bill flips to `PAID`. Kitchen tickets
   for that order become irrelevant.

### Offline-capable billing

When the network drops mid-shift, the POS keeps working:

- A buffer of **pre-allocated invoice numbers** (`invoice_reservations`)
  is leased to each device while online. Refilled via
  `reserve_invoice_numbers(N)` whenever the count dips below 10.
- When offline, the POS pops one reservation → prints the bill with that
  real, server-issued number → queues the bill payload in localStorage.
- On reconnect, `syncPendingBills()` (in `src/lib/offline/sync.ts`)
  drains the queue by calling `generate_bill` with
  `p_reserved_invoice` + `p_client_request_id`. Idempotent: a UNIQUE
  partial index on `bills(tenant_id, client_request_id)` makes
  duplicates physically impossible.
- See [`src/lib/offline/`](src/lib/offline/) for buffer + queue + sync.

### Multi-country tax

All tax wording, rates, currency, FY start, and service-charge policy is
driven by [`src/lib/tax/locale-config.ts`](src/lib/tax/locale-config.ts).
Each country gets a `CountryTaxConfig` with `taxModel` ∈
`{split, single, none}`. **India** is `split` (CGST+SGST intra-state,
IGST inter-state), service charge disallowed. **Most others** are
`single` (one combined VAT/GST/Sales Tax line). All UI labels come from
`cfg.taxShortName` / `cfg.taxLabels.single` etc. — **never hard-code
"GST"** unless the file truly is India-only.

### Per-staff visibility (branch-scoped)

The admin sees everything in the tenant. The kitchen sees every order.
A cashier/captain sees everything **at their own branch** — plus, as a
fallback, any row they personally touched even if it's at another
branch. Enforced at the RLS layer; the current rules live in the
`branch_scoped_reads` bundle of `combined_schema.sql` (search the file
for `SOURCE FILE: 14_branch_scoped_reads.sql`).

- `can_see_full_history()` → OWNER, MANAGER, AUDITOR → see the whole
  tenant, every branch.
- `is_workflow_role()` → KITCHEN, DELIVERY → see every order (and
  order_items) tenant-wide, but not bills/payments.
- `can_read_row_in_branch(branch_id)` → true for the admin roles above
  OR for any staffer whose assigned `branch_id` matches the row's. This
  is what gives CASHIER/CAPTAIN **branch-wide** read of `orders`,
  `bills`, `payments`, `order_items`.
- Per-user fallback → on top of the branch rule, a staffer always sees
  rows where they're `created_by`/`billed_by` (orders), `received_by`
  (payments), or tied to such an order/bill — so a row they touched at
  another branch stays visible.

Note: this is **branch-wide**, not strictly per-staff. The earlier
"a cashier sees only their own bills" model was replaced by the
branch-scoped model in migration 14; writes stay admin-only
(`OWNER`/`MANAGER`) and money paths still go through SECURITY DEFINER
RPCs.

---

## 3. Where things live

```
src/
├── app/
│   ├── (app)/                   ← Authenticated admin/staff surface
│   │   ├── layout.tsx           Auth gate, role fetch, sidebar+topbar
│   │   ├── dashboard/           Role-shaped home
│   │   ├── pos/                 Cart + Send KOT + Checkout
│   │   ├── kds/                 Kitchen display (KOT cards)
│   │   ├── menu/                Catalog admin
│   │   ├── tables/              Floor plan + drill-in to running order
│   │   ├── bills/               List + detail + print
│   │   ├── my-collections/      End-of-shift cash reconciliation
│   │   ├── settings/            Tenant profile, staff, bill design, …
│   │   ├── reports/             Sales / insights / forecast
│   │   ├── ca-export/           India: GST + P&L + BS zip bundle
│   │   └── …
│   ├── (auth)/                  Login / signup / reset
│   ├── qr/[tenantSlug]/[tableNum]/  Customer-facing QR ordering page
│   ├── b/[slug]/[invoice]/      Public verified-bill page
│   ├── api/
│   │   ├── public/              Customer-facing APIs (rate-limited)
│   │   ├── webhooks/            Razorpay + Stripe (HMAC-verified)
│   │   ├── payments/            Server-side checkout-session creation
│   │   ├── admin/               Owner/manager APIs (create staff, …)
│   │   └── notifications/       SMS/WhatsApp send (provider-agnostic)
│   ├── _landing/                Marketing pages on /
│   └── layout.tsx               Root (fonts, theme provider, progress bar)
├── components/
│   ├── ui/                      shadcn primitives + ImageUploader etc.
│   ├── app-shell/               Sidebar, topbar, theme toggle, offline banner
│   ├── pos/                     POS-specific (ItemAddDialog, CheckoutPreview)
│   ├── bill/                    BillPreview, payment-link dialog, verification QR
│   └── qr/                      QR-ordering-specific (success screen, fly-to-cart)
├── lib/
│   ├── supabase/                Client + server factories (createClient)
│   ├── tax/locale-config.ts     The country tax registry (single source of truth)
│   ├── gst/calculator.ts        Pure money/tax math (decimal.js)
│   ├── rbac/                    Permission matrix + can(role, perm)
│   ├── bill/                    Bill template catalog + render data
│   ├── offline/                 Reservation buffer + pending queue + sync
│   ├── kot/state-machine.ts     KOT status transitions (mirror of update_kot_status RPC)
│   ├── theme/                   Theme registry + ThemeProvider
│   ├── storage/image-upload.ts  Canvas compress + Supabase upload helper
│   ├── reports/                 Pure aggregation helpers (shift-summary, etc.)
│   ├── errors.ts                logError / logWarn / logInfo abstraction
│   └── csrf.ts                  Origin assertion for state-changing API routes
├── types/database.ts            Hand-rolled TS row types (regenerate with supabase gen types)
└── middleware.ts                Auth gate (skip on /qr, /b, /api/public, /webhooks)

supabase/
├── migrations/
│   ├── combined_schema.sql      THE schema — bundles 01→33 concatenated, apply this one file
│   ├── _backup_2026-05-20/      The 29 numbered source bundles (editable source of truth)
│   ├── _archived_05_may_2026/   The 21 original incremental migrations (older source material)
│   └── _backup_originals/       Even older versions kept for git archaeology
└── (... + storage buckets etc.)

docs/
└── stripe-setup.md              How to wire up Stripe (platform billing + Connect)

load-test/                       k6 starter script
tests/                           Vitest unit + API mock tests (413 passing as of last update)
```

---

## 4. Conventions you must keep

- **Currency rendering**: `formatCurrency(value, tenant_currency)`. Never
  `₹${value}`. Tenant currency comes from `getTaxConfig(tenant.country).currency`.
- **Tax words**: `cfg.taxShortName` or `cfg.taxLabels.single`. Never
  hard-coded "GST" unless the file is explicitly India-only (CA export).
- **Reads**: `supabase.from(table).select(...)`. Use PostgREST embeds
  (`select("*, related:table(...)")`) for parent-child joins; use
  `Promise.all([…])` for independent queries.
- **Writes**: prefer a SECURITY DEFINER RPC over direct `.insert()` /
  `.update()`. Business rules live in the RPC.
- **Idempotency**: every state-changing API route + every offline sync
  payload carries a `client_request_id` UUID. The DB has UNIQUE partial
  indexes that make double-inserts physically impossible.
- **Migrations are idempotent**: every CREATE TABLE is `if not exists`,
  every function is `CREATE OR REPLACE`, every policy is
  `DROP IF EXISTS` + `CREATE`. Re-running a migration on a fresh DB is
  a no-op.
- **Money math**: `decimal.js` in `src/lib/gst/calculator.ts`. Round
  half-up to 2 decimals. Never `Math.round` on prices.
- **Realtime channels**: always use `uniqueChannelName("kds-kots")`
  from `src/lib/supabase/realtime.ts` to avoid "cannot add
  postgres_changes callbacks after subscribe()".

---

## 5. Gotchas — things future-you will trip over

- **`generate_bill` is the only safe entry point for issuing an invoice.**
  Don't insert directly into `bills`; you'll break FY sequencing.
- **The current Supabase auth model assumes `auth.uid()` is the user.**
  All RPCs read it via `auth.uid()`. If you switch to service-role
  client inside an RPC chain, `auth.uid()` becomes NULL and the
  function will raise `not_authenticated`.
- **Storage paths must start with `<tenant_id>/`** — RLS on
  `storage.objects` enforces this. The helper `tenantImagePath()` in
  `src/lib/storage/image-upload.ts` builds them correctly.
- **The KDS no longer reads `order_items.kds_status`.** It reads
  `kots.status`. Old-style "instant-bill" orders (takeaway / QSR) never
  appear on the KDS because they go straight from cart to bill.
- **PostgREST FK disambiguation**: `orders` has two FKs to `users`
  (`billed_by`, `created_by`). Embeds must use the constraint name:
  `users!orders_billed_by_fkey(...)` not just `users(...)`.
- **`getUser()` in middleware** is intentional, not a perf bug. Supabase
  docs warn against `getSession()` in middleware (won't catch revoked
  tokens). We skip the auth call entirely on public paths instead.

---

## 6. What to do when adding a feature

The repeatable recipe, drawn from how every feature shipped so far was
structured:

1. **Migration** — add tables / columns / RPCs / RLS. Idempotent.
   Restore the numbered bundles from `supabase/migrations/_backup_2026-05-20/`,
   add a new `30_my_feature.sql` (or edit the relevant bundle), then
   re-concatenate into `combined_schema.sql` — see
   `supabase/migrations/README.md` for the regenerate steps.
2. **Types** — update `src/types/database.ts` (hand-rolled).
3. **Pure logic** — extract any non-trivial math / state machine /
   parsing into `src/lib/<feature>/*.ts`. Write Vitest unit tests for it.
4. **Server route** — if it crosses an external boundary (webhook,
   payment provider, third-party API), add an API route under
   `src/app/api/`. CSRF via `assertSameOrigin(req)`. Log via
   `logError(e, { route, ... })`.
5. **UI** — add the page under `src/app/(app)/<feature>/page.tsx`. Use
   shadcn primitives + `<PageHeader>` for consistency. Tenant currency
   + tax labels via `getTaxConfig(tenant.country)`.
6. **Nav entry** — `src/components/app-shell/nav.tsx`. Pick the right
   section + the right role-visibility array.
7. **Tests** — at least 3 happy-path unit tests for the new logic.

---

## 7. Production deploy

Short version:

1. Set all env vars listed in `.env.example` in your hosting platform.
   For the Stripe-specific subset (platform subscription tiers + Connect),
   see [`docs/stripe-setup.md`](docs/stripe-setup.md).
2. Apply `supabase/migrations/combined_schema.sql` — one idempotent file
   containing bundles 01→33. See `supabase/migrations/README.md` for the
   apply guide and the per-bundle index.
3. Verify the storage buckets exist (`menu-images`, `tenant-logos`,
   `user-avatars`).
4. Run the k6 smoke test against the deployed URL
   (`k6 run load-test/restopos-load.js`).
5. Sign up as the first owner, complete onboarding, run one full
   POS → KOT → KDS → bill → payment loop end-to-end before opening
   to real customers.
