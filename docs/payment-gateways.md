# Payment gateways — flows, webhooks & DB field map

RestoPOS accepts customer payments through **exactly one active method per
restaurant**, chosen in **Settings → Payments**:

| Method | Region | Confirmation | Webhook? |
|--------|--------|--------------|----------|
| **PhonePe UPI** | India | **Auto** — webhook mints the bill | Yes |
| **Paytm UPI** | India | **Auto** — webhook mints the bill | Yes |
| **Manual UPI** | India | **Manual** — staff confirm a screenshot | No |
| **Stripe** | Outside India | **Auto** — webhook mints the bill | Yes |

> **Only one at a time.** Enabling PhonePe turns Paytm off (and vice-versa) in
> the settings UI, and a database trigger (`enforce_single_active_gateway`,
> migration 58) rejects any write that would leave two online gateways live.
> `tenants.payment_gateway` (`manual` / `phonepe` / `paytm` / `stripe`) is the
> single source of truth the app routes on (see `src/lib/payments/gateway.ts`).

There are **two surfaces** a payment can start from, both ending at the same
bill:

- **POS counter (cashier-fired)** — the cashier picks UPI at checkout; a QR
  shows on the customer-facing display. Flow tag `POS`.
- **QR self-ordering (customer-fired)** — the customer scans the table QR,
  orders, and pays. Flow tag `QR_ORDER`.

---

## 1. Auto-confirm gateways (PhonePe / Paytm)

### The promise
Once the customer is shown a QR for amount X and pays it, a `bills` row **will**
be created server-side — **no cashier action, no live browser tab required**.
The webhook does it; a reconcile cron is the safety net.

### Flow (identical shape for PhonePe and Paytm)

```
1. App pre-creates an `orders` row (status ON_HOLD / awaiting_confirmation)
   + `order_items`, then inserts a PENDING event row:
      • PhonePe → phonepe_payment_events  (PK merchant_transaction_id)
      • Paytm   → paytm_payment_events     (PK paytm_order_id)
2. App calls the gateway to mint a dynamic UPI QR and shows it to the customer.
3. Customer pays from any UPI app.
4. Gateway → POST our webhook  (ONE shared URL per gateway; the MID/orderId
   in the payload targets the right restaurant + transaction).
5. Webhook verifies the signature, flips the event row to SUCCESS, and calls
   the confirm RPC → bill + payment created atomically.
6. Missed webhook? The every-10-min reconcile cron polls the gateway and
   finalises any still-PENDING event the same way (idempotent).
```

Entry points:

| | PhonePe | Paytm |
|---|---|---|
| POS mint | `POST /api/payments/phonepe/display-checkout` | `POST /api/payments/paytm/display-checkout` |
| QR mint | `POST /api/public/qr/place-order` (phonepe branch) | `POST /api/public/qr/place-order` (paytm branch) |
| Webhook | `POST /api/webhooks/phonepe` | `POST /api/webhooks/paytm` |
| Reconcile cron | `GET /api/payments/phonepe/reconcile` | `GET /api/payments/paytm/reconcile` |
| Test creds | `POST /api/payments/phonepe/test` | `POST /api/payments/paytm/test` |

Signature (the entire trust boundary):
- **PhonePe** — `X-VERIFY = SHA256(base64Body + saltKey) + "###" + saltIndex`.
- **Paytm** — `CHECKSUMHASH = AES-128-CBC(SHA256(data+"|"+salt)+salt, merchantKey)`
  (the standard PaytmChecksum algorithm; see `src/lib/billing/paytm.ts`).

A request that fails verification is rejected `401` — that is what stops a
forged "payment succeeded" callback from ever reaching bill generation.

### What the webhook writes — DB field map

**Step A — the event row** (`phonepe_payment_events` / `paytm_payment_events`):

| Column | Set to |
|--------|--------|
| `status` | `SUCCESS` (or `FAILED`) |
| `provider_txn_id` / `paytm_txn_id` | the gateway's own transaction id |
| `raw` | full webhook payload (audit / dispute evidence) |
| `processed_at` | now() |
| `bill_id` | the bill created in step B |

The update is guarded by `WHERE status = 'PENDING'`, so a webhook racing the
reconcile cron is safe — whichever lands first wins, the other no-ops.

**Step B — the confirm RPC** (atomic, idempotent on `order_id`):

PhonePe → `confirm_phonepe_payment(order_id, provider_txn_id, amount)`
Paytm → `confirm_qr_order_system(order_id, txn_id, amount, 'PAYTM')` (QR flow)
or `confirm_display_checkout_payment(order_id, session_id, txn_id, amount, 0, 'inr', 'PAYTM')` (POS flow)

| Table | Fields written |
|-------|----------------|
| `orders` | `status='PAID'`, `awaiting_confirmation=false`, `confirmed_at`, `billed_at`, `paid_at`, recomputed `subtotal` / `taxable_amount` / `cgst_amount` / `sgst_amount` / `grand_total` |
| `bills` *(insert)* | `invoice_number` (FY-scoped via `next_sequence`), `fy_label`, `bill_status='PAID'`, all totals, `branch_id` |
| `payments` *(insert)* | `method` = `PHONEPE` / `PAYTM`, `amount`, `reference` = gateway txn id, `metadata` |
| `bill_audit_log` *(insert)* | `action='BILL_GENERATED'`, `after_state` incl. invoice number + gateway + `amount_ok` |
| `pos_display_sessions` *(POS only)* | `status='PAID'`, `invoice_number` → flips the cashier UI to "Paid" |

Idempotency: if a bill already exists for the `order_id`, the RPC returns it
unchanged. So webhook retries + the reconcile cron + a double-fire all converge
on exactly **one** bill.

---

## 2. Manual UPI (no webhook)

For a restaurant that has only a plain UPI ID (no gateway connected):

```
1. Customer is shown a UPI QR built from tenants.upi_id (upi://pay?pa=…).
   No webhook is wired — the bank doesn't call us back.
2. QR self-order: customer uploads a payment screenshot →
      qr_payment_proofs (status PENDING).
   POS counter: the customer just pays; the cashier eyeballs their app.
3. Staff confirm:
      • QR order → confirm_qr_order(order_id) verifies the proof and bills.
      • POS      → the cashier taps Generate bill + records payment.
```

`confirm_qr_order(order_id)` (staff-only, OWNER/MANAGER/CASHIER/CAPTAIN):

| Table | Fields written |
|-------|----------------|
| `qr_payment_proofs` | `status='VERIFIED'`, `verified_by`, `verified_at` |
| `orders` | `status='PAID'`, totals recomputed |
| `bills` *(insert)* | invoice number + totals, `bill_status='PAID'` |
| `payments` *(insert)* | `method='UPI'`, `reference` = the UPI id used |

There is **no automatic confirmation** here by design — a human verifies the
money arrived before the order is released.

---

## 3. Stripe (outside India)

Card/wallet checkout via Stripe Connect. `POST /api/public/qr/place-order`
(stripe branch) creates a Checkout Session (destination charge to the
restaurant's connected account, platform fee retained). The Stripe webhook
(`/api/webhooks/stripe`, deduped via `stripe_webhook_events`) calls
`confirm_qr_order_system(…, 'STRIPE')` / `confirm_display_checkout_payment(…,
'STRIPE')` → same `orders`/`bills`/`payments(method='STRIPE')` writes as above.
See [`stripe-setup.md`](stripe-setup.md).

---

## 4. Environment variables

Per-tenant credentials live in `tenant_payment_gateways` (entered in Settings →
Payments). Platform-level `.env` fallbacks (single-restaurant / local sandbox):

```bash
# PhonePe
PHONEPE_ENV=staging            # or production
PHONEPE_MERCHANT_ID=
PHONEPE_SALT_KEY=
PHONEPE_SALT_INDEX=1

# Paytm
PAYTM_ENV=staging              # or production
PAYTM_MID=
PAYTM_MERCHANT_KEY=

# Stripe (see stripe-setup.md for the full set)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PLATFORM_FEE_PERCENT=1

# Reconcile cron auth (PhonePe + Paytm reconcile endpoints)
CRON_SECRET=
```

Schedule both reconcile endpoints every ~10 minutes with
`Authorization: Bearer <CRON_SECRET>`.

---

## 5. Going live checklist (PhonePe / Paytm)

1. Apply `supabase/migrations/combined_schema.sql` (bundles ≤ 58).
2. Settings → Payments → enable ONE gateway, paste **sandbox** credentials,
   hit **Test connection** (must be green).
3. Configure the webhook URL in the gateway dashboard:
   `https://<your-domain>/api/webhooks/phonepe` or `…/api/webhooks/paytm`.
4. Run one real end-to-end sandbox payment; confirm a `bills` row + a
   `payments` row (`method` = PHONEPE/PAYTM) appear and the order flips to PAID.
5. Switch the environment toggle to **Production**, paste live credentials,
   re-test, and set `CRON_SECRET` + schedule the reconcile cron.

> Paytm's checksum + API contract are implemented to Paytm's documented spec
> but **must be validated in Paytm's sandbox** before production — there are no
> Paytm credentials baked into the platform.
