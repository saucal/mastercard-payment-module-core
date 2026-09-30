import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway } from '../../helpers/wc-api';
import { frontendLogin } from '../../helpers/wp-login';
import { checkoutHostedSession, assertOrderComplete } from '../../helpers/flows';
import {
  assertCaptureLogTrail,
  assertAgreementLog,
  verifySubscription,
} from '../../helpers/assertions';
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
 * Covers a customer renewing early from My Account, and the automatic renewal
 * after it.
 *
 * The early renewal is the one subscription payment that is cardholder-
 * initiated: the customer clicks "Renew now" and goes through checkout, with a
 * session and 3DS, paying with the card they saved on the first payment. The
 * automatic renewal that follows is merchant-initiated as usual. The suite
 * exists to hold both sides of that line, and to prove the early renewal did not
 * disturb the agreement the automatic one depends on.
 *
 * Needs WooCommerce Subscriptions "Accept Early Renewal Payments" on; without it
 * there is no "Renew now" link and MC-065 skips.
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

test.describe.serial('Subscription Manual Renewal', () => {
  let baseline: SubscriptionCheckout | undefined;
  /** Set only if the early renewal ran; gates the automatic renewal after it. */
  let renewedEarly = false;

  test.beforeAll(async () => {
    await assertSubscriptionProduct(config.products.subscription);
  });

  // === MC-060: the subscription renewed below ===

  test('MC-060 - Subscription with challenge', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, { ...SETTINGS });

    baseline = await checkoutSubscription({ page, adminPage, emailPage }, config, {
      card: cards.visaChallenge, threeDS: 'always',
    });
  });

  // === MC-065: The customer renews early, from My Account ===

  test('MC-065 - Manual renewal', async ({ page, adminPage, emailPage }) => {
    expect(baseline, 'MC-060 must have run first').toBeTruthy();
    const { ctx: opened, email, password } = baseline!;

    await frontendLogin(page, email, password);
    await page.goto(`/my-account/view-subscription/${opened.subscriptionId}/`);
    const renewNow = page.locator('a.subscription_renewal_early').first();
    const canRenewEarly = await renewNow.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!canRenewEarly, 'No "Renew now" link: Subscriptions "Accept Early Renewal Payments" is off.');

    const ctx = await checkoutHostedSession(page, config, {
      checkoutUrl: (await renewNow.getAttribute('href'))!,
      billing: { ...billing, email },
      // The card saved on MC-060's checkout, offered pre-selected. No card
      // iframes render for it, so typing a fresh one would wait for nothing.
      card: cards.visaChallenge,
      savedTokenIndex: 1,
      // A saved challenge card may or may not re-challenge, per issuer.
      threeDS: 'maybe',
    });
    renewedEarly = true;

    // Saved-token path: no new session POST, no card-details fetch, no new token.
    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: false, expectToken: false, expectCardDetailsFetch: false,
    });
    // The card was stored on MC-060 and picked here, so STORED — even though a
    // subscription cart forces saving, which used to make this TO_BE_STORED.
    // No agreement: the payer is paying, so it is not the next payment in the
    // subscription's merchant-initiated series (the gateway rejects that as
    // INTERNET), and the automatic renewal below proves the series is intact.
    await assertAgreementLog({
      payDate: ctx.payDate,
      logOffset: ctx.logOffset,
      transactionId: ctx.transactionId,
      apiOperation: 'PAY',
      agreementId: null,
      storedOnFile: 'STORED',
    });

    // Renewal orders get Subscriptions' own emails; verifyOrderEmails knows them.
    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
      myAccount: { email, password },
    });
    await verifySubscription(page, opened.subscriptionId!, { expectedStatus: 'Active', displayName: config.displayName });
  });

  // === MC-065: The automatic renewal after it is still merchant-initiated ===

  test('MC-065 - Renewal after manual renew', async ({ adminPage }) => {
    test.skip(!renewedEarly, 'The early renewal did not run, so there is nothing to follow.');
    // The subscription's parent is still MC-060's order, so that is the
    // checkout the renewal must reference, not the early renewal.
    await assertSubscriptionRenews(adminPage, config, baseline!.ctx);
  });

  // === MC-068: A returning customer subscribes again with the saved card ===

  test('MC-068 - Second subscription with the saved card', async ({ page }) => {
    /**
     * A new subscription opens a new agreement, and the gateway reads
     * storedOnFile per agreement: the first payment of an agreement must be
     * TO_BE_STORED even though this card was saved on MC-060. Sent as STORED
     * (a saved card picked at checkout), it was rejected: "transaction.source
     * must be set to MERCHANT for a subsequent payment in a series".
     */
    expect(baseline, 'MC-060 must have run first').toBeTruthy();
    const { ctx: first, email, password } = baseline!;

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.subscription,
      loginAs: { email, password },
      billing: { ...billing, email },
      card: cards.visaChallenge,
      savedTokenIndex: 1,
      threeDS: 'maybe',
    });
    expect(ctx.subscriptionId, 'a second subscription').toBeTruthy();
    expect(ctx.subscriptionId).not.toBe(first.subscriptionId);

    await assertAgreementLog({
      payDate: ctx.payDate,
      logOffset: ctx.logOffset,
      transactionId: ctx.transactionId,
      apiOperation: 'PAY',
      agreementId: subscriptionAgreementId(config.paymentMethodSlug, ctx.subscriptionId!),
      agreementType: 'RECURRING',
      storedOnFile: 'TO_BE_STORED',
    });
  });
});
