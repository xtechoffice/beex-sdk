'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const Beex = require('../src/index.js');
const { webhooks, constructEvent, BeexError, BeexSignatureError, isPaid } = Beex;

const SECRET = 'whsec_test_secret';
const BODY = JSON.stringify({ event: 'invoice.paid', invoiceId: 'abc', status: 'paid' });

test('signature made the way the server signs verifies', () => {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', SECRET).update(`${t}.${BODY}`).digest('hex');
  assert.strictEqual(webhooks.verifySignature(BODY, `t=${t},v1=${v1}`, SECRET), true);
  assert.strictEqual(webhooks.verifySignature(Buffer.from(BODY), `t=${t},v1=${v1}`, SECRET), true);
});

test('tampered body, wrong secret, old or malformed header are rejected', () => {
  const header = webhooks.signPayload(BODY, SECRET);
  assert.strictEqual(webhooks.verifySignature(BODY + ' ', header, SECRET), false);
  assert.strictEqual(webhooks.verifySignature(BODY, header, 'wrong'), false);
  const old = webhooks.signPayload(BODY, SECRET, Math.floor(Date.now() / 1000) - 3600);
  assert.strictEqual(webhooks.verifySignature(BODY, old, SECRET), false);
  assert.strictEqual(webhooks.verifySignature(BODY, 'garbage', SECRET), false);
  assert.strictEqual(webhooks.verifySignature(BODY, 't=1,v1=zz', SECRET), false);
});

test('constructEvent parses or throws', () => {
  const evt = constructEvent(BODY, webhooks.signPayload(BODY, SECRET), SECRET);
  assert.strictEqual(evt.event, 'invoice.paid');
  assert.throws(() => constructEvent(BODY, 't=1,v1=00', SECRET), BeexSignatureError);
});

test('requests carry the key, JSON body and query string', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: '1', status: 'awaiting_payment' }), { status: 201 });
  };
  const beex = new Beex('ck_test_abc', { fetch: fakeFetch });
  assert.strictEqual(beex.isTestMode, true);

  await beex.invoices.create({ orderId: 'o1', amount: '10', payCurrency: 'USDTTRC20' });
  assert.strictEqual(calls[0].url, 'https://beexpayments.com/v1/invoices');
  assert.strictEqual(calls[0].init.method, 'POST');
  assert.strictEqual(calls[0].init.headers['x-api-key'], 'ck_test_abc');
  assert.deepStrictEqual(JSON.parse(calls[0].init.body), { orderId: 'o1', amount: '10', payCurrency: 'USDTTRC20' });

  await beex.invoices.list({ status: 'paid', limit: 5 });
  assert.strictEqual(calls[1].url, 'https://beexpayments.com/v1/invoices?status=paid&limit=5');

  await beex.invoices.retrieve('IN2026-AB/CD');
  assert.strictEqual(calls[2].url, 'https://beexpayments.com/v1/invoices/IN2026-AB%2FCD');
});

test('API errors become BeexError with status and code', async () => {
  const fakeFetch = async () =>
    new Response(JSON.stringify({ error: 'invalid_api_key' }), { status: 401 });
  const beex = new Beex('ck_live_x', { fetch: fakeFetch });
  await assert.rejects(beex.balance.retrieve(), (err) => {
    assert.ok(err instanceof BeexError);
    assert.strictEqual(err.status, 401);
    assert.strictEqual(err.code, 'invalid_api_key');
    return true;
  });
});

test('listAll follows cursors', async () => {
  const pages = [
    { data: [{ id: 'a' }, { id: 'b' }], hasMore: true, nextCursor: 'b' },
    { data: [{ id: 'c' }], hasMore: false, nextCursor: null },
  ];
  const seen = [];
  const fakeFetch = async (url) => {
    seen.push(url);
    return new Response(JSON.stringify(pages[seen.length - 1]), { status: 200 });
  };
  const beex = new Beex('ck_test_x', { fetch: fakeFetch });
  const ids = [];
  for await (const inv of beex.invoices.listAll()) ids.push(inv.id);
  assert.deepStrictEqual(ids, ['a', 'b', 'c']);
  assert.ok(seen[1].endsWith('cursor=b'));
});

test('status helpers', () => {
  assert.strictEqual(isPaid('paid'), true);
  assert.strictEqual(isPaid('partially_paid'), false);
});
