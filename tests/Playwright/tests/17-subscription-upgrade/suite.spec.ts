import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway, getLogs, type LogEntry } from '../../helpers/wc-api';
import { frontendLogin } from '../../helpers/wp-login';
import { checkoutHostedSession, type CheckoutContext } from '../../helpers/flows';
import { assertCaptureLogTrail, assertAgreementLog, verifySubscription } from '../../helpers/assertions';
import {
  assertSubscriptionProduct,
  checkoutSubscription,
  assertSubscriptionRenews,
  subscriptionAgreementId,
  type SubscriptionCheckout,
} from '../../helpers/subscriptions';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

/**
 * Covers a subscription switched to another plan, and renewed after.
 *
 * A plan switch is the customer agreeing to new terms, so it establishes a new
 * agreement - one payment, one 3DS challenge, like the first checkout - and the
 * renewals after it run under that agreement, referencing the switch's gateway
 * order. The old agreement is never sent again.
 *
 * Opening an agreement is TO_BE_STORED even though the saved card is reused:
 * the gateway reads storedOnFile per agreement, and rejects STORED with an
 * agreement.id as a cardholder-initiated "subsequent payment".
 *
 * Needs WooCommerce Subscriptions "Switching" on for variable subscriptions, a
 * variable subscription with two plans configured as
 * PRODUCT_SUBSCRIPTION_BASIC / PRODUCT_SUBSCRIPTION_PREMIUM (variation ids), and
 * upgrades set to prorate. Without the plans the suite skips.
 */

/**
 * A Mastercard challenge card, not visaChallenge: on TESTSAUCAL101 a stored Visa
 * gets an ACTIVE VTS scheme token, and a VERIFY after 3DS on it (the $0
 * downgrade, MC-067) is rejected - "The details provided in field
 * sourceOfFunds.provided.card.number do not match the details used for the 3DS
 * Authentication". Mastercard scheme tokens stay PROVISIONING there. Raised with
 * Mastercard (2026-09-30), with the DCC-on-stored-token failure of the same kind.
 */
const CARD = cards.mastercardMxnChallenge;

const SETTINGS = {
  _3d_secure: 'yes',
  saved_cards: 'yes',
  transaction_mode: 'PURCHASE',
  checkout_mode: 'hosted_session',
  // Pinned off: site-global, and an unanswered DCC offer blocks place-order
  // (see suite 01).
  currency_conversion: 'no',
} as const;

/** The agreement a plan switch establishes. */
function switchAgreementId(subscriptionId: string, switchOrderNumber: string): string {
  return `${subscriptionAgreementId(config.paymentMethodSlug, subscriptionId)}-switch-${switchOrderNumber}`;
}

/**
 * The switch's AUTHENTICATE_PAYER establishes its agreement with the full terms
 * (expiry, minimum gap), as the first checkout's does.
 */
async function assertAgreementEstablished(ctx: CheckoutContext, agreementId: string): Promise<void> {
  const logs: LogEntry[] = (await getLogs(ctx.payDate, '', ctx.logOffset)).logs[0]?.content ?? [];
  const auth = logs.find((l) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER'
    && l.request?.url?.includes(ctx.transactionId));
  expect(auth, 'the switch must go through payer authentication').toBeTruthy();
  const agreement = auth!.request.body.agreement;
  expect(agreement?.id, 'the switch establishes its own agreement').toBe(agreementId);
  expect(agreement?.type).toBe('RECURRING');
  expect(agreement?.expiryDate, 'establishing terms: an expiry').toBeTruthy();
  expect(agreement?.minimumDaysBetweenPayments, 'establishing terms: a minimum gap').toBeGreaterThanOrEqual(1);
}

/** Switch the subscription to `plan` from My Account and land on checkout. */
async function switchPlan(page: Page, subscriptionId: string, plan: string): Promise<void> {
  await page.goto(`/my-account/view-subscription/${subscriptionId}/`);
  const switchLink = page.locator('a.wcs-switch-link, a[href*="switch-subscription"]').first();
  await expect(switchLink, 'no "Upgrade or Downgrade" link: is Switching on?').toBeVisible();
  await switchLink.click();

  await page.locator('select[name="attribute_plan"]').selectOption(plan);
  // The variation form resolves the plan in JS first; until then the button
  // is only class-disabled and WooCommerce swallows the click.
  await expect(page.locator('input.variation_id')).not.toHaveValue(/^0?$/);
  await expect(page.locator('button.single_add_to_cart_button')).not.toHaveClass(/disabled/);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load' }),
    page.locator('button.single_add_to_cart_button').click(),
  ]);
}

test.describe.serial('Subscription Upgrade', () => {
  let baseline: SubscriptionCheckout | undefined;
  /** Set only if the paid upgrade ran; gates what depends on it. */
  let switched: CheckoutContext | undefined;
  /** Set only if the $0 downgrade ran. */
  let downgraded: CheckoutContext | undefined;

  test.beforeAll(async () => {
    test.skip(
      !config.products.subscriptionBasic || !config.products.subscriptionPremium,
      'PRODUCT_SUBSCRIPTION_BASIC / _PREMIUM not configured: no plans to switch between',
    );
    await assertSubscriptionProduct(config.products.subscriptionBasic);
    await assertSubscriptionProduct(config.products.subscriptionPremium);
  });

  // === MC-060: the subscription the switches are performed against ===

  test('MC-060 - Subscription with challenge', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, { ...SETTINGS });

    baseline = await checkoutSubscription({ page, adminPage, emailPage }, config, {
      card: CARD, threeDS: 'always', productId: config.products.subscriptionBasic,
    });
  });

  // === MC-064: Upgrade, paying the prorated difference ===

  test('MC-064 - Upgrade subscription', async ({ page }) => {
    expect(baseline, 'MC-060 must have run first').toBeTruthy();
    const { ctx: opened, email, password } = baseline!;

    await frontendLogin(page, email, password);
    await switchPlan(page, opened.subscriptionId!, 'Premium');

    switched = await checkoutHostedSession(page, config, {
      checkoutUrl: '/checkout/',
      billing: { ...billing, email },
      // The card saved on MC-060, offered pre-selected.
      card: CARD,
      savedTokenIndex: 1,
      threeDS: 'maybe',
    });

    // One payment, one authentication, establishing the switch's agreement.
    await assertCaptureLogTrail({
      ...switched,
      expectSessionPost: false, expectToken: false, expectCardDetailsFetch: false,
    });
    const agreementId = switchAgreementId(opened.subscriptionId!, switched.orderNumber);
    await assertAgreementLog({
      payDate: switched.payDate,
      logOffset: switched.logOffset,
      transactionId: switched.transactionId,
      apiOperation: 'PAY',
      agreementId,
      agreementType: 'RECURRING',
      storedOnFile: 'TO_BE_STORED',
    });
    await assertAgreementEstablished(switched, agreementId);

    await page.goto(`/my-account/view-subscription/${opened.subscriptionId}/`);
    await expect(page.locator('.woocommerce-MyAccount-content'), 'the subscription is now on the other plan')
      .toContainText('Premium');
    await verifySubscription(page, opened.subscriptionId!, { expectedStatus: 'Active', displayName: config.displayName });
  });

  // === MC-064: the renewal runs under the switch's agreement ===

  test('MC-064 - Renewal of upgrade', async ({ adminPage }) => {
    test.skip(!switched, 'MC-064 did not switch the subscription, so there is nothing to renew.');
    const subscriptionId = baseline!.ctx.subscriptionId!;
    await assertSubscriptionRenews(adminPage, config, baseline!.ctx, {
      id: switchAgreementId(subscriptionId, switched!.orderNumber),
      referenceOrderId: switched!.transactionId,
    });
  });

  // === MC-067: A switch that costs nothing still goes through the gateway ===

  test('MC-067 - Downgrade without charge establishes a new agreement', async ({ page }) => {
    test.skip(!switched, 'MC-064 did not switch the subscription, so there is nothing to downgrade.');
    const { ctx: opened, email, password } = baseline!;

    // Upgrades prorate, downgrades do not: back to Basic costs nothing now.
    await frontendLogin(page, email, password);
    await switchPlan(page, opened.subscriptionId!, 'Basic');

    downgraded = await checkoutHostedSession(page, config, {
      checkoutUrl: '/checkout/',
      billing: { ...billing, email },
      card: CARD,
      savedTokenIndex: 1,
      threeDS: 'maybe',
    });

    // Nothing is charged: a VERIFY under the new agreement, authenticated at the
    // recurring amount (AUTHENTICATE_PAYER rejects 0).
    const agreementId = switchAgreementId(opened.subscriptionId!, downgraded.orderNumber);
    await assertAgreementLog({
      payDate: downgraded.payDate,
      logOffset: downgraded.logOffset,
      transactionId: downgraded.transactionId,
      apiOperation: 'VERIFY',
      agreementId,
      agreementType: 'RECURRING',
      storedOnFile: 'TO_BE_STORED',
    });
    await assertAgreementEstablished(downgraded, agreementId);

    await page.goto(`/my-account/view-subscription/${opened.subscriptionId}/`);
    await expect(page.locator('.woocommerce-MyAccount-content'), 'the subscription is back on Basic')
      .toContainText('Basic');
  });

  test('MC-067 - Renewal after downgrade', async ({ adminPage }) => {
    test.skip(!downgraded, 'MC-067 did not downgrade the subscription, so there is nothing to renew.');
    const subscriptionId = baseline!.ctx.subscriptionId!;
    await assertSubscriptionRenews(adminPage, config, baseline!.ctx, {
      id: switchAgreementId(subscriptionId, downgraded!.orderNumber),
      referenceOrderId: downgraded!.transactionId,
    });
  });
});
