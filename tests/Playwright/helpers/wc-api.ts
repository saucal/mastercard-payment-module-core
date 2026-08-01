import type { PluginConfig } from '../plugin-config.types';

const BASE_URL = process.env.WP_BASE_URL || 'https://mastercard-saucal.sa.ngrok.io';
const ADMIN_USER = process.env.WP_USERNAME || 'admin';
const API_PASS = process.env.WP_API_PASS || '';
const WOO_USER = process.env.WOO_USER || '';
const WOO_PASS = process.env.WOO_PASS || '';

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
  });
  if (!res.ok) throw new Error(`switchCheckoutMode(${mode}) failed: ${res.status}`);
}

export async function configureGateway(config: PluginConfig, settings: Record<string, string>): Promise<void> {
  const res = await fetch(`${BASE_URL}/wp-json/custom/v1/update-option`, {
    method: 'POST',
    headers: wpAuthHeaders(),
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
  });
  if (!res.ok) throw new Error(`getOrder(${orderNumber}) failed: ${res.status}`);
  return res.json();
}

export async function getFailedOrders(): Promise<any[]> {
  const res = await fetch(`${BASE_URL}/wp-json/wc/v3/orders?status=failed`, {
    headers: wcAuthHeaders(),
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
      session?: { id: string; updateStatus: string };
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
