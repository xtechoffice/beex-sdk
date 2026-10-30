// Express webhook handler. BEEX_API_KEY and BEEX_WEBHOOK_SECRET in env.
const express = require('express');
const Beex = require('../src');

const beex = new Beex(process.env.BEEX_API_KEY);
const app = express();

// express.raw — the signature is over the exact bytes Bee X sent.
app.post('/webhooks/beex', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = Beex.constructEvent(req.body, req.get('X-Signature'), process.env.BEEX_WEBHOOK_SECRET);
  } catch {
    return res.status(400).send('bad signature');
  }

  // Answer fast; Bee X retries anything that is not 2xx.
  res.sendStatus(200);

  if (event.event && event.event.startsWith('invoice.')) {
    // Re-fetch before fulfilling: the API is the source of truth.
    const invoice = await beex.invoices.retrieve(event.invoiceId);
    if (invoice.mode === 'live' && Beex.isPaid(invoice.status)) {
      console.log('Fulfil order', invoice.orderId, '— received', invoice.amountReceived, invoice.payCurrency);
    }
  }

  if (event.event === 'payout.completed' || event.event === 'payout.failed') {
    console.log('Payout update', event);
  }
});

app.listen(3000, () => console.log('Listening on :3000'));
