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
  selectSavedToken,
} from '../../helpers/checkout';
import {
  fillHostedSessionCC,
  fillHostedSessionCCPartial,
  assertSessionFieldsPresent,
} from '../../helpers/hosted-session';
import { handle3DSChallenge } from '../../helpers/three-ds';
import { verifyOrderReceived } from '../../helpers/order-received';
import {
  selectGatewayOnAddPaymentMethod,
  verifyPaymentMethods,
  deletePaymentMethod,
} from '../../helpers/my-account';
import { adminLogin, frontendLogin, registerUser } from '../../helpers/wp-login';
import { waitForUnblock } from '../../helpers/block-ui';
import {
  navigateToOrder,
  assertOrderStatus,
  assertPaymentMethodMeta,
  assertCapturedNote,
} from '../../helpers/admin-orders';
import {
  extractAllLogs,
  extractSessionGetLogs,
  extractTokenLogs,
  verifySessionGet,
  verifyTokenLog,
  verifyAuthorizeCaptureLog,
} from '../../helpers/log-verification';
import { verifyAdminEmail } from '../../helpers/email-verification';
import config from '../../plugin-config';
import { cards, fourDigits } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

async function submitAddPaymentMethod(page: Page, opts: { handle3ds: boolean }): Promise<void> {
  await page.locator('#place_order').first().click();
  if (opts.handle3ds) {
    await handle3DSChallenge(page, /payment-methods|add-payment-method/);
  }
  await page.waitForURL(/payment-methods/, { timeout: 30000 });
  await waitForUnblock(page);
  await expect(page.locator('.woocommerce-message, .wc-block-components-notice-banner.is-success'))
    .toContainText('Payment method successfully added.');
}

test.describe.serial('Hosted Session - Add Payment Method', () => {
  let adminPage: Page;
  const mcEmail = uniqueEmail();
  // MC-050 saves a Visa challenge card; MC-051 charges via that token; MC-052 adds a Visa frictionless.
  const card1 = cards.visaChallenge;
  const card2 = cards.visaFrictionless;
  let mc050Token: string;

  test.beforeAll(async ({ browser }) => {
    const adminContext = await browser.newContext({ ignoreHTTPSErrors: true });
    adminPage = await adminContext.newPage();
    await adminLogin(adminPage);
  });

  test.afterAll(async () => {
    await adminPage.close();
  });

  // === MC-050: Add Payment Method ===

  test('MC-050 - Add Payment Method', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });

    await registerUser(page, mcEmail, billing.password);

    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = new Date().toISOString().slice(0, 19);

    await selectGatewayOnAddPaymentMethod(page, config);
    await fillHostedSessionCC(page, card1, config);

    await submitAddPaymentMethod(page, { handle3ds: !!card1.challenge });

    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: card1.name,
      fourDigits: fourDigits(card1),
      expiryMonth: card1.month,
      expiryYear: card1.year,
    });

    const tokenLogs = await extractTokenLogs(payDate, payDate, logOffset);
    expect(tokenLogs.logs[0]?.content?.length, 'token logs should not be empty').toBeGreaterThan(0);
    const tokenLog = tokenLogs.logs[0].content[0];
    const session = tokenLog.request?.body?.session?.id || '';
    verifyTokenLog(tokenLog, { session, card: card1 });
    mc050Token = tokenLog.response?.body?.token || '';
    expect(mc050Token, 'token id should be captured').toBeTruthy();
  });

  // === MC-051: Logged user pay with saved CC ===

  test('MC-051 - Logged user pay with saved CC', async ({ page }) => {
    await frontendLogin(page, mcEmail, billing.password);

    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = await addToCartAndCheckout(page, config.products.physical);

    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await selectSavedToken(page, 1);

    await clickPlaceOrder(page);
    // visaChallenge token still triggers 3DS on subsequent purchases
    if (card1.challenge) {
      await handle3DSChallenge(page);
    }
    await page.waitForURL(/order-received/, { timeout: 60000 });
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();
    const total: string = String(order.total);
    const session = getOrderMeta(order, config.sessionIdMetaKey) || '';

    const sessionGetLogs = await extractSessionGetLogs(payDate, '', payDate, logOffset);
    expect(sessionGetLogs.logs[0]?.content?.length, 'session GET logs should not be empty').toBeGreaterThan(0);
    const sessionPut = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'PUT'
        && l.request?.body?.apiOperation === 'UPDATE_SESSION'
        && l.response?.body?.session?.updateStatus === 'SUCCESS'
    );
    expect(sessionPut, 'UPDATE_SESSION PUT log entry not found').toBeTruthy();
    const resolvedSession = sessionPut!.response?.body?.session?.id || session;
    verifySessionGet(sessionPut!, { session: resolvedSession, card: card1, token: mc050Token });

    const allLogs = await extractAllLogs(payDate, logOffset);
    const logContent = allLogs.logs[0]?.content ?? [];
    const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session: resolvedSession, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card: card1,
    });

    await verifyAdminEmail(orderNumber, { paymentMethodTitle: config.displayName });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);
  });

  // === MC-052: Add second payment method ===

  test('MC-052 - Add second payment method', async ({ page }) => {
    await frontendLogin(page, mcEmail, billing.password);

    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = new Date().toISOString().slice(0, 19);

    await selectGatewayOnAddPaymentMethod(page, config);
    await fillHostedSessionCC(page, card2, config);

    await submitAddPaymentMethod(page, { handle3ds: !!card2.challenge });

    await verifyPaymentMethods(page, {
      expectedCards: 2,
      cards: [
        { cardName: card1.name, fourDigits: fourDigits(card1), expiryMonth: card1.month, expiryYear: card1.year },
        { cardName: card2.name, fourDigits: fourDigits(card2), expiryMonth: card2.month, expiryYear: card2.year },
      ],
    });

    const tokenLogs = await extractTokenLogs(payDate, payDate, logOffset);
    expect(tokenLogs.logs[0]?.content?.length, 'token log for second card not found').toBeGreaterThan(0);
    const tokenLog = tokenLogs.logs[0].content[0];
    const session = tokenLog.request?.body?.session?.id || '';
    verifyTokenLog(tokenLog, { session, card: card2 });
  });

  // === MC-053: Session loading ===

  test('MC-053 - Session loading', async ({ page }) => {
    await frontendLogin(page, mcEmail, billing.password);
    await selectGatewayOnAddPaymentMethod(page, config);
    await assertSessionFieldsPresent(page, config);
  });

  // === MC-054: Not filling CC info ===

  test('MC-054 - Not filling CC info', async ({ page }) => {
    await frontendLogin(page, mcEmail, billing.password);
    await selectGatewayOnAddPaymentMethod(page, config);

    await page.locator('#place_order').first().click();
    await waitForUnblock(page);

    const error = page.locator('.woocommerce-error, .woocommerce-notices-wrapper .woocommerce-error, .wc-block-components-notice-banner.is-error');
    await expect(error.first()).toBeVisible({ timeout: 10000 });
  });

  // === MC-055: Invalid missing CC number ===

  test('MC-055 - Invalid missing CC number', async ({ page }) => {
    await frontendLogin(page, mcEmail, billing.password);
    await selectGatewayOnAddPaymentMethod(page, config);

    await fillHostedSessionCCPartial(page, config, {
      month: card1.month,
      year: card1.year,
      cvv: card1.cvv,
    });

    await page.locator('#place_order').first().click();
    await waitForUnblock(page);

    const error = page.locator('.woocommerce-error, .woocommerce-notices-wrapper .woocommerce-error, .wc-block-components-notice-banner.is-error');
    await expect(error.first()).toBeVisible({ timeout: 10000 });
  });

  // === MC-056: Invalid missing CVC ===

  test('MC-056 - Invalid missing CVC', async ({ page }) => {
    await frontendLogin(page, mcEmail, billing.password);
    await selectGatewayOnAddPaymentMethod(page, config);

    await fillHostedSessionCCPartial(page, config, {
      number: card1.number,
      month: card1.month,
      year: card1.year,
    });

    await page.locator('#place_order').first().click();
    await waitForUnblock(page);

    const error = page.locator('.woocommerce-error, .woocommerce-notices-wrapper .woocommerce-error, .wc-block-components-notice-banner.is-error');
    await expect(error.first()).toBeVisible({ timeout: 10000 });
  });

  // === MC-057: Invalid missing expiry month ===

  test('MC-057 - Invalid missing expiry month', async ({ page }) => {
    await frontendLogin(page, mcEmail, billing.password);
    await selectGatewayOnAddPaymentMethod(page, config);

    await fillHostedSessionCCPartial(page, config, {
      number: card1.number,
      year: card1.year,
      cvv: card1.cvv,
    });

    await page.locator('#place_order').first().click();
    await waitForUnblock(page);

    const error = page.locator('.woocommerce-error, .woocommerce-notices-wrapper .woocommerce-error, .wc-block-components-notice-banner.is-error');
    await expect(error.first()).toBeVisible({ timeout: 10000 });
  });

  // === MC-058: Invalid missing expiry year ===

  test('MC-058 - Invalid missing expiry year', async ({ page }) => {
    await frontendLogin(page, mcEmail, billing.password);
    await selectGatewayOnAddPaymentMethod(page, config);

    await fillHostedSessionCCPartial(page, config, {
      number: card1.number,
      month: card1.month,
      cvv: card1.cvv,
    });

    await page.locator('#place_order').first().click();
    await waitForUnblock(page);

    const error = page.locator('.woocommerce-error, .woocommerce-notices-wrapper .woocommerce-error, .wc-block-components-notice-banner.is-error');
    await expect(error.first()).toBeVisible({ timeout: 10000 });
  });

  // === MC-059: Delete payment method ===

  test('MC-059 - Delete payment method', async ({ page }) => {
    await frontendLogin(page, mcEmail, billing.password);

    await deletePaymentMethod(page, 1);
    await expect(page.locator('.woocommerce-message')).toContainText('Payment method deleted.');
    await verifyPaymentMethods(page, { expectedCards: 1 });

    await deletePaymentMethod(page, 1);
    await expect(page.locator('.woocommerce-message')).toContainText('Payment method deleted.');
    await verifyPaymentMethods(page, { expectedCards: 0 });
  });
});
