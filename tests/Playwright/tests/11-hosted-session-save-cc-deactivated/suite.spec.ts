import { test, expect } from '../../fixtures/test';
import { Page } from '@playwright/test';
import {
  switchCheckoutMode,
  configureGateway,
  verifyOrderViaAPI,
  getLogEntryCount,
} from '../../helpers/api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  createAccountAtCheckout,
  extractOrderTotal,
  extractSessionId,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { verifyOrderReceived } from '../../helpers/order-received';
import { verifyCartEmpty, verifyPaymentMethods } from '../../helpers/my-account';
import { adminLogin, frontendLogin } from '../../helpers/wp-login';
import {
  navigateToOrder,
  assertOrderStatus,
  assertPaymentMethodMeta,
  assertCapturedNote,
} from '../../helpers/admin-orders';
import {
  extractAllLogs,
  extractSessionPostLogs,
  extractSessionGetLogs,
  extractTokenLogs,
  verifySessionPost,
  verifySessionGet,
  verifySessionGetCardDetails,
  verifyAuthorizeCaptureLog,
  verifyTokenLogsEmpty,
} from '../../helpers/log-verification';
import { verifyOrderEmails } from '../../helpers/email-verification';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

test.describe.serial('Hosted Session - Save CC Deactivated', () => {
  let adminPage: Page;
  const mc031Email = uniqueEmail();

  test.beforeAll(async ({ browser }) => {
    const adminContext = await browser.newContext({ ignoreHTTPSErrors: true });
    adminPage = await adminContext.newPage();
    await adminLogin(adminPage);
  });

  test.afterAll(async () => {
    await adminPage.close();
  });

  // Verifies a successful purchase with save_cards: 'no' — runs the full
  // log + admin pipeline and asserts no token logs were emitted.
  async function runSuccessFlow(opts: {
    page: Page;
    card: typeof cards.mastercard;
    expectedSavedCards: number | 'skip';
    loginAfterPurchase?: { email: string; password: string };
  }): Promise<void> {
    const { page, card, expectedSavedCards, loginAfterPurchase } = opts;

    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = await addToCartAndCheckout(page, config.products.physical);
    const sessionDate = payDate;
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);

    // Save-card UI must NOT be present (saved_cards = 'no')
    await expect(
      page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`),
      'save-card label should not render',
    ).not.toBeVisible();
    await expect(
      page.locator('text=Save to account'),
      'save-card label should not render',
    ).not.toBeVisible();

    await fillHostedSessionCC(page, card, config);

    const total = await extractOrderTotal(page);
    const session = await extractSessionId(page);

    await clickPlaceOrder(page);
    await page.waitForURL(/order-received/, { timeout: 60000 });
    const result = await verifyOrderReceived(page, {
      displayName: config.displayName,
      expectedTotal: total,
    });
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    const allLogs = await extractAllLogs(payDate, logOffset);
    const sessionPostLogs = await extractSessionPostLogs(payDate, sessionDate, '', '', logOffset);
    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate, logOffset);
    const tokenLogs = await extractTokenLogs(payDate, payDate, logOffset);

    expect(sessionPostLogs.logs[0]?.content.length, 'session POST logs should not be empty').toBeGreaterThan(0);
    const sessionPostLog = session
      ? sessionPostLogs.logs[0].content.find((l: any) => l.response?.body?.session?.id === session)
      : sessionPostLogs.logs[0].content[0];
    expect(sessionPostLog, `session POST entry not found for session ${session}`).toBeTruthy();
    verifySessionPost(sessionPostLog!, {
      session, total, currency: 'USD', transactionId: transactionId!, orderNumber,
    });

    expect(sessionGetLogs.logs[0]?.content.length, 'session GET logs should not be empty').toBeGreaterThan(0);
    const sessionPut = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'PUT'
        && l.request?.body?.apiOperation === 'UPDATE_SESSION'
        && l.response?.body?.session?.updateStatus === 'SUCCESS'
    );
    expect(sessionPut, 'UPDATE_SESSION PUT log entry not found').toBeTruthy();
    verifySessionGet(sessionPut!, { session, card });
    const sessionGet = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'GET'
        && l.request?.url?.includes('/session/')
        && l.response?.body?.session?.id === session
    );
    expect(sessionGet, 'session GET card details entry not found').toBeTruthy();
    verifySessionGetCardDetails(sessionGet!, { session, card });

    // Token logs must be EMPTY when saved_cards is off
    verifyTokenLogsEmpty(tokenLogs);

    expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
    const logContent = allLogs.logs[0].content;
    const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card,
    });

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    if (loginAfterPurchase) {
      await frontendLogin(page, loginAfterPurchase.email, loginAfterPurchase.password);
    }
    if (expectedSavedCards !== 'skip') {
      await verifyPaymentMethods(page, { expectedCards: expectedSavedCards });
    }
  }

  // === MC-030: Guest checkout, save CC deactivated ===

  test('MC-030 - Guest checkout', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'no',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });

    // Guest has no /my-account/, skip the saved-cards check.
    await runSuccessFlow({
      page,
      card: cards.mastercard,
      expectedSavedCards: 'skip',
    });
  });

  // === MC-031: New user, save CC deactivated ===

  test('MC-031 - New user', async ({ page }) => {
    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = await addToCartAndCheckout(page, config.products.digital);
    const sessionDate = payDate;
    await fillBilling(page, { ...billing, email: mc031Email });
    await createAccountAtCheckout(page, billing.password);

    await selectPaymentMethod(page, config);
    await expect(
      page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`),
      'save-card label should not render',
    ).not.toBeVisible();

    await fillHostedSessionCC(page, cards.mastercard, config);
    const total = await extractOrderTotal(page);
    const session = await extractSessionId(page);

    await clickPlaceOrder(page);
    await page.waitForURL(/order-received/, { timeout: 60000 });
    const result = await verifyOrderReceived(page, {
      displayName: config.displayName,
      expectedTotal: total,
    });
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    const tokenLogs = await extractTokenLogs(payDate, payDate, logOffset);
    verifyTokenLogsEmpty(tokenLogs);

    const allLogs = await extractAllLogs(payDate, logOffset);
    const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);
    const captureLog = allLogs.logs[0]?.content.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    await frontendLogin(page, mc031Email, billing.password);
    await verifyPaymentMethods(page, { expectedCards: 0 });

    // session/sessionDate touched to keep names imported and parallel to runSuccessFlow
    void sessionDate;
    void session;
  });

  // === MC-032: Logged user pays with new CC, save CC deactivated ===

  test('MC-032 - Logged user pay with new CC', async ({ page }) => {
    await frontendLogin(page, mc031Email, billing.password);

    await runSuccessFlow({
      page,
      card: cards.mastercard2,
      expectedSavedCards: 0,
    });
  });

  // MC-060 (subscription with challenge, saved_cards: 'no') not ported here.
  // Subscriptions require a saved payment method to renew; with saved_cards
  // disabled the gateway is filtered out by the subscription addon. Any port
  // of this scenario belongs in suites 16-18.
});
