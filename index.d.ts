// Type definitions for beex-payments

export type Network = 'USDTTRC20' | 'USDTBSC' | (string & {});

export type InvoiceStatus =
  | 'created'
  | 'awaiting_payment'
  | 'confirming'
  | 'partially_paid'
  | 'paid'
  | 'overpaid'
  | 'underpaid'
  | 'expired'
  | 'cancelled'
  | 'failed'
  | 'refunded'
  | (string & {});

export interface CreateInvoiceParams {
  /** Your own order id. Also the idempotency key: the same orderId returns the same invoice. */
  orderId: string;
  /** Amount in the coin itself (e.g. "25.00" USDT). Fiat is not accepted. */
  amount: string | number;
  /** One network… */
  payCurrency?: Network;
  /** …or several of the same coin, and the customer chooses. The choice is final. */
  payCurrencies?: Network[];
  description?: string;
  customerEmail?: string;
  successUrl?: string;
  cancelUrl?: string;
  /** Per-invoice webhook URL; overrides the account webhook. https only. */
  webhookUrl?: string;
}

export interface Invoice {
  id: string;
  reference: string | null;
  mode: 'live' | 'test';
  orderId: string;
  status: InvoiceStatus;
  amount: string;
  currency: string | null;
  payCurrency: string | null;
  payCurrencies?: string[];
  payChain: string | null;
  payAmount: string | null;
  payAddress: string | null;
  amountReceived: string;
  netAmount: string;
  feeAmount: string;
  expiresAt: string | null;
  createdAt: string;
  description: string | null;
  /** Hosted checkout page — redirect the customer here. */
  checkoutUrl: string;
}

export interface CreatePayoutParams {
  address: string;
  currency: Network;
  amount: string | number;
  /** Your own id. Strongly recommended: the same reference never sends twice. */
  reference?: string;
  /** "receiver": fee comes out of amount. "merchant": amount arrives in full, fee added on top. */
  feePaidBy?: 'receiver' | 'merchant';
}

export interface Payout {
  reference: string;
  status: string;
  amount: string;
  currency: string;
  address: string;
  /** Present on create: false means this reference already existed. */
  created?: boolean;
  note?: string;
  [key: string]: unknown;
}

export interface Page<T> {
  data: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ListParams {
  status?: string;
  limit?: number;
  cursor?: string;
}

export interface WebhookEvent {
  event: string;
  mode?: 'live' | 'test';
  invoiceId?: string;
  reference?: string | null;
  orderId?: string;
  status?: string;
  amount?: string;
  currency?: string;
  payCurrency?: string;
  amountReceived?: string;
  netAmount?: string;
  feeAmount?: string;
  occurredAt?: string;
  [key: string]: unknown;
}

export interface BeexOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface VerifyOptions {
  /** Maximum age of the signature in seconds. Default 900. 0 disables the check. */
  toleranceSec?: number;
  now?: number;
}

export declare class BeexError extends Error {
  status: number;
  code: string;
  body: unknown;
}

export declare class BeexSignatureError extends BeexError {}

export declare class Beex {
  constructor(apiKey: string, options?: BeexOptions);
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly isTestMode: boolean;

  invoices: {
    create(params: CreateInvoiceParams): Promise<Invoice>;
    retrieve(id: string): Promise<Invoice>;
    cancel(id: string, params?: { reason?: string }): Promise<Invoice & { alreadyCancelled: boolean; note: string }>;
    list(params?: ListParams): Promise<Page<Invoice>>;
    listAll(params?: ListParams): AsyncGenerator<Invoice>;
  };

  payouts: {
    create(params: CreatePayoutParams): Promise<Payout>;
    retrieve(reference: string): Promise<Payout>;
    list(params?: ListParams): Promise<Page<Payout>>;
    listAll(params?: ListParams): AsyncGenerator<Payout>;
    quote(params: { amount: string | number; currency?: Network; feePaidBy?: 'receiver' | 'merchant' }): Promise<Record<string, unknown>>;
    limits(): Promise<Record<string, unknown>>;
  };

  balance: {
    retrieve(): Promise<{ balances: Record<string, { available: string; pending: string; reserve: string }> }>;
  };

  currencies: {
    list(): Promise<{ currencies: string[] }>;
  };

  request<T = unknown>(method: string, path: string, body?: unknown, query?: Record<string, unknown>): Promise<T>;
}

export declare function verifySignature(rawBody: string | Buffer, header: string | undefined, secret: string, options?: VerifyOptions): boolean;
export declare function constructEvent(rawBody: string | Buffer, header: string | undefined, secret: string, options?: VerifyOptions): WebhookEvent;

export declare const webhooks: {
  verifySignature: typeof verifySignature;
  constructEvent: typeof constructEvent;
  signPayload(rawBody: string | Buffer, secret: string, timestamp?: number): string;
};

export declare const NETWORKS: Readonly<Record<string, string>>;
export declare function isPaid(status: string): boolean;
export declare function isOpen(status: string): boolean;
export declare function isDead(status: string): boolean;
export declare const VERSION: string;

export default Beex;
