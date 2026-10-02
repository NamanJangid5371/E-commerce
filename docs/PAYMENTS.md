# Avyora — Razorpay Payments

**Last updated:** 2026-08-31

Avyora uses Razorpay for UPI, cards, and netbanking. Payment confirmation is **always verified on the server** — never trust the browser callback alone.

---

## Environment variables

Add to `avyora/.env`:

```env
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_xxx      # or rzp_test_xxx
RAZORPAY_KEY_SECRET=your_secret_key
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

| Variable | Exposure | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Public (frontend) | Opens Razorpay checkout modal |
| `RAZORPAY_KEY_SECRET` | **Server only** | Order creation + payment signature verification |
| `RAZORPAY_WEBHOOK_SECRET` | **Server only** | Webhook HMAC validation |

Without credentials, checkout runs in **demo mode** — orders receive IDs like `order_demo_*` and signatures are accepted for testing only.

---

## Razorpay dashboard setup

1. Create account at [razorpay.com](https://razorpay.com) and complete KYC for live mode.
2. **Settings → API Keys** — generate Key ID and Key Secret (test keys for development).
3. **Settings → Webhooks** — add endpoint:

   ```
   https://your-storefront-domain.com/api/payments/razorpay/webhook
   ```

   For local testing, use a tunnel (ngrok, Cloudflare Tunnel) — Razorpay cannot reach `localhost` directly.

4. Subscribe to events:
   - `payment.captured`
   - `payment.failed`
5. Copy the **Webhook Secret** into `RAZORPAY_WEBHOOK_SECRET`.

---

## Payment flow

```
Customer checkout
       │
       ▼
POST /api/checkout/place          → Creates Order (PENDING_PAYMENT) + Payment record
       │
       ▼
POST /api/payments/razorpay/order → Creates Razorpay order (amount from server)
       │
       ▼
Razorpay checkout modal (browser)  → Customer pays
       │
       ▼
POST /api/payments/razorpay/verify → HMAC verify razorpay_signature
       │                              Updates Payment → SUCCESS
       │                              Order → PAYMENT_CONFIRMED
       ▼
(Optional parallel path)
POST /api/payments/razorpay/webhook → HMAC verify x-razorpay-signature
                                      Idempotent via PaymentEvent table
```

### Never trust the browser

- Do **not** mark an order paid based on Razorpay modal `handler` success alone.
- Always call `POST /api/payments/razorpay/verify` with `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature`.
- The verify endpoint checks HMAC: `HMAC-SHA256(key_secret, order_id + "|" + payment_id)`.
- Webhooks provide a backup path when the customer closes the browser before verify runs.

---

## API endpoints

### Create Razorpay order

`POST /api/payments/razorpay/order`

```json
{
  "orderId": "AVY-2026-00042",
  "receipt": "AVY-2026-00042"
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "orderId": "order_xxx",
    "amount": 1030000,
    "currency": "INR",
    "keyId": "rzp_test_xxx",
    "demo": false
  }
}
```

Amount is in **paise** (INR × 100).

### Verify payment (client → server after modal)

`POST /api/payments/razorpay/verify`

```json
{
  "orderId": "clx…",
  "razorpay_order_id": "order_xxx",
  "razorpay_payment_id": "pay_xxx",
  "razorpay_signature": "hex_signature"
}
```

### Webhook (Razorpay → server)

`POST /api/payments/razorpay/webhook`

Headers:

- `x-razorpay-signature` — HMAC-SHA256 of raw body using webhook secret
- `x-razorpay-event-id` — used for idempotency

Invalid signature → **401**.

---

## Demo mode

When `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` are unset:

- `createRazorpayOrder` returns `order_demo_<timestamp>`
- `verifyPaymentSignature` returns `true` for `order_demo_*` IDs
- Suitable for local UI development only — **not for production**

---

## Security checklist

- [ ] Key secret and webhook secret only in server env (never `NEXT_PUBLIC_*`)
- [ ] Verify endpoint called after every successful modal callback
- [ ] Webhook URL uses HTTPS in production
- [ ] Webhook secret rotated if leaked
- [ ] Order amounts always computed server-side at checkout — never from client cart
- [ ] Payment records store `providerOrderId`, `providerPaymentId` for reconciliation
- [ ] Duplicate webhook events handled via `PaymentEvent.providerEventId` unique constraint

---

## Testing signatures locally

Unit tests in `src/server/payments/razorpay.test.ts` cover:

- Demo order auto-verify
- Webhook HMAC with known secret/body

Run:

```powershell
cd avyora
npm test
```

---

## Refunds

Refund API integration is planned (`POST /api/payments/refund`). Until implemented, process refunds in the Razorpay dashboard and update order status in admin manually.
