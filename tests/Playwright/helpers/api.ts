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

export async function getLogs(date: string, urlFilter: string, skip = 0): Promise<any> {
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
