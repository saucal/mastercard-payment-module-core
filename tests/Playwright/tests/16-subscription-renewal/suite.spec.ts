import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI, getLogEntryCount, getLogs, getOrderMeta } from '../../helpers/wc-api';
import { waitForUnblock } from '../../helpers/block-ui';
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
import { adminLogin, frontendLogin, registerUser } from '../../helpers/wp-login';
import { triggerSubscriptionRenewal, extractRenewalOrderNumber, navigateToOrder } from '../../helpers/admin-orders';
import {
  assertOrderStatus,
  assertPaymentMethodMeta,
  assertCapturedNote,
  assertAuthorizedNote,
  assertCaptureLogTrail,
  assertSubscriptionAgreement,
  assertMerchantInitiatedRenewal,
  verifySessionPost,
  verifySessionGet,
  verifyTokenLog,
  verifyInitiateAuthentication,
  verifyAuthenticatePayer,
  verifyAuthenticationResult,
  verifyAuthorizeCaptureLog,
  verifyAgreement,
  verifyOrderEmails,
  verifyAdminEmail,
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
 * Subscriptions, in the shape used by suites 01-15.
 *
 * Two things differ from those suites, both forced by WooCommerce Subscriptions:
 *
 * 1. Account creation is mandatory. Subscriptions renders the account fields
 *    with no "Create an account?" checkbox and a required password, so every
 *    scenario needs its own address -- a fixed one makes the test single-use
 *    ("An account is already registered with your email address") -- and
 *    fillBilling() fills the forced password field.
 *
 * 2. A renewal is a *merchant*-initiated transaction. It carries no session and
 *    no 3DS: the gateway charges the stored token under the agreement opened by
 *    the initial payment. assertMerchantInitiatedRenewal() checks that shape,
 *    and is the regression guard for the missing `agreement.type` that used to
 *    make every renewal fail with INVALID_REQUEST.
 *
 * Each scenario is one test that owns its whole trail (checkout -> API -> logs
 * -> email -> admin -> my account), with the renewal split out only because it
 * needs the subscription the previous test created.
 */
test.describe.serial('Subscription Renewal', () => {
  // === MC-060: Subscription with Challenge (classic) ===

  const mc060Email = uniqueEmail();
  let mc060SubscriptionId: string;
  let mc060TotalRenew: string;

  test('MC-060 - Subscription with challenge (classic)', async ({ page, adminPage, emailPage }) => {
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
    await fillBilling(page, { ...billing, email: mc060Email });
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaChallenge, config);

    const total = await extractOrderTotal(page);
    mc060TotalRenew = await extractRecurringTotal(page);
    const session = await extractSessionId(page);

    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, result);
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
    expect(result.subscriptionId, 'subscription id should be on the order-received page').toBeTruthy();
    mc060SubscriptionId = result.subscriptionId!;

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
    // expectToken: a subscription forces tokenization regardless of the save-card
    // checkbox -- the renewal has nothing to charge otherwise.
    await assertCaptureLogTrail({
      payDate, logOffset, session, total,
      transactionId: transactionId!, orderNumber, card: cards.visaChallenge,
      expectSessionPost: true, expectToken: true, expectCardDetailsFetch: true,
    });
    await assertSubscriptionAgreement({
      payDate, logOffset,
      subscriptionId: mc060SubscriptionId,
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
    await frontendLogin(page, mc060Email, billing.password);
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { displayName: config.displayName });
    await verifySubscription(page, mc060SubscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  test('MC-060 - Renewal', async ({ adminPage }) => {
    expect(mc060SubscriptionId, 'no subscription from the checkout test').toBeTruthy();

    // Offset taken *now*, not at checkout: the renewal's assertions must not see
    // the initial payment's session and token entries, which share the same day.
    const renewDate = new Date().toISOString().slice(0, 19);
    const renewOffset = await getLogEntryCount(renewDate);

    await triggerSubscriptionRenewal(adminPage, mc060SubscriptionId);
    const renewalOrderNumber = await extractRenewalOrderNumber(adminPage);
    expect(renewalOrderNumber, 'no renewal order was created').toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(renewalOrderNumber, config);
    await logOrderContext(test.info().title, {
      orderNumber: renewalOrderNumber, transactionId, payDate: renewDate, logOffset: renewOffset,
    });
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId, 'renewal order has no gateway transaction').toBeTruthy();

    // The renewal charges the recurring total, not the initial total (which can
    // include one-off shipping or sign-up fees).
    expect(parseAmount(order.total)).toBeCloseTo(parseAmount(mc060TotalRenew), 2);

    // The renewal must be merchant-initiated: stored token, agreement, no session.
    await assertMerchantInitiatedRenewal({
      payDate: renewDate, logOffset: renewOffset,
      subscriptionId: mc060SubscriptionId,
      slug: config.paymentMethodSlug,
      total: mc060TotalRenew,
    });

    // A merchant-initiated charge never opens a checkout session.
    const sessionPostLogs = await getLogs(renewDate, '/session', renewOffset);
    expect(sessionPostLogs.logs[0]?.content.length ?? 0, 'renewal should not create a session').toBe(0);
  });

  // === MC-061: Subscription frictionless (classic) ===

  const mc061Email = uniqueEmail();
  let mc061SubscriptionId: string;
  let mc061TotalRenew: string;

  test('MC-061 - Subscription frictionless (classic)', async ({ page, adminPage, emailPage }) => {
    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, { ...billing, email: mc061Email });
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    const total = await extractOrderTotal(page);
    mc061TotalRenew = await extractRecurringTotal(page);
    const session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, result);
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
    expect(result.subscriptionId, 'subscription id should be on the order-received page').toBeTruthy();
    mc061SubscriptionId = result.subscriptionId!;

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    await logOrderContext(test.info().title, {
      orderNumber, transactionId, session, total, payDate, logOffset,
      card: `${cards.visaFrictionless.name} ****${fourDigits(cards.visaFrictionless)}`,
    });

    await assertCaptureLogTrail({
      payDate, logOffset, session, total,
      transactionId: transactionId!, orderNumber, card: cards.visaFrictionless,
      expectSessionPost: true, expectToken: true, expectCardDetailsFetch: true,
    });
    await assertSubscriptionAgreement({
      payDate, logOffset,
      subscriptionId: mc061SubscriptionId,
      frequency: 'MONTHLY',
      slug: config.paymentMethodSlug,
    });

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName, page: emailPage });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    await frontendLogin(page, mc061Email, billing.password);
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { displayName: config.displayName });
    await verifySubscription(page, mc061SubscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  test('MC-061 - Renewal', async ({ adminPage }) => {
    expect(mc061SubscriptionId, 'no subscription from the checkout test').toBeTruthy();

    const renewDate = new Date().toISOString().slice(0, 19);
    const renewOffset = await getLogEntryCount(renewDate);

    await triggerSubscriptionRenewal(adminPage, mc061SubscriptionId);
    const renewalOrderNumber = await extractRenewalOrderNumber(adminPage);
    expect(renewalOrderNumber, 'no renewal order was created').toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(renewalOrderNumber, config);
    await logOrderContext(test.info().title, {
      orderNumber: renewalOrderNumber, transactionId, payDate: renewDate, logOffset: renewOffset,
    });
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId, 'renewal order has no gateway transaction').toBeTruthy();
    expect(parseAmount(order.total)).toBeCloseTo(parseAmount(mc061TotalRenew), 2);

    await assertMerchantInitiatedRenewal({
      payDate: renewDate, logOffset: renewOffset,
      subscriptionId: mc061SubscriptionId,
      slug: config.paymentMethodSlug,
      total: mc061TotalRenew,
    });

    const sessionPostLogs = await getLogs(renewDate, '/session', renewOffset);
    expect(sessionPostLogs.logs[0]?.content.length ?? 0, 'renewal should not create a session').toBe(0);
  });

  // === MC-062: Subscription with Challenge (blocks) ===

  const mc062Email = uniqueEmail();

  test('MC-062 - Subscription with challenge (blocks)', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('blocks');

    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, { ...billing, email: mc062Email });
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaChallenge, config);

    const total = await extractOrderTotal(page);
    const session = await extractSessionId(page);

    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, result);
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
    expect(result.subscriptionId, 'subscription id should be on the order-received page').toBeTruthy();
    const subscriptionId = result.subscriptionId!;

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    await logOrderContext(test.info().title, {
      orderNumber, transactionId, session, total, payDate, logOffset,
      card: `${cards.visaChallenge.name} ****${fourDigits(cards.visaChallenge)}`,
    });

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

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName, page: emailPage });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    await frontendLogin(page, mc062Email, billing.password);
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { displayName: config.displayName });
    await verifySubscription(page, subscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  // === MC-063: Subscription frictionless (blocks) ===

  const mc063Email = uniqueEmail();

  test('MC-063 - Subscription frictionless (blocks)', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('blocks');

    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, { ...billing, email: mc063Email });
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    const total = await extractOrderTotal(page);
    const session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, result);
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
    expect(result.subscriptionId, 'subscription id should be on the order-received page').toBeTruthy();
    const subscriptionId = result.subscriptionId!;

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    await logOrderContext(test.info().title, {
      orderNumber, transactionId, session, total, payDate, logOffset,
      card: `${cards.visaFrictionless.name} ****${fourDigits(cards.visaFrictionless)}`,
    });

    await assertCaptureLogTrail({
      payDate, logOffset, session, total,
      transactionId: transactionId!, orderNumber, card: cards.visaFrictionless,
      expectSessionPost: true, expectToken: true, expectCardDetailsFetch: true,
    });
    await assertSubscriptionAgreement({
      payDate, logOffset, subscriptionId,
      frequency: 'MONTHLY',
      slug: config.paymentMethodSlug,
    });

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName, page: emailPage });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    await frontendLogin(page, mc063Email, billing.password);
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { displayName: config.displayName });
    await verifySubscription(page, subscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });
});

// ============================================================================
// MC-060 variant: 3DS Inactive (moved from suite 07-hosted-session-3ds-inactive)
// ----------------------------------------------------------------------------
// The subscription addon's gateway-support filter currently rejects the gateway
// when _3d_secure: 'no'. Skipped pending addon-side investigation; sources
// preserved verbatim from the original suite-07 port for future reactivation.
// ============================================================================

test.describe.skip('Subscription Order - Challenge with 3DS Inactive (from suite 07)', () => {
  test.beforeAll(async () => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'no',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });
  });

  let orderNumber: string;
  let subscriptionId: string;
  let mc060Total: string;
  let mc060Session: string;
  let mc060PayDate: string;

  test('MC-060 - Subscription order with Challenge', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, billing);
    mc060Total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    mc060Session = await extractSessionId(page);
    await fillHostedSessionCC(page, cards.visaChallenge, config);

    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: mc060Total }, result);
    orderNumber = result.orderNumber;
    mc060PayDate = new Date().toISOString().slice(0, 19);
    expect(orderNumber).toBeTruthy();
    expect(result.subscriptionId).toBeTruthy();
    subscriptionId = result.subscriptionId!;
  });

  test('MC-060 - Subscription Admin', async ({ page, emailPage }) => {
    expect(orderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    await logOrderContext(test.info().title, { orderNumber: orderNumber, transactionId });
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    const allLogs = await getLogs(mc060PayDate, '');
    const sessionPostLogs = await getLogs(mc060PayDate, '/session');
    const sessionGetLogs = await getLogs(mc060PayDate, `/session/${mc060Session}`);

    // The '/session' filter matches the creating POST *and* every later
    // GET/PUT on that session, and the order they land in is not fixed --
    // taking content[0] blindly handed verifySessionPost a GET entry.
    const sessionPostLog = (sessionPostLogs.logs[0]?.content ?? []).find(
      (l: any) => l.request?.type === 'POST' || l.request?.type === 'PUT',
    );
    if (sessionPostLog) {
      verifySessionPost(sessionPostLog, {
        session: mc060Session,
        total: mc060Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber,
        apiOperation: 'CREATE_SESSION',
      });
    }

    // verifySessionGet asserts the UPDATE_SESSION PUT specifically, so pick
    // it rather than whichever entry happens to be first.
    const sessionGetLog = (sessionGetLogs.logs[0]?.content ?? []).find(
      (l: any) => l.request?.type === 'PUT' && l.request?.body?.apiOperation === 'UPDATE_SESSION',
    );
    if (sessionGetLog) {
      verifySessionGet(sessionGetLog, { session: mc060Session, card: cards.visaChallenge });
    }

    const allContent = allLogs.logs[0]?.content ?? [];
    const initiateLog = allContent.find((e: any) => e.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION');
    const payerLog = allContent.find((e: any) => e.request?.body?.apiOperation === 'AUTHENTICATE_PAYER');
    expect(initiateLog).toBeUndefined();
    expect(payerLog).toBeUndefined();

    const captureLog = allContent.find((e: any) => e.request?.body?.apiOperation === 'PAY');
    if (captureLog) {
      verifyAuthorizeCaptureLog(captureLog, {
        apiOperation: 'PAY',
        session: mc060Session,
        total: mc060Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber,
        card: cards.visaChallenge,
      });
    }

    const agreementLog = allContent.find(
      (e: any) => e.request?.body?.agreement !== undefined || e.response?.body?.agreement !== undefined,
    );
    if (agreementLog && subscriptionId) {
      verifyAgreement(agreementLog, {
        subscriptionId,
        frequency: 'MONTHLY',
        payDate: mc060PayDate,
        slug: config.paymentMethodSlug,
      });
    }

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName, page: emailPage });

    await adminLogin(page);
    await navigateToOrder(page, orderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId!);
    await assertCapturedNote(page, config, transactionId!);

    expect(subscriptionId).toBeTruthy();
    await verifySubscription(page, subscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  test('MC-060 - Subscription Renewal', async ({ page }) => {
    expect(subscriptionId).toBeTruthy();

    await adminLogin(page);
    await triggerSubscriptionRenewal(page, subscriptionId);

    const renewalOrderNumber = await extractRenewalOrderNumber(page);
    expect(renewalOrderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(renewalOrderNumber, config);
    await logOrderContext(test.info().title, { orderNumber: renewalOrderNumber, transactionId });
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();
  });
});

// ============================================================================
// MC-060 variant: Save CC Deactivated (moved from suite 11-save-cc-deactivated)
// ----------------------------------------------------------------------------
// Subscriptions need a saved card to renew; with saved_cards: 'no' the addon's
// gateway-support filter rejects the gateway. Skipped pending addon-side
// investigation; sources preserved verbatim from the original suite-11 port.
// ============================================================================

test.describe.skip('Subscription Order - Challenge with Save CC Deactivated (from suite 11)', () => {
  test.beforeAll(async () => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'no',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });
  });

  let mc060OrderNumber: string;
  let mc060SubscriptionId: string;
  let mc060PayDate: string;
  let mc060Session: string;
  let mc060Total: string;

  test('MC-060 - Subscription with challenge', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, billing);
    mc060Total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaChallenge, config);

    // Save card checkbox must NOT be visible (saved_cards: 'no')
    await expect(
      page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`),
    ).not.toBeVisible();

    mc060PayDate = new Date().toISOString().slice(0, 19);
    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: mc060Total }, result);
    mc060OrderNumber = result.orderNumber;
    expect(mc060OrderNumber).toBeTruthy();
    expect(result.subscriptionId).toBeTruthy();
    mc060SubscriptionId = result.subscriptionId!;
  });

  test('MC-060 - Subscription Admin', async ({ page, emailPage }) => {
    expect(mc060OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc060OrderNumber, config);
    await logOrderContext(test.info().title, { orderNumber: mc060OrderNumber, transactionId });
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    mc060Session = getOrderMeta(order, config.sessionIdMetaKey) || '';

    const sessionGetLogs = await getLogs(mc060PayDate, `/session/${mc060Session}`);
    const allLogs = await getLogs(mc060PayDate, '');

    if (sessionGetLogs.logs[0]?.content?.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session: mc060Session, card: cards.visaChallenge });
    }

    if (allLogs.logs[0]?.content?.length) {
      const agreementLog = allLogs.logs[0].content.find(
        (l: any) => l.request?.body?.agreement,
      );
      if (agreementLog) {
        verifyAgreement(agreementLog, {
          subscriptionId: mc060SubscriptionId,
          frequency: 'MONTHLY',
          payDate: mc060PayDate,
          slug: config.paymentMethodSlug,
        });
      }
    }

    await verifyOrderEmails(mc060OrderNumber, { paymentMethodTitle: config.displayName, page: emailPage });

    await adminLogin(page);
    await navigateToOrder(page, mc060OrderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId!);
    await assertCapturedNote(page, config, transactionId!);

    expect(mc060SubscriptionId).toBeTruthy();
    await verifySubscription(page, mc060SubscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  test('MC-060 - Subscription Renewal', async ({ page }) => {
    expect(mc060SubscriptionId).toBeTruthy();

    await adminLogin(page);

    const hposUrl = `/wp-admin/admin.php?page=wc-orders--shop_subscription&action=edit&id=${mc060SubscriptionId}`;
    const classicUrl = `/wp-admin/post.php?post=${mc060SubscriptionId}&action=edit`;

    const hposMenuLink = page.locator('a[href*="wc-orders--shop_subscription"]');
    const hposEnabled = await hposMenuLink.isVisible({ timeout: 3000 }).catch(() => false);

    if (hposEnabled) {
      await page.goto(hposUrl);
    } else {
      await page.goto(classicUrl);
    }

    await page.waitForLoadState('load');

    const actionSelect = page.locator('#order_action, select[name="wc_order_action"]');
    await actionSelect.selectOption('wcs_process_renewal');

    const updateBtn = page.locator('#post-preview, button[name="save"], input[name="save"], button.components-button.is-primary').first();
    const classicUpdateBtn = page.locator('#publish');
    const wooUpdateBtn = page.locator('button.save_order, button[name="save_order"]');

    if (await classicUpdateBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await classicUpdateBtn.click();
    } else if (await wooUpdateBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await wooUpdateBtn.click();
    } else {
      await updateBtn.click();
    }

    await waitForUnblock(page);
    await page.waitForLoadState('load');

    await expect(page.locator('h1, .woocommerce-page-title, #title')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Moved from suite 14 (authorize-capture-void): MC-061 — subscription order
// charged with the gateway in transaction_mode=AUTHORIZE, then renewed.
// Source suite 14 (canonical port commit pending): subscription products need
// a registered customer + their own iframe-mount sequence; running it inside
// suite 14's serial flow after MC-022 didn't reliably mount the hosted-session
// iframe. Belongs in subscription suite 16 once 16 is canonically ported.
// Wrapped in describe.skip per the "subscription tests move, don't delete"
// rule; activate when suite 16 is ported.
// ─────────────────────────────────────────────────────────────────────────────

test.describe.skip('Subscription Order with Authorize Mode (from suite 14)', () => {
  test('MC-061 - Subscription frictionless', async ({ page, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      transaction_mode: 'AUTHORIZE',
      checkout_mode: 'hosted_session',
    });

    const subscriptionEmail = uniqueEmail();
    await registerUser(page, subscriptionEmail, billing.password);

    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = await addToCartAndCheckout(page, config.products.subscription);

    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);
    const session = await extractSessionId(page);

    await clickPlaceOrder(page);
    await page.waitForURL(/order-received/, { timeout: 60000 });
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName }, result);
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
    expect(result.subscriptionId, 'subscription id should be on the order-received page').toBeTruthy();
    const subscriptionId = result.subscriptionId!;

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    await logOrderContext(test.info().title, { orderNumber: orderNumber, transactionId, session, payDate, logOffset });
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();
    const orderSession = getOrderMeta(order, config.sessionIdMetaKey) || session;

    const sessionGetLogs = await getLogs(payDate, `/session/${session}`, logOffset);
    expect(sessionGetLogs.logs[0]?.content.length, 'session GET logs should not be empty').toBeGreaterThan(0);
    const sessionPut = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'PUT'
        && l.request?.body?.apiOperation === 'UPDATE_SESSION'
        && l.response?.body?.session?.updateStatus === 'SUCCESS'
    );
    expect(sessionPut, 'UPDATE_SESSION PUT log entry not found').toBeTruthy();
    verifySessionGet(sessionPut!, { session: orderSession, card: cards.mastercard });

    const allLogs = await getLogs(payDate, '', logOffset);
    const agreementLog = allLogs.logs[0]?.content.find(
      (l: any) => l.request?.body?.agreement
    );
    expect(agreementLog, 'agreement log not found').toBeTruthy();
    verifyAgreement(agreementLog!, {
      subscriptionId, frequency: 'MONTHLY', payDate,
      slug: config.paymentMethodSlug,
    });

    await verifyAdminEmail(orderNumber, { paymentMethodTitle: config.displayName, page: emailPage });

    await adminLogin(page);
    await navigateToOrder(page, orderNumber);
    await assertOrderStatus(page, 'On hold');
    await assertAuthorizedNote(page, config, transactionId!);

    await verifySubscription(page, subscriptionId, {
      expectedStatus: 'Active', displayName: config.displayName,
    });

    await triggerSubscriptionRenewal(page, subscriptionId);
    const renewalOrderNumber = await extractRenewalOrderNumber(page);
    expect(renewalOrderNumber).toBeTruthy();

    const { order: renewalOrder, transactionId: renewalTxn } = await verifyOrderViaAPI(renewalOrderNumber, config);
    await logOrderContext(test.info().title, { orderNumber: renewalOrderNumber, transactionId: renewalTxn, session, payDate, logOffset });
    expect(renewalOrder.payment_method).toBe(config.paymentMethodSlug);
    expect(renewalTxn).toBeTruthy();
  });
});
