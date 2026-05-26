# Paytm payment auto-confirmation — how it works

This doc explains how a customer's UPI payment is **confirmed
automatically** — the bill generates itself, the customer screen turns
green, and the staff screen updates — with **no manual verification**,
across many restaurants and many staff at once.

There are **two** auto-confirm flows. Both share one webhook and one
routing model.

---

## The two flows

| Flow | Who orders | Where the QR shows | Confirm path |
|------|-----------|--------------------|--------------|
| **A · QR table-ordering** | The customer self-orders at a table (scans the table QR) | On the customer's own phone, in the ordering page | webhook → `confirm_qr_order_system` |
| **B · POS counter scan-to-pay** | The cashier rings the order up on the POS | On the POS **customer-facing display** | webhook → `confirm_display_checkout_payment` |

Both end the same way: the customer pays from **any** UPI app, Paytm
calls our webhook, and the bill is finalised server-side.

---

## How multi-tenant routing works

Nothing is "addressed" to a restaurant. One webhook URL serves everyone;
**data does the targeting.**

```
Customer pays
   │
   ▼
Paytm ──POST──► /api/webhooks/paytm        ← ONE URL, every restaurant
   │   payload: MID, ORDERID, TXNAMOUNT, STATUS, CHECKSUMHASH
   │
   ├─ 1. Which RESTAURANT?  tenant_payment_gateways WHERE paytm_mid = <MID>
   │      (each restaurant connects its own Paytm → its own MID)
   │
   ├─ 2. Verify CHECKSUMHASH against that tenant's merchant key
   │      (a forged / unsigned callback is rejected with 401)
   │
   ├─ 3. Which exact SALE?  paytm_payment_events WHERE paytm_order_id = <ORDERID>
   │      → the row carries tenant_id, order_id, display_session_id, flow
   │
   ├─ 4. Idempotency: if the row is already SUCCESS, ack and stop
   │      (Paytm retries callbacks — duplicates are no-ops)
   │
   ▼
On TXN_SUCCESS → the confirm RPC for that flow:
   • flow = 'QR_ORDER' → confirm_qr_order_system(order_id, txn_id, amount)
   • flow = 'POS'      → confirm_display_checkout_payment(order_id, display_session_id, …)
```

`paytm_payment_events` is the heart of it — **one row per QR issued**,
written *before* the QR is shown, so the webhook can always map a
payment back to the exact sale. `paytm_order_id` is the primary key, so
double-processing is physically impossible.

The `idx_tpg_paytm_mid` index (migration 33) keeps step 1 fast no matter
how many restaurants are connected.

---

## How the screens update — no polling

**Supabase Realtime + RLS.** The webhook just writes to the database;
Postgres then pushes the change to subscribed clients, and **row-level
security guarantees each restaurant only receives its own events.**

- **Customer display** (`/display/...`) subscribes to its
  `pos_display_sessions` row. When the webhook flips it to `PAID`, the
  screen swaps to the green "Thank you, &lt;name&gt;!" panel by itself.
- **Cashier's POS** subscribes to the same row (`pos-display-paid`
  channel). On `PAID` it closes the checkout dialog, shows
  *"Payment received — invoice INV-…"*, and resets for the next sale.
- **Anywhere in the admin app**, `PaymentNotifier` subscribes to the
  `payments` table (filtered by tenant / branch) and toasts + chimes.

Restaurant B can never receive Restaurant A's "Paid" event — same
webhook URL, but RLS scopes every realtime delivery. That's what makes
it correct at scale.

---

## Flow B — POS counter scan-to-pay (the cashier path)

```
Cashier hits "Review & checkout"
   │
   ▼
POS ──► /api/payments/paytm/display-checkout
   • creates an orders row + order_items (NET amount + gst_slab per line)
   • asks Paytm for a dynamic UPI QR for the grand total
   • writes a paytm_payment_events row (flow=POS, display_session_id set)
   • stashes the UPI intent on pos_display_sessions.checkout_url
   │
   ▼
Customer display renders the Paytm QR  ·  cashier sees "Waiting for payment…"
   │
   ▼
Customer scans + pays from any UPI app
   │
   ▼
Paytm ──► /api/webhooks/paytm ──► confirm_display_checkout_payment
   • generates the bill (status PAID), records the payment
   • flips pos_display_sessions → PAID
   │
   ▼
Customer screen → "Thank you!"   ·   Cashier screen → "Payment received · INV-…"
```

The cashier **enters nothing** — no UTR, no "confirm" click. While the
QR is live and the **UPI** method is selected, the checkout dialog's
"Generate invoice" button is replaced by a non-clickable *"Waiting for
the customer to pay…"* — see the no-double-bill section below.

Cash and Card stay fully manual: the cashier still collects and clicks
"Generate invoice" for those.

---

## GST correctness

`confirm_display_checkout_payment` recomputes CGST/SGST from
`order_items.gst_slab`. So the order_items **must** carry the right tax
data. The POS's `sync_pos_display` therefore enriches each cart line
with `gst_slab` and `taxable_amount` (the **net, pre-tax** line total —
tax backed out of inclusive prices). The display-checkout route writes
order_items straight from that, and the confirm RPC produces a
GST-correct bill whose grand total matches what the customer paid.

---

## Idempotency — no double bills

- **`paytm_payment_events.paytm_order_id` is the primary key** + a
  `status` guard — Paytm webhook retries are no-ops.
- **`confirm_display_checkout_payment` / `confirm_qr_order_system` are
  idempotent on the order** — if a bill already exists for that order,
  the existing bill is returned, never a second one.
- **The cashier can't race the webhook**: while a Paytm QR is live the
  manual "Generate invoice" button is gone. The webhook is the only
  thing that bills a scan-to-pay sale.
- The display-checkout route is idempotent — a `upi:` intent already on
  the session returns the cached QR instead of minting another.

---

## What if a page refreshes mid-payment?

Scenario: the customer scans the QR, a screen accidentally refreshes,
then the customer pays. **The payment cannot break** — here's why:

- The `ORDERID` is captured into the **customer's UPI app** the instant
  they scan. When they pay, Paytm calls the webhook **server-side** — no
  browser is in the loop. The bill generates, the payment records.
- `paytm_payment_events` and the `orders` row are **separate tables**,
  untouched by any screen's lifecycle — the webhook always finds them.

Per refreshed screen:

| Refreshed screen | Effect |
|------------------|--------|
| **Customer display** | Re-loads the session row and re-renders the same QR. Customer pays → screen greens. No issue. |
| **Cashier's POS** | The page-unload cleanup (`clear_pos_display`) is **skipped while a Paytm QR is live**, so the session row survives. On reload the POS **recovers the in-flight sale** — see below. |

**POS in-flight recovery.** When the POS reloads, it reads its own
`pos_display_sessions` row (`created_by = me`) once the menu has loaded:

- **`PAID`** — the customer paid while the screen was away. The cashier
  gets a *"Your last sale completed — invoice INV-…"* toast; the session
  is cleared. (The bill was already generated.)
- **`AWAITING_PAYMENT` / `PROCESSING`** with a live `upi:` QR — a
  **"Payment in progress"** overlay shows the items + total + a "waiting"
  state, and the POS re-subscribes to the session. When the customer
  pays, the webhook flips it `PAID` → the overlay closes with *"Payment
  received"*. A 15-second heartbeat keeps the customer display's QR live
  meanwhile. The cashier can also "Cancel this sale".
- **Anything else** — a leftover cart, an abandoned checkout, or a row
  older than 20 minutes — is **cleared**, so the POS and the customer
  screen both start from a clean slate. (Leaving a half-recovered row
  there is what put the two out of step.)

The bill, the money, and the audit log are correct in **every** case —
and now the cashier's screen recovers too, rather than stranding them.
The payment always lands on the **same** order/bill: recovery re-adopts
the *existing* session (and its `order_id`); it never creates a second
order. Enforced in `pos/page.tsx` (`recoveredSale` + `recoveryDoneRef`).

---

## Files

| File | Role |
|------|------|
| `src/lib/billing/paytm.ts` | Paytm API client — `paytmCreateQr`, checksum verify, status poll |
| `src/app/api/payments/paytm/display-checkout/route.ts` | **Flow B** — issues the POS-counter QR |
| `src/app/api/public/qr/place-order/route.ts` | **Flow A** — issues the table-order QR |
| `src/app/api/webhooks/paytm/route.ts` | The webhook — routes by MID, verifies, confirms |
| `src/lib/billing/paytm-confirm.ts` | `finalizePaytmPayment` — shared "paid event → bill" step |
| `src/app/api/payments/paytm/reconcile/route.ts` | Missed-webhook safety net — polls Paytm for stuck PENDING events |
| `src/app/display/[tenantSlug]/display-chrome.tsx` | Customer display — `UpiScanPanel`, auto-green |
| `src/app/(app)/pos/page.tsx` | Fires the route, subscribes for `PAID` |
| `src/components/pos/checkout-preview-dialog.tsx` | "Waiting for payment…" state |
| `supabase/migrations/_backup_2026-05-20/33_paytm_gateway.sql` | `paytm_payment_events` + columns + index + confirm RPCs |

No new migration is needed for Flow B — it reuses the existing
`pos_display_sessions.checkout_url` column (a `upi:` intent there tells
the display chrome to render the Paytm panel; a `https:` URL is Stripe).

---

## Payment integrity

- **Method label.** Both confirm RPCs take a `p_method` parameter — the
  Paytm webhook (and the reconcile job) pass `'PAYTM'`, so the `payments`
  row is recorded under the correct gateway. The Stripe webhook omits it
  and gets the `'STRIPE'` default, unchanged.
- **Amount verification.** Each confirm RPC compares the recomputed bill
  total against the amount the gateway actually settled. Sub-rupee
  rounding passes; a wider gap is stamped into `bill_audit_log`
  (`amount_ok = false`) so it can't go unnoticed. The bill is still
  generated — the customer has already paid — but the discrepancy is on
  the record.
- **Missed webhook.** If Paytm never delivers a callback, the
  reconciliation sweep (`/api/payments/paytm/reconcile`, run every
  ~10 min by `vercel.json`'s cron) polls Paytm for every PENDING event a
  few minutes old and finalises the ones that succeeded — billed exactly
  as the webhook would, via the shared `finalizePaytmPayment`. It's
  protected by `CRON_SECRET`. Idempotent, so racing the webhook is safe.

## Known limitations / follow-ups

- **Webhook must be reachable.** Paytm only accepts an `https://`
  callback URL on port 443. See `docs/paytm-setup.md`.
- **Fully-migrated DB.** The whole flow needs `paytm_payment_events`, the
  `payments` gateway columns, and the confirm RPCs. Apply the current
  `supabase/migrations/combined_schema.sql` before going live — it's
  idempotent and contains everything.

---

## Testing

1. Connect Paytm (staging) in **Settings → Payment gateway**, set the
   webhook URL in the Paytm dashboard (or via Paytm support).
2. **Flow B:** ring up an item on the POS, hit **Review & checkout**,
   pick **UPI / Google Pay**. The customer display shows a Paytm QR;
   the checkout dialog shows *"Waiting for payment…"*.
3. Pay the QR with a Paytm **staging test instrument**.
4. Watch: webhook hits `/api/webhooks/paytm` → `paytm_payment_events`
   row flips `PENDING → SUCCESS` → the customer screen greens → the
   cashier's dialog closes with *"Payment received"*.
5. **Flow A:** scan a table QR, place an order, pay the Paytm QR — the
   QR-ordering page shows the success screen and staff get the toast.

```sql
select paytm_order_id, flow, status, bill_id, processed_at
from public.paytm_payment_events
order by created_at desc limit 10;
```
