import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI, getLogEntryCount, getLogs } from '../../helpers/wc-api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  extractOrderTotal,
  extractRecurringTotal,
  extractSessionId,
  selectSavedToken,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { collectOrderReceivedData } from '../../helpers/flows';
import { handle3DSChallenge } from '../../helpers/three-ds';
import { frontendLogin } from '../../helpers/wp-login';
import { triggerSubscriptionRenewal, extractRenewalOrderNumber, navigateToOrder } from '../../helpers/admin-orders';
import {
  assertOrderStatus,
  assertPaymentMethodMeta,
  assertCapturedNote,
  assertCaptureLogTrail,
  assertSubscriptionAgreement,
  assertMerchantInitiatedRenewal,
  verifyOrderEmails,
  assertOrderReceived,
  verifySubscription,
  verifyOrderInMyAccount,
  parseAmount,
} from '../../helpers/assertions';
import config from '../../plugin-config';
import { cards, fourDigits } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';
import { logOrderContext } from '../../helpers/debug';

/**
 * Early manual renewal, in the shape used by suites 01-15.
 *
 * MC-065 is the one flow in the subscription suites that is *payer*-initiated:
 * the customer chooses "Renew now" from My Account, so it goes through checkout
 * with a session like any normal payment. That is the point of the test -- it
 * sits either side of MC-065's automatic renewal, which is merchant-initiated
 * and carries no session at all.
 *
 * It needs WooCommerce Subscriptions' "Accept Early Renewal Payments" turned on;
 * without it there is no renew link, so the test skips with that reason rather
 * than failing.
 *
 * See tests/16-subscription-renewal for the notes on forced account creation
 * and on why an automatic renewal is asserted as merchant-initiated.
 */
test.describe.serial('Subscription Manual Renewal', () => {
  const shopperEmail = uniqueEmail();

  let subscriptionId: string;
  let totalRenew: string;
  /** Set only when the early-renewal flow actually ran. */
  let manuallyRenewed = false;

  // === MC-060: baseline subscription ===

  test('MC-060 - Subscription with challenge', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });

    // === CHECKOUT (buyer's page) ===
    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, { ...billing, email: shopperEmail });
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaChallenge, config);

    const total = await extractOrderTotal(page);
    totalRenew = await extractRecurringTotal(page);
    const session = await extractSessionId(page);

    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, result);
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
    expect(result.subscriptionId, 'subscription id should be on the order-received page').toBeTruthy();
    subscriptionId = result.subscriptionId!;

    // === API VERIFICATION ===
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    await logOrderContext(test.info().title, {
      orderNumber, transactionId, session, total, payDate, logOffset,
      card: `${cards.visaChallenge.name} ****${fourDigits(cards.visaChallenge)}`,
    });

    // === LOG VERIFICATION ===
    await assertCaptureLogTrail({
      payDate, logOffset, session, total,
      transactionId: transactionId!, orderNumber, card: cards.visaChallenge,
      expectSessionPost: true, expectToken: true, expectCardDetailsFetch: true,
    });
    await assertSubscriptionAgreement({
      payDate, logOffset, subscriptionId,
      frequency: 'MONTHLY',
      slug: config.paymentMethodSlug,
    });

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName, page: emailPage });

    // === ADMIN BACKEND (admin page) ===
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    // === MY ACCOUNT (buyer's page) ===
    await frontendLogin(page, shopperEmail, billing.password);
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { displayName: config.displayName });
    await verifySubscription(page, subscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  // === MC-065: customer renews early from My Account (payer-initiated) ===

  test('MC-065 - Manual renewal', async ({ page, adminPage, emailPage }) => {
    expect(subscriptionId, 'no subscription from the baseline test').toBeTruthy();

    await frontendLogin(page, shopperEmail, billing.password);
    await page.goto(`/my-account/view-subscription/${subscriptionId}/`);

    const renewLink = page.locator('a.subscription_renewal_early, a[href*="subscription_renewal_early"]');
    const canRenewEarly = await renewLink.first().isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(
      !canRenewEarly,
      'No early-renewal link on the subscription: WooCommerce Subscriptions '
      + '"Accept Early Renewal Payments" is not enabled.',
    );

    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = new Date().toISOString().slice(0, 19);

    await renewLink.first().click();
    await selectPaymentMethod(page, config);
    // The subscription stored a card, so the renewal checkout offers it
    // pre-selected and renders no card iframes at all -- typing a fresh card
    // here just waits 30s for an iframe that will never appear. Paying with the
    // stored card is also the realistic flow: the customer already gave one.
    await selectSavedToken(page, 1);
    const total = await extractOrderTotal(page);
    const session = await extractSessionId(page);
    await clickPlaceOrder(page);
    // Payer-initiated, and the stored card is the challenge card from the
    // baseline, so this still goes through 3DS -- unlike the automatic renewal.
    await handle3DSChallenge(page);

    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, result);
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
    manuallyRenewed = true;

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    await logOrderContext(test.info().title, {
      orderNumber, transactionId, session, total, payDate, logOffset,
    });

    // Payer-initiated, so unlike an automatic renewal this one *does* open a
    // session and run the full capture trail.
    await assertCaptureLogTrail({
      payDate, logOffset, session, total,
      transactionId: transactionId!, orderNumber, card: cards.visaChallenge,
      // Saved-token path: no new session POST, no card-details GET, no new
      // token. The composite derives the session id from the UPDATE_SESSION PUT
      // when the DOM field is empty.
      expectSessionPost: false, expectToken: false, expectCardDetailsFetch: false,
    });

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName, page: emailPage });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { displayName: config.displayName });
    await verifySubscription(page, subscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  // === MC-065: the automatic renewal after it must still be merchant-initiated ===

  test('MC-065 - Renewal after manual renew', async ({ adminPage }) => {
    test.skip(!manuallyRenewed, 'The early manual renewal did not run, so there is nothing to follow.');

    const renewDate = new Date().toISOString().slice(0, 19);
    const renewOffset = await getLogEntryCount(renewDate);

    await triggerSubscriptionRenewal(adminPage, subscriptionId);
    const renewalOrderNumber = await extractRenewalOrderNumber(adminPage);
    expect(renewalOrderNumber, 'no renewal order was created').toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(renewalOrderNumber, config);
    await logOrderContext(test.info().title, {
      orderNumber: renewalOrderNumber, transactionId, payDate: renewDate, logOffset: renewOffset,
    });
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId, 'renewal order has no gateway transaction').toBeTruthy();
    expect(parseAmount(order.total)).toBeCloseTo(parseAmount(totalRenew), 2);

    // An early manual renewal must not leave the agreement in a state that stops
    // the scheduled charge: this is still merchant-initiated, on the stored token.
    await assertMerchantInitiatedRenewal({
      payDate: renewDate, logOffset: renewOffset,
      subscriptionId,
      slug: config.paymentMethodSlug,
      total: totalRenew,
    });

    const sessionPostLogs = await getLogs(renewDate, '/session', renewOffset);
    expect(sessionPostLogs.logs[0]?.content.length ?? 0, 'renewal should not create a session').toBe(0);
  });
});
