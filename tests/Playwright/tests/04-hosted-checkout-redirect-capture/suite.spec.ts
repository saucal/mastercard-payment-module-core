import { test, expect } from '../../fixtures/test';
import {
  switchCheckoutMode, configureGateway, verifyOrderViaAPI, getLogEntryCount, getLogs,
  findCustomerIdByEmail, createPendingOrder,
} from '../../helpers/wc-api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  extractOrderTotal,
  createAccountAtCheckout,
} from '../../helpers/checkout';
import { fillHostedCheckoutCC, clickHostedCheckoutPay, clickPlaceOrderHostedCheckout } from '../../helpers/hosted-checkout';
import { collectOrderReceivedData } from '../../helpers/flows';
import { handle3DSChallenge } from '../../helpers/three-ds';
import {
  expectedOrderStatus,
  verifySessionPost,
  verifyTokenLogsEmpty,
  verifyOrderEmails,
  assertOrderStatus,
  assertPaymentMethodMeta,
  assertCapturedNote,
  assertOrderReceived,
  verifyOrderInMyAccount,
  verifyCartEmpty,
} from '../../helpers/assertions';
import { frontendLogin, registerUser } from '../../helpers/wp-login';
import { navigateToOrder } from '../../helpers/admin-orders';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';
import { logOrderContext } from '../../helpers/debug';
import { siteUrl, siteEnv } from '../../helpers/site';

const BASE_URL = siteUrl();
const WOO_USER = siteEnv('WOO_USER');
const WOO_PASS = siteEnv('WOO_PASS');

// Hosted-checkout REDIRECT mode — same server-side log shape as embedded
// (only INITIATE_CHECKOUT is logged on the merchant side; INIT_AUTH /
// AUTHENTICATE_PAYER / PAY all happen inside MPGS). The difference is that
// redirect navigates the buyer's browser to test-gateway.mastercard.com
// instead of embedding an iframe — helpers branch on the `redirect` mode.
//
// AUDIT 2026-04-29 vs GI:
// - JUSTIFIED FIX (MC-011): skips email + expectedTotal (REST-created
//   pending order has no billing.email).
// - MISSING: GI buyer-side subscription assertions relocated to suite
//   16-subscription-renewal as `test.describe.skip(...)` per the
//   move-not-delete rule. Activate when suite 16 is canonically ported.
test.describe.serial('Hosted Checkout - Redirect - Capture', () => {
  let orderNumber: string;
  const mc005Email = uniqueEmail();
  // Pay-for-order needs an account that owns the order, as in suite 03.
  const mc011Email = uniqueEmail();
  // MC-008 reuses the MC-005 account so the buyer already has a saved
  // billing address (newly registered users have no billing and the
  // checkout stalls).
  const mc008Email = mc005Email;

  let payDate: string;
  let total: string;
  let logOffset: number;




  // === MC-004: Guest checkout ===

  test('MC-004 - Guest checkout', async ({ page, emailPage, adminPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_checkout',
      hosted_checkout_mode: 'redirect',
    });

    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    total = await extractOrderTotal(page);
    await clickPlaceOrderHostedCheckout(page, config, 'redirect');

    await fillHostedCheckoutCC(page, cards.mastercard, config, 'redirect');
    await clickHostedCheckoutPay(page, config, 'redirect');

    if (cards.mastercard.challenge) {
      await handle3DSChallenge(page);
    }

    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, result);
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    await logOrderContext(test.info().title, { orderNumber: orderNumber, transactionId, total, payDate, logOffset });
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    const sessionPostLogs = await getLogs(payDate, '/session', logOffset);
    const tokenLogs = await getLogs(payDate, '/token', logOffset);

    expect(sessionPostLogs.logs[0]?.content.length, 'session POST logs should not be empty').toBeGreaterThan(0);
    const sessionPostLog = sessionPostLogs.logs[0].content.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_CHECKOUT'
        && l.response?.body?.result === 'SUCCESS'
        && String(l.request?.body?.order?.reference) === String(orderNumber)
    );
    expect(sessionPostLog, `INITIATE_CHECKOUT session POST entry not found for order ${orderNumber}`).toBeTruthy();
    const resolvedSession: string = sessionPostLog!.response.body.session?.id || '';
    expect(resolvedSession, 'session id not returned from INITIATE_CHECKOUT').toBeTruthy();
    verifySessionPost(sessionPostLog!, {
      session: resolvedSession, total, currency: 'USD', transactionId: transactionId!, orderNumber,
      apiOperation: 'INITIATE_CHECKOUT',
    });

    verifyTokenLogsEmpty(tokenLogs);

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName, page: emailPage });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);
  });

  // === MC-005: New user ===

  test('MC-005 - New user', async ({ page, emailPage, adminPage }) => {
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.digital);
    await fillBilling(page, { ...billing, email: mc005Email });
    await createAccountAtCheckout(page, billing.password);
    await selectPaymentMethod(page, config);
    total = await extractOrderTotal(page);
    await clickPlaceOrderHostedCheckout(page, config, 'redirect');

    await fillHostedCheckoutCC(page, cards.mastercard, config, 'redirect');
    await clickHostedCheckoutPay(page, config, 'redirect');

    if (cards.mastercard.challenge) {
      await handle3DSChallenge(page);
    }

    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, result);
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    await logOrderContext(test.info().title, { orderNumber: orderNumber, transactionId, total, payDate, logOffset });
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    const sessionPostLogs = await getLogs(payDate, '/session', logOffset);
    const tokenLogs = await getLogs(payDate, '/token', logOffset);

    expect(sessionPostLogs.logs[0]?.content.length, 'session POST logs should not be empty').toBeGreaterThan(0);
    const sessionPostLog = sessionPostLogs.logs[0].content.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_CHECKOUT'
        && l.response?.body?.result === 'SUCCESS'
        && String(l.request?.body?.order?.reference) === String(orderNumber)
    );
    expect(sessionPostLog, `INITIATE_CHECKOUT session POST entry not found for order ${orderNumber}`).toBeTruthy();
    const resolvedSession: string = sessionPostLog!.response.body.session?.id || '';
    expect(resolvedSession, 'session id not returned from INITIATE_CHECKOUT').toBeTruthy();
    verifySessionPost(sessionPostLog!, {
      session: resolvedSession, total, currency: 'USD', transactionId: transactionId!, orderNumber,
      apiOperation: 'INITIATE_CHECKOUT',
    });

    verifyTokenLogsEmpty(tokenLogs);

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName, page: emailPage });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, expectedOrderStatus({ product: 'download', transaction: 'capture' }));
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    await frontendLogin(page, mc005Email, billing.password);
    await verifyOrderInMyAccount(page, orderNumber, expectedOrderStatus({ product: 'download', transaction: 'capture' }), { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-008: Logged user ===

  test('MC-008 - Logged user', async ({ page, emailPage, adminPage }) => {
    await frontendLogin(page, mc008Email, billing.password);

    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config);
    total = await extractOrderTotal(page);
    await clickPlaceOrderHostedCheckout(page, config, 'redirect');

    await fillHostedCheckoutCC(page, cards.mastercard2, config, 'redirect');
    await clickHostedCheckoutPay(page, config, 'redirect');

    if (cards.mastercard2.challenge) {
      await handle3DSChallenge(page);
    }

    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, result);
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    await logOrderContext(test.info().title, { orderNumber: orderNumber, transactionId, total, payDate, logOffset });
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    const sessionPostLogs = await getLogs(payDate, '/session', logOffset);
    const tokenLogs = await getLogs(payDate, '/token', logOffset);

    expect(sessionPostLogs.logs[0]?.content.length, 'session POST logs should not be empty').toBeGreaterThan(0);
    const sessionPostLog = sessionPostLogs.logs[0].content.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_CHECKOUT'
        && l.response?.body?.result === 'SUCCESS'
        && String(l.request?.body?.order?.reference) === String(orderNumber)
    );
    expect(sessionPostLog, `INITIATE_CHECKOUT session POST entry not found for order ${orderNumber}`).toBeTruthy();
    const resolvedSession: string = sessionPostLog!.response.body.session?.id || '';
    expect(resolvedSession, 'session id not returned from INITIATE_CHECKOUT').toBeTruthy();
    verifySessionPost(sessionPostLog!, {
      session: resolvedSession, total, currency: 'USD', transactionId: transactionId!, orderNumber,
      apiOperation: 'INITIATE_CHECKOUT',
    });

    verifyTokenLogsEmpty(tokenLogs);

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName, page: emailPage });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    await frontendLogin(page, mc008Email, billing.password);
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-011: Pay for order ===

  test('MC-011 - Pay for order', async ({ page, adminPage }) => {
    await registerUser(page, mc011Email, billing.password);
    const customerId = await findCustomerIdByEmail(mc011Email);
    const { orderId, orderKey, total: orderTotal, paymentUrl } = await createPendingOrder({
      productId: config.products.physical, customerId, email: mc011Email, billing,
    });
    total = orderTotal;

    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    // WooCommerce's own pay URL points at whatever page this install uses for
    // checkout; a hand-built /checkout/… path lands on the cart when the
    // checkout page lives elsewhere (e.g. /checkout-blocks/).
    await page.goto(paymentUrl || `/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`);
    await page.waitForLoadState('networkidle');

    payDate = new Date().toISOString().slice(0, 19);
    await selectPaymentMethod(page, config);
    await clickPlaceOrderHostedCheckout(page, config, 'redirect');

    await fillHostedCheckoutCC(page, cards.mastercard, config, 'redirect');
    await clickHostedCheckoutPay(page, config, 'redirect');

    if (cards.mastercard.challenge) {
      await handle3DSChallenge(page);
    }

    // Skip expectedTotal — locale-formatted total may not match the REST
    // "10.00" string; REST verification below re-confirms the amount.
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName }, result);
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    await logOrderContext(test.info().title, { orderNumber: orderNumber, transactionId, total, payDate, logOffset });
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    const sessionPostLogs = await getLogs(payDate, '/session', logOffset);
    const tokenLogs = await getLogs(payDate, '/token', logOffset);

    expect(sessionPostLogs.logs[0]?.content.length, 'session POST logs should not be empty').toBeGreaterThan(0);
    const sessionPostLog = sessionPostLogs.logs[0].content.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_CHECKOUT'
        && l.response?.body?.result === 'SUCCESS'
        && String(l.request?.body?.order?.reference) === String(orderNumber)
    );
    expect(sessionPostLog, `INITIATE_CHECKOUT session POST entry not found for order ${orderNumber}`).toBeTruthy();
    const resolvedSession: string = sessionPostLog!.response.body.session?.id || '';
    expect(resolvedSession, 'session id not returned from INITIATE_CHECKOUT').toBeTruthy();
    verifySessionPost(sessionPostLog!, {
      session: resolvedSession, total, currency: 'USD', transactionId: transactionId!, orderNumber,
      apiOperation: 'INITIATE_CHECKOUT',
    });

    verifyTokenLogsEmpty(tokenLogs);

    // Skip email verification — REST-created pending order has no billing.email.

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);
  });
});
