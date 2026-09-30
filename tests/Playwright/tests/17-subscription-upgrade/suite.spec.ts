import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway } from '../../helpers/wc-api';
import { frontendLogin } from '../../helpers/wp-login';
import { checkoutHostedSession, type CheckoutContext } from '../../helpers/flows';
import { assertCaptureLogTrail, assertAgreementLog, verifySubscription } from '../../helpers/assertions';
import {
  assertSubscriptionProduct,
  checkoutSubscription,
  assertSubscriptionRenews,
  type SubscriptionCheckout,
} from '../../helpers/subscriptions';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

/**
 * Covers a subscription switched to another plan, and renewed after.
 *
 * Needs WooCommerce Subscriptions "Switching" on for variable subscriptions,
 * and a variable subscription with two plans configured as
 * PRODUCT_SUBSCRIPTION_BASIC / PRODUCT_SUBSCRIPTION_PREMIUM (variation ids).
 * Without them the suite skips rather than switch nothing.
 *
 * Also needs upgrades to charge now ("Prorate Recurring Payment" set to
 * upgrades), so the switch reaches the gateway at all; with the default "never"
 * it is a $0 order with no payment step. The switch is paid by the customer at
 * checkout, so it is cardholder-initiated; the renewal after it is
 * merchant-initiated as usual, at the new plan's price.
 */

const SETTINGS = {
  _3d_secure: 'yes',
  saved_cards: 'yes',
  transaction_mode: 'PURCHASE',
  checkout_mode: 'hosted_session',
  // Pinned off: site-global, and an unanswered DCC offer blocks place-order
  // (see suite 01).
  currency_conversion: 'no',
} as const;

test.describe.serial('Subscription Upgrade', () => {
  let baseline: SubscriptionCheckout | undefined;
  /** Set only if a switch actually ran; gates the renewal that depends on it. */
  let switched: CheckoutContext | undefined;

  test.beforeAll(async () => {
    test.skip(
      !config.products.subscriptionBasic || !config.products.subscriptionPremium,
      'PRODUCT_SUBSCRIPTION_BASIC / _PREMIUM not configured: no plans to switch between',
    );
    await assertSubscriptionProduct(config.products.subscriptionBasic);
    await assertSubscriptionProduct(config.products.subscriptionPremium);
  });

  // === MC-060: the subscription the switch is performed against ===

  test('MC-060 - Subscription with challenge', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, { ...SETTINGS });

    baseline = await checkoutSubscription({ page, adminPage, emailPage }, config, {
      card: cards.visaChallenge, threeDS: 'always', productId: config.products.subscriptionBasic,
    });
  });

  // === MC-064: Switch to the other plan ===

  test('MC-064 - Upgrade subscription', async ({ page }) => {
    expect(baseline, 'MC-060 must have run first').toBeTruthy();
    const { ctx: opened, email, password } = baseline!;

    await frontendLogin(page, email, password);
    await page.goto(`/my-account/view-subscription/${opened.subscriptionId}/`);
    const switchLink = page.locator('a.wcs-switch-link, a[href*="switch-subscription"]').first();
    await expect(switchLink, 'no "Upgrade or Downgrade" link: is Switching on?').toBeVisible();
    await switchLink.click();

    // The product page, in switch mode: pick the other plan.
    await page.locator('select[name="attribute_plan"]').selectOption('Premium');
    // The variation form resolves the plan in JS first; until then the button
    // is only class-disabled and WooCommerce swallows the click.
    await expect(page.locator('input.variation_id')).not.toHaveValue(/^0?$/);
    await expect(page.locator('button.single_add_to_cart_button')).not.toHaveClass(/disabled/);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load' }),
      page.locator('button.single_add_to_cart_button').click(),
    ]);

    switched = await checkoutHostedSession(page, config, {
      checkoutUrl: '/checkout/',
      billing: { ...billing, email },
      // The card saved on MC-060, offered pre-selected.
      card: cards.visaChallenge,
      savedTokenIndex: 1,
      threeDS: 'maybe',
    });

    // An upgrade with proration charges the difference now, paid by the
    // customer with the saved card: cardholder-initiated, and - like an early
    // renewal - without the subscription's agreement. With it, the gateway
    // takes the payment for the next in the series and rejects INTERNET.
    await assertCaptureLogTrail({
      ...switched,
      expectSessionPost: false, expectToken: false, expectCardDetailsFetch: false,
    });
    await assertAgreementLog({
      payDate: switched.payDate,
      logOffset: switched.logOffset,
      transactionId: switched.transactionId,
      apiOperation: 'PAY',
      agreementId: null,
      storedOnFile: 'STORED',
    });

    await page.goto(`/my-account/view-subscription/${opened.subscriptionId}/`);
    await expect(page.locator('.woocommerce-MyAccount-content'), 'the subscription is now on the other plan')
      .toContainText('Premium');
    await verifySubscription(page, opened.subscriptionId!, { expectedStatus: 'Active', displayName: config.displayName });
  });

  // === MC-064: the switched subscription must still renew, merchant-initiated ===

  test('MC-064 - Renewal of upgrade', async ({ adminPage }) => {
    test.skip(!switched, 'MC-064 did not switch the subscription, so there is nothing to renew.');
    // The subscription's parent is still MC-060's order, so that is the
    // checkout the renewal references.
    await assertSubscriptionRenews(adminPage, config, baseline!.ctx);
  });
});
