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
 * Subscription switch (upgrade), in the shape used by suites 01-15.
 *
 * The switch itself needs store configuration that does not exist on the test
 * install: WooCommerce Subscriptions "Switching" enabled, plus a grouped or
 * variable subscription the customer can move between. Without it there is no
 * switch link to click, so MC-064 skips with that reason stated rather than
 * failing, and the renewal that depends on it skips too instead of renewing the
 * un-upgraded subscription and reporting a false pass.
 *
 * See tests/16-subscription-renewal for the notes on forced account creation
 * and on why a renewal is asserted as a merchant-initiated transaction.
 */
test.describe.serial('Subscription Upgrade', () => {
  const shopperEmail = uniqueEmail();

  let subscriptionId: string;
  let totalRenew: string;
  /** Set only when the switch actually ran; gates the tests that depend on it. */
  let upgraded = false;
  let upgradeOrderNumber: string;

  // === MC-060: baseline subscription the upgrade is performed against ===

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

  // === MC-064: switch the subscription to another plan ===

  test('MC-064 - Upgrade subscription', async ({ page, adminPage, emailPage }) => {
    expect(subscriptionId, 'no subscription from the baseline test').toBeTruthy();

    await frontendLogin(page, shopperEmail, billing.password);
    await page.goto(`/my-account/view-subscription/${subscriptionId}/`);

    const upgradeLink = page.locator('a.subscription_switch_link, a[href*="switch-subscription"]');
    const canSwitch = await upgradeLink.first().isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(
      !canSwitch,
      'No switch link on the subscription: WooCommerce Subscriptions "Switching" '
      + 'is not enabled, or no upgradeable (variable/grouped) subscription product exists.',
    );

    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = new Date().toISOString().slice(0, 19);

    await upgradeLink.first().click();
    await fillHostedSessionCC(page, cards.visaFrictionless, config);
    const total = await extractOrderTotal(page);
    const session = await extractSessionId(page);
    await selectPaymentMethod(page, config);
    await clickPlaceOrder(page);

    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, result);
    upgradeOrderNumber = result.orderNumber;
    expect(upgradeOrderNumber).toBeTruthy();
    // A switch may keep the same subscription or open a new one.
    if (result.subscriptionId) subscriptionId = result.subscriptionId;
    upgraded = true;

    const { order, transactionId } = await verifyOrderViaAPI(upgradeOrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    await logOrderContext(test.info().title, {
      orderNumber: upgradeOrderNumber, transactionId, session, total, payDate, logOffset,
    });

    // The switch re-registers the agreement against the new plan.
    await assertSubscriptionAgreement({
      payDate, logOffset, subscriptionId,
      frequency: 'MONTHLY',
      slug: config.paymentMethodSlug,
    });

    await verifyOrderEmails(upgradeOrderNumber, { paymentMethodTitle: config.displayName, page: emailPage });

    await navigateToOrder(adminPage, upgradeOrderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    await verifyOrderInMyAccount(page, upgradeOrderNumber, 'Processing', { displayName: config.displayName });
    await verifySubscription(page, subscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });

    // The upgraded plan's recurring total is what renewals must charge.
    totalRenew = await extractRecurringTotal(page).catch(() => totalRenew);
  });

  // === MC-064: the upgraded subscription must still renew, merchant-initiated ===

  test('MC-064 - Renewal of upgrade', async ({ adminPage }) => {
    test.skip(!upgraded, 'The upgrade did not run, so there is no upgraded subscription to renew.');

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
