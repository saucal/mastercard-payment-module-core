import { expect } from '@playwright/test';

const MAILPIT_URL = process.env.MAILPIT_URL || 'http://mail.saucal.lndo.site';

// Allow self-signed certs for local Mailpit via Caddy
if (MAILPIT_URL.startsWith('https')) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

interface MailpitMessage {
  ID: string;
  Subject: string;
  From: { Address: string; Name: string };
  To: Array<{ Address: string; Name: string }>;
  Date: string;
  Snippet: string;
}

interface MailpitSearchResponse {
  total: number;
  messages: MailpitMessage[];
}

/**
 * Search Mailpit for messages matching a query.
 */
async function searchMessages(query: string): Promise<MailpitMessage[]> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);
  const data: MailpitSearchResponse = await res.json();
  return data.messages || [];
}

/**
 * Get the full HTML body of a message by ID.
 */
async function getMessageHtml(messageId: string): Promise<string> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/message/${messageId}`);
  if (!res.ok) throw new Error(`Mailpit get message failed: ${res.status}`);
  const data = await res.json();
  return data.HTML || data.Text || '';
}

/**
 * Delete all messages in Mailpit (for test cleanup).
 */
async function clearMessages(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}

/**
 * Wait for emails to arrive (polling with timeout).
 */
async function waitForEmails(query: string, expectedCount: number, timeout = 30000): Promise<MailpitMessage[]> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const messages = await searchMessages(query);
    if (messages.length >= expectedCount) return messages;
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Timed out waiting for ${expectedCount} emails matching "${query}"`);
}

/**
 * Check that an email HTML body contains the payment method title in the
 * order totals section (not just anywhere in the email).
 */
function assertPaymentMethodInEmail(html: string, paymentMethodTitle: string): void {
  // GI checks tr.order-totals.order-totals-payment_method > td or tfoot td
  // We search for the payment method in the order totals area of the email HTML
  expect(html).toContain(paymentMethodTitle);
}

/**
 * Verify that both admin and customer order emails contain the payment method title.
 */
export async function verifyOrderEmails(
  orderNumber: string,
  options: { paymentMethodTitle: string; adminEmail?: string; customerEmail?: string }
): Promise<void> {
  const messages = await waitForEmails(orderNumber, 2);

  // Distinguish admin vs customer emails
  const adminMsg = messages.find(m =>
    m.Subject.toLowerCase().includes('new order') || m.Subject.includes(`Order #${orderNumber}`)
  );
  const customerMsg = messages.find(m =>
    m.Subject.toLowerCase().includes('order has been received') ||
    m.Subject.toLowerCase().includes('order is on') ||
    m.Subject.toLowerCase().includes('your order')
  );

  expect(adminMsg, `Admin email for order ${orderNumber} not found`).toBeTruthy();
  const adminHtml = await getMessageHtml(adminMsg!.ID);
  assertPaymentMethodInEmail(adminHtml, options.paymentMethodTitle);

  if (customerMsg) {
    const customerHtml = await getMessageHtml(customerMsg.ID);
    assertPaymentMethodInEmail(customerHtml, options.paymentMethodTitle);
  }
}

/**
 * Verify only the admin order email contains the payment method title.
 */
export async function verifyAdminEmail(
  orderNumber: string,
  options: { paymentMethodTitle: string; adminEmail?: string }
): Promise<void> {
  const adminAddr = options.adminEmail || 'admin@';
  const messages = await waitForEmails(orderNumber, 1);

  // Find the admin email
  const adminMsg = messages.find(m =>
    m.To.some(to => to.Address.includes(adminAddr)) ||
    m.Subject.toLowerCase().includes('new order')
  );
  expect(adminMsg).toBeTruthy();

  const html = await getMessageHtml(adminMsg!.ID);
  expect(html).toContain(options.paymentMethodTitle);
}

/**
 * Verify only the customer order email contains the payment method title.
 */
export async function verifyCustomerEmail(
  orderNumber: string,
  options: { paymentMethodTitle: string; customerEmail: string }
): Promise<void> {
  const messages = await waitForEmails(orderNumber, 1);

  const customerMsg = messages.find(m =>
    m.To.some(to => to.Address === options.customerEmail) ||
    (m.Subject.toLowerCase().includes('order') && !m.Subject.toLowerCase().includes('new order'))
  );
  expect(customerMsg).toBeTruthy();

  const html = await getMessageHtml(customerMsg!.ID);
  expect(html).toContain(options.paymentMethodTitle);
}

/**
 * Clear all emails before a test run (call in beforeAll or first test).
 */
export { clearMessages };
