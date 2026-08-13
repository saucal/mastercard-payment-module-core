import { Page, expect, test } from '@playwright/test';
import type { PluginConfig, BillingData, CardData } from '../plugin-config.types';
import { addToCartAndCheckout } from './cart';
import {
  fillBilling,
  createAccountAtCheckout,
  selectPaymentMethod,
  selectSavedToken,
  clickSaveCardCheckbox,
  extractOrderTotal,
  extractSessionId,
  clickPlaceOrder,
} from './checkout';
import { fillHostedSessionCC } from './hosted-session';
import { handle3DSChallenge } from './three-ds';
import { frontendLogin } from './wp-login';
import { getLogEntryCount, verifyOrderViaAPI } from './wc-api';
import {
  assertOrderReceived,
  verifyCartEmpty,
  assertOrderStatus,
  assertPaymentMethodMeta,
  assertCapturedNote,
  assertAuthorizedNote,
  verifyOrderEmails,
  verifyAdminEmail,
  verifyPaymentMethods,
  verifyOrderInMyAccount,
} from './assertions';
import { navigateToOrder } from './admin-orders';
import { answerDccOffer, requireDccOffer, type DccChoice } from './dcc';
import { logOrderContext } from './debug';
import { billing as defaultBilling } from '../fixtures/billing';
import { fourDigits } from '../fixtures/cards';

export interface OrderReceivedData {
  orderNumber: string;
  subscriptionId?: string;
  declined: boolean;
}

/**
 * Read the order-received page's data without asserting anything. Pass the
 * result to assertions.assertOrderReceived(), which owns the checks — including
 * the subscription-id invariant, which is why the data is returned rather than
 * validated here.
 */
export async function collectOrderReceivedData(page: Page): Promise<OrderReceivedData> {
  await page.waitForLoadState('load');

  const declined = await page.locator('.woocommerce-error').isVisible().catch(() => false);
  if (declined) {
    return { orderNumber: '', declined: true };
  }

  // The previous single-function verifyOrderReceived() got its wait for free
  // from an auto-retrying expect() on the page title, which ran before this
  // read. Without that, reading the order number races the confirmation page's
  // render — so wait for the element explicitly.
  const orderLocator = page
    .locator('.order > strong, li:has-text("Order number") > strong')
    .first();
  await orderLocator.waitFor({ state: 'visible', timeout: 30000 });
  const orderNumber = (await orderLocator.textContent() || '').trim();

  let subscriptionId: string | undefined;
  const subLink = page.locator('td.subscription-id > a');
  if (await subLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    subscriptionId = (await subLink.textContent() || '').trim();
  }

  return { orderNumber, subscriptionId, declined: false };
}

// ─── Checkout orchestration ───────────────────────────────────────────────────

/**
 * Everything a downstream assertion needs about one completed checkout.
 *
 * Field names match `CaptureLogTrailExpected` in assertions.ts on purpose: a
 * spec spreads this straight into assertCaptureLogTrail and adds only the three
 * expect* booleans. Renaming a field here breaks that, so don't.
 */
export interface CheckoutContext {
  orderNumber: string;
  subscriptionId?: string;
  transactionId: string;
  /** Raw WC REST order object, for assertions needing more than the id. */
  order: any;
  session: string;
  total: string;
  payDate: string;
  logOffset: number;
  card: CardData;
}

export interface HostedSessionCheckoutOptions {
  productId: number;
  /**
   * Always required. On the saved-token path the card is not typed in, but the
   * log assertions still match against the card the token represents — so pass
   * the card that was originally saved.
   */
  card: CardData;
  /** Defaults to the shared `billing` fixture. Override to vary the email. */
  billing?: BillingData;
  /** Log in before adding to cart. */
  loginAs?: { email: string; password: string };
  /** Tick "create an account" at checkout with this password. */
  createAccount?: string;
  /** Tick "save payment method". */
  saveCard?: boolean;
  /** 1-based index into the saved-token list. Skips card entry when set. */
  savedTokenIndex?: number;
  /** Force the "use a new card" radio even when saved tokens exist. */
  useNewToken?: boolean;
  /**
   * 'always' waits for the ACS prompt unconditionally; 'maybe' handles it only
   * if the browser actually landed on one (a saved challenge token may or may
   * not re-challenge, per issuer); 'never' skips it.
   */
  threeDS?: 'always' | 'maybe' | 'never';
  /** Assert the save-card checkbox is NOT rendered (guest checkout). */
  expectNoSaveCardCheckbox?: boolean;
  /**
   * Which side of a DCC offer to take, if one appears. Defaults to 'reject', so
   * a checkout is not derailed by an offer it did not ask for. Only cards whose
   * issuing currency differs from the order currency draw one.
   */
  dccChoice?: DccChoice;
  /**
   * Require a DCC offer and fail if none arrives. The DCC suite sets this — the
   * offer is what it is testing. Capture suites leave it off, where an offer is
   * incidental and its absence is not a failure.
   */
  requireDccOffer?: boolean;
}

/**
 * Drive a hosted-session checkout end to end and return what the assertion layer
 * needs. Replaces the ~40-line block that was pasted into every test case.
 *
 * Asserts the order-received page and an empty cart, because both are
 * invariants of "the checkout succeeded" rather than per-suite choices.
 * Everything else — log trails, emails, admin screens — is the caller's job,
 * via assertOrderComplete and the assert*LogTrail composites.
 */
export async function checkoutHostedSession(
  page: Page,
  config: PluginConfig,
  opts: HostedSessionCheckoutOptions,
): Promise<CheckoutContext> {
  if (opts.loginAs) {
    await frontendLogin(page, opts.loginAs.email, opts.loginAs.password);
  }

  const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
  const payDate = await addToCartAndCheckout(page, opts.productId);

  // A logged-in returning customer already has billing pre-filled and shows no
  // account checkbox, so only fill when there is a reason to.
  if (!opts.loginAs || opts.billing) {
    await fillBilling(page, opts.billing ?? defaultBilling);
  }
  if (opts.createAccount) {
    await createAccountAtCheckout(page, opts.createAccount);
  }

  await selectPaymentMethod(page, config, opts.useNewToken ?? false);

  if (opts.savedTokenIndex !== undefined) {
    await selectSavedToken(page, opts.savedTokenIndex);
  } else {
    await fillHostedSessionCC(page, opts.card, config);
  }

  if (opts.expectNoSaveCardCheckbox) {
    await expect(
      page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`),
    ).not.toBeVisible();
  }
  if (opts.saveCard) {
    await clickSaveCardCheckbox(page);
  }

  // Answer any DCC offer before reading the total: accepting one changes what the
  // payer is charged, and an unanswered offer blocks place-order outright.
  if (opts.requireDccOffer) {
    await requireDccOffer(page, config);
    const answered = await answerDccOffer(page, config, opts.dccChoice ?? 'reject');
    expect(answered, 'a required DCC offer was present but could not be answered').toBe(true);
  } else {
    await answerDccOffer(page, config, opts.dccChoice ?? 'reject');
  }

  const total = await extractOrderTotal(page);
  const session = await extractSessionId(page);

  await clickPlaceOrder(page);

  const threeDS = opts.threeDS ?? 'never';
  if (threeDS === 'always') {
    await handle3DSChallenge(page);
  } else if (threeDS === 'maybe' && /acs|3ds|threedsecure|mastercard\.com.*prompt/i.test(page.url())) {
    await handle3DSChallenge(page);
  }

  const received = await collectOrderReceivedData(page);
  await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, received);
  expect(received.orderNumber, 'order number should be present on order-received').toBeTruthy();
  await verifyCartEmpty(page);

  const { order, transactionId } = await verifyOrderViaAPI(received.orderNumber, config);
  expect(order.payment_method).toBe(config.paymentMethodSlug);
  expect(order.payment_method_title).toBe(config.displayName);
  expect(transactionId, 'gateway transaction id should be on the order').toBeTruthy();

  const ctx: CheckoutContext = {
    orderNumber: received.orderNumber,
    subscriptionId: received.subscriptionId,
    transactionId: transactionId!,
    order,
    session,
    total,
    payDate,
    logOffset,
    card: opts.card,
  };

  await logOrderContext(test.info().title, {
    orderNumber: ctx.orderNumber,
    transactionId: ctx.transactionId,
    session: ctx.session,
    total: ctx.total,
    payDate: ctx.payDate,
    logOffset: ctx.logOffset,
    card: `${opts.card.name} ****${fourDigits(opts.card)}`,
  });

  return ctx;
}

// ─── Post-checkout verification ───────────────────────────────────────────────

export interface OrderCompleteOptions {
  /** Admin order-screen status, e.g. 'Processing', 'On hold', 'Completed'. */
  status: string;
  /** Which gateway order note to require. 'none' for flows that add neither. */
  note: 'captured' | 'authorized' | 'none';
  /** 'both' = admin + customer, 'admin' = admin only, 'none'. Default 'both'. */
  emails?: 'both' | 'admin' | 'none';
  /**
   * When set, logs the buyer in and checks My Account. Field names mirror
   * verifyPaymentMethods' own options, so they pass straight through.
   */
  myAccount?: {
    email: string;
    password: string;
    expectedCards: number;
    cardName?: string;
    fourDigits?: string;
    expiryMonth?: string;
    expiryYear?: string;
    cards?: Array<{ cardName: string; fourDigits: string; expiryMonth?: string; expiryYear?: string }>;
  };
}

/**
 * The email + admin-order + My Account verification block that followed every
 * checkout in suites 01-15.
 *
 * Log-trail assertions are deliberately NOT here: which trail applies is the one
 * thing that genuinely varies per suite, so the spec calls
 * assertCaptureLogTrail / assertAuthorizeLogTrail / assertHostedCheckoutLogTrail
 * itself, between checkoutHostedSession and this.
 */
export async function assertOrderComplete(
  ctx: CheckoutContext,
  config: PluginConfig,
  pages: { page: Page; adminPage: Page; emailPage: Page },
  opts: OrderCompleteOptions,
): Promise<void> {
  const emails = opts.emails ?? 'both';
  if (emails === 'both') {
    await verifyOrderEmails(ctx.orderNumber, { paymentMethodTitle: config.displayName, page: pages.emailPage });
  } else if (emails === 'admin') {
    await verifyAdminEmail(ctx.orderNumber, { paymentMethodTitle: config.displayName, page: pages.emailPage });
  }

  await navigateToOrder(pages.adminPage, ctx.orderNumber);
  await assertOrderStatus(pages.adminPage, opts.status);
  await assertPaymentMethodMeta(pages.adminPage, config, ctx.transactionId);
  if (opts.note === 'captured') {
    await assertCapturedNote(pages.adminPage, config, ctx.transactionId);
  } else if (opts.note === 'authorized') {
    await assertAuthorizedNote(pages.adminPage, config, ctx.transactionId);
  }

  if (opts.myAccount) {
    const { email, password, ...cardExpectations } = opts.myAccount;
    await frontendLogin(pages.page, email, password);
    await verifyPaymentMethods(pages.page, cardExpectations);
    await verifyOrderInMyAccount(pages.page, ctx.orderNumber, opts.status, {
      expectedTotal: ctx.total,
      displayName: config.displayName,
    });
  }
}
