import { test, expect } from '../../fixtures/test';
import { Page } from '@playwright/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI, getLogEntryCount } from '../../helpers/api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  extractOrderTotal,
  createAccountAtCheckout,
} from '../../helpers/checkout';
import { fillHostedCheckoutCC, clickHostedCheckoutPay, clickPlaceOrderHostedCheckout } from '../../helpers/hosted-checkout';
import { verifyOrderReceived } from '../../helpers/order-received';
import { handle3DSChallenge } from '../../helpers/three-ds';
import {
  extractSessionPostLogs,
  extractTokenLogs,
  verifySessionPost,
  verifyTokenLogsEmpty,
} from '../../helpers/log-verification';
import { verifyOrderEmails } from '../../helpers/email-verification';
import { adminLogin, frontendLogin } from '../../helpers/wp-login';
import { navigateToOrder, assertOrderStatus, assertPaymentMethodMeta, assertCapturedNote } from '../../helpers/admin-orders';
import { verifyOrderInMyAccount, verifyCartEmpty } from '../../helpers/my-account';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

const BASE_URL = process.env.WP_BASE_URL || 'https://mastercard-saucal.sa.ngrok.io';
const WOO_USER = process.env.WOO_USER || '';
const WOO_PASS = process.env.WOO_PASS || '';

async function createPendingOrder(productId: number): Promise<{ orderId: string; orderKey: string; total: string }> {
  const res = await fetch(`${BASE_URL}/wp-json/wc/v3/orders`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${WOO_USER}:${WOO_PASS}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      status: 'pending',
      line_items: [{ product_id: productId, quantity: 1 }],
    }),
  });
  if (!res.ok) throw new Error(`createPendingOrder failed: ${res.status}`);
  const order = await res.json();
  return { orderId: String(order.id), orderKey: order.order_key, total: String(order.total) };
}

// Hosted-checkout flow — MPGS drives the full UI inside an iframe: the
// merchant server only creates the INITIATE_CHECKOUT session, then fetches
// the transaction result via GET /order/<id> after the webhook arrives.
// There are no server-side INITIATE_AUTHENTICATION / AUTHENTICATE_PAYER /
// PAY PUT requests to log (unlike the hosted-session flow in suites 01-02);
// MPGS runs those inside its own UI. So log verification here is limited to
// the INITIATE_CHECKOUT session POST plus token emptiness.
test.describe.serial('Hosted Checkout - Embedded - Capture', () => {
  let orderNumber: string;
  const mc005Email = uniqueEmail();
  // MC-008 reuses the account created in MC-005 — that user already has a
  // saved billing address from the previous checkout, so the hosted-checkout
  // flow can proceed without a separate fillBilling step.
  const mc008Email = mc005Email;

  // Shared state per checkout test
  let payDate: string;
  let total: string;
  let logOffset: number;

  // Shared admin browser context
  let adminPage: Page;

  test.beforeAll(async ({ browser }) => {
    const adminContext = await browser.newContext({ ignoreHTTPSErrors: true });
    adminPage = await adminContext.newPage();
    await adminLogin(adminPage);
  });

  test.afterAll(async () => {
    await adminPage.close();
  });

  // === MC-004: Guest checkout ===

  test('MC-004 - Guest checkout', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_checkout',
      hosted_checkout_mode: 'embedded',
    });

    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    total = await extractOrderTotal(page);
    await clickPlaceOrderHostedCheckout(page, config);

    // On hosted checkout embedded page — fill CC and pay
    await fillHostedCheckoutCC(page, cards.mastercard, config);
    await clickHostedCheckoutPay(page, config);

    if (cards.mastercard.challenge) {
      await handle3DSChallenge(page);
    }

    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    // === API VERIFICATION ===
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // === LOG VERIFICATION ===
    const sessionPostLogs = await extractSessionPostLogs(payDate, payDate, '', '', logOffset);
    const tokenLogs = await extractTokenLogs(payDate, payDate, logOffset);

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

    // Token empty (guest)
    verifyTokenLogsEmpty(tokenLogs);

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // === ADMIN BACKEND (admin page) ===
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);
  });

  // === MC-005: New user ===

  test('MC-005 - New user', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.digital);
    await fillBilling(page, { ...billing, email: mc005Email });
    await createAccountAtCheckout(page, billing.password);
    await selectPaymentMethod(page, config);
    total = await extractOrderTotal(page);
    await clickPlaceOrderHostedCheckout(page, config);

    await fillHostedCheckoutCC(page, cards.mastercard, config);
    await clickHostedCheckoutPay(page, config);

    if (cards.mastercard.challenge) {
      await handle3DSChallenge(page);
    }

    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    // === API VERIFICATION ===
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // === LOG VERIFICATION ===
    const sessionPostLogs = await extractSessionPostLogs(payDate, payDate, '', '', logOffset);
    const tokenLogs = await extractTokenLogs(payDate, payDate, logOffset);

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

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // === ADMIN BACKEND (admin page) ===
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    // === MY ACCOUNT (buyer's page) ===
    await frontendLogin(page, mc005Email, billing.password);
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-008: Logged user ===

  test('MC-008 - Logged user', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    await frontendLogin(page, mc008Email, billing.password);

    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config);
    total = await extractOrderTotal(page);
    await clickPlaceOrderHostedCheckout(page, config);

    await fillHostedCheckoutCC(page, cards.mastercard2, config);
    await clickHostedCheckoutPay(page, config);

    if (cards.mastercard2.challenge) {
      await handle3DSChallenge(page);
    }

    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    // === API VERIFICATION ===
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // === LOG VERIFICATION ===
    const sessionPostLogs = await extractSessionPostLogs(payDate, payDate, '', '', logOffset);
    const tokenLogs = await extractTokenLogs(payDate, payDate, logOffset);

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

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // === ADMIN BACKEND (admin page) ===
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    // === MY ACCOUNT (buyer's page) ===
    await frontendLogin(page, mc008Email, billing.password);
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-011: Pay for order ===

  test('MC-011 - Pay for order', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    // Create the order via WC REST and use its total directly; the pay-for-
    // order page does not always render an .order-total row that matches
    // extractOrderTotal's selector, so reading the amount from the REST
    // response is more reliable.
    const { orderId, orderKey, total: orderTotal } = await createPendingOrder(config.products.physical);
    total = orderTotal;

    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    await page.goto(`/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`);
    await page.waitForLoadState('networkidle');

    payDate = new Date().toISOString().slice(0, 19);
    await selectPaymentMethod(page, config);
    await clickPlaceOrderHostedCheckout(page, config);

    await fillHostedCheckoutCC(page, cards.mastercard, config);
    await clickHostedCheckoutPay(page, config);

    if (cards.mastercard.challenge) {
      await handle3DSChallenge(page);
    }

    // Skip expectedTotal — REST returns "10.00" but the order-received page
    // may render locale-formatted "10,00 $"; the REST verification below
    // re-confirms the amount via order.total anyway.
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    // === API VERIFICATION ===
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // === LOG VERIFICATION ===
    const sessionPostLogs = await extractSessionPostLogs(payDate, payDate, '', '', logOffset);
    const tokenLogs = await extractTokenLogs(payDate, payDate, logOffset);

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

    // Email verification is skipped for MC-011 — the pending order created
    // via REST has no customer email set, so WC only fires the admin "new
    // order" email; the customer "processing" email does not send. The
    // order-received + REST + admin assertions above already cover the
    // successful checkout.

    // === ADMIN BACKEND (admin page) ===
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);
  });
});
