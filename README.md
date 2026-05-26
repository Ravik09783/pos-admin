# RestoPOS

Multi-tenant SaaS Point-of-Sale for Indian restaurants. Browser-based, GST-compliant, with a one-click **CA Export Bundle** as the killer feature — every month, the owner downloads a ZIP containing GSTR-1 working, GSTR-3B summary, P&L, Balance Sheet inputs, Tally XML, and the GST portal JSON. The CA just files; data entry is gone.

Built with **Next.js 14 App Router + Supabase + Tailwind + shadcn/ui**.

## What's in Phase 1

- Multi-tenant auth with Supabase + RLS isolation
- Role-based access control (Owner / Manager / Cashier / Captain / Kitchen / Auditor)
- Restaurant onboarding wizard (profile, GSTIN, FSSAI, state)
- Menu CRUD — categories, items, HSN codes, GST slabs, food types
- POS screen — order builder, cart, GST tax engine
- Bill generation with **lock & audit log** (only the Owner can edit a generated bill)
- Bill display, payment recording (cash / UPI / card / split / etc.)
- Bill void with audit trail
- Accounting — expenses, balance sheet entries
- **CA Export Bundle** — Excel ZIP, Tally XML, GST portal JSON, PDF, all in a single ZIP
- Futuristic dark-mode UI with neon accents and glassmorphism

## What's NOT in Phase 1 yet

Kitchen Display System, inventory + recipe costing, table reservations, QR code ordering, multi-branch, payment gateway webhooks, WhatsApp/SMS, PWA offline mode. The Phase 1 schema already supports these; only the UI is deferred.

## Setup

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com), create a project, copy the project URL and the anon key.

### 2. Run the migrations

In your Supabase project's SQL editor, run the migration files in order:

```
supabase/migrations/001_init.sql
supabase/migrations/002_menu.sql
supabase/migrations/003_pos.sql
supabase/migrations/004_accounting.sql
supabase/migrations/005_rls.sql
supabase/migrations/006_seed.sql
supabase/migrations/007_rpc.sql
```

Or via the Supabase CLI:

```bash
supabase link --project-ref <YOUR_REF>
supabase db push
```

### 3. Configure env

Copy `.env.example` to `.env` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Project structure

```
src/
  app/
    (auth)/           # /login, /signup
    (app)/            # authenticated app shell
      dashboard/
      pos/            # main order-taking screen
      menu/           # categories + items CRUD
      bills/
      accounting/     # expenses, balance sheet
      ca-export/      # the differentiator
      settings/
    onboarding/       # restaurant profile wizard
    auth/callback/    # OAuth callback
  components/
    ui/               # shadcn-style primitives
    app-shell/        # sidebar, topbar
  lib/
    supabase/         # client / server / middleware
    gst/              # tax engine (Decimal-precise)
    rbac/             # permission checks
    ca-export/        # the killer feature
      fetch.ts        # gather monthly data
      excel.ts        # 9-sheet workbook
      tally.ts        # Tally Prime XML
      gst-portal.ts   # GSTR-1 offline-utility JSON
      pdf.ts          # PDF report
      bundle.ts       # ZIP everything
  types/
    database.ts       # hand-rolled Supabase types
supabase/migrations/  # SQL schema + RLS + seed + RPCs
```

## CA Export — what's in the ZIP

When the Owner clicks "Download CA bundle (ZIP)" on `/ca-export`, the ZIP contains:

| File | What's inside |
|------|---------------|
| `*_GST_Filing.xlsx` | 9 sheets: Summary · Sales Register · Sales Item Detail · GSTR-1 Working (Tables 4, 7, 12) · GSTR-3B Working · Purchase Register · Expenses · P&L Statement · Balance Sheet inputs |
| `*_Tally_Vouchers.xml` | Tally Prime / ERP 9 import — sales + purchase vouchers with CGST/SGST/IGST allocations |
| `*_GSTR1_Portal.json` | GSTR-1 in offline-utility schema (v3.0.4) — B2B, B2C-Large, B2C-Small, HSN summary |
| `*_Filing_Summary.pdf` | Human-readable summary with all tables |
| `README.txt` | Filing checklist for the CA |

The owner emails the ZIP to their CA — and now the CA's job becomes *reviewing & filing*, not *re-entering data*. That's the cost-cut.

## Security

- Multi-tenant isolation enforced at the database via Supabase RLS
- Bill edits restricted to Owner role at *both* the API layer and DB RLS layer
- `bill_audit_log` table is append-only — UPDATE and DELETE triggers raise exceptions
- Helper functions use `SECURITY DEFINER` with `search_path` locked
- Bill generation, payment, and void use atomic RPC functions

## Tech stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 14 (App Router, Server Components) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS + custom shadcn/ui primitives |
| State | Zustand + React Query |
| Backend | Supabase (PostgreSQL + Auth + RLS + Realtime + Storage) |
| Money | `decimal.js` (round-half-up, 2dp) |
| Excel | `exceljs` |
| PDF | `jsPDF` + `jspdf-autotable` |
| ZIP | `jszip` + `file-saver` |
| Validation | Zod |
| Forms | react-hook-form |
