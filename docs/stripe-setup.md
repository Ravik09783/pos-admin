# Stripe setup

Everything you need to take a fresh RestoPOS deployment from "no payments
configured" to "international restaurants can subscribe and accept
customer payments." Plain-language steps; copy-paste-friendly.

There are **two independent Stripe surfaces** in RestoPOS, and they use
two different Stripe accounts:

| Surface | What it does | Whose account |
|---|---|---|
| **Platform SaaS subscription** | RestoPOS charges the restaurant a monthly fee ($49 / $99 / $199 in USD, or the INR equivalents for India) | **Your** Stripe account |
| **Stripe Connect** | The restaurant charges its own customers via QR ordering | The **restaurant's** Stripe Express account (onboarded through your platform) |

You configure the platform side **once**. Each restaurant then onboards
their own Connect account from inside the app.

---

## Part 1 — Platform Stripe account (one-time setup by you)

This is the Stripe account on your Stripe Dashboard, the one whose
secret key starts with `sk_live_…`.

### 1.1 Create the three pricing tier products (USD, for international restaurants)

Stripe Dashboard → **Products → Add product**. Repeat three times:

| Product name | Price | Currency | Billing period |
|---|---|---|---|
| RestoPOS Starter | 49.00 | USD | Monthly recurring |
| RestoPOS Growth | 99.00 | USD | Monthly recurring |
| RestoPOS Scale | 199.00 | USD | Monthly recurring |

After each save, Stripe shows you a `price_xxxxxxxxxxxx` id under the
product. **Copy each one** — you'll paste them into env vars in a
moment.

> **For Indian tenants, billing is invoice-based by default** (the app
> shows them an "our team will reach out" note). If you'd rather charge
> Indian tenants on Stripe too, create three more products with INR
> prices (₹3,500 / ₹5,000 / ₹10,000 monthly) and copy those Price IDs
> for the `STRIPE_PLATFORM_PRICE_ID_IN_*` env vars below. Otherwise
> leave those env vars blank.

### 1.2 Enable Stripe Connect

Stripe Dashboard → **Connect** → click **Get Started**:

- **Platform type**: Platform with connected accounts
- **Account type to offer**: **Express** (this is what RestoPOS uses;
  Custom and Standard are not supported)
- Add your platform branding (logo, colors, support contact). Restaurants
  see this branding during their own onboarding flow.
- Under **Settings → Connect → Connect onboarding settings**, set
  redirect URLs to your domain:
  - Return URL: `https://your-domain.com/api/payments/stripe/connect/refresh`
  - Refresh URL: `https://your-domain.com/api/payments/stripe/connect/refresh`

### 1.3 Configure the Customer Portal

Stripe Dashboard → **Settings → Customer Portal** → **Activate**.

This is what the "Manage in Stripe portal" button on the restaurant's
billing settings page opens. Enable at least:

- Update payment method
- View invoice history
- Cancel subscription (with at-period-end behavior)

Leave plan-switching disabled in the portal — restaurants should pick
their tier from the in-app `/settings/billing` page so the
`set-plan` flow stays the single source of truth.

### 1.4 Add the webhook endpoint

Stripe Dashboard → **Developers → Webhooks → Add endpoint**:

- **Endpoint URL**: `https://your-domain.com/api/webhooks/stripe`
- **Events to send** (copy-paste this list):

  ```
  customer.subscription.created
  customer.subscription.updated
  customer.subscription.deleted
  customer.subscription.trial_will_end
  invoice.payment_succeeded
  invoice.payment_failed
  invoice.upcoming
  checkout.session.completed
  payment_intent.succeeded
  payment_intent.payment_failed
  charge.refunded
  charge.dispute.created
  charge.dispute.closed
  account.updated
  account.application.deauthorized
  payout.paid
  payout.failed
  ```

After saving, click into the endpoint and **reveal the signing secret**
(starts with `whsec_…`). Copy it.

### 1.5 Pin the API version

Recommended but optional. Stripe Dashboard → **Developers → API version**
→ set to **2024-11-20.acacia** (the version RestoPOS pins to in
[`src/lib/billing/stripe.ts`](../src/lib/billing/stripe.ts)). Keeps the
webhook payload shape stable.

---

## Part 2 — Environment variables

Paste these into `.env.local` for local dev, or your hosting platform's
env panel (Vercel / Cloudflare Pages / etc.) for production:

```bash
# ── Stripe core — required ───────────────────────────────────────────
STRIPE_SECRET_KEY=sk_live_...                  # from API keys
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_... # from API keys
STRIPE_WEBHOOK_SECRET=whsec_...                # from step 1.4

# ── International pricing tiers (USD) — required for non-India ───────
STRIPE_PLATFORM_PRICE_ID_INTL_STARTER=price_... # $49/mo product
STRIPE_PLATFORM_PRICE_ID_INTL_GROWTH=price_...  # $99/mo product
STRIPE_PLATFORM_PRICE_ID_INTL_SCALE=price_...   # $199/mo product

# ── India pricing tiers (INR) — only if you bill Indian tenants ──────
# ── on Stripe instead of invoice. Otherwise leave blank.            ──
STRIPE_PLATFORM_PRICE_ID_IN_STARTER=
STRIPE_PLATFORM_PRICE_ID_IN_GROWTH=
STRIPE_PLATFORM_PRICE_ID_IN_SCALE=

# ── Platform commission percent (Stripe Connect)  ────────────────────
# Percent of every customer payment kept by the platform. 1 = 1%.
STRIPE_PLATFORM_FEE_PERCENT=1
```

Restart your Next server after changing env vars (Next caches them at
process start).

---

## Part 3 — Verify it works

### 3.1 Smoke-test the webhook

Stripe Dashboard → your webhook endpoint → click **Send test webhook**
→ pick `customer.subscription.updated`. You should see a `200` response.
If you see `400 missing signature` or `401 invalid signature`,
`STRIPE_WEBHOOK_SECRET` is wrong.

### 3.2 End-to-end: a non-India restaurant subscribes

1. **Sign up** at `/signup` → pick **United States** → complete
   onboarding → you should land on `/dashboard` with a 30-day trial
   banner.
2. **Go to `/settings/billing`** → confirm the three tier cards show
   $49 / $99 / $199 with the **Most popular** badge on Growth.
3. **Click "Switch to Growth"** → toast "Switched to Growth". This
   writes `plan_tier = growth` to the tenants row but does **not** yet
   create a Stripe subscription (still on trial).
4. **Add a card** (Stripe Card Element below the picker) using the test
   card `4242 4242 4242 4242` (any future expiry, any CVC). On submit:
   - `setup-intent` creates a Stripe Customer
   - `start-subscription` reads `plan_tier=growth + country=US` → picks
     `STRIPE_PLATFORM_PRICE_ID_INTL_GROWTH` → creates the subscription
   - Webhook fires `customer.subscription.created` → tenants row flips
     to `subscription_status = ACTIVE`
5. **Refresh `/settings/billing`** → status card should now say
   **"Subscription active · Next charge on YYYY-MM-DD"**.

### 3.3 End-to-end: the restaurant onboards Connect + takes a customer payment

1. **Go to `/settings/payments`** → click **Connect with Stripe**.
2. Stripe Express onboarding opens in a new tab. Use the test
   completion flow (Stripe lets you skip most steps in test mode).
3. Back in the app, status pills flip green: **Details submitted**,
   **Charges enabled**, **Payouts enabled**.
4. **Open `/qr/<your-tenant-slug>/T5`** in an incognito tab → add an
   item → tap **Pay & place order** → Stripe Checkout opens → pay with
   `4242 4242 4242 4242`.
5. Webhook fires `checkout.session.completed` → bill auto-generates →
   the QR success screen shows the invoice number + Download bill link.

If any of these steps stall, check the server logs for `logWarn` /
`logError` entries — every Stripe-side failure surfaces a clear message
naming the missing env var or the rejected operation.

To change pricing or limits later, edit
[`src/lib/billing/plans.ts`](../src/lib/billing/plans.ts) and update the
matching Price IDs in your Stripe Dashboard + the env vars. Nothing
else needs to be touched.
