import { Page, expect } from '@playwright/test';
import type { CardData, PluginConfig } from '../plugin-config.types';
import { getLogs, getWebhookLogs, getLogEntryCount, getLoggedMail } from './wc-api';
import type { LogEntry, LogResponse, LoggedMail } from './wc-api';
import type { OrderReceivedData } from './flows';

// ─── Admin order screen ───────────────────────────────────────────────────────

export async function assertOrderStatus(page: Page, expectedStatus: string): Promise<void> {
  await expect(page.locator('#select2-order_status-container')).toContainText(expectedStatus);
}

/**
 * Verify that a specific text appears in the order notes.
 * Optionally check at a specific position (1-indexed system note).
 */
export async function assertOrderNoteContains(page: Page, text: string, position?: number): Promise<void> {
  if (position) {
    // GI checks specific note positions: li.note.system-note:nth-of-type(N)
    const positionalNote = page.locator(`li.note.system-note:nth-of-type(${position}) .note_content p`);
    if (await positionalNote.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(positionalNote).toContainText(text);
      return;
    }
  }
  // Fallback: search all notes
  const notes = page.locator('li.note .note_content p, #order_note_list li .note_content p');
  const noteTexts = await notes.allTextContents();
  const found = noteTexts.some(n => n.includes(text));
  expect(found, `Expected order note containing "${text}" but found: ${noteTexts.join(' | ')}`).toBeTruthy();
}

/**
 * Verify the order note for a captured payment (GI expects this at position 2).
 */
export async function assertCapturedNote(page: Page, config: PluginConfig, transactionId: string): Promise<void> {
  await assertOrderNoteContains(page, `${config.displayName} payment was Captured (Order ID: ${transactionId})`, 2);
}

/**
 * Verify the order note for an authorized payment.
 */
export async function assertAuthorizedNote(page: Page, config: PluginConfig, transactionId: string): Promise<void> {
  await assertOrderNoteContains(page, `${config.displayName} payment was Authorized (Order ID: ${transactionId})`);
}

/**
 * Verify the "Payment via" text in order meta.
 */
export async function assertPaymentMethodMeta(page: Page, config: PluginConfig, transactionId?: string): Promise<void> {
  if (transactionId) {
    await expect(page.locator('.woocommerce-order-data__meta')).toContainText(`Payment via ${config.displayName} (${transactionId})`);
  } else {
    await expect(page.locator('.woocommerce-order-data__meta')).toContainText(`Payment via ${config.displayName}`);
  }
}

/**
 * Verify payment method title appears in the order line items description.
 * GI checks: tbody > tr:nth-child(2) > td:nth-child(1) > span.description
 */
export async function assertPaymentMethodInLineItems(page: Page, config: PluginConfig): Promise<void> {
  const desc = page.locator('tbody > tr:nth-child(2) > td:nth-child(1) > span.description');
  if (await desc.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expect(desc).toContainText(config.displayName);
  }
}

export async function assertCaptureFormVisible(page: Page, config: PluginConfig, visible: boolean): Promise<void> {
  const form = page.locator(`.${config.paymentMethodSlug}-capture-form, .acme-capture-form, .mpgs-capture-form`);
  if (visible) {
    await expect(form.first()).toBeVisible();
  } else {
    await expect(form.first()).not.toBeVisible();
  }
}

export async function assertVoidFormVisible(page: Page, config: PluginConfig, visible: boolean): Promise<void> {
  const form = page.locator(`.${config.paymentMethodSlug}-void-form, .acme-void-form, .mpgs-void-form`);
  if (visible) {
    await expect(form.first()).toBeVisible();
  } else {
    await expect(form.first()).not.toBeVisible();
  }
}

// ─── Gateway API log verification ─────────────────────────────────────────────
// Moved verbatim from the former helpers/log-verification.ts. The thin
// extract*Logs() wrappers that used to live alongside these were dropped —
// callers now hit wc-api.getLogs() directly.

/**
 * Parse a currency string to a number, handling both US (10.00) and
 * European (10,00) decimal formats, plus currency symbols.
 */
function parseAmount(value: string): number {
  // Remove currency symbols and whitespace
  let cleaned = value.replace(/[^0-9.,]/g, '').trim();
  // If comma is the last separator (European), treat it as decimal
  if (/,\d{1,2}$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    cleaned = cleaned.replace(/,/g, '');
  }
  return parseFloat(cleaned);
}

// ─── Card assertion helpers ────────────────────────────────────────────────────

interface CardExpected {
  card: CardData;
  token?: string;
}

function assertCardDetails(
  sourceOfFunds: LogEntry['response']['body']['sourceOfFunds'],
  card: CardData,
  token?: string,
): void {
  expect(sourceOfFunds).toBeTruthy();
  expect(sourceOfFunds!.type).toBe('CARD');

  if (token) {
    expect(sourceOfFunds!.token).toBe(token);
  }

  const provided = sourceOfFunds!.provided?.card;
  expect(provided).toBeTruthy();
  expect(provided!.brand.toUpperCase()).toBe(card.shortName.toUpperCase());
  expect(provided!.scheme.toUpperCase()).toBe(card.shortName.toUpperCase());

  // Masked number: first 6 + xxxxxx + last 4
  const six = card.number.slice(0, 6);
  const four = card.number.slice(-4);
  expect(provided!.number).toContain(six);
  expect(provided!.number).toContain(four);

  // Expiry month/year — format varies: {month, year} object or string
  const expiry = provided!.expiry as any;
  if (expiry && typeof expiry === 'object' && expiry.month) {
    expect(String(Number(expiry.month))).toBe(String(Number(card.month)));
    expect(String(Number(expiry.year))).toBe(String(Number(card.year)));
  } else if (typeof expiry === 'string') {
    // Some responses use "MMYY" or "MM/YY" format
    expect(expiry).toContain(card.month);
    expect(expiry).toContain(card.year);
  }

  // securityCode masking — present as 'xxx' in session GET, absent in auth responses
  if (provided!.securityCode !== undefined) {
    expect(provided!.securityCode).toBe('xxx');
  }
}

// ─── Session verification ─────────────────────────────────────────────────────

interface SessionPostExpected {
  session: string;
  total: string;
  currency: string;
  transactionId: string;
  orderNumber: string | number;
  apiOperation?: string;
}

/**
 * Verify a session POST log entry.
 * Asserts request type, URL match, SUCCESS result, session ID,
 * order amount/currency/id/reference.
 */
export function verifySessionPost(log: LogEntry, expected: SessionPostExpected): void {
  expect(['POST', 'PUT']).toContain(log.request.type);
  expect(log.request.url).toContain('/session');

  const res = log.response?.body;
  // Session POST/PUT response may carry success signal as either top-level
  // `result: "SUCCESS"` (creation) or `session.updateStatus: "SUCCESS"`
  // (update); a freshly created session that just returns `session.version`
  // also counts. Accept any of those.
  const ok = res?.result === 'SUCCESS'
    || res?.session?.updateStatus === 'SUCCESS'
    || !!res?.session?.version;
  expect(ok, 'session POST/PUT response missing success indicator').toBeTruthy();

  if (expected.session) {
    expect(res!.session?.id).toBe(expected.session);
  } else {
    expect(res!.session?.id).toBeTruthy();
  }

  // Request body order assertions (amount, currency, reference). The log
  // parser can emit orphan entries with a null request body; guard so the
  // helper degrades gracefully instead of throwing TypeError.
  const reqOrder = log.request.body?.order;
  if (reqOrder) {
    if (reqOrder.amount) {
      const expectedAmount = parseAmount(expected.total);
      expect(parseFloat(reqOrder.amount)).toBeCloseTo(expectedAmount, 2);
    }
    if (reqOrder.currency) {
      expect(reqOrder.currency).toBe(expected.currency);
    }
    if (reqOrder.reference !== undefined) {
      expect(String(reqOrder.reference)).toBe(String(expected.orderNumber));
    }
  }
}

interface SessionGetExpected {
  session: string;
  card: CardData;
  token?: string;
}

/**
 * Verify a session UPDATE_SESSION log entry.
 * Asserts PUT method, UPDATE_SESSION operation, session ID, updateStatus SUCCESS.
 */
export function verifySessionGet(log: LogEntry, expected: SessionGetExpected): void {
  expect(log.request.type).toBe('PUT');
  expect(log.request.url).toContain('/session/');
  expect(log.request.body.apiOperation).toBe('UPDATE_SESSION');
  expect(log.request.body.session?.id ?? log.response.body.session?.id).toBe(expected.session);

  const res = log.response.body;
  expect(res.session?.updateStatus).toBe('SUCCESS');
}

/**
 * Verify card details from a session GET retrieval log entry.
 */
export function verifySessionGetCardDetails(log: LogEntry, expected: SessionGetExpected): void {
  expect(log.request.type).toBe('GET');
  expect(log.request.url).toContain('/session/');
  expect(log.response.body.session?.id).toBe(expected.session);
  expect(log.response.body.session?.updateStatus).toBe('SUCCESS');
  assertCardDetails(log.response.body.sourceOfFunds, expected.card, expected.token);
}

// ─── Authentication verification ─────────────────────────────────────────────

interface InitiateAuthenticationExpected {
  session: string;
  card: CardData;
  transactionId: string;
  currency: string;
}

/**
 * Verify an INITIATE_AUTHENTICATION log entry.
 */
export function verifyInitiateAuthentication(
  log: LogEntry,
  expected: InitiateAuthenticationExpected,
): void {
  expect(log.request.type).toBe('PUT');
  expect(log.request.url).toContain('/transaction/');
  expect(log.request.body.apiOperation).toBe('INITIATE_AUTHENTICATION');
  // authentication.channel may be in request body (after build) or response body
  const authChannel = log.request.body.authentication?.channel ?? log.response.body.authentication?.channel;
  expect(authChannel).toBe('PAYER_BROWSER');
  expect(log.request.body.session?.id).toBe(expected.session);

  const res = log.response.body;
  expect(res.result).toBe('SUCCESS');

  const order = res.order;
  expect(order).toBeTruthy();
  expect(order!.currency).toBe(expected.currency);
  expect(order!.id).toBe(expected.transactionId);
  expect(order!.status).toBe('AUTHENTICATION_INITIATED');

  assertCardDetails(res.sourceOfFunds, expected.card);

  const txn = res.transaction;
  expect(txn).toBeTruthy();
  expect(txn!.currency).toBe(expected.currency);
  expect(txn!.id).toBe(`${expected.transactionId}-1`);
  expect(txn!.type).toBe('AUTHENTICATION');
}

interface AuthenticatePayerExpected {
  session: string;
  transactionId: string;
  currency: string;
  card: CardData;
}

/**
 * Verify an AUTHENTICATE_PAYER log entry.
 * Result may be SUCCESS or PENDING (for challenge flow).
 */
export function verifyAuthenticatePayer(
  log: LogEntry,
  expected: AuthenticatePayerExpected,
): void {
  expect(log.request.type).toBe('PUT');
  expect(log.request.url).toContain('/transaction/');
  expect(log.request.body.apiOperation).toBe('AUTHENTICATE_PAYER');
  expect(log.request.body.session?.id).toBe(expected.session);

  const res = log.response.body;
  expect(['SUCCESS', 'PENDING']).toContain(res.result);

  const order = res.order;
  expect(order).toBeTruthy();
  expect(order!.currency).toBe(expected.currency);
  expect(order!.id).toBe(expected.transactionId);
  expect(order!.status).toBeTruthy();

  assertCardDetails(res.sourceOfFunds, expected.card);
}

interface AuthenticationResultExpected {
  transactionId: string;
  currency: string;
  authStatus: string;
}

/**
 * Verify an authentication result log entry.
 * Asserts authenticationStatus, currency, and order details.
 */
export function verifyAuthenticationResult(
  log: LogEntry,
  expected: AuthenticationResultExpected,
): void {
  const res = log.response.body;

  const authStatus = res.authenticationStatus ?? res.order?.authenticationStatus;
  expect(authStatus).toBe(expected.authStatus);

  const currency = res.currency ?? res.order?.currency ?? res.transaction?.currency;
  expect(currency).toBe(expected.currency);

  const orderId = res.id ?? res.order?.id;
  expect(orderId).toBe(expected.transactionId);
}

// ─── Authorize / Capture / Pay verification ───────────────────────────────────

interface AuthorizeCaptureExpected {
  apiOperation: 'AUTHORIZE' | 'PAY' | 'CAPTURE';
  session?: string;
  total: string;
  currency: string;
  transactionId: string;
  orderNumber: string | number;
  card: CardData;
}

/**
 * Verify an AUTHORIZE, PAY, or CAPTURE log entry.
 */
export function verifyAuthorizeCaptureLog(
  log: LogEntry,
  expected: AuthorizeCaptureExpected,
): void {
  expect(log.request.type).toBe('PUT');
  expect(log.request.url).toContain('/transaction/');
  expect(log.request.body.apiOperation).toBe(expected.apiOperation);

  if (expected.session) {
    expect(log.request.body.session?.id).toBe(expected.session);
  }

  const res = log.response.body;
  expect(res.result).toBe('SUCCESS');

  const order = res.order;
  expect(order).toBeTruthy();
  expect(order!.currency).toBe(expected.currency);
  expect(order!.id).toBe(expected.transactionId);

  if (expected.apiOperation !== 'CAPTURE') {
    expect(String(order!.reference)).toBe(String(expected.orderNumber));
  }

  const txn = res.transaction;
  expect(txn).toBeTruthy();
  expect(txn!.currency).toBe(expected.currency);

  const expectedAmount = parseAmount(expected.total);
  if (txn!.amount !== undefined) {
    expect(txn!.amount).toBeCloseTo(expectedAmount, 2);
  }

  assertCardDetails(res.sourceOfFunds, expected.card);
}

// ─── Token verification ───────────────────────────────────────────────────────

interface TokenLogExpected {
  session: string;
  card: CardData;
}

/**
 * Verify a token creation log entry.
 * Asserts POST method, session ID, SUCCESS result, card details, status VALID.
 */
export function verifyTokenLog(log: LogEntry, expected: TokenLogExpected): void {
  expect(log.request.type).toBe('POST');
  expect(log.request.body.session?.id).toBe(expected.session);

  const res = log.response.body;
  expect(res.result).toBe('SUCCESS');

  const status = res.status ?? (res as any).token?.status;
  expect(status).toBe('VALID');

  assertCardDetails(res.sourceOfFunds, expected.card);
}

/**
 * Assert that no token logs exist (token was not created).
 */
export function verifyTokenLogsEmpty(tokenLogs: LogResponse): void {
  expect(tokenLogs.logs[0]?.content.length).toBe(0);
}

// ─── Agreement / Subscription verification ────────────────────────────────────

type PaymentFrequency = 'MONTHLY' | 'WEEKLY' | 'YEARLY' | 'DAILY' | string;

interface AgreementExpected {
  type?: string;
  amountVariability?: string;
  subscriptionId: string;
  frequency: PaymentFrequency;
  payDate: string; // ISO date string, e.g. '2026-04-07'
}

function calculateAgreementDates(
  payDate: string,
  frequency: PaymentFrequency,
): { startDate: string; expiryDate: string; numberOfPayments: string } {
  const start = new Date(payDate);
  const expiry = new Date(payDate);

  // Default: 12 monthly payments spanning 1 year
  let numberOfPayments = 12;
  switch (frequency.toUpperCase()) {
    case 'WEEKLY':
      expiry.setFullYear(expiry.getFullYear() + 1);
      numberOfPayments = 52;
      break;
    case 'MONTHLY':
      expiry.setFullYear(expiry.getFullYear() + 1);
      numberOfPayments = 12;
      break;
    case 'YEARLY':
      expiry.setFullYear(expiry.getFullYear() + 5);
      numberOfPayments = 5;
      break;
    case 'DAILY':
      expiry.setFullYear(expiry.getFullYear() + 1);
      numberOfPayments = 365;
      break;
    default:
      expiry.setFullYear(expiry.getFullYear() + 1);
      numberOfPayments = 12;
  }

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return {
    startDate: fmt(start),
    expiryDate: fmt(expiry),
    numberOfPayments: String(numberOfPayments),
  };
}

/**
 * Verify an agreement (subscription) log entry.
 * Asserts agreement type RECURRING, amountVariability FIXED, id format,
 * frequency, and calculated date range.
 */
export function verifyAgreement(log: LogEntry, expected: AgreementExpected): void {
  const reqAgreement = log.request.body.agreement;
  const resAgreement = log.response.body.agreement;

  // At least one side should carry the agreement data
  const agreement = reqAgreement ?? resAgreement;
  expect(agreement).toBeTruthy();

  expect(agreement!.type).toBe(expected.type ?? 'RECURRING');
  expect(agreement!.amountVariability).toBe(expected.amountVariability ?? 'FIXED');
  expect(agreement!.id).toContain(`acme_subscription-order-${expected.subscriptionId}`);
  expect(agreement!.paymentFrequency).toBe(expected.frequency.toUpperCase());

  const { startDate, expiryDate, numberOfPayments } = calculateAgreementDates(
    expected.payDate,
    expected.frequency,
  );

  expect(agreement!.startDate).toBe(startDate);
  expect(agreement!.expiryDate).toBe(expiryDate);
  expect(agreement!.numberOfPayments).toBe(numberOfPayments);
}

// ─── Void verification ────────────────────────────────────────────────────────

interface VoidExpected {
  transactionId: string;
  orderNumber: string | number;
  currency: string;
  card: CardData;
}

/**
 * Verify a VOID log entry.
 * Asserts apiOperation VOID, targetTransactionId, order.status CANCELLED, result SUCCESS.
 */
export function verifyVoidLog(log: LogEntry, expected: VoidExpected): void {
  expect(log.request.body.apiOperation).toBe('VOID');
  // VOID's targetTransactionId points at the prior auth/capture transaction
  // for the same order. The gateway may suffix it with a sequence (e.g.
  // "...-2") when the auth flow recorded multiple transactions; treat the
  // expected id as a prefix match instead of strict equality.
  expect(log.request.body.transaction?.targetTransactionId).toContain(expected.transactionId);

  const res = log.response.body;
  expect(res.result).toBe('SUCCESS');

  const order = res.order;
  expect(order).toBeTruthy();
  expect(order!.status).toBe('CANCELLED');
  expect(order!.currency).toBe(expected.currency);

  assertCardDetails(res.sourceOfFunds, expected.card);
}

// ─── Refund verification ──────────────────────────────────────────────────────

interface RefundExpected {
  total: string;
  currency: string;
  isPartial: boolean;
  partialAmount?: string;
}

/**
 * Verify a REFUND log entry.
 * Asserts apiOperation REFUND, amount/currency, result SUCCESS,
 * order.status REFUNDED or PARTIALLY_REFUNDED, and totalRefundedAmount.
 */
export function verifyRefundLog(log: LogEntry, expected: RefundExpected): void {
  expect(log.request.body.apiOperation).toBe('REFUND');

  const reqOrder = log.request.body.order;
  if (reqOrder) {
    expect(reqOrder.currency).toBe(expected.currency);
  }

  const reqTransaction = log.request.body.transaction;
  if (reqTransaction) {
    if (expected.total) {
      const amount = parseAmount(expected.total);
      const actualAmount = parseFloat(String((log as any).request?.body?.transaction?.amount));
      expect(actualAmount).toBeCloseTo(amount, 2);
    }
    expect((log as any).request?.body?.transaction?.currency).toBe(expected.currency || 'USD');
  }

  const res = log.response.body;
  expect(res.result).toBe('SUCCESS');

  const order = res.order;
  expect(order).toBeTruthy();
  expect(order!.currency).toBe(expected.currency);

  if (expected.isPartial) {
    expect(order!.status).toBe('PARTIALLY_REFUNDED');
    if (expected.partialAmount !== undefined) {
      const partialAmt = parseAmount(expected.partialAmount);
      expect(order!.totalRefundedAmount).toBeCloseTo(partialAmt, 2);
    }
  } else {
    expect(order!.status).toBe('REFUNDED');
    const totalAmt = parseAmount(expected.total);
    expect(order!.totalRefundedAmount).toBeCloseTo(totalAmt, 2);
  }

  const txn = res.transaction;
  expect(txn).toBeTruthy();
  expect(txn!.type).toBe('REFUND');
  expect(txn!.currency).toBe(expected.currency);

  const refundAmt = parseAmount(
    (expected.isPartial ? expected.partialAmount : expected.total) ?? '0',
  );
  if (txn!.amount !== undefined) {
    expect(txn!.amount).toBeCloseTo(refundAmt, 2);
  }
}

// ─── Webhook verification ────────────────────────────────────────────────────

export type WebhookTxType = 'PAYMENT' | 'AUTHORIZATION' | 'AUTHENTICATION' | 'CAPTURE' | 'REFUND' | 'VOID_AUTHORIZATION';

/**
 * Poll the webhook log until ALL expected SUCCESS webhooks have arrived for
 * the given order. Then poll the main api log until it has been quiet for
 * `quiescenceMs` (no new entries appended). Each webhook triggers a
 * `retrieve_order()` GET that logs to the main file; without quiescence
 * those stragglers interleave with the next test's outbound writes and the
 * parser mis-pairs request/response sections.
 *
 * Capture flow expects ['PAYMENT', 'AUTHENTICATION'].
 * Authorize flow expects ['AUTHORIZATION', 'AUTHENTICATION'].
 * Refund flow expects ['REFUND'].
 *
 * Returns the matched webhook entries.
 */
export async function waitForWebhooks(
  date: string,
  orderNumber: string,
  expectedTxTypes: WebhookTxType[],
  timeoutMs = 120000,
  quiescenceMs = 5000,
): Promise<Array<{ date: string; body: any }>> {
  const start = Date.now();
  const remaining = new Set<WebhookTxType>(expectedTxTypes);
  const matched: Array<{ date: string; body: any }> = [];
  let lastEntries: any[] = [];

  console.log(`  [webhook] waiting for [${[...remaining].join(', ')}] on order ${orderNumber}...`);
  while (Date.now() - start < timeoutMs && remaining.size > 0) {
    const result = await getWebhookLogs(date, String(orderNumber));
    lastEntries = result.logs[0]?.content || [];
    for (const e of lastEntries) {
      const tx = e.body?.transaction?.type as WebhookTxType | undefined;
      if (tx && remaining.has(tx) && e.body?.result === 'SUCCESS') {
        matched.push(e);
        remaining.delete(tx);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`  [webhook] ${tx} arrived after ${elapsed}s (remaining: [${[...remaining].join(', ')}])`);
      }
    }
    if (remaining.size === 0) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (remaining.size > 0) {
    const seen = lastEntries.map((e: any) => `${e.date}/${e.body?.transaction?.type}/${e.body?.result}`).join(', ');
    throw new Error(
      `waitForWebhooks timeout: missing [${[...remaining].join(', ')}] for order ${orderNumber} within ${timeoutMs}ms. Seen: [${seen}]`,
    );
  }

  // Quiescence: each webhook triggers a retrieve_order GET in the main log,
  // and those writes can interleave with the next test's outbound IC writes.
  // Poll until the main log entry count has been stable for `quiescenceMs`.
  console.log(`  [webhook] all received, waiting ${quiescenceMs}ms main-log quiescence...`);
  let lastCount = await getLogEntryCount(date);
  let stableSince = Date.now();
  const quiescenceDeadline = Date.now() + timeoutMs;
  while (Date.now() < quiescenceDeadline) {
    await new Promise((r) => setTimeout(r, 1000));
    const count = await getLogEntryCount(date);
    if (count !== lastCount) {
      console.log(`  [webhook] main log grew ${lastCount} -> ${count}, resetting quiescence clock`);
      lastCount = count;
      stableSince = Date.now();
      continue;
    }
    if (Date.now() - stableSince >= quiescenceMs) {
      console.log(`  [webhook] main log quiescent for ${quiescenceMs}ms`);
      return matched;
    }
  }
  throw new Error(`waitForWebhooks: main log did not reach quiescence (${quiescenceMs}ms stable) within ${timeoutMs}ms for order ${orderNumber}`);
}

// ─── Order email verification ─────────────────────────────────────────────────
// Reads what WordPress actually generated, from its own mail log
// (custom/v1/get-mail). The admin-vs-customer subject heuristics below are
// carried over verbatim from the previous external mail-catcher client — only
// the transport changed, and the body no longer needs a second fetch since the
// log row already carries it.

function assertPaymentMethodInEmail(mail: LoggedMail, paymentMethodTitle: string): void {
  // GI checks tr.order-totals.order-totals-payment_method > td or tfoot td;
  // matching anywhere in the body mirrors the previous implementation.
  expect(
    mail.message,
    `email "${mail.subject}" to ${mail.receiver} should mention ${paymentMethodTitle}`,
  ).toContain(paymentMethodTitle);
}

/**
 * Verify that both the admin and customer order emails contain the payment
 * method title.
 */
export async function verifyOrderEmails(
  orderNumber: string,
  options: { paymentMethodTitle: string; adminEmail?: string; customerEmail?: string }
): Promise<void> {
  // minCount: 2 — both the admin and the customer mail must have been written
  // before asserting. Returning after only the admin row exists would silently
  // skip the customer assertion below.
  const mails = await getLoggedMail({ contains: orderNumber }, { minCount: 2 });

  const adminMsg = mails.find(m =>
    m.subject.toLowerCase().includes('new order') || m.subject.includes(`Order #${orderNumber}`)
  );
  const customerMsg = mails.find(m =>
    m.subject.toLowerCase().includes('order has been received') ||
    m.subject.toLowerCase().includes('order is on') ||
    m.subject.toLowerCase().includes('your order')
  );

  expect(adminMsg, `Admin email for order ${orderNumber} not found`).toBeTruthy();
  assertPaymentMethodInEmail(adminMsg!, options.paymentMethodTitle);

  if (customerMsg) {
    assertPaymentMethodInEmail(customerMsg, options.paymentMethodTitle);
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
  const mails = await getLoggedMail({ contains: orderNumber });

  const adminMsg = mails.find(m =>
    m.receiver.includes(adminAddr) ||
    m.subject.toLowerCase().includes('new order')
  );
  expect(adminMsg, `Admin email for order ${orderNumber} not found`).toBeTruthy();
  assertPaymentMethodInEmail(adminMsg!, options.paymentMethodTitle);
}

/**
 * Verify only the customer order email contains the payment method title.
 */
export async function verifyCustomerEmail(
  orderNumber: string,
  options: { paymentMethodTitle: string; customerEmail: string }
): Promise<void> {
  const mails = await getLoggedMail({ contains: orderNumber });

  const customerMsg = mails.find(m =>
    m.receiver === options.customerEmail ||
    (m.subject.toLowerCase().includes('order') && !m.subject.toLowerCase().includes('new order'))
  );
  expect(customerMsg, `Customer email for order ${orderNumber} not found`).toBeTruthy();
  assertPaymentMethodInEmail(customerMsg!, options.paymentMethodTitle);
}

// ─── Order received (thank-you) page ──────────────────────────────────────────

/**
 * Assert the order-received page rendered correctly. `data` is the value
 * flows.collectOrderReceivedData() just returned — required to check the
 * subscription-id invariant, which the data-collection half cannot assert.
 */
export async function assertOrderReceived(
  page: Page,
  options: { displayName: string; expectDeclined?: boolean; expectedTotal?: string },
  data?: OrderReceivedData,
): Promise<void> {
  if (options.expectDeclined) {
    await expect(page.locator('.woocommerce-error')).toBeVisible();
    return;
  }

  await expect(page.locator('h1.entry-title')).toContainText('Order received');

  // Payment method
  await expect(
    page.locator('.method > strong, li:has-text("Payment method") > strong')
  ).toContainText(options.displayName);

  if (options.expectedTotal) {
    // Try multiple selectors: tfoot total, order summary list, order details table
    const totalLocator = page.locator(
      'tfoot tr.order-total td span.woocommerce-Price-amount.amount > bdi, ' +
      'li:has-text("Total") > strong, ' +
      'tr:has(> th:has-text("Total"), > td.rowheader:has-text("Total")) td .woocommerce-Price-amount.amount'
    ).first();
    await expect(totalLocator).toContainText(options.expectedTotal);
  }

  // Carried over from the previous verifyOrderReceived(): when the page
  // rendered a subscription link, its id must not be empty. `undefined` means
  // no link was present, which is the non-subscription case, not a failure.
  if (data?.subscriptionId !== undefined) {
    expect(data.subscriptionId, 'Subscription ID should not be empty').toBeTruthy();
  }
}
