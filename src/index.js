'use strict';

/**
 * Bee X Payments — official Node.js SDK.
 *
 * Zero dependencies. Node 18+ (uses the built-in fetch and crypto).
 * Docs: https://beexpayments.com/docs
 */

const crypto = require('crypto');
const pkg = require('../package.json');

const DEFAULT_BASE_URL = 'https://beexpayments.com';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_TOLERANCE_SEC = 900;

/** Networks Bee X accepts today. */
const NETWORKS = Object.freeze({
  USDTTRC20: 'USDT — Tron (TRC-20)',
  USDTBSC: 'USDT — BNB Smart Chain (BEP-20)',
});

/** Invoice statuses grouped by what a store should do with them. */
const PAID_STATUSES = Object.freeze(['paid', 'overpaid']);
const OPEN_STATUSES = Object.freeze(['created', 'awaiting_payment', 'partially_paid', 'confirming']);
const DEAD_STATUSES = Object.freeze(['expired', 'cancelled', 'failed']);

class BeexError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, code?: string, body?: any}} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'BeexError';
    /** HTTP status, or 0 for a network/timeout failure. */
    this.status = info.status || 0;
    /** Machine-readable code from the API, e.g. "invalid_api_key". */
    this.code = info.code || '';
    /** Parsed response body, when there was one. */
    this.body = info.body;
  }
}

class BeexSignatureError extends BeexError {
  constructor(message) {
    super(message, { code: 'invalid_signature' });
    this.name = 'BeexSignatureError';
  }
}

class Beex {
  /**
   * @param {string} apiKey  ck_live_… or ck_test_…
   * @param {{baseUrl?: string, timeoutMs?: number, fetch?: Function}} [options]
   */
  constructor(apiKey, options = {}) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new BeexError('A Bee X API key is required (ck_live_… or ck_test_…).', { code: 'no_api_key' });
    }
    this.apiKey = apiKey.trim();
    this.baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this._fetch = options.fetch || globalThis.fetch;
    if (typeof this._fetch !== 'function') {
      throw new BeexError('No fetch available. Use Node 18+ or pass options.fetch.', { code: 'no_fetch' });
    }

    const r = this.request.bind(this);
    const enc = encodeURIComponent;

    this.invoices = {
      /** POST /v1/invoices — orderId is the idempotency key. */
      create: (params) => r('POST', '/v1/invoices', params),
      /** GET /v1/invoices/:id — our id, our reference (IN…), or your orderId. */
      retrieve: (id) => r('GET', `/v1/invoices/${enc(id)}`),
      /** POST /v1/invoices/:id/cancel — the deposit address stays open upstream. */
      cancel: (id, params = {}) => r('POST', `/v1/invoices/${enc(id)}/cancel`, params),
      /** GET /v1/invoices — one page. */
      list: (params = {}) => r('GET', '/v1/invoices', undefined, params),
      /** Async iterator over every invoice, following nextCursor. */
      listAll: (params = {}) => paginate((p) => r('GET', '/v1/invoices', undefined, p), params),
    };

    this.payouts = {
      /** POST /v1/payouts — live keys only. Always pass `reference` so retries are safe. */
      create: (params) => r('POST', '/v1/payouts', params),
      /** GET /v1/payouts/:reference — ours (OUT…) or yours. */
      retrieve: (reference) => r('GET', `/v1/payouts/${enc(reference)}`),
      /** GET /v1/payouts — one page. */
      list: (params = {}) => r('GET', '/v1/payouts', undefined, params),
      /** Async iterator over every payout. */
      listAll: (params = {}) => paginate((p) => r('GET', '/v1/payouts', undefined, p), params),
      /** GET /v1/payout-quote — what a payout would cost. Reserves nothing. */
      quote: (params) => r('GET', '/v1/payout-quote', undefined, params),
      /** GET /v1/payout-limits — limits, fees, and the payout IP whitelist. */
      limits: () => r('GET', '/v1/payout-limits'),
    };

    this.balance = {
      /** GET /v1/balance — available / pending / reserve per coin. */
      retrieve: () => r('GET', '/v1/balance'),
    };

    this.currencies = {
      /** GET /v1/currencies — coins enabled on this account. */
      list: () => r('GET', '/v1/currencies'),
    };
  }

  /** True for a ck_test_ key. Test keys cannot send payouts. */
  get isTestMode() {
    return this.apiKey.startsWith('ck_test_');
  }

  /**
   * Low-level call. Resolves with the parsed JSON body; rejects with a
   * BeexError on any non-2xx, network failure or timeout.
   */
  async request(method, path, body, query) {
    let url = this.baseUrl + path;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
    }

    const headers = {
      'x-api-key': this.apiKey,
      Accept: 'application/json',
      'User-Agent': `beex-node/${pkg.version} node/${process.versions.node}`,
    };
    const init = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    init.signal = controller.signal;

    let res;
    try {
      res = await this._fetch(url, init);
    } catch (err) {
      const timedOut = err && err.name === 'AbortError';
      throw new BeexError(
        timedOut
          ? `Bee X did not answer within ${this.timeoutMs}ms. For a payout, check its status before retrying.`
          : `Could not reach Bee X Payments: ${err && err.message}`,
        { code: timedOut ? 'timeout' : 'network' }
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = undefined;
    }

    if (!res.ok || data === undefined) {
      const msg =
        (data && (data.message || data.error)) || `Unexpected response from Bee X (HTTP ${res.status})`;
      throw new BeexError(msg, { status: res.status, code: (data && data.error) || '', body: data });
    }
    return data;
  }
}

async function* paginate(fetchPage, params) {
  let cursor = params.cursor;
  for (;;) {
    const page = await fetchPage({ ...params, cursor });
    for (const row of page.data || []) yield row;
    if (!page.hasMore || !page.nextCursor) return;
    cursor = page.nextCursor;
  }
}

// ------------------------------------------------------------- webhooks

function parseSignatureHeader(header) {
  const out = {};
  for (const part of String(header || '').split(',')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * Check the X-Signature header Bee X sends with every webhook:
 *   t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
 *
 * Pass the RAW request body (string or Buffer), not re-serialised JSON —
 * any change in whitespace or key order breaks the signature.
 *
 * @returns {boolean}
 */
function verifySignature(rawBody, header, secret, options = {}) {
  if (!secret || !header || rawBody === undefined || rawBody === null) return false;
  const { t, v1 } = parseSignatureHeader(header);
  if (!t || !v1 || !/^\d+$/.test(t) || !/^[a-f0-9]{64}$/i.test(v1)) return false;

  const tolerance = options.toleranceSec ?? DEFAULT_TOLERANCE_SEC;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (tolerance > 0 && Math.abs(now - Number(t)) > tolerance) return false;

  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1.toLowerCase(), 'hex'));
}

/**
 * Verify and parse a webhook in one step. Throws BeexSignatureError if
 * the signature is wrong or too old.
 */
function constructEvent(rawBody, header, secret, options = {}) {
  if (!verifySignature(rawBody, header, secret, options)) {
    throw new BeexSignatureError('Webhook signature did not verify. Check the secret and that you passed the raw body.');
  }
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  return JSON.parse(payload);
}

/** Build a valid header — for your own tests. */
function signPayload(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const v1 = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

// -------------------------------------------------------------- helpers

const isPaid = (status) => PAID_STATUSES.includes(status);
const isOpen = (status) => OPEN_STATUSES.includes(status);
const isDead = (status) => DEAD_STATUSES.includes(status);

module.exports = Beex;
module.exports.Beex = Beex;
module.exports.default = Beex;
module.exports.BeexError = BeexError;
module.exports.BeexSignatureError = BeexSignatureError;
module.exports.webhooks = { verifySignature, constructEvent, signPayload };
module.exports.verifySignature = verifySignature;
module.exports.constructEvent = constructEvent;
module.exports.NETWORKS = NETWORKS;
module.exports.isPaid = isPaid;
module.exports.isOpen = isOpen;
module.exports.isDead = isDead;
module.exports.VERSION = pkg.version;
