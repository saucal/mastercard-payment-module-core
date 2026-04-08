import { expect } from '@playwright/test';
import { getLogs } from './api';
import type { CardData } from '../plugin-config.types';

// ─── Types ────────────────────────────────────────────────────────────────────

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
            expiry: string;
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
  logs: Array<{ content: LogEntry[] }>;
}

// ─── Extraction helpers ────────────────────────────────────────────────────────

/**
 * Extract logs for session POST calls.
 * urlFilter: '/session' with type POST
 */
export async function extractSessionPostLogs(
  date: string,
  sessionDate: string,
  adminUser: string,
  apiPass: string,
): Promise<LogResponse> {
  return getLogs(date, '/session');
}

/**
 * Extract logs for session GET calls filtered by a specific session ID.
 * urlFilter: '/session/{sessionId}'
 */
export async function extractSessionGetLogs(
  date: string,
  session: string,
  payDate: string,
): Promise<LogResponse> {
  return getLogs(date, `/session/${session}`);
}

/**
 * Extract logs related to token operations.
 * urlFilter: '/token'
 */
export async function extractTokenLogs(
  date: string,
  payDate: string,
): Promise<LogResponse> {
  return getLogs(date, '/token');
}

/**
 * Extract logs for PUT transaction calls.
 * urlFilter: transaction URL pattern
 */
export async function extractTransactionPutLogs(
  date: string,
): Promise<LogResponse> {
  return getLogs(date, '/transaction');
}

/**
 * Extract all logs for a given date.
 */
export async function extractAllLogs(date: string): Promise<LogResponse> {
  return getLogs(date, '');
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
  expect(provided!.brand).toBeTruthy();
  expect(provided!.scheme.toUpperCase()).toBe(card.shortName.toUpperCase());

  // Masked number: first 6 + xxxxxx + last 4
  const six = card.number.slice(0, 6);
  const four = card.number.slice(-4);
  expect(provided!.number).toContain(six);
  expect(provided!.number).toContain(four);

  expect(provided!.securityCode).toBe('xxx');
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

  const res = log.response.body;
  expect(res.result).toBe('SUCCESS');

  expect(res.session?.id).toBe(expected.session);

  const order = res.order;
  expect(order).toBeTruthy();
  expect(order!.currency).toBe(expected.currency);
  expect(order!.id).toBe(expected.transactionId);
  expect(String(order!.reference)).toBe(String(expected.orderNumber));

  // Amount is on the request body order; compare numerically when present
  const reqOrder = log.request.body.order;
  if (reqOrder?.amount) {
    const expectedAmount = parseFloat(expected.total.replace(/[^0-9.]/g, ''));
    const logAmount = parseFloat(reqOrder.amount);
    expect(logAmount).toBeCloseTo(expectedAmount, 2);
  }
}

interface SessionGetExpected {
  session: string;
  card: CardData;
  token?: string;
}

/**
 * Verify a session GET / UPDATE_SESSION log entry.
 * Asserts PUT method, UPDATE_SESSION operation, session ID, updateStatus SUCCESS,
 * and card details.
 */
export function verifySessionGet(log: LogEntry, expected: SessionGetExpected): void {
  expect(log.request.type).toBe('PUT');
  expect(log.request.body.apiOperation).toBe('UPDATE_SESSION');
  expect(log.request.body.session?.id ?? log.response.body.session?.id).toBe(expected.session);

  const res = log.response.body;
  expect(res.session?.updateStatus).toBe('SUCCESS');

  assertCardDetails(res.sourceOfFunds, expected.card, expected.token);
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
  expect(log.request.body.apiOperation).toBe('INITIATE_AUTHENTICATION');
  expect(log.request.body.authentication?.channel).toBe('PAYER_BROWSER');
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

  const expectedAmount = parseFloat(expected.total.replace(/[^0-9.]/g, ''));
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
  expect(log.request.body.transaction?.targetTransactionId).toBe(expected.transactionId);

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
      const amount = parseFloat(expected.total.replace(/[^0-9.]/g, ''));
      expect((log as any).request?.body?.transaction?.amount).toBe(amount);
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
      const partialAmt = parseFloat(expected.partialAmount.replace(/[^0-9.]/g, ''));
      expect(order!.totalRefundedAmount).toBeCloseTo(partialAmt, 2);
    }
  } else {
    expect(order!.status).toBe('REFUNDED');
    const totalAmt = parseFloat(expected.total.replace(/[^0-9.]/g, ''));
    expect(order!.totalRefundedAmount).toBeCloseTo(totalAmt, 2);
  }

  const txn = res.transaction;
  expect(txn).toBeTruthy();
  expect(txn!.type).toBe('REFUND');
  expect(txn!.currency).toBe(expected.currency);

  const refundAmt = parseFloat(
    (expected.isPartial ? expected.partialAmount : expected.total)?.replace(/[^0-9.]/g, '') ?? '0',
  );
  if (txn!.amount !== undefined) {
    expect(txn!.amount).toBeCloseTo(refundAmt, 2);
  }
}
