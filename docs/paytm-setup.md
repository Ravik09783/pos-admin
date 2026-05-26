# Paytm Payment Gateway — setup & testing guide

This is the India payment rail for the **scan-to-pay** flow: the customer
scans a Paytm UPI QR, pays from **any** UPI app (Google Pay, PhonePe,
Paytm, BHIM), and RestoPOS auto-confirms the payment via a webhook →
records it → finalises the bill. International tenants use Stripe (see
`docs/stripe-setup.md`); Paytm is India-only and runs alongside it.

It's **per-tenant**: every restaurant connects *its own* Paytm merchant
account, so money settles to the right restaurant.

### Who does what — read this first

- **The platform / website owner** handles **no money** and needs **no
  KYC**. The app is software; payments go `customer → Paytm →
  restaurant's bank`, never through the platform. The webhook the
  platform receives is just an *information ping* ("payment X
  happened") — it carries no money.
- **Each restaurant** creates **its own** Paytm for Business account and
  completes **its own** KYC — because each restaurant is the merchant
  receiving its own money. One restaurant's KYC never covers another's;
  every merchant that receives money is KYC-verified separately (RBI
  rule, not a software limit).
- Wherever this doc says "after KYC", it means **the restaurant's
  KYC** — not the platform owner's.

> **Testing:** you can test today with Paytm **staging** credentials —
> no KYC needed. Staging behaves identically to production; a restaurant
> swaps to its KYC-approved production credentials when it goes live.

---

## 0. Prerequisite — apply the migration

Paytm support lives in **migration 33**. Run `combined_schema.sql` (or
just `33_paytm_gateway.sql`) in the Supabase SQL editor. It adds:

- `tenant_payment_gateways.paytm_mid`, `paytm_merchant_key`,
  `paytm_enabled`, `paytm_env`
- the `paytm_payment_events` tracking table

---

## 1. Get Paytm credentials

1. Sign up / log in at **<https://business.paytm.com>** and open the
   **Paytm Payment Gateway** product.
2. Go to **Developer Settings → API Keys**. You'll see two credential
   sets:
   - **Test** — works immediately, no KYC. Use this now.
   - **Production** — unlocked after business KYC is approved.
3. From the **Test** set, copy:
   - **MID** (Merchant ID) — e.g. `TestMid12345678901234`
   - **Merchant Key** — a 16-character secret
4. Make sure **UPI** and **Dynamic QR** are enabled for the MID (Paytm
   support enables these on request if they aren't already).

> The **Merchant Key** is a secret. RestoPOS stores it on
> `tenant_payment_gateways` (Owner-only via RLS, read server-side only,
> never sent to the browser) — the same way the Razorpay keys are kept.

---

## 2. Connect Paytm in RestoPOS

There are two ways to supply the credentials. Pick **A** for quick
single-restaurant testing; **B** is the real multi-tenant model.

### A. `.env` — platform fallback (easiest for testing)

Put the credentials in `.env`. The code uses these for **any** tenant
that hasn't connected its own Paytm — perfect for dev / one restaurant:

```dotenv
PAYTM_ENV=staging
PAYTM_MID=YOUR_TEST_MID
PAYTM_MERCHANT_KEY=YOUR_TEST_MERCHANT_KEY
PAYTM_WEBSITE=WEBSTAGING
PAYTM_CHANNEL_ID_WEB=WEB
PAYTM_CHANNEL_ID_WAP=WAP
```

Restart the dev server after editing `.env`. Done — no SQL needed.

### B. Per-tenant — Settings → Payment gateway (production model)

In real multi-tenant production, each restaurant connects **its own**
Paytm account so money settles to the right restaurant. The restaurant
OWNER does this themselves: **Settings → Payment gateway → Paytm tab →
paste MID + Merchant Key → pick the environment → Save**. That writes
the `tenant_payment_gateways` row for you — no SQL needed.

If you ever need to set it by hand (migrations, scripting), the row is:

```sql
insert into public.tenant_payment_gateways (tenant_id, paytm_mid, paytm_merchant_key, paytm_env, paytm_enabled)
select id, 'TENANT_MID', 'TENANT_MERCHANT_KEY', 'staging', true
from public.tenants where slug = 'your-restaurant-slug'
on conflict (tenant_id) do update set
    paytm_mid          = excluded.paytm_mid,
    paytm_merchant_key = excluded.paytm_merchant_key,
    paytm_env          = excluded.paytm_env,
    paytm_enabled      = excluded.paytm_enabled;
```

A tenant's own row (B) **always wins** over the `.env` fallback (A).

`paytm_env` (and `PAYTM_ENV`) controls which Paytm host is used:
- `staging` → `securegw-stage.paytm.in` (test)
- `production` → `securegw.paytm.in` (live)

---

## 3. Configure the webhook (callback URL)

In the Paytm dashboard, set the **transaction / status callback URL** to:

```
https://<your-domain>/api/webhooks/paytm
```

For local testing, expose your dev server with a tunnel (e.g.
`ngrok http 3000`) and use the tunnel URL — Paytm must be able to reach
it from the public internet.

One URL serves every tenant — the handler routes by the `MID` in the
payload and verifies the `CHECKSUMHASH` against that tenant's merchant
key. An unsigned or mis-signed callback is rejected with `401`.

---

## 4. How a payment flows

```
Cashier hits "Pay via QR"            Customer self-orders at a table
        │                                      │
        ▼                                      ▼
  create-QR route ── asks Paytm ──► dynamic UPI QR  (paytm_payment_events row = PENDING)
        │
        ▼
  QR shown on the customer screen / QR-ordering page
        │
        ▼
  Customer scans + pays in any UPI app
        │
        ▼
  Paytm ──POST──► /api/webhooks/paytm
        │   • verify CHECKSUMHASH
        │   • idempotent on paytm_order_id
        ▼
  Payment recorded → bill auto-generated → event row = SUCCESS
        │
        ▼
  Customer screen: "Paid ✓"   ·   Staff: "Payment received" → print
```

The webhook is the **only** source of truth — a client-side "success"
screen is never trusted (the customer could close the app, or fake it).

---

## 5. Test it

With staging credentials connected:

1. Ring up an order on the POS, choose **Pay via UPI / QR**.
2. The customer screen shows the Paytm QR.
3. Pay it using Paytm's **staging test instruments** (Paytm's docs list
   test UPI handles / test card numbers for the staging environment) —
   no real money moves.
4. Watch:
   - the **webhook** hit `/api/webhooks/paytm` (check the server logs),
   - the `paytm_payment_events` row flip `PENDING → SUCCESS`,
   - a `payments` row appear against the bill,
   - the customer screen show **"Paid ✓"**, then reset.

Verify in SQL:

```sql
select paytm_order_id, status, paytm_txn_id, amount, bill_id, processed_at
from public.paytm_payment_events
order by created_at desc limit 10;
```

---

## 6. Go live (after KYC)

Once Paytm approves your business KYC and issues **production**
credentials:

1. In the Paytm dashboard, copy the **Production** MID + Merchant Key.
2. Update the tenant row:
   ```sql
   update public.tenant_payment_gateways g
   set paytm_mid = 'PROD_MID',
       paytm_merchant_key = 'PROD_MERCHANT_KEY',
       paytm_env = 'production'
   from public.tenants t
   where t.id = g.tenant_id and t.slug = 'your-restaurant-slug';
   ```
3. Point the Paytm dashboard's callback URL at your **production**
   domain's `/api/webhooks/paytm`.

No code change — `paytm_env = 'production'` switches the host. The next
QR is a live one.

---

## For restaurant owners — connect Paytm (step by step)

This is the part a **restaurant owner** follows to start accepting
scan-to-pay UPI. (Hand this section to them, or it becomes the
Settings → Payment Gateway help text.)

1. **Create a Paytm for Business account.** Go to
   <https://business.paytm.com>, sign up with your business phone +
   email, and open the **Payment Gateway** product.
2. **Complete KYC.** Paytm asks for your business details, **PAN**,
   **bank account** (where your money settles), and address proof —
   GST if you have it. This is *your* restaurant's KYC; it usually
   clears in 1–3 days.
3. **Enable UPI + Dynamic QR** on your account (Paytm support enables
   these if they're not on by default).
4. **Copy your credentials.** Dashboard → **Developer Settings → API
   Keys** → **Production** tab → copy the **MID** and **Merchant Key**.
   (Use the **Test** tab first if you want to trial it without KYC.)
5. **Connect in RestoPOS.** Open **Settings → Payment gateway**, choose
   the **Paytm** tab, paste your **MID** and **Merchant Key**, pick the
   environment (**Test** / **Production**), and **Save**. The page
   confirms both fields are set; the credentials are exercised for real
   the first time a customer's QR is issued.
6. **Set the callback URL in Paytm.** In the Paytm dashboard's
   **Webhook / Callback URL** setting, paste:
   `https://<your-restopos-domain>/api/webhooks/paytm`
   (Your RestoPOS administrator can give you the exact domain.)
7. **Done.** Customers can now scan your QR on the POS customer screen
   or the table-ordering page and pay from any UPI app — the bill is
   recorded and finalised automatically.

### Restaurant FAQ

**Q: Does the POS company / website owner see or hold my money?**
No. Money flows `customer → Paytm → your bank account`. The POS only
receives a small "payment done" notification so it can mark the bill
paid. It never touches the funds.

**Q: Do I have to use Paytm?**
For the **automatic** scan-to-pay flow, yes — this integration is built
on Paytm. If you don't want a gateway, use the **free plain UPI QR**
instead: just enter any UPI ID and your staff taps "Payment received"
after the customer pays (no KYC, no fee, but not automatic).

**Q: Can my customers pay with Google Pay / PhonePe, not just Paytm?**
Yes. The QR is a **standard UPI QR** — Google Pay, PhonePe, Paytm,
BHIM, any UPI app scans it. Paytm is just *your* collecting account.

**Q: Personal UPI or a business account?**
For the Paytm gateway flow you need a **Paytm for Business merchant
account** (KYC'd). For the free plain-QR flow, use a **business /
merchant UPI ID** — personal UPI IDs have low daily limits and mix
personal and business money.

**Q: What does it cost me?**
UPI through Paytm is **0% MDR** (government-mandated) — effectively
free. Card payments carry Paytm's standard fee. The POS platform
charges you nothing for payments.

**Q: Can I test before finishing KYC?**
Yes. Use Paytm's **Test (staging) credentials** — they work
immediately, with test instruments and no real money. Switch to
**Production** credentials once KYC is approved; nothing else changes.

**Q: The QR fails to generate / payments don't go through.**
Re-copy the MID + Merchant Key (no stray spaces), and make sure the
environment toggle (Test vs Production) matches which credentials you
pasted — Test credentials only work in Test mode. If a customer hits a
QR before this is fixed, the order falls back to your plain UPI ID
(if set) so they can still pay.

**Q: A customer paid but the bill didn't finalise.**
Rare — usually a missed webhook. The POS re-checks payment status on a
timer, so it self-heals within a minute. Staff can also tap
"Payment received" manually as a fallback.

---

## Security notes

- **Never trust a client success screen** — only the signed webhook (or
  the `paytmTransactionStatus` poll) confirms a payment.
- **Checksum verification is mandatory** — the webhook rejects any
  callback whose `CHECKSUMHASH` doesn't validate against the tenant's
  merchant key.
- **Idempotency** — `paytm_payment_events.paytm_order_id` is the primary
  key and the `status` guard; Paytm retries callbacks, duplicates are
  no-ops.
- The merchant key is Owner-only (RLS) and read server-side only. For
  extra hardening you can later move it into Supabase Vault.
