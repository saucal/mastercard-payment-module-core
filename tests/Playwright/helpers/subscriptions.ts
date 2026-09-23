/**
 * WooCommerce Subscriptions primitives for suites 16-18.
 *
 * A subscription is a stored-credential flow: the first payment is
 * cardholder-initiated and opens a RECURRING agreement, and every renewal is a
 * merchant-initiated charge against it with no payer present. The generic
 * agreement and merchant-initiated assertions live in assertions.ts; this holds
 * what only subscriptions need.
 */

import { Page, expect } from '@playwright/test';
import type { PluginConfig, CardData } from '../plugin-config.types';
import { getProduct, getOrder, getLogs, getLogEntryCount, type LogEntry } from './wc-api';
import {
  assertAgreementLog,
  assertMerchantInitiatedPaymentLog,
  assertCaptureLogTrail,
  verifySubscription,
} from './assertions';
import { triggerSubscriptionRenewal, extractRenewalOrderNumber } from './admin-orders';
import { checkoutHostedSession, assertOrderComplete, type CheckoutContext } from './flows';
import { billing, uniqueEmail } from '../fixtures/billing';

/** The agreement id the gateway plugin derives from a subscription. */
export function subscriptionAgreementId(slug: string, subscriptionId: string): string {
  return `${slug}_subscription-order-${subscriptionId}`;
}

/**
 * Fail unless the product is a WooCommerce subscription.
 *
 * Same reason as assertPreOrderProduct: an ordinary product checks out through
 * every step of these suites, and every subscription-specific assertion would
 * then fail for a confusing reason — or, worse, the renewal tests would skip
 * their way to green.
 */
export async function assertSubscriptionProduct(productId: number): Promise<void> {
  expect(productId, 'subscription product id must be configured').toBeGreaterThan(0);
  const product = await getProduct(productId);
  expect(product.type, `product ${productId} is not a subscription`).toBe('subscription');
}

/**
 * Process a renewal from the subscription's admin screen and return the renewal
 * order number. The renewal charges the stored card through
 * `woocommerce_scheduled_subscription_payment_<gateway>`.
 */
export async function renewSubscription(adminPage: Page, subscriptionId: string): Promise<string> {
  await triggerSubscriptionRenewal(adminPage, subscriptionId);
  const renewalOrderNumber = await extractRenewalOrderNumber(adminPage);
  expect(renewalOrderNumber, 'no renewal order was created').toBeTruthy();
  return renewalOrderNumber;
}

/**
 * Assert the RECURRING agreement a subscription's first payment opened, and that
 * each operation carries the fields the gateway requires of it.
 *
 * The split is the point. AUTHENTICATE_PAYER establishes the agreement and is
 * rejected without an expiry and a minimum gap between payments ("must provide
 * recurring expiry and recurring frequency"). The PAY must not invent them for
 * a subscription that runs until cancelled — Mastercard Gateway Support: such
 * agreements "should not" provide expiryDate or numberOfPayments. So the two
 * operations disagree on purpose.
 *
 * `expect3DS: false` for a gateway running with 3DS off, where there is no
 * AUTHENTICATE_PAYER to check.
 */
export async function assertSubscriptionAgreement(expected: {
  payDate: string;
  logOffset: number;
  transactionId: string;
  subscriptionId: string;
  slug: string;
  paymentFrequency: string;
  expect3DS?: boolean;
}): Promise<void> {
  const agreementId = subscriptionAgreementId(expected.slug, expected.subscriptionId);

  await assertAgreementLog({
    payDate: expected.payDate,
    logOffset: expected.logOffset,
    transactionId: expected.transactionId,
    apiOperation: 'PAY',
    agreementId,
    agreementType: 'RECURRING',
  });

  const content: LogEntry[] = (await getLogs(expected.payDate, '', expected.logOffset)).logs[0]?.content ?? [];
  const forAgreement = (op: string) => content.find(
    (l: LogEntry) => l.request?.body?.apiOperation === op && l.request?.body?.agreement?.id === agreementId,
  );

  const pay = forAgreement('PAY')!.request.body.agreement!;
  expect(pay.amountVariability).toBe('FIXED');
  expect(pay.paymentFrequency).toBe(expected.paymentFrequency);
  expect(pay.expiryDate, 'PAY must not invent an expiry for an open-ended subscription').toBeUndefined();
  expect(pay.numberOfPayments, 'PAY must not declare a payment count').toBeUndefined();
  expect(pay.minimumDaysBetweenPayments, 'PAY carries only what identifies the agreement').toBeUndefined();

  if (expected.expect3DS ?? true) {
    const auth = forAgreement('AUTHENTICATE_PAYER');
    expect(auth, 'AUTHENTICATE_PAYER carrying the agreement not found').toBeTruthy();
    expect(auth!.request.body.agreement!.expiryDate, 'AUTHENTICATE_PAYER is rejected without an expiry').toBeTruthy();
    // max(1) in the plugin: a 0 is dropped by array_filter() and rejected as missing.
    expect(auth!.request.body.agreement!.minimumDaysBetweenPayments ?? 0).toBeGreaterThanOrEqual(1);
  }
}

/**
 * Renew a subscription and assert the renewal was charged as a
 * merchant-initiated payment. Returns the renewal order number.
 *
 * A renewal order existing proves nothing: WooCommerce creates it before the
 * charge is attempted, so a failed charge still leaves one behind. What counts
 * is the gateway approving a MERCHANT-source PAY against the stored card, and
 * granting it the RECURRING_PAYMENT exemption — no payer is present to
 * authenticate, so without that exemption it would be sent for 3DS and decline.
 *
 * `ctx` is the checkout that opened the subscription: its gateway order is what
 * the renewal must reference.
 */
export async function assertSubscriptionRenews(
  adminPage: Page,
  config: PluginConfig,
  ctx: CheckoutContext,
): Promise<string> {
  expect(ctx.subscriptionId, 'the checkout did not produce a subscription').toBeTruthy();

  // A fresh window: the renewal is charged now, not during the checkout.
  const payDate = new Date().toISOString().slice(0, 19);
  const logOffset = await getLogEntryCount(payDate);

  const renewalOrderNumber = await renewSubscription(adminPage, ctx.subscriptionId!);
  const renewal = await getOrder(renewalOrderNumber);
  expect(renewal.date_paid, 'the renewal order was not paid').toBeTruthy();

  await assertMerchantInitiatedPaymentLog({
    payDate,
    logOffset,
    orderNumber: renewalOrderNumber,
    // The renewal order's own total: it can differ from the checkout's, which
    // may include one-off shipping or a sign-up fee.
    amount: String(renewal.total),
    agreementId: subscriptionAgreementId(config.paymentMethodSlug, ctx.subscriptionId!),
    agreementType: 'RECURRING',
    referenceOrderId: ctx.transactionId,
    exemption: 'RECURRING_PAYMENT',
  });

  return renewalOrderNumber;
}

/** A subscription checkout, and the buyer account it created. */
export interface SubscriptionCheckout {
  ctx: CheckoutContext;
  email: string;
  password: string;
}

/**
 * Buy the subscription product through hosted session and assert everything
 * about the checkout that opened it — the block every case in suites 16-18
 * starts with. The checkout mode is the caller's: switch it first.
 *
 * Subscriptions makes the account mandatory, so each call mints its own
 * address; a fixed one fails its second run on "An account is already
 * registered with your email address".
 */
export async function checkoutSubscription(
  pages: { page: Page; adminPage: Page; emailPage: Page },
  config: PluginConfig,
  opts: { card: CardData; threeDS: 'always' | 'never' },
): Promise<SubscriptionCheckout> {
  const email = uniqueEmail();
  const password = billing.password;

  const ctx = await checkoutHostedSession(pages.page, config, {
    productId: config.products.subscription,
    card: opts.card,
    billing: { ...billing, email },
    createAccount: password,
    threeDS: opts.threeDS,
  });
  expect(ctx.subscriptionId, 'subscription id should be on the order-received page').toBeTruthy();

  // expectToken: a subscription stores the card whatever the checkbox says —
  // there is nothing to renew against otherwise.
  await assertCaptureLogTrail({
    ...ctx,
    expectSessionPost: true, expectToken: true, expectCardDetailsFetch: true,
    authStatus: 'AUTHENTICATION_SUCCESSFUL',
  });
  await assertSubscriptionAgreement({
    ...ctx,
    subscriptionId: ctx.subscriptionId!,
    slug: config.paymentMethodSlug,
    paymentFrequency: 'MONTHLY',
  });

  await assertOrderComplete(ctx, config, pages, {
    status: 'Processing',
    note: 'captured',
    myAccount: { email, password },
  });
  // assertOrderComplete left the buyer logged in on `page`.
  await verifySubscription(pages.page, ctx.subscriptionId!, {
    expectedStatus: 'Active',
    displayName: config.displayName,
  });

  return { ctx, email, password };
}
