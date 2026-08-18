import type { PluginConfig, BillingData } from '../plugin-config.types';
import { siteUrl, siteEnv } from './site';
import { logOrderContext } from './debug';

const BASE_URL = siteUrl();
// Per-site: an application password is issued by one install and rejected by the
// others, so each site can override these with a _2 / _3 suffix.
const ADMIN_USER = siteEnv('WP_USERNAME') || 'admin';
const API_PASS = siteEnv('WP_API_PASS');
const WOO_USER = siteEnv('WOO_USER');
const WOO_PASS = siteEnv('WOO_PASS');

function wpAuthHeaders(): HeadersInit {
  return {
    'Authorization': 'Basic ' + Buffer.from(`${ADMIN_USER}:${API_PASS}`).toString('base64'),
    'Content-Type': 'application/json',
  };
}

function wcAuthHeaders(): HeadersInit {
  return {
    'Authorization': 'Basic ' + Buffer.from(`${WOO_USER}:${WOO_PASS}`).toString('base64'),
    'Content-Type': 'application/json',
  };
}

export async function switchCheckoutMode(mode: 'classic' | 'blocks'): Promise<void> {
  const endpoint = mode === 'classic' ? 'to_checkout_classic' : 'to_checkout_blocks';
  const res = await fetch(`${BASE_URL}/wp-json/custom/v1/${endpoint}`, {
    method: 'GET',
    headers: wpAuthHeaders(),
    credentials: 'omit',
  });
  if (!res.ok) throw new Error(`switchCheckoutMode(${mode}) failed: ${res.status}`);
}

export async function configureGateway(config: PluginConfig, settings: Record<string, string>): Promise<void> {
  const res = await fetch(`${BASE_URL}/wp-json/custom/v1/update-option`, {
    method: 'POST',
    headers: wpAuthHeaders(),
    credentials: 'omit',
    body: JSON.stringify({
      option_name: config.settingsOptionName,
      updates: settings,
    }),
  });
  if (!res.ok) throw new Error(`configureGateway failed: ${res.status}`);
}

export async function getOrder(orderNumber: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/wp-json/wc/v3/orders/${orderNumber}`, {
    headers: wcAuthHeaders(),
    credentials: 'omit',
  });
  if (!res.ok) throw new Error(`getOrder(${orderNumber}) failed: ${res.status}`);
  return res.json();
}

export async function getFailedOrders(): Promise<any[]> {
  const res = await fetch(`${BASE_URL}/wp-json/wc/v3/orders?status=failed`, {
    headers: wcAuthHeaders(),
    credentials: 'omit',
  });
  if (!res.ok) throw new Error(`getFailedOrders failed: ${res.status}`);
  return res.json();
}

export function getOrderMeta(order: any, key: string): string | undefined {
  const meta = order.meta_data?.find((m: any) => m.key === key);
  return meta?.value;
}

export async function verifyOrderViaAPI(orderNumber: string, config: PluginConfig): Promise<{
  order: any;
  transactionId: string | undefined;
}> {
  const order = await getOrder(orderNumber);
  const transactionId = getOrderMeta(order, config.transactionIdMetaKey);
  return { order, transactionId };
}

// ─── Gateway API log wire types ───────────────────────────────────────────────
// Shape of the entries custom/v1/get-log returns. Lives here (with the fetcher)
// rather than in assertions.ts so getLogs() can be typed — an untyped `any`
// return silently disables type checking at every call site.

export interface LogEntry {
  request: {
    type: 'POST' | 'PUT' | 'GET';
    url: string;
    body: {
      apiOperation?: string;
      order?: {
        currency: string;
        reference: number | string;
        id: string;
        amount: string;
      };
      session?: { id: string };
      sourceOfFunds?: { token?: string };
      transaction?: { currency: string; targetTransactionId?: string; amount?: number };
      authentication?: { channel: string };
      /**
       * Attached by DynamicCurrencyConversion::maybe_add_dcc_payment_data when a
       * quote requestId was posted. uptake is 'NOT_AVAILABLE' unless an offer
       * state came back: 'ACCEPTED' for Accept, 'DECLINED' for anything else.
       */
      currencyConversion?: { requestId?: string; uptake?: string };
      agreement?: {
        type: string;
        amountVariability: string;
        id: string;
        paymentFrequency: string;
        startDate: string;
        expiryDate: string;
        numberOfPayments: string;
      };
    };
  };
  response: {
    body: {
      result?: string;
      session?: { id: string; updateStatus: string; version?: string };
      /**
       * PAYMENT_OPTIONS_INQUIRY response. Only present on the saved-token quote,
       * which ajax_dcc_quote makes server-side; an entered card's quote goes
       * browser-to-MPGS and never reaches this log.
       */
      paymentTypes?: {
        card?: {
          currencyConversion?: {
            requestId?: string;
            offerText?: string;
            payerCurrency?: string;
            payerAmount?: string;
            payerExchangeRate?: string;
          };
        };
      };
      order?: {
        id: string;
        currency: string;
        status: string;
        authenticationStatus?: string;
        totalRefundedAmount?: number;
        reference?: string;
      };
      sourceOfFunds?: {
        type: string;
        token?: string;
        provided?: {
          card?: {
            brand: string;
            scheme: string;
            number: string;
            expiry: { month: string; year: string };
            securityCode: string;
          };
        };
      };
      transaction?: {
        id: string;
        type: string;
        currency: string;
        amount?: number;
      };
      authentication?: {
        channel: string;
      };
      agreement?: {
        type: string;
        amountVariability: string;
        id: string;
        paymentFrequency: string;
        startDate: string;
        expiryDate: string;
        numberOfPayments: string;
      };
      response?: { gatewayCode?: string };
      token?: string;
      authenticationStatus?: string;
      id?: string;
      currency?: string;
      status?: string;
    };
  };
}

export interface LogResponse {
  logs: Array<{ content: LogEntry[]; total?: number }>;
}

export async function getLogs(date: string, urlFilter: string, skip = 0): Promise<LogResponse> {
  const params = new URLSearchParams({
    date,
    url: urlFilter,
    ...(skip > 0 ? { skip: String(skip) } : {}),
  });
  const res = await fetch(
    `${BASE_URL}/wp-json/custom/v1/get-log?${params}`,
    { headers: wpAuthHeaders() }
  );
  if (res.status === 404) return { logs: [{ content: [], total: 0 }] };
  if (!res.ok) throw new Error(`getLogs failed: ${res.status}`);
  const data = await res.json();
  return { logs: Array.isArray(data) ? data : [] };
}

/**
 * Get the current total log entry count (used as a marker before checkout).
 * Returns the total parsed entries in the log file.
 */
export async function getLogEntryCount(date: string): Promise<number> {
  const result = await getLogs(date, '');
  return result.logs[0]?.total || result.logs[0]?.content?.length || 0;
}

/**
 * Fetch webhook-log entries for a given order. The log parser writes inbound
 * MPGS webhook notifications to a separate file (`<slug>-webhooks-logs-*`).
 */
export async function getWebhookLogs(date: string, orderReference?: string): Promise<{ logs: any[] }> {
  const params = new URLSearchParams({
    date,
    ...(orderReference ? { order_reference: orderReference } : {}),
  });
  const res = await fetch(
    `${BASE_URL}/wp-json/custom/v1/get-webhook-log?${params}`,
    { headers: wpAuthHeaders() }
  );
  if (res.status === 404) return { logs: [{ filename: '', total: 0, content: [] }] };
  if (!res.ok) throw new Error(`getWebhookLogs failed: ${res.status}`);
  const data = await res.json();
  return { logs: Array.isArray(data) ? data : [] };
}

// ─── Mail log (WP Mail Logging DB table via custom/v1/get-mail) ────────────────
// Replaces the previous external mail-catcher client. Reading what WordPress
// actually wrote to its own mail log removes the SMTP/delivery dependency and
// the cross-project bleed of a shared catch-all inbox. Matches the approach
// bluesnap-automation and payoneer-v4-automation converged on 2026-06-18.

export interface LoggedMail {
  mail_id: number;
  timestamp: string;
  receiver: string;
  subject: string;
  headers: string;
  message: string; // full HTML/text body WordPress generated
}

interface LoggedMailResponse {
  table: string;
  count: number;
  mails: LoggedMail[];
}

/**
 * Poll custom/v1/get-mail until at least `minCount` matching rows appear, then
 * return them. Throws on timeout rather than returning an empty array: callers
 * that expect two mails (admin + customer) would otherwise skip an assertion
 * instead of failing when only one had been written.
 *
 * Query params are AND-combined server-side; `to`/`subject`/`contains` are
 * substring matches, `since` is a `>=` on the row timestamp.
 */
export async function getLoggedMail(
  opts: { to?: string; subject?: string; contains?: string; since?: string; limit?: number },
  poll: { minCount?: number; timeoutMs?: number; intervalMs?: number } = {},
): Promise<LoggedMail[]> {
  const minCount = poll.minCount ?? 1;
  const timeoutMs = poll.timeoutMs ?? 60000;
  const intervalMs = poll.intervalMs ?? 3000;
  const deadline = Date.now() + timeoutMs;
  let lastSeen: LoggedMail[] = [];

  for (;;) {
    const params = new URLSearchParams({
      ...(opts.to ? { to: opts.to } : {}),
      ...(opts.subject ? { subject: opts.subject } : {}),
      ...(opts.contains ? { contains: opts.contains } : {}),
      ...(opts.since ? { since: opts.since } : {}),
      limit: String(opts.limit ?? 100),
    });
    const res = await fetch(`${BASE_URL}/wp-json/custom/v1/get-mail?${params}`, {
      headers: wpAuthHeaders(),
    });
    if (!res.ok) throw new Error(`getLoggedMail failed: ${res.status}`);
    const data: LoggedMailResponse = await res.json();
    lastSeen = data.mails || [];
    if (lastSeen.length >= minCount) return lastSeen;
    if (Date.now() >= deadline) {
      const seen = lastSeen.map(m => `${m.receiver}/${m.subject}`).join(', ');
      throw new Error(
        `getLoggedMail timeout: wanted >=${minCount} mails matching ${JSON.stringify(opts)} `
        + `within ${timeoutMs}ms, got ${lastSeen.length}. Seen: [${seen}]`,
      );
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

// ─── Orders created over REST (pay-for-order flows) ───────────────────────────
// One implementation shared by suites 03/04/05/12. They each carried their own
// copy and drifted: some passed no customer or billing, some threw away the
// error body, and all of them hand-built the pay URL.

/**
 * Resolve the customer ID for a registered account, by email.
 *
 * `?email=` is an exact filter, unlike `?search=`, so there is no ordering guess
 * and no dependence on the username rendered in the My Account dashboard.
 */
export async function findCustomerIdByEmail(email: string): Promise<number> {
  const res = await fetch(
    `${BASE_URL}/wp-json/wc/v3/customers?email=${encodeURIComponent(email)}&role=all`,
    { headers: wcAuthHeaders() },
  );
  const body = await res.text();
  if (!res.ok) throw new Error(`findCustomerIdByEmail(${email}) failed: ${res.status} — ${body}`);
  const users = JSON.parse(body);
  if (!users.length) throw new Error(`findCustomerIdByEmail: no customer found for ${email}`);
  await logOrderContext('customer lookup', {
    email, matches: users.length, customerId: users[0].id, username: users[0].username,
  });
  return users[0].id;
}

export interface PendingOrder {
  orderId: string;
  orderKey: string;
  total: string;
  /**
   * The pay URL WooCommerce generated. It points at whatever page this install
   * uses for checkout — a hand-built `/checkout/order-pay/…` lands on the cart
   * when the checkout page lives elsewhere (e.g. `/checkout-blocks/`).
   */
  paymentUrl: string;
}

/**
 * Create a pending order for the pay-for-order flow.
 *
 * Pass `customerId` + `email` + `billing` for an order that belongs to a real
 * account with an address; without them WooCommerce creates a guest order with
 * no billing, which cannot complete checkout unaided.
 */
export async function createPendingOrder(opts: {
  productId: number;
  customerId?: number;
  email?: string;
  billing?: BillingData;
}): Promise<PendingOrder> {
  const { productId, customerId, email, billing } = opts;

  const res = await fetch(`${BASE_URL}/wp-json/wc/v3/orders`, {
    method: 'POST',
    headers: wcAuthHeaders(),
    body: JSON.stringify({
      status: 'pending',
      currency: 'USD',
      ...(customerId ? { customer_id: customerId } : {}),
      ...(billing ? {
        billing: {
          first_name: billing.firstName,
          last_name: billing.lastName,
          company: billing.company,
          address_1: billing.street,
          address_2: billing.address2,
          city: billing.city,
          state: billing.shortState,
          postcode: billing.zipCode,
          country: billing.shortCountry,
          email: email ?? billing.email,
          phone: billing.phone,
        },
      } : {}),
      line_items: [{ product_id: productId, quantity: 1 }],
    }),
  });

  // Read the body before deciding: WooCommerce explains refusals in JSON
  // (`woocommerce_rest_invalid_product_id`, `…_cannot_create`, …), and throwing
  // on the status alone discards the only useful part of the response.
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(
      `createPendingOrder failed: ${res.status}\n`
      + `  product=${productId} customer=${customerId ?? '(guest)'} email=${email ?? '(none)'}\n`
      + `  response: ${raw}`,
    );
  }

  const order = JSON.parse(raw);
  await logOrderContext('pending order created', {
    orderId: order.id,
    orderKey: order.order_key,
    status: order.status,
    total: order.total,
    currency: order.currency,
    customerId: order.customer_id,
    billingEmail: order.billing?.email,
    lineItems: order.line_items?.length,
    paymentUrl: order.payment_url,
  });
  if (!order.id) throw new Error(`createPendingOrder: no order id in response: ${raw}`);

  return {
    orderId: String(order.id),
    orderKey: order.order_key,
    total: String(order.total),
    paymentUrl: order.payment_url || '',
  };
}
