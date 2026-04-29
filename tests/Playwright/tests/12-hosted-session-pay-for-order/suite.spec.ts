import { test, expect } from '../../fixtures/test';
import { Page } from '@playwright/test';
import {
  switchCheckoutMode,
  configureGateway,
  verifyOrderViaAPI,
  getLogEntryCount,
} from '../../helpers/api';
import {
  selectPaymentMethod,
  clickPlaceOrder,
  clickSaveCardCheckbox,
  selectSavedToken,
  extractSessionId,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { verifyOrderReceived } from '../../helpers/order-received';
import { handle3DSChallenge } from '../../helpers/three-ds';
import { verifyPaymentMethods } from '../../helpers/my-account';
import { adminLogin, frontendLogin, registerUser } from '../../helpers/wp-login';
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
  verifySessionGetCardDetails,
  verifyInitiateAuthentication,
  verifyAuthenticatePayer,
  verifyAuthenticationResult,
  verifyAuthorizeCaptureLog,
  verifyTokenLog,
  verifyTokenLogsEmpty,
} from '../../helpers/log-verification';
import { verifyAdminEmail } from '../../helpers/email-verification';
import config from '../../plugin-config';
import { cards, fourDigits } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

const BASE_URL = process.env.WP_BASE_URL || 'https://mastercard-saucal.sa.ngrok.io';
const WOO_USER = process.env.WOO_USER || '';
const WOO_PASS = process.env.WOO_PASS || '';

const wcAuth = 'Basic ' + Buffer.from(`${WOO_USER}:${WOO_PASS}`).toString('base64');

async function getCustomerId(email: string): Promise<number> {
  const res = await fetch(`${BASE_URL}/wp-json/wc/v3/customers?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: wcAuth },
  });
  if (!res.ok) throw new Error(`getCustomerId failed: ${res.status}`);
  const customers = await res.json();
  if (!Array.isArray(customers) || !customers.length) throw new Error(`no customer found for ${email}`);
  return customers[0].id;
}

async function createPendingOrder(productId: number, customerId: number, email: string): Promise<{ orderId: string; orderKey: string }> {
  const res = await fetch(`${BASE_URL}/wp-json/wc/v3/orders`, {
    method: 'POST',
    headers: { Authorization: wcAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'pending',
      customer_id: customerId,
      currency: 'USD',
      billing: {
        first_name: billing.firstName,
        last_name: billing.lastName,
        company: billing.company,
        address_1: billing.street,
        address_2: billing.address2,
        city: billing.city,
        state: billing.shortState,
        postcode: billing.zipCode,
        country: billing.shortCountry,
        email,
        phone: billing.phone,
      },
      line_items: [{ product_id: productId, quantity: 1 }],
    }),
  });
  if (!res.ok) throw new Error(`createPendingOrder failed: ${res.status}`);
  const order = await res.json();
  return { orderId: String(order.id), orderKey: order.order_key };
}

test.describe.serial('Hosted Session - Pay For Order', () => {
  let adminPage: Page;
  const mcEmail = uniqueEmail();
  let mcCustomerId: number;
  let mc012Token: string;

  test.beforeAll(async ({ browser }) => {
    const adminContext = await browser.newContext({ ignoreHTTPSErrors: true });
    adminPage = await adminContext.newPage();
    await adminLogin(adminPage);
  });

  test.afterAll(async () => {
    await adminPage.close();
  });

  // === MC-011: Pay for order, not saving CC ===

  test('MC-011 - Pay for order not saving CC', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });

    await registerUser(page, mcEmail, billing.password);
    mcCustomerId = await getCustomerId(mcEmail);

    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = new Date().toISOString().slice(0, 19);

    const { orderId, orderKey } = await createPendingOrder(config.products.physical, mcCustomerId, mcEmail);
    await page.goto(`/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`);
    await page.waitForLoadState('networkidle');

    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);
    const session = await extractSessionId(page);

    await clickPlaceOrder(page);
    await page.waitForURL(/order-received/, { timeout: 60000 });
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();
    const total: string = String(order.total);

    const allLogs = await extractAllLogs(payDate, logOffset);
    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate, logOffset);
    const tokenLogs = await extractTokenLogs(payDate, payDate, logOffset);

    expect(sessionGetLogs.logs[0]?.content.length, 'session GET logs should not be empty').toBeGreaterThan(0);
    const sessionPut = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'PUT'
        && l.request?.body?.apiOperation === 'UPDATE_SESSION'
        && l.response?.body?.session?.updateStatus === 'SUCCESS'
    );
    expect(sessionPut, 'UPDATE_SESSION PUT log entry not found').toBeTruthy();
    verifySessionGet(sessionPut!, { session, card: cards.mastercard });
    const sessionGet = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'GET'
        && l.request?.url?.includes('/session/')
        && l.response?.body?.session?.id === session
    );
    expect(sessionGet, 'session GET card details entry not found').toBeTruthy();
    verifySessionGetCardDetails(sessionGet!, { session, card: cards.mastercard });

    verifyTokenLogsEmpty(tokenLogs);

    expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
    const logContent = allLogs.logs[0].content;
    const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

    const initiateAuthLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(initiateAuthLog, 'INITIATE_AUTHENTICATION log not found').toBeTruthy();
    verifyInitiateAuthentication(initiateAuthLog!, {
      session, card: cards.mastercard, transactionId: transactionId!, currency: 'USD',
    });

    const authenticatePayerLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(authenticatePayerLog, 'AUTHENTICATE_PAYER log not found').toBeTruthy();
    verifyAuthenticatePayer(authenticatePayerLog!, {
      session, transactionId: transactionId!, currency: 'USD', card: cards.mastercard,
    });

    const authResultLog = logContent.find(
      (l: any) => txFilter(l) && (
        l.response?.body?.authenticationStatus === 'AUTHENTICATION_SUCCESSFUL'
        || l.response?.body?.order?.authenticationStatus === 'AUTHENTICATION_SUCCESSFUL'
      )
    );
    expect(authResultLog, 'AUTHENTICATION_SUCCESSFUL result log not found').toBeTruthy();
    verifyAuthenticationResult(authResultLog!, {
      transactionId: transactionId!, currency: 'USD', authStatus: 'AUTHENTICATION_SUCCESSFUL',
    });

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card: cards.mastercard,
    });

    await verifyAdminEmail(orderNumber, { paymentMethodTitle: config.displayName });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);
  });

  // === MC-012: Pay for order, saving CC (challenge card) ===

  test('MC-012 - Pay for order saving CC', async ({ page }) => {
    // Explicit login — registerUser in MC-011 does not survive across tests
    // reliably (cookies / WP nonces differ on /checkout/order-pay/). Without
    // a logged-in session WC's tokenization-form.js reads is_logged_in=""
    // from wc_tokenization_form_params and force-hides the save-card row.
    await frontendLogin(page, mcEmail, billing.password);

    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = new Date().toISOString().slice(0, 19);

    const { orderId, orderKey } = await createPendingOrder(config.products.physical, mcCustomerId, mcEmail);
    await page.goto(`/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`);
    await page.waitForLoadState('networkidle');

    // useNewToken=true clicks the "Use new payment method" radio — required
    // on pay-for-order, where WC tokenization-form.js keeps the .saveNew row
    // hidden until the new-token radio fires `change` (matches GI step 31
    // where the radio is clicked before filling the CC iframe).
    await selectPaymentMethod(page, config, true);
    await fillHostedSessionCC(page, cards.visaChallenge, config);
    await clickSaveCardCheckbox(page);
    const session = await extractSessionId(page);

    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    await page.waitForURL(/order-received/, { timeout: 60000 });
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();
    const total: string = String(order.total);

    const allLogs = await extractAllLogs(payDate, logOffset);
    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate, logOffset);
    const tokenLogs = await extractTokenLogs(payDate, payDate, logOffset);

    expect(sessionGetLogs.logs[0]?.content.length, 'session GET logs should not be empty').toBeGreaterThan(0);
    const sessionPut = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'PUT'
        && l.request?.body?.apiOperation === 'UPDATE_SESSION'
        && l.response?.body?.session?.updateStatus === 'SUCCESS'
    );
    expect(sessionPut, 'UPDATE_SESSION PUT log entry not found').toBeTruthy();
    verifySessionGet(sessionPut!, { session, card: cards.visaChallenge });

    expect(tokenLogs.logs[0]?.content.length, 'token logs should not be empty (saving CC)').toBeGreaterThan(0);
    const tokenLog = tokenLogs.logs[0].content[0];
    verifyTokenLog(tokenLog, { session, card: cards.visaChallenge });
    mc012Token = tokenLog.response?.body?.token || '';
    expect(mc012Token, 'token id should be captured').toBeTruthy();

    expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
    const logContent = allLogs.logs[0].content;
    const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

    const initiateAuthLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(initiateAuthLog, 'INITIATE_AUTHENTICATION log not found').toBeTruthy();

    const authenticatePayerLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER' && txFilter(l)
    );
    expect(authenticatePayerLog, 'AUTHENTICATE_PAYER log not found').toBeTruthy();

    const authResultLog = logContent.find(
      (l: any) => txFilter(l) && (
        l.response?.body?.authenticationStatus === 'AUTHENTICATION_SUCCESSFUL'
        || l.response?.body?.order?.authenticationStatus === 'AUTHENTICATION_SUCCESSFUL'
      )
    );
    expect(authResultLog, 'AUTHENTICATION_SUCCESSFUL result log not found').toBeTruthy();

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card: cards.visaChallenge,
    });

    await verifyAdminEmail(orderNumber, { paymentMethodTitle: config.displayName });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: cards.visaChallenge.name,
      fourDigits: fourDigits(cards.visaChallenge),
      expiryMonth: cards.visaChallenge.month,
      expiryYear: cards.visaChallenge.year,
    });
  });

  // === MC-013: Pay for order with saved CC ===

  test('MC-013 - Pay for order with saved CC', async ({ page }) => {
    await frontendLogin(page, mcEmail, billing.password);
    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = new Date().toISOString().slice(0, 19);

    const { orderId, orderKey } = await createPendingOrder(config.products.physical, mcCustomerId, mcEmail);
    await page.goto(`/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`);
    await page.waitForLoadState('networkidle');

    await selectPaymentMethod(page, config);
    await selectSavedToken(page, 1);

    await clickPlaceOrder(page);
    if (/acs|3ds|threedsecure|mastercard\.com.*prompt/i.test(page.url())) {
      await handle3DSChallenge(page);
    }
    await page.waitForURL(/order-received/, { timeout: 60000 });
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();
    const total: string = String(order.total);

    const sessionGetLogs = await extractSessionGetLogs(payDate, '', payDate, logOffset);
    expect(sessionGetLogs.logs[0]?.content.length, 'session GET logs should not be empty').toBeGreaterThan(0);
    const sessionPut = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'PUT'
        && l.request?.body?.apiOperation === 'UPDATE_SESSION'
        && l.response?.body?.session?.updateStatus === 'SUCCESS'
    );
    expect(sessionPut, 'UPDATE_SESSION PUT log entry not found (saved-token path)').toBeTruthy();
    const resolvedSession = sessionPut!.response?.body?.session?.id || '';
    expect(resolvedSession, 'session id should be derivable from UPDATE_SESSION').toBeTruthy();
    verifySessionGet(sessionPut!, { session: resolvedSession, card: cards.visaChallenge, token: mc012Token });

    const allLogs = await extractAllLogs(payDate, logOffset);
    const logContent = allLogs.logs[0]?.content ?? [];
    const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session: resolvedSession, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card: cards.visaChallenge,
    });

    await verifyAdminEmail(orderNumber, { paymentMethodTitle: config.displayName });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);
  });
});
