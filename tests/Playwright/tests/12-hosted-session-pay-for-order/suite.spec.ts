import { test, expect } from '@playwright/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI, getOrderMeta } from '../../helpers/api';
import {
  selectPaymentMethod,
  clickPlaceOrder,
  clickSaveCardCheckbox,
  selectSavedToken,
  extractOrderTotal,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { verifyOrderReceived } from '../../helpers/order-received';
import { verifyPaymentMethods } from '../../helpers/my-account';
import { frontendLogin, registerUser } from '../../helpers/wp-login';
import { adminLogin } from '../../helpers/wp-login';
import { waitForUnblock } from '../../helpers/block-ui';
import {
  navigateToOrder,
  assertOrderStatus,
  assertPaymentMethodMeta,
  assertCapturedNote,
} from '../../helpers/admin-orders';
import {
  extractSessionPostLogs,
  extractSessionGetLogs,
  extractTokenLogs,
  verifySessionPost,
  verifySessionGet,
  verifyTokenLog,
  verifyTokenLogsEmpty,
  verifyAuthorizeCaptureLog,
} from '../../helpers/log-verification';
import { verifyOrderEmails } from '../../helpers/email-verification';
import config from '../../plugin-config';
import { cards, fourDigits } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

const BASE_URL = process.env.WP_BASE_URL || 'https://mastercard-saucal.sa.ngrok.io';
const WOO_USER = process.env.WOO_USER || '';
const WOO_PASS = process.env.WOO_PASS || '';

async function createPendingOrder(productId: number): Promise<{ orderId: string; orderKey: string }> {
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
  return { orderId: String(order.id), orderKey: order.order_key };
}

test.describe.serial('Hosted Session - Pay For Order', () => {
  const mc011Email = uniqueEmail();

  // === MC-011: Pay for order, not saving CC ===

  let mc011OrderNumber: string;
  let mc011PayDate: string;
  let mc011Session: string;
  let mc011Total: string;

  test('MC-011 - Pay for order not saving CC', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });

    // Register user first
    await registerUser(page, mc011Email, billing.password);

    // Create a pending order via WC REST API
    const { orderId, orderKey } = await createPendingOrder(config.products.physical);

    // Navigate to pay-for-order page
    await page.goto(`/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`);
    await page.waitForLoadState('networkidle');

    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);

    // Do NOT click save card checkbox

    mc011PayDate = new Date().toISOString().slice(0, 10);
    await clickPlaceOrder(page);
    await waitForUnblock(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: mc011Total });
    mc011OrderNumber = result.orderNumber;
    expect(mc011OrderNumber).toBeTruthy();
  });

  test('MC-011 - Pay for order not saving CC - Admin', async ({ page }) => {
    expect(mc011OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc011OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    mc011Session = getOrderMeta(order, config.sessionIdMetaKey) || '';

    // Phase 2: Log extraction
    const sessionGetLogs = await extractSessionGetLogs(mc011PayDate, mc011Session, mc011PayDate);
    const tokenLogs = await extractTokenLogs(mc011PayDate, mc011PayDate);

    // Phase 3: Verify session GET
    if (sessionGetLogs.logs[0]?.content?.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session: mc011Session, card: cards.mastercard });
    }

    // Phase 4: Token logs empty (not saving CC)
    verifyTokenLogsEmpty(tokenLogs);

    // Phase 11: Email verification
    await verifyOrderEmails(mc011OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend
    await adminLogin(page);
    await navigateToOrder(page, mc011OrderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId!);
    await assertCapturedNote(page, config, transactionId!);
  });

  // === MC-012: Pay for order, saving CC ===

  let mc012OrderNumber: string;
  let mc012PayDate: string;
  let mc012Session: string;
  // mc012Token is captured in admin test and used by MC-013 admin test
  let mc012Token: string;

  test('MC-012 - Pay for order saving CC', async ({ page }) => {
    // Login as mc011 user
    await frontendLogin(page, mc011Email, billing.password);

    // Create a pending order via WC REST API
    const { orderId, orderKey } = await createPendingOrder(config.products.physical);

    // Navigate to pay-for-order page
    await page.goto(`/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`);
    await page.waitForLoadState('networkidle');

    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);
    await clickSaveCardCheckbox(page);

    mc012PayDate = new Date().toISOString().slice(0, 10);
    await clickPlaceOrder(page);
    await waitForUnblock(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc012OrderNumber = result.orderNumber;
    expect(mc012OrderNumber).toBeTruthy();
  });

  test('MC-012 - Pay for order saving CC - Admin', async ({ page }) => {
    expect(mc012OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc012OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    mc012Session = getOrderMeta(order, config.sessionIdMetaKey) || '';
    mc012Token = getOrderMeta(order, config.tokenMetaKey) || '';

    // Phase 2: Log extraction
    const sessionGetLogs = await extractSessionGetLogs(mc012PayDate, mc012Session, mc012PayDate);
    const tokenLogs = await extractTokenLogs(mc012PayDate, mc012PayDate);

    // Phase 3: Verify session GET
    if (sessionGetLogs.logs[0]?.content?.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session: mc012Session, card: cards.mastercard });
    }

    // Phase 4: Token log present (saving CC)
    if (tokenLogs.logs[0]?.content?.length) {
      const tokenLog = tokenLogs.logs[0].content[0];
      verifyTokenLog(tokenLog, { session: mc012Session, card: cards.mastercard });
    }

    // Phase 11: Email verification
    await verifyOrderEmails(mc012OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend
    await adminLogin(page);
    await navigateToOrder(page, mc012OrderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId!);
    await assertCapturedNote(page, config, transactionId!);

    // Phase 13: My Account – 1 saved card
    await frontendLogin(page, mc011Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
      expiryMonth: cards.mastercard.month,
      expiryYear: cards.mastercard.year,
    });
  });

  // === MC-013: Pay for order with saved CC ===

  let mc013OrderNumber: string;
  let mc013PayDate: string;
  let mc013Session: string;

  test('MC-013 - Pay for order with saved CC', async ({ page }) => {
    // Login as mc011 user (has 1 saved card from MC-012)
    await frontendLogin(page, mc011Email, billing.password);

    // Create a pending order via WC REST API
    const { orderId, orderKey } = await createPendingOrder(config.products.physical);

    // Navigate to pay-for-order page
    await page.goto(`/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`);
    await page.waitForLoadState('networkidle');

    await selectPaymentMethod(page, config);
    await selectSavedToken(page, 1);

    mc013PayDate = new Date().toISOString().slice(0, 10);
    await clickPlaceOrder(page);
    await waitForUnblock(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc013OrderNumber = result.orderNumber;
    expect(mc013OrderNumber).toBeTruthy();
  });

  test('MC-013 - Pay for order with saved CC - Admin', async ({ page }) => {
    expect(mc013OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc013OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    mc013Session = getOrderMeta(order, config.sessionIdMetaKey) || '';

    // Phase 2: Log extraction
    const sessionGetLogs = await extractSessionGetLogs(mc013PayDate, mc013Session, mc013PayDate);

    // Phase 3: Verify session GET has token (using saved CC)
    if (sessionGetLogs.logs[0]?.content?.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, {
        session: mc013Session,
        card: cards.mastercard,
        token: mc012Token,
      });
    }

    // Phase 11: Email verification
    await verifyOrderEmails(mc013OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend
    await adminLogin(page);
    await navigateToOrder(page, mc013OrderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId!);
    await assertCapturedNote(page, config, transactionId!);
  });
});
