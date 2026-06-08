# Paytm setup (India UPI auto-confirm)

Paytm is one of the two auto-confirm UPI gateways (alongside PhonePe). The
end-to-end flow, the webhook → DB field map, and the going-live checklist are
documented once in **[payment-gateways.md](payment-gateways.md)** — this file is
just the Paytm-dashboard specifics.

> Remember: a restaurant runs **one** gateway at a time. Enabling Paytm in
> Settings → Payments automatically disables PhonePe.

## 1. Get your credentials
From the **Paytm for Business** dashboard (https://business.paytm.com):
- **Merchant ID (MID)** — under Developer Settings → API Keys.
- **Merchant Key** — the secret paired with that MID. **Keep it secret.**
- Each environment has its own pair:
  - **Staging/Test** → `securegw-stage.paytm.in`
  - **Production** → `securegw.paytm.in`

## 2. Enter them in RestoPOS
Settings → Payments → **Paytm** card:
1. Toggle **Accept UPI payments via Paytm** on (this disables PhonePe).
2. Pick the **Sandbox** tab, paste the test MID + Merchant Key.
3. **Test connection** — green means Paytm accepted the signed call.
4. Save.

## 3. Configure the webhook
In the Paytm dashboard, set the **transaction status callback URL** to:

```
https://<your-domain>/api/webhooks/paytm
```

The handler verifies Paytm's `CHECKSUMHASH` against your Merchant Key before
trusting any callback, then auto-creates the bill. A forged callback is
rejected with `401`.

## 4. Go live
Once the sandbox flow works end-to-end (a real test payment produces a `bills`
row + a `payments` row with `method = 'PAYTM'` and flips the order to PAID):
1. Switch the **Production** tab, paste live credentials, re-test.
2. Set `CRON_SECRET` and schedule `GET /api/payments/paytm/reconcile` every
   ~10 minutes (the missed-webhook safety net).

> The Paytm checksum + API contract are implemented to Paytm's documented spec.
> Because there are no Paytm credentials baked into the platform, **validate the
> full flow in Paytm's sandbox before taking production payments.**
