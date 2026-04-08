import { test, expect } from '@playwright/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI } from '../../helpers/api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  extractOrderTotal,
} from '../../helpers/checkout';
import { fillHostedCheckoutCC, clickHostedCheckoutPay } from '../../helpers/hosted-checkout';
import { verifyOrderReceived } from '../../helpers/order-received';
import { handle3DSChallenge } from '../../helpers/three-ds';
import {
  extractAllLogs,
  extractSessionPostLogs,
  extractTokenLogs,
  verifySessionPost,
  verifyInitiateAuthentication,
  verifyAuthenticatePayer,
  verifyAuthorizeCaptureLog,
  verifyTokenLogsEmpty,
} from '../../helpers/log-verification';
import { verifyOrderEmails } from '../../helpers/email-verification';
import { adminLogin, frontendLogin } from '../../helpers/wp-login';
import { navigateToOrder, assertOrderStatus } from '../../helpers/admin-orders';
import { verifyOrderInMyAccount, verifyCartEmpty } from '../../helpers/my-account';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
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

test.describe.serial('Hosted Checkout - Embedded - Capture', () => {
  let orderNumber: string;
  const mc005Email = uniqueEmail();
  const mc008Email = uniqueEmail();

  // Shared state per checkout test
  let payDate: string;
  let total: string;

  // === MC-004: Guest checkout ===

  test('MC-004 - Guest checkout', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_checkout',
      hosted_checkout_mode: 'embedded',
    });

    payDate = await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    total = await extractOrderTotal(page);
    await clickPlaceOrder(page);

    // Now on hosted checkout embedded page — fill CC and pay
    await fillHostedCheckoutCC(page, cards.mastercard, config);
    await clickHostedCheckoutPay(page);

    // Handle 3DS if challenged
    if (cards.mastercard.challenge) {
      await handle3DSChallenge(page);
    }

    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-004 - Guest checkout - Admin', async ({ page }) => {
    expect(orderNumber).toBeTruthy();

    // Phase 1: WC API verification
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // Phase 2: Log extraction
    const allLogs = await extractAllLogs(payDate);
    const sessionPostLogs = await extractSessionPostLogs(payDate, payDate, '', '');
    const tokenLogs = await extractTokenLogs(payDate, payDate);

    // Phase 3: Verify session POST — hosted checkout uses INITIATE_CHECKOUT
    if (sessionPostLogs.logs[0]?.content.length) {
      const sessionPostLog = sessionPostLogs.logs[0].content[0];
      verifySessionPost(sessionPostLog, {
        session: sessionPostLog.response?.body?.session?.id || '',
        total, currency: 'USD', transactionId: transactionId!, orderNumber,
        apiOperation: 'INITIATE_CHECKOUT',
      });
    }

    // Phase 4: Token empty (guest)
    verifyTokenLogsEmpty(tokenLogs);

    // Phase 5-8: Auth + capture logs
    if (allLogs.logs[0]?.content.length) {
      const logContent = allLogs.logs[0].content;

      const initiateAuthLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION'
      );
      if (initiateAuthLog) {
        verifyInitiateAuthentication(initiateAuthLog, {
          session: initiateAuthLog.request?.body?.session?.id || '',
          card: cards.mastercard, transactionId: transactionId!, currency: 'USD',
        });
      }

      const authenticatePayerLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER'
      );
      if (authenticatePayerLog) {
        verifyAuthenticatePayer(authenticatePayerLog, {
          session: authenticatePayerLog.request?.body?.session?.id || '',
          transactionId: transactionId!, currency: 'USD', card: cards.mastercard,
        });
      }

      const captureLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'PAY'
      );
      if (captureLog) {
        verifyAuthorizeCaptureLog(captureLog, {
          apiOperation: 'PAY', total, currency: 'USD',
          transactionId: transactionId!, orderNumber, card: cards.mastercard,
        });
      }
    }

    // Phase 11: Email verification (admin + customer for capture)
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend check
    await adminLogin(page);
    await navigateToOrder(page, orderNumber);
    await assertOrderStatus(page, 'Processing');
    await expect(page.locator('.woocommerce-order-data__meta')).toContainText(`Payment via ${config.displayName}`);
    await expect(page.locator('li.note.system-note .note_content > p').first()).toContainText(transactionId!);

    // Phase 13: Guest — verify cart empty
    await verifyCartEmpty(page);
  });

  // === MC-005: New user ===

  test('MC-005 - New user', async ({ page }) => {
    payDate = await addToCartAndCheckout(page, config.products.digital);
    await fillBilling(page, { ...billing, email: mc005Email });

    // Create account at checkout
    const createAccountLink = page.locator('//span[contains(text(), "Create an account?")]');
    if (await createAccountLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await createAccountLink.click();
      await page.locator('#account_password').fill(billing.password);
    }

    await selectPaymentMethod(page, config);
    total = await extractOrderTotal(page);
    await clickPlaceOrder(page);

    await fillHostedCheckoutCC(page, cards.mastercard, config);
    await clickHostedCheckoutPay(page);

    if (cards.mastercard.challenge) {
      await handle3DSChallenge(page);
    }

    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-005 - New user - Admin', async ({ page }) => {
    expect(orderNumber).toBeTruthy();

    // Phase 1: WC API verification
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // Phase 2: Log extraction
    const allLogs = await extractAllLogs(payDate);
    const sessionPostLogs = await extractSessionPostLogs(payDate, payDate, '', '');
    const tokenLogs = await extractTokenLogs(payDate, payDate);

    // Phase 3: Session POST
    if (sessionPostLogs.logs[0]?.content.length) {
      const sessionPostLog = sessionPostLogs.logs[0].content[0];
      verifySessionPost(sessionPostLog, {
        session: sessionPostLog.response?.body?.session?.id || '',
        total, currency: 'USD', transactionId: transactionId!, orderNumber,
        apiOperation: 'INITIATE_CHECKOUT',
      });
    }

    // Phase 4: Token empty
    verifyTokenLogsEmpty(tokenLogs);

    // Phase 5-8
    if (allLogs.logs[0]?.content.length) {
      const logContent = allLogs.logs[0].content;

      const initiateAuthLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION'
      );
      if (initiateAuthLog) {
        verifyInitiateAuthentication(initiateAuthLog, {
          session: initiateAuthLog.request?.body?.session?.id || '',
          card: cards.mastercard, transactionId: transactionId!, currency: 'USD',
        });
      }

      const captureLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'PAY'
      );
      if (captureLog) {
        verifyAuthorizeCaptureLog(captureLog, {
          apiOperation: 'PAY', total, currency: 'USD',
          transactionId: transactionId!, orderNumber, card: cards.mastercard,
        });
      }
    }

    // Phase 11: Email verification
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend check
    await adminLogin(page);
    await navigateToOrder(page, orderNumber);
    await assertOrderStatus(page, 'Processing');
    await expect(page.locator('.woocommerce-order-data__meta')).toContainText(`Payment via ${config.displayName}`);
    await expect(page.locator('li.note.system-note .note_content > p').first()).toContainText(transactionId!);

    // Phase 13: My Account
    await frontendLogin(page, mc005Email, billing.password);
    await verifyOrderInMyAccount(page, orderNumber, 'Processing');
    await verifyCartEmpty(page);
  });

  // === MC-008: Logged user ===

  test('MC-008 - Logged user', async ({ page }) => {
    await frontendLogin(page, mc008Email, billing.password).catch(async () => {
      // User may not exist yet — register first
      await page.goto('/my-account');
      await page.locator('#reg_email').fill(mc008Email);
      await page.locator('#reg_password').fill(billing.password);
      await page.locator('button[name="register"]').first().click();
    });

    payDate = await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config);
    total = await extractOrderTotal(page);
    await clickPlaceOrder(page);

    await fillHostedCheckoutCC(page, cards.mastercard, config);
    await clickHostedCheckoutPay(page);

    if (cards.mastercard.challenge) {
      await handle3DSChallenge(page);
    }

    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-008 - Logged user - Admin', async ({ page }) => {
    expect(orderNumber).toBeTruthy();

    // Phase 1: WC API verification
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // Phase 2: Log extraction
    const allLogs = await extractAllLogs(payDate);
    const sessionPostLogs = await extractSessionPostLogs(payDate, payDate, '', '');
    const tokenLogs = await extractTokenLogs(payDate, payDate);

    // Phase 3
    if (sessionPostLogs.logs[0]?.content.length) {
      const sessionPostLog = sessionPostLogs.logs[0].content[0];
      verifySessionPost(sessionPostLog, {
        session: sessionPostLog.response?.body?.session?.id || '',
        total, currency: 'USD', transactionId: transactionId!, orderNumber,
        apiOperation: 'INITIATE_CHECKOUT',
      });
    }

    verifyTokenLogsEmpty(tokenLogs);

    // Phase 5-8
    if (allLogs.logs[0]?.content.length) {
      const logContent = allLogs.logs[0].content;

      const initiateAuthLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION'
      );
      if (initiateAuthLog) {
        verifyInitiateAuthentication(initiateAuthLog, {
          session: initiateAuthLog.request?.body?.session?.id || '',
          card: cards.mastercard, transactionId: transactionId!, currency: 'USD',
        });
      }

      const captureLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'PAY'
      );
      if (captureLog) {
        verifyAuthorizeCaptureLog(captureLog, {
          apiOperation: 'PAY', total, currency: 'USD',
          transactionId: transactionId!, orderNumber, card: cards.mastercard,
        });
      }
    }

    // Phase 11: Email verification
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend check
    await adminLogin(page);
    await navigateToOrder(page, orderNumber);
    await assertOrderStatus(page, 'Processing');
    await expect(page.locator('.woocommerce-order-data__meta')).toContainText(`Payment via ${config.displayName}`);
    await expect(page.locator('li.note.system-note .note_content > p').first()).toContainText(transactionId!);

    // Phase 13: My Account
    await frontendLogin(page, mc008Email, billing.password);
    await verifyOrderInMyAccount(page, orderNumber, 'Processing');
    await verifyCartEmpty(page);
  });

  // === MC-011: Pay for order ===

  test('MC-011 - Pay for order', async ({ page }) => {
    const { orderId, orderKey } = await createPendingOrder(config.products.physical);

    await page.goto(`/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`);
    await page.waitForLoadState('networkidle');

    payDate = new Date().toISOString().slice(0, 10);
    await selectPaymentMethod(page, config);
    total = await extractOrderTotal(page);
    await clickPlaceOrder(page);

    await fillHostedCheckoutCC(page, cards.mastercard, config);
    await clickHostedCheckoutPay(page);

    if (cards.mastercard.challenge) {
      await handle3DSChallenge(page);
    }

    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-011 - Pay for order - Admin', async ({ page }) => {
    expect(orderNumber).toBeTruthy();

    // Phase 1: WC API verification
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // Phase 2: Log extraction
    const allLogs = await extractAllLogs(payDate);
    const sessionPostLogs = await extractSessionPostLogs(payDate, payDate, '', '');
    const tokenLogs = await extractTokenLogs(payDate, payDate);

    // Phase 3
    if (sessionPostLogs.logs[0]?.content.length) {
      const sessionPostLog = sessionPostLogs.logs[0].content[0];
      verifySessionPost(sessionPostLog, {
        session: sessionPostLog.response?.body?.session?.id || '',
        total, currency: 'USD', transactionId: transactionId!, orderNumber,
        apiOperation: 'INITIATE_CHECKOUT',
      });
    }

    verifyTokenLogsEmpty(tokenLogs);

    // Phase 5-8
    if (allLogs.logs[0]?.content.length) {
      const logContent = allLogs.logs[0].content;

      const captureLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'PAY'
      );
      if (captureLog) {
        verifyAuthorizeCaptureLog(captureLog, {
          apiOperation: 'PAY', total, currency: 'USD',
          transactionId: transactionId!, orderNumber, card: cards.mastercard,
        });
      }
    }

    // Phase 11: Email verification
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend check
    await adminLogin(page);
    await navigateToOrder(page, orderNumber);
    await assertOrderStatus(page, 'Processing');
    await expect(page.locator('.woocommerce-order-data__meta')).toContainText(`Payment via ${config.displayName}`);
    await expect(page.locator('li.note.system-note .note_content > p').first()).toContainText(transactionId!);

    // Phase 13: Cart empty
    await verifyCartEmpty(page);
  });
});
