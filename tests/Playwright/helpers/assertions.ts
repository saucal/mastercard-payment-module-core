import { Page, expect } from '@playwright/test';
import type { CardData, PluginConfig } from '../plugin-config.types';
import { getLogs, getWebhookLogs, getLogEntryCount, getLoggedMail, getOrder, getOrderMeta } from './wc-api';
import type { LogEntry, LogResponse, LoggedMail } from './wc-api';
import type { OrderReceivedData } from './flows';
import { showEmails, logOrderContext } from './debug';

// ─── Admin order screen ───────────────────────────────────────────────────────

export async function assertOrderStatus(page: Page, expectedStatus: string): Promise<void> {
  await expect(page.locator('#select2-order_status-container')).toContainText(expectedStatus);
}

export type ProductKind = 'physical' | 'virtual' | 'download';
export type TransactionKind = 'capture' | 'authorize';

export interface ExpectedOrderStatusInput {
  product: ProductKind;
  transaction: TransactionKind;
  declined?: boolean;
}

/**
 * Ghost Inspector's order-status expectation, which is conditional on product
 * type and transaction mode rather than fixed. From the `mc-*-admin` tests'
 * steps on `#select2-order_status-container`:
 *
 *   declined                    -> Failed
 *   authorize                   -> On hold
 *   capture + download          -> Completed
 *   capture + physical|virtual  -> Processing
 *
 * A `download` order reaches Completed because WooCommerce auto-completes
 * orders whose items are all virtual and downloadable, so asserting Processing
 * for one is always wrong. Subscriptions assert 'Active' on their own screen.
 */
export function expectedOrderStatus(input: ExpectedOrderStatusInput): string {
  if (input.declined) return 'Failed';
  if (input.transaction === 'authorize') return 'On hold';
  return input.product === 'download' ? 'Completed' : 'Processing';
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
 * Verify the order note for a captured payment.
 *
 * Deliberately NOT pinned to a position, though Ghost Inspector pinned it to 2.
 * WooCommerce writes the gateway's two notes and the two "Email ... sent." notes
 * inside the same second, and the admin screen orders by timestamp — so whether
 * the emails tie with the capture note or land a second after it decides whether
 * the capture note renders second or fourth. Observed both on 2026-08-19: order
 * 6291 had all four at 12:22:53, order 6295 had the emails a second later. The
 * pin turned that coin-flip into red runs across suites 01, 02, 04, 07, 11, 12
 * and 15, and a pre-order's extra "Email “Pre-ordered” sent." note shifted it
 * again in suite 20.
 *
 * The text is the assertion; the position never was.
 */
export async function assertCapturedNote(page: Page, config: PluginConfig, transactionId: string): Promise<void> {
  await assertOrderNoteContains(page, `${config.displayName} payment was Captured (Order ID: ${transactionId})`);
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
  /**
   * Gateway slug the agreement id is prefixed with — pass
   * `config.paymentMethodSlug`. Required rather than defaulted: this used to be
   * hardcoded to 'acme', which silently failed on any site whose gateway slug
   * differs (e.g. mastercard_merchant_cloud).
   */
  slug: string;
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
  expect(agreement!.id).toContain(`${expected.slug}_subscription-order-${expected.subscriptionId}`);
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
  // `undefined` here does not mean the void was refused — a refusal would read
  // 'FAILURE'. It means the entry carries no parsed response at all, which
  // happens when the log parser could not decode it: `parse_raw_log_content()`
  // in the ghost-inspector-runner plugin only picks up a response body that
  // sits on a single line starting with '{', so a pretty-printed response
  // leaves `body` as a fragment or empty string. Say which it is.
  expect(
    res?.result,
    'VOID response carried no result. Raw response.body was: '
    + `${JSON.stringify(log.response?.body)?.slice(0, 400)}`,
  ).toBe('SUCCESS');

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
  options: { paymentMethodTitle: string; adminEmail?: string; customerEmail?: string; page?: Page }
): Promise<void> {
  // minCount: 2 — both the admin and the customer mail must have been written
  // before asserting. Returning after only the admin row exists would silently
  // skip the customer assertion below.
  const mails = await getLoggedMail({ contains: orderNumber }, { minCount: 2 });
  if (options.page) await showEmails(options.page, mails);

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
  options: { paymentMethodTitle: string; adminEmail?: string; page?: Page }
): Promise<void> {
  const adminAddr = options.adminEmail || 'admin@';
  const mails = await getLoggedMail({ contains: orderNumber });
  if (options.page) await showEmails(options.page, mails);

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
  options: { paymentMethodTitle: string; customerEmail: string; page?: Page }
): Promise<void> {
  const mails = await getLoggedMail({ contains: orderNumber });
  if (options.page) await showEmails(options.page, mails);

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

  await expect(page.locator('h1.entry-title')).toContainText('Order received', { timeout: 30000 });

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

// ─── My Account pages ─────────────────────────────────────────────────────────
// Moved verbatim from helpers/my-account.ts, which keeps only its two
// navigation primitives. Each of these still navigates before asserting —
// strictly a flows.ts concern, left as-is to preserve call-site behavior.

interface CardRow {
  cardName: string;
  fourDigits: string;
  expiryMonth?: string;
  expiryYear?: string;
}

export async function verifyPaymentMethods(
  page: Page,
  options: {
    expectedCards: number;
    cardName?: string;
    fourDigits?: string;
    expiryMonth?: string;
    expiryYear?: string;
    cards?: CardRow[];
  }
): Promise<void> {
  await page.goto('/my-account/payment-methods/');

  if (options.expectedCards === 0) {
    await expect(page.getByText('No saved methods found')).toBeVisible();
    return;
  }

  // Assert the count first, and say what is on the page when it disagrees.
  // Going straight to `tr:nth-of-type(2)` reports "element(s) not found", which
  // cannot distinguish "only one card was saved" from "the markup changed" —
  // and the interesting case is almost always the former.
  const methodCells = page.locator('td.woocommerce-PaymentMethod.woocommerce-PaymentMethod--method');
  await methodCells.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  const rendered = (await methodCells.allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());

  await logOrderContext('saved payment methods', {
    url: page.url(),
    expected: options.expectedCards,
    found: rendered.length,
    rows: rendered.join(' | ') || '(none)',
  });

  expect(
    rendered.length,
    `expected ${options.expectedCards} saved card(s), found ${rendered.length}: `
    + `[${rendered.join(' | ') || 'none'}]`,
  ).toBe(options.expectedCards);

  for (let i = 1; i <= options.expectedCards; i++) {
    const row = page.locator(
      `tr:nth-of-type(${i}) > td.woocommerce-PaymentMethod.woocommerce-PaymentMethod--method`
    );
    await expect(row).toBeVisible();

    const spec: CardRow | undefined = options.cards
      ? options.cards[i - 1]
      : (options.cardName && options.fourDigits
        ? { cardName: options.cardName, fourDigits: options.fourDigits, expiryMonth: options.expiryMonth, expiryYear: options.expiryYear }
        : undefined);

    if (spec) {
      await expect(row).toContainText(`${spec.cardName} ending in ${spec.fourDigits}`);
      if (spec.expiryMonth && spec.expiryYear) {
        const expiryCell = page.locator(
          `tr:nth-of-type(${i}) > td.woocommerce-PaymentMethod.woocommerce-PaymentMethod--expires`
        );
        await expect(expiryCell).toContainText(`${spec.expiryMonth}/${spec.expiryYear}`);
      }
    }
  }

  // No trailing "extra row" check: the count assertion above already covers it,
  // and covers a *missing* row too, which the old check did not.
}

export async function verifyOrderInMyAccount(
  page: Page,
  orderNumber: string,
  expectedStatus: string,
  options?: { expectedTotal?: string; displayName?: string }
): Promise<void> {
  await page.goto(`/my-account/view-order/${orderNumber}/`);
  await expect(page.locator('mark.order-status')).toContainText(expectedStatus);
  if (options?.expectedTotal) {
    // Find the Total row's value cell — works across themes
    const totalCell = page.locator('tr:has(th:has-text("Total"), td:has-text("Total:")) td').last();
    await expect(totalCell).toContainText(options.expectedTotal);
  }
  if (options?.displayName) {
    await expect(page.locator('section.woocommerce-order-details')).toContainText(options.displayName);
  }
}

export async function verifySubscription(
  page: Page,
  subscriptionId: string,
  options: { expectedStatus: string; displayName: string }
): Promise<void> {
  await page.goto(`/my-account/view-subscription/${subscriptionId}/`);
  await expect(
    page.locator('table.shop_table.subscription_details > tbody > tr:nth-of-type(1) > td:nth-of-type(2)')
  ).toContainText(options.expectedStatus);
  await expect(page.locator('.subscription-payment-method')).toContainText(`Via ${options.displayName}`);
}

export async function verifyCartEmpty(page: Page): Promise<void> {
  const cartUrl = process.env.CART_URL || '/cart/';
  await page.goto(cartUrl);
  await page.waitForLoadState('load');


  // Verify empty state — blocks or classic
  await expect(
    page.locator('.wc-block-cart__empty-cart__title, .cart-empty.woocommerce-info')
  ).toContainText('cart is currently empty', { timeout: 30000 });
}

// ─── Composite log trails ─────────────────────────────────────────────────────

export interface CaptureLogTrailExpected {
  payDate: string;
  logOffset: number;
  session: string;
  total: string;
  currency?: string;
  transactionId: string;
  orderNumber: string | number;
  card: CardData;
  /** false for saved-token checkouts, which don't POST a new session */
  expectSessionPost: boolean;
  /** true only when the checkout saves a new card */
  expectToken: boolean;
  /** false for saved-token checkouts, which don't re-fetch card details */
  expectCardDetailsFetch: boolean;
  /**
   * The money-movement operation the gateway logs: 'PAY' in PURCHASE mode,
   * 'AUTHORIZE' in AUTHORIZE mode. Everything before it — session, token, 3DS —
   * is identical, which is why this is a flag and not a second function.
   */
  apiOperation?: 'PAY' | 'AUTHORIZE';
  /**
   * Whether the gateway ran 3DS at all. Defaults to true. Pass false for the
   * `_3d_secure=no` suites, where the assertion inverts: INITIATE_AUTHENTICATION
   * and AUTHENTICATE_PAYER must be ABSENT, and the challenge-card
   * AUTHENTICATION_SUCCESSFUL probe does not apply. Everything else — session,
   * token, the money-movement operation — is identical either way.
   */
  expect3DS?: boolean;
  /**
   * Pin the final authentication status and run verifyAuthenticationResult
   * against that entry — the 3DS suite (06) asserts this per case, including
   * AUTHENTICATION_ATTEMPTED for a frictionless-attempted card.
   *
   * Left unset, the weaker default applies: a challenge card must produce an
   * AUTHENTICATION_SUCCESSFUL entry somewhere and a frictionless one is not
   * probed at all, which is all suites 01/02 ever asserted.
   */
  authStatus?: 'AUTHENTICATION_SUCCESSFUL' | 'AUTHENTICATION_ATTEMPTED';
}

/**
 * Dedup of the capture-flow log-verification block repeated across
 * MC-004..MC-010 in 01-hosted-session-capture-classic: fetches the
 * session/token/all logs for the order, locates each relevant entry, and
 * runs the matching verify* assertion against it.
 */
export async function assertCaptureLogTrail(expected: CaptureLogTrailExpected): Promise<void> {
  const currency = expected.currency ?? 'USD';
  const apiOperation = expected.apiOperation ?? 'PAY';
  const txFilter = (l: LogEntry) => !expected.transactionId || l.request?.url?.includes(expected.transactionId);

  // Fetch every log window up front, in the same order the inline blocks did.
  const allLogs = await getLogs(expected.payDate, '', expected.logOffset);
  const sessionPostLogs = expected.expectSessionPost
    ? await getLogs(expected.payDate, '/session', expected.logOffset)
    : null;
  const sessionGetLogs = await getLogs(expected.payDate, `/session/${expected.session}`, expected.logOffset);
  const tokenLogs = await getLogs(expected.payDate, '/token', expected.logOffset);

  if (sessionPostLogs) {
    expect(sessionPostLogs.logs[0]?.content.length, 'session POST logs should not be empty').toBeGreaterThan(0);
    const sessionPostLog = expected.session
      ? sessionPostLogs.logs[0].content.find((l: LogEntry) => l.response?.body?.session?.id === expected.session && (l.response?.body?.result === 'SUCCESS' || l.response?.body?.session?.updateStatus === 'SUCCESS' || l.response?.body?.session?.version))
      : sessionPostLogs.logs[0].content[0];
    expect(sessionPostLog, `session POST entry not found for session ${expected.session}`).toBeTruthy();
    verifySessionPost(sessionPostLog!, {
      session: expected.session, total: expected.total, currency,
      transactionId: expected.transactionId, orderNumber: expected.orderNumber,
    });
  }

  expect(sessionGetLogs.logs[0]?.content.length, 'session GET logs should not be empty').toBeGreaterThan(0);
  const sessionPut = sessionGetLogs.logs[0].content.find(
    (l: LogEntry) => l.request?.type === 'PUT'
      && l.request?.body?.apiOperation === 'UPDATE_SESSION'
      && l.response?.body?.session?.updateStatus === 'SUCCESS'
  );
  expect(sessionPut, 'UPDATE_SESSION PUT log entry not found').toBeTruthy();
  const resolvedSession: string = expected.session
    || sessionPut!.request.body.session?.id
    || sessionPut!.response.body.session?.id
    || '';
  verifySessionGet(sessionPut!, { session: resolvedSession, card: expected.card });

  if (expected.expectCardDetailsFetch) {
    const sessionGet = sessionGetLogs.logs[0].content.find(
      (l: LogEntry) => l.request?.type === 'GET'
        && l.request?.url?.includes('/session/')
        && l.response?.body?.session?.id === resolvedSession
    );
    expect(sessionGet, 'session GET card details entry not found').toBeTruthy();
    verifySessionGetCardDetails(sessionGet!, { session: resolvedSession, card: expected.card });
  }

  if (expected.expectToken) {
    expect(tokenLogs.logs[0]?.content.length, 'token logs should not be empty').toBeGreaterThan(0);
    verifyTokenLog(tokenLogs.logs[0].content[0], { session: resolvedSession, card: expected.card });
  } else {
    verifyTokenLogsEmpty(tokenLogs);
  }

  // Auth + capture logs (filter by transaction ID to avoid cross-order matches)
  expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
  const logContent: LogEntry[] = allLogs.logs[0].content;

  if (expected.expect3DS ?? true) {
    const initiateAuthLog = logContent.find(
      (l: LogEntry) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(initiateAuthLog, 'INITIATE_AUTHENTICATION log not found').toBeTruthy();
    verifyInitiateAuthentication(initiateAuthLog!, {
      session: resolvedSession, card: expected.card, transactionId: expected.transactionId, currency,
    });

    const expectedAuthResult = expected.card.challenge ? 'PENDING' : 'SUCCESS';
    const authenticatePayerLog = logContent.find(
      (l: LogEntry) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER' && txFilter(l)
        && l.response?.body?.result === expectedAuthResult
    );
    expect(authenticatePayerLog, 'AUTHENTICATE_PAYER log not found').toBeTruthy();
    verifyAuthenticatePayer(authenticatePayerLog!, {
      session: resolvedSession, transactionId: expected.transactionId, currency, card: expected.card,
    });

    // Final authentication status. When the caller pins one, that exact status is
    // required and fully verified; otherwise only a challenge card is probed, and
    // only for existence.
    const wantedStatus = expected.authStatus ?? (expected.card.challenge ? 'AUTHENTICATION_SUCCESSFUL' : undefined);
    if (wantedStatus) {
      const authResultLog = logContent.find(
        (l: LogEntry) => txFilter(l) && (
          l.response?.body?.authenticationStatus === wantedStatus
          || l.response?.body?.order?.authenticationStatus === wantedStatus
        )
      );
      expect(authResultLog, `${wantedStatus} result log not found`).toBeTruthy();
      if (expected.authStatus) {
        verifyAuthenticationResult(authResultLog!, {
          transactionId: expected.transactionId, currency, authStatus: expected.authStatus,
        });
      }
    }
  } else {
    // 3DS inactive: the absence of the auth flow IS the assertion. Note this
    // holds even for a challenge card — with _3d_secure=no the gateway never
    // authenticates it, so there is no PENDING result and no ACS prompt.
    expect(
      logContent.find((l: LogEntry) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l)),
      'INITIATE_AUTHENTICATION log should NOT be present (3DS inactive)',
    ).toBeFalsy();
    expect(
      logContent.find((l: LogEntry) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER' && txFilter(l)),
      'AUTHENTICATE_PAYER log should NOT be present (3DS inactive)',
    ).toBeFalsy();
  }

  const captureLog = logContent.find(
    (l: LogEntry) => l.request?.body?.apiOperation === apiOperation && txFilter(l) && l.response?.body?.result === 'SUCCESS'
  );
  expect(captureLog, `${apiOperation} log not found`).toBeTruthy();
  verifyAuthorizeCaptureLog(captureLog!, {
    apiOperation, session: resolvedSession, total: expected.total, currency,
    transactionId: expected.transactionId, orderNumber: expected.orderNumber, card: expected.card,
  });
}

/** {@link assertCaptureLogTrail} inputs, minus the operation this pins. */
export type AuthorizeLogTrailExpected = Omit<CaptureLogTrailExpected, 'apiOperation'>;

/**
 * The AUTHORIZE-mode sibling of assertCaptureLogTrail. The session, token and
 * 3DS trail are byte-identical — only the money-movement operation differs — so
 * this delegates rather than duplicating eighty lines. There is no CAPTURE yet;
 * use assertCaptureOperationLog for the admin-side capture that follows.
 */
export async function assertAuthorizeLogTrail(expected: AuthorizeLogTrailExpected): Promise<void> {
  await assertCaptureLogTrail({ ...expected, apiOperation: 'AUTHORIZE' });
}

/**
 * Assert the admin-triggered CAPTURE against an already-authorized order. Unlike
 * the checkout operations this lands on `/transaction`, and the amount is the
 * captured amount, not the order total — partial captures pass a quarter of it.
 *
 * VOID deliberately has no sibling here: it is one case in suite 14 and needs
 * verifyVoidLog, a different assertion with a different shape.
 */
export async function assertCaptureOperationLog(expected: {
  payDate: string;
  logOffset: number;
  amount: string;
  currency?: string;
  transactionId: string;
  orderNumber: string | number;
  card: CardData;
}): Promise<void> {
  const transactionLogs = await getLogs(expected.payDate, '/transaction', expected.logOffset);
  expect(transactionLogs.logs[0]?.content.length, 'transaction PUT logs should not be empty').toBeGreaterThan(0);
  const log = transactionLogs.logs[0].content.find(
    (l: LogEntry) => l.request?.body?.apiOperation === 'CAPTURE'
      && l.request?.url?.includes(expected.transactionId)
  );
  expect(log, 'CAPTURE log not found').toBeTruthy();
  verifyAuthorizeCaptureLog(log!, {
    apiOperation: 'CAPTURE', total: expected.amount, currency: expected.currency ?? 'USD',
    transactionId: expected.transactionId, orderNumber: expected.orderNumber, card: expected.card,
  });
}

export interface HostedCheckoutLogTrailExpected {
  payDate: string;
  logOffset: number;
  total: string;
  currency?: string;
  transactionId: string;
  orderNumber: string | number;
}

/**
 * Hosted-checkout log trail — the same fifteen lines repeated across all twelve
 * cases of suites 03, 04 and 05.
 *
 * Deliberately shorter than the hosted-session trail: MPGS runs
 * INITIATE_AUTHENTICATION, AUTHENTICATE_PAYER and the payment itself inside its
 * own hosted UI, so none of those reach our log. Only INITIATE_CHECKOUT does,
 * and it is INITIATE_CHECKOUT in authorize mode too (suite 05) — the transaction
 * mode is not visible in this trail at all. Asserting more would be inventing it.
 *
 * The session id is discovered from the log rather than passed in: hosted
 * checkout never exposes it to the page. Returned for callers that want it.
 */
export async function assertHostedCheckoutLogTrail(
  expected: HostedCheckoutLogTrailExpected,
): Promise<string> {
  const sessionPostLogs = await getLogs(expected.payDate, '/session', expected.logOffset);
  const tokenLogs = await getLogs(expected.payDate, '/token', expected.logOffset);

  expect(sessionPostLogs.logs[0]?.content.length, 'session POST logs should not be empty').toBeGreaterThan(0);
  const sessionPostLog = sessionPostLogs.logs[0].content.find(
    (l: LogEntry) => l.request?.body?.apiOperation === 'INITIATE_CHECKOUT'
      && l.response?.body?.result === 'SUCCESS'
      && String(l.request?.body?.order?.reference) === String(expected.orderNumber)
  );
  expect(sessionPostLog, `INITIATE_CHECKOUT session POST entry not found for order ${expected.orderNumber}`).toBeTruthy();
  const resolvedSession: string = sessionPostLog!.response.body.session?.id || '';
  expect(resolvedSession, 'session id not returned from INITIATE_CHECKOUT').toBeTruthy();
  verifySessionPost(sessionPostLog!, {
    session: resolvedSession, total: expected.total, currency: expected.currency ?? 'USD',
    transactionId: expected.transactionId, orderNumber: expected.orderNumber,
    apiOperation: 'INITIATE_CHECKOUT',
  });

  // Hosted checkout never tokenizes on our side — every case in 03/04/05 asserts
  // this, including the logged-in ones.
  verifyTokenLogsEmpty(tokenLogs);

  return resolvedSession;
}

// ─── Dynamic Currency Conversion ──────────────────────────────────────────────

export interface DccExpected {
  /**
   * The payer's currency, i.e. the card's — not the store's.
   *
   * Optional, because MPGS picks it and the same card is quoted differently per
   * path: GBP on hosted session, BRL on hosted checkout (see the discovery note).
   * Omit it to assert only that a conversion happened — some currency, differing
   * from the order's — and pin it only where the test means to.
   */
  payerCurrency?: string;
}

/**
 * Assert the three dcc_* meta keys DynamicCurrencyConversion::process_dcc_data
 * writes on an accepted offer.
 *
 * That method returns early unless uptake is exactly 'ACCEPTED' *and* all three
 * of payerExchangeRate / payerCurrency / payerAmount came back on the response
 * (DynamicCurrencyConversion.php:220-226), so absence is the correct assertion
 * for a declined offer — hence `expectAbsent`.
 */
export async function assertDccOrderMeta(
  orderNumber: string,
  config: PluginConfig,
  expected: DccExpected & { expectAbsent?: boolean },
): Promise<void> {
  const order = await getOrder(orderNumber);
  const rate = getOrderMeta(order, config.dccMetaKeys.exchangeRate);
  const currency = getOrderMeta(order, config.dccMetaKeys.currency);
  const amount = getOrderMeta(order, config.dccMetaKeys.amount);

  if (expected.expectAbsent) {
    expect(rate, 'dcc exchange rate should not be written for a declined offer').toBeFalsy();
    expect(currency, 'dcc currency should not be written for a declined offer').toBeFalsy();
    expect(amount, 'dcc amount should not be written for a declined offer').toBeFalsy();
    return;
  }

  expect(rate, 'dcc exchange rate meta missing').toBeTruthy();
  expect(Number(rate), 'dcc exchange rate should be numeric and non-zero').toBeGreaterThan(0);
  expect(currency, 'dcc currency meta missing').toBeTruthy();
  if (expected.payerCurrency) {
    expect(currency, 'dcc currency meta').toBe(expected.payerCurrency);
  } else {
    // Unpinned: any currency will do, as long as it is not the order's — the same
    // value would mean nothing was converted.
    expect(currency, 'payer currency should differ from the order currency')
      .not.toBe(order.currency);
  }
  expect(Number(amount), 'dcc converted amount should be numeric and non-zero').toBeGreaterThan(0);
  // The converted amount must differ from the order total — the same number means
  // the "conversion" did nothing and the assertions above would pass vacuously.
  expect(Number(amount), 'converted amount should differ from the order total')
    .not.toBe(Number(order.total));
}

/**
 * The "Paid Amount:" row render_dcc_data_receipt adds to the order totals table
 * on the order-received page and in My Account.
 *
 * It is a `woocommerce_get_order_item_totals` filter registered inside
 * init_dcc_hooks, so it renders wherever WooCommerce prints order totals.
 */
export async function assertDccReceiptRow(page: Page, expected: DccExpected): Promise<void> {
  const row = page.locator('tr:has-text("Paid Amount"), li:has-text("Paid Amount")').first();
  await expect(row, 'DCC "Paid Amount" row missing from the receipt').toBeVisible({ timeout: 15_000 });
  // The value is `wc_price(amount, currency) (CURRENCY)` — the code is in the
  // parenthetical, so the row text carries it.
  if (expected.payerCurrency) {
    await expect(row).toContainText(expected.payerCurrency);
  }
}

/**
 * The DCC panel render_dcc_data prints after the billing address on the admin
 * order screen. Asserts all five labels, since a partial render is the likely
 * failure and a single-label check would miss it.
 */
export async function assertDccAdminPanel(page: Page, expected: DccExpected): Promise<void> {
  const heading = page.locator('h4:has-text("Dynamic Currency Conversion")');
  await expect(heading, 'DCC admin panel heading missing').toBeVisible({ timeout: 15_000 });
  // The labels live in the <p> immediately after the heading. Scoped to that
  // sibling rather than the heading's parent, which is the whole order-data box.
  const panel = heading.locator('xpath=./following-sibling::p[1]');
  for (const label of [
    'Original Currency:',
    'Payment Currency:',
    'Original Amount:',
    'Paid Amount (Converted):',
    'Exchange Rate:',
  ]) {
    await expect(panel, `DCC panel missing "${label}"`).toContainText(label);
  }
  if (expected.payerCurrency) {
    await expect(panel).toContainText(expected.payerCurrency);
  }
}

/**
 * Assert the currencyConversion block our server declared to MPGS.
 *
 * maybe_add_dcc_payment_data attaches `currencyConversion: { requestId, uptake }`
 * to the payment data, and it is registered on two filters — the plain
 * hosted-session one and the 3DS one (DynamicCurrencyConversion.php:119-120).
 * Which request ends up carrying it therefore depends on the path:
 *
 *   3DS off  → the block rides on PAY (or AUTHORIZE).
 *   3DS on   → the block rides on INITIATE_AUTHENTICATION, and the later PAY has
 *              none. Confirmed live on order 6317, 2026-08-19: the conversion is
 *              declared once, MPGS applies it to the session, and the PAY
 *              response still came back converted — the order carries
 *              dcc_currency=MXN, dcc_amount=762.67, matching the offer.
 *
 * So this looks for whichever operation declared it rather than pinning PAY,
 * which would fail on every 3DS case for a reason that has nothing to do with
 * DCC. `assertDccOrderMeta` is the outcome check either way.
 *
 * uptake is 'ACCEPTED' for Accept, 'DECLINED' for anything else answered, and
 * 'NOT_AVAILABLE' when the offer was the hidden `Unavailable` shape or no offer
 * state was posted at all (DynamicCurrencyConversion.php:195-205).
 */
export async function assertDccUptakeLog(expected: {
  payDate: string;
  logOffset: number;
  transactionId: string;
  uptake: 'ACCEPTED' | 'DECLINED' | 'NOT_AVAILABLE';
}): Promise<void> {
  const allLogs = await getLogs(expected.payDate, '', expected.logOffset);
  expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
  const content: LogEntry[] = allLogs.logs[0].content;

  const declaringOps = ['PAY', 'AUTHORIZE', 'INITIATE_AUTHENTICATION'];
  const forThisOrder = content.filter(
    (l: LogEntry) => l.request?.url?.includes(expected.transactionId)
      && declaringOps.includes(l.request?.body?.apiOperation),
  );
  expect(
    forThisOrder.length,
    'no PAY / AUTHORIZE / INITIATE_AUTHENTICATION log found for the DCC order',
  ).toBeGreaterThan(0);

  const declaring = forThisOrder.find((l: LogEntry) => l.request?.body?.currencyConversion);
  const conversion = declaring?.request?.body?.currencyConversion;
  expect(
    conversion,
    'no currencyConversion block on any of '
      + forThisOrder.map((l) => l.request?.body?.apiOperation).join(', '),
  ).toBeTruthy();
  expect(conversion?.requestId, 'currencyConversion should carry the quote requestId').toBeTruthy();
  expect(
    conversion?.uptake,
    `${declaring?.request?.body?.apiOperation} should carry uptake=${expected.uptake}`,
  ).toBe(expected.uptake);
}

/**
 * Assert the server-side PAYMENT_OPTIONS_INQUIRY quote call.
 *
 * SAVED-TOKEN PATH ONLY. For an entered card the quote never reaches our log:
 * `_hostedSessions.js` posts PAYMENT_OPTIONS_INQUIRY from the browser straight to
 * MPGS (`dccRequestEndpoint` is `api()->get_domain() . 'paymentOptionsInquiry'`,
 * authenticated with the session id), so nothing passes through WordPress to be
 * logged. Only `ajax_dcc_quote` — the saved-token handler — inquires server-side
 * via `api()->payment_options_inquiry()`.
 *
 * Asserting this on an entered-card case would fail for a reason that has nothing
 * to do with DCC being broken. Use assertDccUptakeLog for those.
 */
export async function assertDccQuoteInquiryLog(expected: {
  payDate: string;
  logOffset: number;
}): Promise<void> {
  const allLogs = await getLogs(expected.payDate, '', expected.logOffset);
  expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
  const content: LogEntry[] = allLogs.logs[0].content;

  const inquiry = content.find(
    (l: LogEntry) => l.request?.body?.apiOperation === 'PAYMENT_OPTIONS_INQUIRY',
  );
  expect(
    inquiry,
    'PAYMENT_OPTIONS_INQUIRY log not found. This assertion only holds for the '
    + 'saved-token path; an entered card quotes browser-to-MPGS and is never logged.',
  ).toBeTruthy();
  expect(inquiry!.response?.body?.result, 'quote inquiry should succeed').toBe('SUCCESS');
  expect(
    inquiry!.response?.body?.paymentTypes?.card?.currencyConversion?.requestId,
    'quote response should carry a currencyConversion requestId',
  ).toBeTruthy();
}
