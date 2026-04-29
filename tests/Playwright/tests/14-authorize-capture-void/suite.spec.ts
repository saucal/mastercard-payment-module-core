import { test, expect } from '../../fixtures/test';
import { Page } from '@playwright/test';
import {
  switchCheckoutMode,
  configureGateway,
  verifyOrderViaAPI,
  getOrderMeta,
  getLogEntryCount,
} from '../../helpers/api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  extractOrderTotal,
  extractSessionId,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { verifyOrderReceived } from '../../helpers/order-received';
import { adminLogin } from '../../helpers/wp-login';
import {
  navigateToOrder,
  assertOrderStatus,
  capturePayment,
  voidPayment,
  assertCaptureFormVisible,
  assertVoidFormVisible,
  assertAuthorizedNote,
  assertOrderNoteContains,
} from '../../helpers/admin-orders';
import {
  extractSessionGetLogs,
  extractTokenLogs,
  extractTransactionPutLogs,
  verifySessionGet,
  verifyAuthorizeCaptureLog,
  verifyVoidLog,
  verifyTokenLogsEmpty,
} from '../../helpers/log-verification';
import { verifyAdminEmail } from '../../helpers/email-verification';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

test.describe.serial('Authorize / Capture / Void', () => {
  let adminPage: Page;
  // GI source: all four MCs use 5123456789012346 = cards.mastercard (frictionless).
  const card = cards.mastercard;

  test.beforeAll(async ({ browser }) => {
    const adminContext = await browser.newContext({ ignoreHTTPSErrors: true });
    adminPage = await adminContext.newPage();
    await adminLogin(adminPage);
  });

  test.afterAll(async () => {
    await adminPage.close();
  });

  // === MC-020: Partial capture ===

  test('MC-020 - Partial capture', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      transaction_mode: 'AUTHORIZE',
      checkout_mode: 'hosted_session',
    });

    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = await addToCartAndCheckout(page, config.products.physical);

    await fillBilling(page, billing);
    const total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, card, config);
    const session = await extractSessionId(page);

    await clickPlaceOrder(page);
    await page.waitForURL(/order-received/, { timeout: 60000 });
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate, logOffset);
    expect(sessionGetLogs.logs[0]?.content.length, 'session GET logs should not be empty').toBeGreaterThan(0);
    const sessionPut = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'PUT'
        && l.request?.body?.apiOperation === 'UPDATE_SESSION'
        && l.response?.body?.session?.updateStatus === 'SUCCESS'
    );
    expect(sessionPut, 'UPDATE_SESSION PUT log entry not found').toBeTruthy();
    verifySessionGet(sessionPut!, { session, card });

    const tokenLogs = await extractTokenLogs(payDate, payDate, logOffset);
    verifyTokenLogsEmpty(tokenLogs);

    await verifyAdminEmail(orderNumber, { paymentMethodTitle: config.displayName });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'On hold');
    await assertAuthorizedNote(adminPage, config, transactionId!);
    await assertCaptureFormVisible(adminPage, config, true);
    await assertVoidFormVisible(adminPage, config, true);

    const orderTotalNum = parseFloat(String(order.total));
    const partialAmount = (orderTotalNum / 4).toFixed(2);
    await capturePayment(adminPage, config, partialAmount);
    await assertOrderStatus(adminPage, 'On hold');
    // Partial capture emits a "Partially Captured. Captured Amount: ..." note
    // (locale-formatted amount, not the structured "Captured (Order ID: ...)"
    // note that full capture uses).
    await assertOrderNoteContains(
      adminPage,
      `${config.displayName} payment was Partially Captured`,
    );

    const transactionLogs = await extractTransactionPutLogs(payDate, logOffset);
    expect(transactionLogs.logs[0]?.content.length, 'transaction PUT logs should not be empty').toBeGreaterThan(0);
    const captureLog = transactionLogs.logs[0].content.find(
      (l: any) => l.request?.body?.apiOperation === 'CAPTURE' && l.request?.url?.includes(transactionId!)
    );
    expect(captureLog, 'CAPTURE log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'CAPTURE', total: partialAmount, currency: 'USD',
      transactionId: transactionId!, orderNumber, card,
    });
  });

  // === MC-021: Full capture ===

  test('MC-021 - Full capture', async ({ page }) => {
    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = await addToCartAndCheckout(page, config.products.digital);

    await fillBilling(page, billing);
    const total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, card, config);
    const session = await extractSessionId(page);

    await clickPlaceOrder(page);
    await page.waitForURL(/order-received/, { timeout: 60000 });
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(transactionId).toBeTruthy();

    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate, logOffset);
    expect(sessionGetLogs.logs[0]?.content.length, 'session GET logs should not be empty').toBeGreaterThan(0);
    const sessionPut = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'PUT'
        && l.request?.body?.apiOperation === 'UPDATE_SESSION'
        && l.response?.body?.session?.updateStatus === 'SUCCESS'
    );
    expect(sessionPut, 'UPDATE_SESSION PUT log entry not found').toBeTruthy();
    verifySessionGet(sessionPut!, { session, card });

    await verifyAdminEmail(orderNumber, { paymentMethodTitle: config.displayName });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'On hold');
    await assertAuthorizedNote(adminPage, config, transactionId!);

    const orderTotalStr = String(order.total);
    // GI step 314 always fills the capture amount field; without it the
    // gateway's CAPTURE button submits 0 and the order stays On hold.
    await capturePayment(adminPage, config, orderTotalStr);

    // Reload to refresh select2 status widget — capturePayment posts via WP
    // admin "Order updated" notice but the status dropdown only re-renders
    // on the next page load.
    await navigateToOrder(adminPage, orderNumber);
    const statusEl = adminPage.locator('#select2-order_status-container');
    const status = await statusEl.textContent() || '';
    expect(
      ['Processing', 'Completed'].some(s => status.includes(s)),
      `expected Processing or Completed after full capture, got "${status}"`,
    ).toBeTruthy();
    await assertOrderNoteContains(
      adminPage,
      `${config.displayName} payment was Captured (Order ID: ${transactionId})`,
    );

    const transactionLogs = await extractTransactionPutLogs(payDate, logOffset);
    const captureLog = transactionLogs.logs[0]?.content.find(
      (l: any) => l.request?.body?.apiOperation === 'CAPTURE' && l.request?.url?.includes(transactionId!)
    );
    expect(captureLog, 'CAPTURE log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'CAPTURE', total: orderTotalStr, currency: 'USD',
      transactionId: transactionId!, orderNumber, card,
    });
  });

  // === MC-022: Void payment ===

  test('MC-022 - Void payment', async ({ page }) => {
    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = await addToCartAndCheckout(page, config.products.physical);

    await fillBilling(page, billing);
    const total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, card, config);

    await clickPlaceOrder(page);
    await page.waitForURL(/order-received/, { timeout: 60000 });
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    const { transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(transactionId).toBeTruthy();

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'On hold');
    await assertAuthorizedNote(adminPage, config, transactionId!);

    await voidPayment(adminPage, config);

    // Status select is bound at page load; reload to see the new value.
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Cancelled');
    await assertCaptureFormVisible(adminPage, config, false);
    await assertVoidFormVisible(adminPage, config, false);
    await assertOrderNoteContains(adminPage, 'Authorization was cancelled');

    const transactionLogs = await extractTransactionPutLogs(payDate, logOffset);
    const voidLog = transactionLogs.logs[0]?.content.find(
      (l: any) => l.request?.body?.apiOperation === 'VOID' && l.request?.url?.includes(transactionId!)
    );
    expect(voidLog, 'VOID log not found').toBeTruthy();
    verifyVoidLog(voidLog!, {
      transactionId: transactionId!, orderNumber, currency: 'USD', card,
    });
  });

  // MC-061 (subscription order with authorize mode + renewal) was here.
  // Moved to suite 16 (subscription suite) — subscription products need
  // their own bundle, and registerUser-from-checkout into a hosted-session
  // iframe didn't reliably mount the iframe under suite 14's serial flow.
});
