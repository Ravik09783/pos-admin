# How to create a super-admin

A super-admin is a platform operator (you, your ops team) — **not** a
restaurant owner. They have access to the `/super-admin` console where
they can:

- See every registered restaurant on the platform (filterable by
  country), plus a second tab listing accounts that signed up but have
  no restaurant yet
- Create a complete restaurant directly from the console — owner login
  account **and** the tenant in one step (name, email, password,
  restaurant name, country). **No verification email is sent**: the
  account is confirmed immediately, so the owner signs in with the
  password the super-admin sets. The restaurant shows up in the list
  right away; the owner fine-tunes tax details, address and staff in
  Settings. *Requires migration 34 — see below.*
- Impersonate any account in a new tab — a restaurant's owner (falls
  back to any member if the tenant has no OWNER row), or an account from
  the "without restaurant" tab (lands on onboarding)
- Send **announcement posts** (`/super-admin/posts`) — compose an HTML
  message (formatting toolbar + inline image upload), preview it,
  optionally set an expiry date, and broadcast to every restaurant or a
  specific set. Restaurants read them on their in-app Announcements
  page; expired posts stop showing. Open a sent post to see **who has
  read it** (restaurant, name, email, time), or delete it — its images
  are swept out of Supabase storage too.
- Permanently delete a restaurant (cascade: DB rows, uploaded files,
  staff logins, Stripe subscription)

There are two ways to create one. **Use the role-update path for
day-to-day ops.** The env-var path is for bootstrap and break-glass.

---

## One-time: console migrations (34 + 35 + 36)

Three console features need their RPCs / tables applied once:

- **Migration 34** — `super_admin_create_restaurant`, behind the
  **Create restaurant** button.
- **Migration 35** — `super_admin_tenant_payments`, behind the
  **Payments** card on a restaurant's detail page
  (`/super-admin/restaurant/<id>`).
- **Migration 36** — `admin_posts` (+ RPCs), behind the **Announcements**
  page (`/super-admin/posts`) and the restaurant-side Announcements page.

```bash
# Supabase Studio → SQL editor, paste the contents of EITHER:
#   supabase/migrations/_backup_2026-05-20/34_super_admin_create_restaurant.sql  (delta)
#   supabase/migrations/_backup_2026-05-20/35_super_admin_tenant_payments.sql    (delta)
#   supabase/migrations/_backup_2026-05-20/36_admin_posts.sql                    (delta)
#   supabase/migrations/combined_schema.sql                                      (whole schema — has all)
```

All are idempotent (`CREATE OR REPLACE` / `IF NOT EXISTS`), so re-running
is safe — a fresh DB set up from `combined_schema.sql` already has all
three. Until applied: the Create-restaurant button returns a clear
"apply migration 34" error (and rolls back the half-created account),
the Payments card shows an "apply migration 35" hint, and sending an
announcement returns an "apply migration 36" error.

---

## Recommended: role-update (no redeploy)

### 1. Apply migration 21 once

```bash
# In Supabase Studio → SQL editor, paste the contents of:
# supabase/migrations/21_super_admin_role.sql
```

This adds `'SUPER_ADMIN'` as a valid value for `public.users.role` and
ships a `public.is_super_admin()` SQL helper.

### 2. Have the person sign up normally

Send them to **`/signup`**. They enter an email and password like any
other user. They'll land on the onboarding page (the standard flow for
a new account without a tenant). **They don't need to complete
onboarding — leave that page open or close the tab. The signup itself
is what matters.**

What just happened in the DB:

- A row was inserted into `auth.users` (Supabase manages this)
- A trigger inserted a matching row into `public.users` with
  `tenant_id = NULL` and `role = 'OWNER'` (the default)

### 3. Promote them to SUPER_ADMIN in Supabase Studio

1. Open your Supabase project → **Table Editor** → `public.users`
2. Find the row whose `email` matches the person you want to promote
3. Click the row → edit the `role` column → change `OWNER` → `SUPER_ADMIN`
4. Save

You can also do it via SQL editor:

```sql
update public.users
set role = 'SUPER_ADMIN'
where email = 'ops@yourdomain.com';
```

### 4. The user refreshes their browser

Whatever page they were on when you flipped the role, the next request
hits the `(app)` layout — which now sees `role = 'SUPER_ADMIN'` and
redirects them straight to **`/super-admin`**. They never see the
tenant onboarding flow again.

That's it. They can now manage every restaurant on the platform.

### To remove super-admin access

In Supabase Studio, set their `role` back to `OWNER` (or anything that
isn't `SUPER_ADMIN`). On their next page load they'll be sent back to
onboarding (because they still don't have a `tenant_id`).

To fully remove the account, delete the `auth.users` row in the
Authentication panel — the cascade drops the matching `public.users`
row automatically.

### Locked-out edge case

Setting `is_active = false` on a SUPER_ADMIN row blocks their login
just like it does for any other staff user. If a super-admin gets
locked out and there's no other super-admin to flip them back, use
the env-var break-glass path below.

---

## Bootstrap / break-glass: env-var allow-list

For the **very first** super-admin (before anyone is in the DB to flip
a role) or to recover from a lockout, add the user's email to
`RESTOPOS_SUPER_ADMIN_EMAILS` in `.env.local` (or your hosting
platform's env panel):

```bash
RESTOPOS_SUPER_ADMIN_EMAILS=ops@yourdomain.com
# Multiple emails:
RESTOPOS_SUPER_ADMIN_EMAILS=ops@yourdomain.com,founder@yourdomain.com
```

Restart your Next server. Anyone whose signed-in email matches an entry
in the list gets `/super-admin` access regardless of their
`public.users.role`.

Notes on the env path:

- **Adding / removing emails requires a redeploy.** That's why we
  recommend the role-update path for day-to-day ops.
- The check is **case-insensitive** and strips whitespace.
- The env-listed user still goes through normal onboarding the first
  time they sign in (unless you've also promoted them via the
  role-update path). The env match grants `/super-admin` access on top
  of their normal tenant access — useful if you want a person to be
  both a tenant owner AND a super-admin.

---

## Verifying it worked

1. Have the promoted user sign in at `/login`.
2. They should land on `/super-admin` (role path) or
   `/dashboard` with a **"Super-admin console"** entry in the user
   dropdown (env path).
3. The `/super-admin` URL returns a 404 for anyone who isn't a super-
   admin — including regular tenant OWNERs.

---

## Security model

- The `/super-admin` URL **404s** for everyone outside the allow-list.
  We don't render a "403 Forbidden" page on purpose; making the URL's
  existence invisible reduces the attack surface for credential
  stuffing.
- Every `/api/super-admin/*` endpoint re-checks authorization with the
  same `requireSuperAdmin()` guard. A direct API call without the
  allow-list match returns the same 404.
- The two destructive RPCs (`super_admin_tenant_overview()` and
  `super_admin_delete_tenant()`) refuse anything that isn't the service
  role — even a hypothetical authenticated SUPER_ADMIN row in
  `public.users` can't call them via PostgREST.
- Every impersonation and every delete writes a `logInfo` audit line
  with the super-admin's email + target tenant. Wire that into your
  log sink (Sentry, Logtail, etc.) for a full trail.

---

## Quick reference

| Question | Answer |
|---|---|
| Where is the role check enforced? | `(app)/layout.tsx` (redirect), `super-admin/layout.tsx` (gate), `lib/super-admin/guard.ts` (API). |
| What table column? | `public.users.role`. Allowed values include `SUPER_ADMIN` after migration 21. |
| Tenant id of a super-admin? | `NULL`. Super-admins are platform-scoped, not tenant-scoped. |
| Can a super-admin also be a tenant OWNER? | Only via the env-var path. The role column holds one value at a time. |
| How do I list every super-admin? | `select email, full_name from public.users where role = 'SUPER_ADMIN';` |
| Where do I see audit logs? | Wherever `logInfo`/`logWarn` lands — Sentry, Logtail, stdout, etc. |
