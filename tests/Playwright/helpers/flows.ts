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
import {
  clickPlaceOrderHostedCheckout,
  fillHostedCheckoutCC,
  clickHostedCheckoutPay,
  type HostedCheckoutMode,
} from './hosted-checkout';
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

/** Pay-for-order entry, shared by both orchestrators. Returns the pay date. */
async function gotoPayForOrder(page: Page, url: string): Promise<string> {
  await page.goto(url);
  await page.waitForLoadState('load');
  // Where we ended up matters more than where we aimed: an unroutable pay URL
  // lands on a 404 or redirects to my-account, and the next failure would be
  // the generic "Could not detect checkout mode".
  await logOrderContext('order-pay page', {
    requested: url,
    landedOn: page.url(),
    title: await page.title(),
    hasClassicForm: await page.locator('form.woocommerce-checkout').count(),
    hasOrderReviewForm: await page.locator('form#order_review').count(),
    hasBlocksCheckout: await page.locator('.wp-block-woocommerce-checkout').count(),
  });
  return new Date().toISOString().slice(0, 19);
}

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
  /**
   * The order-received URL, kept because the flow leaves that page — verifyCartEmpty
   * navigates to the cart. Anything asserting on the receipt itself (the DCC
   * "Paid Amount:" row) has to come back here. The key is in the query string, so
   * it re-opens for a guest too.
   */
  orderReceivedUrl: string;
}

export interface HostedSessionCheckoutOptions {
  /** Cart entry. Omit only when passing payForOrder. */
  productId?: number;
  /**
   * Pay-for-order entry (suite 12): skip the cart and drive an existing pending
   * order's pay page. `total` defaults to the REST order's own total, which is
   * where the pay-for-order cases read it from — the order-pay page does not
   * reliably render a row extractOrderTotal can scrape.
   */
  payForOrder?: { url: string; total?: string };
  /**
   * Always required. On the saved-token path the card is not typed in, but the
   * log assertions still match against the card the token represents — so pass
   * the card that was originally saved.
   */
  card: CardData;
  /**
   * Defaults to the shared `billing` fixture. Setting this also FORCES the
   * billing form to be filled, which matters when combined with `loginAs`:
   * without it a logged-in buyer's fields are left alone, on the assumption the
   * account already has an address. That assumption holds for accounts created
   * at checkout, but NOT for ones made with `registerUser`, which saves no
   * address — those check out into "Billing First name is a required field".
   */
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

  expect(
    (opts.productId === undefined) !== (opts.payForOrder === undefined),
    'pass exactly one of productId or payForOrder',
  ).toBe(true);

  const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));

  let payDate: string;
  if (opts.payForOrder) {
    payDate = await gotoPayForOrder(page, opts.payForOrder.url);
  } else {
    payDate = await addToCartAndCheckout(page, opts.productId!);

    // A logged-in returning customer already has billing pre-filled and shows no
    // account checkbox, so only fill when there is a reason to.
    if (!opts.loginAs || opts.billing) {
      await fillBilling(page, opts.billing ?? defaultBilling);
    }
    if (opts.createAccount) {
      await createAccountAtCheckout(page, opts.createAccount);
    }
  }

  await selectPaymentMethod(page, config, opts.useNewToken ?? false);

  if (opts.savedTokenIndex !== undefined) {
    await selectSavedToken(page, opts.savedTokenIndex);
  } else {
    await fillHostedSessionCC(page, opts.card, config);
  }

  if (opts.expectNoSaveCardCheckbox) {
    // Scoped to OUR gateway's label, deliberately. Suite 11 also carried a bare
    // `text=Save to account` check; hoisting it here broke suite 01, because
    // that wording is not ours — every gateway on the checkout renders the same
    // label, so it matched PayPal's too and died on a strict-mode violation.
    // This locator says the same thing about the only gateway under test.
    await expect(
      page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`),
      'save-card label should not render',
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

  // The order-pay page has no scrapeable total; it comes off the REST order below.
  const pageTotal = opts.payForOrder ? '' : await extractOrderTotal(page);
  const session = await extractSessionId(page);

  // Saved-token checkouts are the case where blocks can leave the submit button
  // stuck disabled; see clickPlaceOrder's own note.
  await clickPlaceOrder(page, { force: opts.savedTokenIndex !== undefined });

  const threeDS = opts.threeDS ?? 'never';
  if (threeDS === 'always') {
    await handle3DSChallenge(page);
  } else if (threeDS === 'maybe' && /acs|3ds|threedsecure|mastercard\.com.*prompt/i.test(page.url())) {
    await handle3DSChallenge(page);
  }

  const received = await collectOrderReceivedData(page);
  // Skip the total on the pay-for-order path: REST returns "10.00" while the
  // order-received page may render locale-formatted "10,00 $".
  await assertOrderReceived(
    page,
    { displayName: config.displayName, expectedTotal: opts.payForOrder ? undefined : pageTotal },
    received,
  );
  expect(received.orderNumber, 'order number should be present on order-received').toBeTruthy();
  const orderReceivedUrl = page.url();
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
    orderReceivedUrl,
    total: opts.payForOrder ? (opts.payForOrder.total ?? String(order.total)) : pageTotal,
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

export interface HostedCheckoutOptions {
  /** 'embedded' keeps MPGS in an iframe; 'redirect' navigates the buyer away. */
  hostedMode: HostedCheckoutMode;
  card: CardData;
  /** Cart entry: add this product, then check out. Mutually exclusive with payForOrder. */
  productId?: number;
  /**
   * Pay-for-order entry (MC-011): go straight to a pending order's pay URL. The
   * total is passed in from the REST response rather than scraped, because the
   * order-pay page does not reliably render a row extractOrderTotal can read.
   */
  payForOrder?: { url: string; total: string };
  billing?: BillingData;
  loginAs?: { email: string; password: string };
  createAccount?: string;
  /**
   * Which side of MPGS's own conversion offer to take. Defaults to 'reject', so a
   * checkout is not derailed by an offer it did not ask for.
   *
   * This offer is NOT the plugin's: init_addon_dcc returns at the
   * is_hosted_checkout() guard, so the `currency_conversion` setting has no
   * bearing on it. It comes from the MPGS merchant profile and renders on MPGS's
   * own page.
   */
  dccChoice?: DccChoice;
  /** Require MPGS to offer a conversion, and fail if it does not. */
  requireDccOffer?: boolean;
}

/**
 * Drive a hosted-checkout (embedded or redirect) checkout end to end.
 *
 * The sibling of checkoutHostedSession, and separate from it on purpose: MPGS
 * owns the whole payment UI here, so there are no card fields, no saved tokens
 * and no save-card checkbox on our side — the options that dominate the
 * hosted-session flow are all meaningless in this one.
 */
export async function checkoutHostedCheckout(
  page: Page,
  config: PluginConfig,
  opts: HostedCheckoutOptions,
): Promise<CheckoutContext> {
  expect(
    (opts.productId === undefined) !== (opts.payForOrder === undefined),
    'pass exactly one of productId or payForOrder',
  ).toBe(true);

  if (opts.loginAs) {
    await frontendLogin(page, opts.loginAs.email, opts.loginAs.password);
  }

  const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));

  let payDate: string;
  let total: string;

  if (opts.payForOrder) {
    payDate = await gotoPayForOrder(page, opts.payForOrder.url);
    total = opts.payForOrder.total;
  } else {
    payDate = await addToCartAndCheckout(page, opts.productId!);
    if (!opts.loginAs || opts.billing) {
      await fillBilling(page, opts.billing ?? defaultBilling);
    }
    if (opts.createAccount) {
      await createAccountAtCheckout(page, opts.createAccount);
    }
  }

  await selectPaymentMethod(page, config);
  if (!opts.payForOrder) {
    total = await extractOrderTotal(page);
  }

  await clickPlaceOrderHostedCheckout(page, config, opts.hostedMode);
  await fillHostedCheckoutCC(page, opts.card, config, opts.hostedMode);
  await clickHostedCheckoutPay(
    page,
    config,
    opts.hostedMode,
    opts.dccChoice ?? 'reject',
    opts.requireDccOffer ?? false,
  );

  if (opts.card.challenge) {
    await handle3DSChallenge(page);
  }

  const received = await collectOrderReceivedData(page);
  // Skip the total on the pay-for-order path: REST returns "10.00" while the
  // order-received page may render locale-formatted "10,00 $". The REST check
  // below re-confirms the amount anyway.
  await assertOrderReceived(
    page,
    { displayName: config.displayName, expectedTotal: opts.payForOrder ? undefined : total! },
    received,
  );
  expect(received.orderNumber, 'order number should be present on order-received').toBeTruthy();
  const orderReceivedUrl = page.url();
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
    orderReceivedUrl,
    // Hosted checkout never exposes the session to the page; the log-trail
    // composite discovers it from INITIATE_CHECKOUT and returns it.
    session: '',
    total: total!,
    payDate,
    logOffset,
    card: opts.card,
  };

  await logOrderContext(test.info().title, {
    orderNumber: ctx.orderNumber,
    transactionId: ctx.transactionId,
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
    /**
     * Omit to check only the order, not the saved-cards list. Hosted checkout
     * (suites 03-05) never tokenizes on our side, and those suites accordingly
     * never asserted a card count — adding one here would be inventing coverage.
     */
    expectedCards?: number;
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
    if (cardExpectations.expectedCards !== undefined) {
      await verifyPaymentMethods(pages.page, { ...cardExpectations, expectedCards: cardExpectations.expectedCards });
    }
    await verifyOrderInMyAccount(pages.page, ctx.orderNumber, opts.status, {
      expectedTotal: ctx.total,
      displayName: config.displayName,
    });
  }
}
