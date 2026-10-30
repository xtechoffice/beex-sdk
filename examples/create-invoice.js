// node examples/create-invoice.js   (BEEX_API_KEY=ck_test_...)
const Beex = require('../src');

const beex = new Beex(process.env.BEEX_API_KEY);

(async () => {
  const invoice = await beex.invoices.create({
    orderId: `order-${Date.now()}`,
    amount: '25.00',
    payCurrencies: ['USDTTRC20', 'USDTBSC'], // customer picks the network
    description: 'Pro plan — 1 month',
    successUrl: 'https://yourshop.com/thanks',
    cancelUrl: 'https://yourshop.com/cart',
  });

  console.log('Send the customer to:', invoice.checkoutUrl);
  console.log('Reference:', invoice.reference, '| status:', invoice.status);
})().catch((err) => {
  console.error(err.code || err.name, err.message);
  process.exit(1);
});
