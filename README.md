# Bee X Payments — Node.js SDK

Official Node.js library for [Bee X Payments](https://beexpayments.com), the crypto payment gateway for accepting **USDT on Tron (TRC-20) and BNB Smart Chain (BEP-20)** and sending payouts.

- Zero dependencies — Node 18+ built-in `fetch` and `crypto`
- Invoices, payouts, balance, and payout quotes and limits
- Webhook signature verification (`X-Signature`)
- TypeScript types included

Full API reference: **https://beexpayments.com/docs**

## Install

```bash
npm install github:xtechoffice/beex-sdk
```

## Quick start

```js
const Beex = require('beex-payments');

const beex = new Beex(process.env.BEEX_API_KEY); // ck_test_… or ck_live_…

const invoice = await beex.invoices.create({
  orderId: 'order-1001',          // your id — also the idempotency key
  amount: '25.00',                // priced in the coin itself, never fiat
  payCurrencies: ['USDTTRC20', 'USDTBSC'],
  successUrl: 'https://yourshop.com/thanks',
});

// Redirect the customer to the hosted checkout
console.log(invoice.checkoutUrl);
```

Get API keys from your merchant panel at [beexpayments.com/app](https://beexpayments.com/app). A **test key** (`ck_test_…`) creates invoices you can pay with the simulate controls on the checkout page — no real funds move.

## Invoices (pay-in)

```js
await beex.invoices.create({ orderId, amount, payCurrency: 'USDTTRC20' });
await beex.invoices.retrieve('IN2026-7K3QZP');   // our id, our reference, or your orderId
await beex.invoices.cancel('order-1001', { reason: 'customer left' });
await beex.invoices.list({ status: 'paid', limit: 50 });

for await (const inv of beex.invoices.listAll({ status: 'paid' })) {
  console.log(inv.reference, inv.amountReceived);
}
```

Sending the same `orderId` twice returns the same invoice, so a retry never creates a second deposit address.

With `payCurrencies` the customer chooses the network on the checkout page. **That choice is final.**

Cancelling does not close the deposit address. Funds a customer sends to it are still received and credited.

## Payouts

Payouts move real funds. They need a **live key**, and the request must come from an IP on your payout whitelist (set it in the panel under API keys).

```js
const payout = await beex.payouts.create({
  address: 'TXYZ…',
  currency: 'USDTTRC20',
  amount: '100',
  reference: 'withdrawal-5521', // ALWAYS set this
  feePaidBy: 'merchant',        // amount arrives in full; fee added on top
});

payout.created; // false → this reference already existed, nothing new was sent
```

**Always pass a `reference`.** The same reference always resolves to the same withdrawal, so retrying after a timeout is safe. Without one, a slow retry can send twice.

```js
await beex.payouts.quote({ amount: '100', currency: 'USDTTRC20', feePaidBy: 'merchant' });
await beex.payouts.limits();       // min/max, daily cap, fees, your IP
await beex.payouts.retrieve('withdrawal-5521');
```

## Balance

```js
const { balances } = await beex.balance.retrieve();
// { USDTTRC20: { available: '412.50', pending: '25.00', reserve: '0' } }
```

## Webhooks

Bee X signs every webhook with `X-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`, using your webhook secret (`whsec_…`). Payment and payout events arrive on the same endpoint.

Verify against the **raw** body. Parsing it to JSON first and re-serialising it changes the bytes, and the signature will fail.

```js
app.post('/webhooks/beex', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = Beex.constructEvent(req.body, req.get('X-Signature'), process.env.BEEX_WEBHOOK_SECRET);
  } catch {
    return res.status(400).end();
  }
  res.sendStatus(200);

  // event.event: invoice.paid, invoice.overpaid, invoice.partially_paid,
  //              invoice.expired, payout.completed, payout.failed, …
});
```

Before you fulfil an order, re-fetch the invoice with `beex.invoices.retrieve()` and check that both `mode === 'live'` and `Beex.isPaid(status)` hold.

Any response other than 2xx is retried: after 5 minutes, after 4 hours, and after about 48 hours.

## Errors

Every failure rejects with a `BeexError`:

```js
try {
  await beex.payouts.create({ … });
} catch (err) {
  err.status; // HTTP status, 0 for network/timeout
  err.code;   // e.g. 'invalid_api_key', 'payout_ip_not_whitelisted', 'timeout'
  err.message;
}
```

If a **payout** times out, do not assume it failed. Call `payouts.retrieve(reference)` first, or retry with the same `reference`.

## Options

```js
new Beex(apiKey, {
  baseUrl: 'https://beexpayments.com', // default
  timeoutMs: 30000,
});
```

## Other platforms

Ready-made plugins for WooCommerce, Easy Digital Downloads, WHMCS, OpenCart and PrestaShop are available from your merchant panel.

## License

MIT
