import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway, getLogs, getLogEntryCount, type LogEntry } from '../../helpers/wc-api';
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
import { selectGatewayOnAddPaymentMethod } from '../../helpers/my-account';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { waitForUnblock } from '../../helpers/block-ui';
import { handle3DSChallenge } from '../../helpers/three-ds';
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

/**
 * The second card MC-070 saves and MC-071 changes to: a Mastercard, not a Visa.
 * On TESTSAUCAL101 a saved Visa's VTS scheme token turns ACTIVE about a minute
 * after it is stored, and a VERIFY after 3DS on it (the change of payment
 * method) is then rejected: "The details provided in field
 * sourceOfFunds.provided.card.number do not match the details used for the 3DS
 * Authentication". Whether it had turned active made MC-071 flaky. Mastercard
 * scheme tokens stay PROVISIONING there. Raised with Mastercard (2026-09-30).
 */
const SECOND_CARD = cards.mastercardEurFrictionless;

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

  // === MC-069: The card subscriptions renew with cannot be removed ===

  test('MC-069 - The only card a subscription renews with cannot be removed', async ({ page }) => {
    // WooCommerce Subscriptions hides Delete for a card an active subscription
    // renews with when the customer has no other card. It finds those
    // subscriptions by the token stored in their meta, which this gateway
    // writes (payment_token), so the protection applies to our subscriptions.
    expect(baseline, 'MC-060 must have run first').toBeTruthy();
    const { email, password } = baseline!;

    await frontendLogin(page, email, password);
    await page.goto('/my-account/payment-methods/');
    const row = page.locator('tr.payment-method').filter({ hasText: cards.visaChallenge.number.slice(-4) });
    await expect(row, 'the card the subscriptions renew with').toHaveCount(1);
    await expect(row.locator('a.delete'), 'no Delete action while subscriptions renew with it').toHaveCount(0);
  });

  // === MC-070: Another saved card does not unlock it ===

  test('MC-070 - The subscription card stays locked with another card saved', async ({ page }) => {
    /**
     * WooCommerce Subscriptions lets a customer remove the card once they have
     * another, and repoints the subscription. With this gateway the next
     * renewal then fails (observed: "Invalid payment token", subscription On
     * hold), and even a repointed card would be refused: the gateway only
     * charges, merchant-initiated, the card of the agreement's last
     * cardholder-initiated payment. So the gateway keeps the card locked; the
     * customer changes it through "Change payment method".
     */
    expect(baseline, 'MC-060 must have run first').toBeTruthy();
    const { email, password } = baseline!;

    await frontendLogin(page, email, password);
    await selectGatewayOnAddPaymentMethod(page, config);
    await fillHostedSessionCC(page, SECOND_CARD, config);
    await page.locator('#place_order').first().click();
    await page.waitForURL(/payment-methods/, { timeout: 60000 });
    await waitForUnblock(page);

    const subscriptionCard = page.locator('tr.payment-method').filter({ hasText: cards.visaChallenge.number.slice(-4) });
    const otherCard = page.locator('tr.payment-method').filter({ hasText: SECOND_CARD.number.slice(-4) });
    await expect(subscriptionCard.locator('a.delete'), 'the subscription card stays locked').toHaveCount(0);
    await expect(otherCard.locator('a.delete'), 'a card no subscription uses can be removed').toHaveCount(1);
    await expect(page.locator('.woocommerce-info, .woocommerce-notice, .wc-block-components-notice-banner'))
      .toContainText('change the subscription');
  });
  // === MC-071: Change payment method moves the subscription to another card ===

  test('MC-071 - Change payment method, then renew with the new card', async ({ page, adminPage }) => {
    /**
     * The way to change the card a subscription renews with (MC-070 keeps the
     * old one from being removed). It must be a cardholder-initiated payment
     * under the subscription's agreement, because the gateway only charges,
     * merchant-initiated, the card of the agreement's last cardholder-initiated
     * payment: the renewal after it must charge the new card, and be approved.
     */
    expect(baseline, 'MC-060 must have run first').toBeTruthy();
    const { ctx: opened, email, password } = baseline!;
    const newCard = SECOND_CARD; // saved in MC-070

    await frontendLogin(page, email, password);
    await page.goto(`/my-account/view-subscription/${opened.subscriptionId}/`);
    await page.locator('a.change_payment_method').first().click();
    await page.waitForLoadState('load');

    const payDate = new Date().toISOString().slice(0, 19);
    const logOffset = await getLogEntryCount(payDate);

    // Pick the other saved card.
    await page.locator(`label[for="payment_method_${config.paymentMethodSlug}"]`).click().catch(() => {});
    await page.locator('li.woocommerce-SavedPaymentMethods-token label').filter({ hasText: newCard.number.slice(-4) }).click();
    await waitForUnblock(page);
    await page.locator('#place_order').click();
    await handle3DSChallenge(page, { urlPattern: /view-subscription|my-account/ }).catch(() => {});
    await page.waitForURL(/view-subscription|my-account/, { timeout: 60000 });
    await expect(page.locator('.woocommerce-message, .wc-block-components-notice-banner.is-success'))
      .toContainText(/Payment method updated/i);

    // The change is a VERIFY under the subscription's agreement.
    const changeLogs: LogEntry[] = (await getLogs(payDate, '', logOffset)).logs[0]?.content ?? [];
    const verify = changeLogs.find((l) => l.request?.body?.apiOperation === 'VERIFY'
      && l.response?.body?.result === 'SUCCESS');
    expect(verify, 'the change is verified at the gateway').toBeTruthy();
    expect(verify!.request.body.agreement?.id, 'under the subscription agreement')
      .toBe(subscriptionAgreementId(config.paymentMethodSlug, opened.subscriptionId!));
    const newToken = verify!.response.body.sourceOfFunds?.token;
    expect(newToken, 'the new card is a stored token').toBeTruthy();

    // The next renewal charges the new card, merchant-initiated, and is approved.
    const renewalDate = new Date().toISOString().slice(0, 19);
    const renewalOffset = await getLogEntryCount(renewalDate);
    await assertSubscriptionRenews(adminPage, config, opened);
    const renewalLogs: LogEntry[] = (await getLogs(renewalDate, '', renewalOffset)).logs[0]?.content ?? [];
    const pay = renewalLogs.find((l) => l.request?.body?.apiOperation === 'PAY'
      && l.request?.body?.transaction?.source === 'MERCHANT');
    expect(pay?.request?.body?.sourceOfFunds?.token, 'the renewal charges the new card').toBe(newToken);
  });
});
