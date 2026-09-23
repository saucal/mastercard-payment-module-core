import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway } from '../../helpers/wc-api';
import { frontendLogin } from '../../helpers/wp-login';
import type { CheckoutContext } from '../../helpers/flows';
import {
  assertSubscriptionProduct,
  checkoutSubscription,
  assertSubscriptionRenews,
  type SubscriptionCheckout,
} from '../../helpers/subscriptions';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';

/**
 * Covers a subscription switched to another plan, and renewed after.
 *
 * The switch needs store configuration this suite cannot create: WooCommerce
 * Subscriptions "Switching" enabled, and a variable or grouped subscription the
 * customer can move between. Without it there is no switch link, so MC-064
 * skips with that reason, and the renewal that depends on it skips too rather
 * than renewing the un-switched subscription and passing for the wrong reason.
 *
 * With the link present MC-064 is still a fixme: which plan to pick, and what
 * checkout follows, depends on the product the store offers — design it against
 * a real one rather than guess.
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
    await assertSubscriptionProduct(config.products.subscription);
  });

  // === MC-060: the subscription the switch is performed against ===

  test('MC-060 - Subscription with challenge', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, { ...SETTINGS });

    baseline = await checkoutSubscription({ page, adminPage, emailPage }, config, {
      card: cards.visaChallenge, threeDS: 'always',
    });
  });

  // === MC-064: Switch to another plan ===

  test('MC-064 - Upgrade subscription', async ({ page }) => {
    expect(baseline, 'MC-060 must have run first').toBeTruthy();

    await frontendLogin(page, baseline!.email, baseline!.password);
    await page.goto(`/my-account/view-subscription/${baseline!.ctx.subscriptionId}/`);
    const switchLink = page.locator('a.subscription_switch_link, a[href*="switch-subscription"]');
    const canSwitch = await switchLink.first().isVisible({ timeout: 5000 }).catch(() => false);

    test.skip(
      !canSwitch,
      'No switch link: WooCommerce Subscriptions "Switching" is off, or no '
      + 'upgradeable (variable or grouped) subscription product exists.',
    );
    test.fixme(true, 'The switch flow depends on the upgrade product the store offers; design it against a real one.');
  });

  // === MC-064: the switched subscription must still renew, merchant-initiated ===

  test('MC-064 - Renewal of upgrade', async ({ adminPage }) => {
    test.skip(!switched, 'MC-064 did not switch the subscription, so there is nothing to renew.');
    await assertSubscriptionRenews(adminPage, config, switched!);
  });
});
