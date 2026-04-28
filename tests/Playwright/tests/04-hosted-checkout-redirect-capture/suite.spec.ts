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

// Hosted-checkout REDIRECT mode — same server-side log shape as embedded
// (only INITIATE_CHECKOUT is logged on the merchant side; INIT_AUTH /
// AUTHENTICATE_PAYER / PAY all happen inside MPGS). The difference is that
// redirect navigates the buyer's browser to test-gateway.mastercard.com
// instead of embedding an iframe — helpers branch on the `redirect` mode.
test.describe.serial('Hosted Checkout - Redirect - Capture', () => {
  let orderNumber: string;
  const mc005Email = uniqueEmail();
  // MC-008 reuses the MC-005 account so the buyer already has a saved
  // billing address (newly registered users have no billing and the
  // checkout stalls).
  const mc008Email = mc005Email;

  let payDate: string;
  let total: string;
  let logOffset: number;

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

    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

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

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);
  });

  // === MC-005: New user ===

  test('MC-005 - New user', async ({ page }) => {
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

    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

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

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    await frontendLogin(page, mc005Email, billing.password);
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-008: Logged user ===

  test('MC-008 - Logged user', async ({ page }) => {
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

    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

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

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    await frontendLogin(page, mc008Email, billing.password);
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-011: Pay for order ===

  test('MC-011 - Pay for order', async ({ page }) => {
    const { orderId, orderKey, total: orderTotal } = await createPendingOrder(config.products.physical);
    total = orderTotal;

    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    await page.goto(`/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`);
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
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

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

    // Skip email verification — REST-created pending order has no billing.email.

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);
  });
});
