import { test, expect } from '../../fixtures/test';
import { Page, Browser } from '@playwright/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI, getLogEntryCount } from '../../helpers/api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  extractOrderTotal,
  extractSessionId,
  createAccountAtCheckout,
  clickSaveCardCheckbox,
  selectSavedToken,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { verifyOrderReceived } from '../../helpers/order-received';
import {
  extractAllLogs,
  extractSessionPostLogs,
  extractSessionGetLogs,
  extractTokenLogs,
  verifySessionPost,
  verifySessionGet,
  verifySessionGetCardDetails,
  verifyInitiateAuthentication,
  verifyAuthenticatePayer,
  verifyAuthorizeCaptureLog,
  verifyTokenLog,
  verifyTokenLogsEmpty,
} from '../../helpers/log-verification';
import { verifyOrderEmails } from '../../helpers/email-verification';
import { adminLogin, frontendLogin } from '../../helpers/wp-login';
import { navigateToOrder, assertOrderStatus, assertPaymentMethodMeta, assertCapturedNote } from '../../helpers/admin-orders';
import { verifyPaymentMethods, verifyOrderInMyAccount, verifyCartEmpty } from '../../helpers/my-account';
import config from '../../plugin-config';
import { cards, fourDigits } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

test.describe.serial('Hosted Session - Capture - Blocks', () => {
  let orderNumber: string;
  const mc005Email = uniqueEmail();

  // Shared state per checkout test
  let payDate: string;
  let sessionDate: string;
  let session: string;
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
    await switchCheckoutMode('blocks');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });

    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    sessionDate = payDate;
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);

    // Guest should NOT see save card checkbox
    await expect(page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`)).not.toBeVisible();

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    // Guest cart should be empty after successful checkout
    await verifyCartEmpty(page);

    // === API VERIFICATION ===
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // === LOG VERIFICATION ===
    const allLogs = await extractAllLogs(payDate, logOffset);
    const sessionPostLogs = await extractSessionPostLogs(payDate, sessionDate, '', '', logOffset);
    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate, logOffset);
    const tokenLogs = await extractTokenLogs(payDate, payDate, logOffset);

    // Verify session POST (find entry matching this order's session)
    expect(sessionPostLogs.logs[0]?.content.length, 'session POST logs should not be empty').toBeGreaterThan(0);
    const sessionPostLog = session
      ? sessionPostLogs.logs[0].content.find((l: any) => l.response?.body?.session?.id === session)
      : sessionPostLogs.logs[0].content[0];
    expect(sessionPostLog, `session POST entry not found for session ${session}`).toBeTruthy();
    verifySessionPost(sessionPostLog!, {
      session, total, currency: 'USD', transactionId: transactionId!, orderNumber,
    });

    // Verify session GET (UPDATE_SESSION PUT + GET card details)
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

    // Token logs empty (guest)
    verifyTokenLogsEmpty(tokenLogs);

    // Auth + capture logs (filter by transaction ID to avoid cross-order matches)
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

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card: cards.mastercard,
    });

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // === ADMIN BACKEND (admin page) ===
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);
  });

  // === MC-005: New user, NOT saving CC ===

  test('MC-005 - New user not saving CC', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.digital);
    sessionDate = payDate;
    await fillBilling(page, { ...billing, email: mc005Email });
    await createAccountAtCheckout(page, billing.password);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    // Cart should be empty after successful checkout
    await verifyCartEmpty(page);

    // === API VERIFICATION ===
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // === LOG VERIFICATION ===
    const allLogs = await extractAllLogs(payDate, logOffset);
    const sessionPostLogs = await extractSessionPostLogs(payDate, sessionDate, '', '', logOffset);
    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate, logOffset);
    const tokenLogs = await extractTokenLogs(payDate, payDate, logOffset);

    // Verify session POST (find entry matching this order's session)
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
    verifySessionGet(sessionPut!, { session, card: cards.mastercard });
    const sessionGet = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'GET'
        && l.request?.url?.includes('/session/')
        && l.response?.body?.session?.id === session
    );
    expect(sessionGet, 'session GET card details entry not found').toBeTruthy();
    verifySessionGetCardDetails(sessionGet!, { session, card: cards.mastercard });

    // Token empty (not saving)
    verifyTokenLogsEmpty(tokenLogs);

    // Auth + capture logs (filter by transaction ID to avoid cross-order matches)
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

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card: cards.mastercard,
    });

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // === ADMIN BACKEND (admin page) ===
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    // === MY ACCOUNT (buyer's page) ===
    await frontendLogin(page, mc005Email, billing.password);
    await verifyPaymentMethods(page, { expectedCards: 0 });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-008: Logged user, pay with new CC (not saving) ===

  test('MC-008 - Logged user pay with new CC', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    await frontendLogin(page, mc005Email, billing.password);
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    sessionDate = payDate;
    await selectPaymentMethod(page, config, true); // useNewToken = true
    await fillHostedSessionCC(page, cards.mastercard, config);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    // Cart should be empty after successful checkout
    await verifyCartEmpty(page);

    // === API VERIFICATION ===
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // === LOG VERIFICATION ===
    const allLogs = await extractAllLogs(payDate, logOffset);
    const sessionPostLogs = await extractSessionPostLogs(payDate, sessionDate, '', '', logOffset);
    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate, logOffset);
    const tokenLogs = await extractTokenLogs(payDate, payDate, logOffset);

    // Verify session POST (find entry matching this order's session)
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
    verifySessionGet(sessionPut!, { session, card: cards.mastercard });
    const sessionGet = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'GET'
        && l.request?.url?.includes('/session/')
        && l.response?.body?.session?.id === session
    );
    expect(sessionGet, 'session GET card details entry not found').toBeTruthy();
    verifySessionGetCardDetails(sessionGet!, { session, card: cards.mastercard });

    verifyTokenLogsEmpty(tokenLogs);

    // Auth + capture logs (filter by transaction ID to avoid cross-order matches)
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

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card: cards.mastercard,
    });

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // === ADMIN BACKEND (admin page) ===
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    // === MY ACCOUNT (buyer's page) — still 0 saved cards ===
    await frontendLogin(page, mc005Email, billing.password);
    await verifyPaymentMethods(page, { expectedCards: 0 });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-009: Logged user, pay with new CC and save it ===

  test('MC-009 - Logged user pay with new CC and save it', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    await frontendLogin(page, mc005Email, billing.password);
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    sessionDate = payDate;
    await selectPaymentMethod(page, config, true); // useNewToken = true
    await fillHostedSessionCC(page, cards.mastercard, config);
    await clickSaveCardCheckbox(page);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    // Cart should be empty after successful checkout
    await verifyCartEmpty(page);

    // === API VERIFICATION ===
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // === LOG VERIFICATION ===
    const allLogs = await extractAllLogs(payDate, logOffset);
    const sessionPostLogs = await extractSessionPostLogs(payDate, sessionDate, '', '', logOffset);
    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate, logOffset);
    const tokenLogs = await extractTokenLogs(payDate, payDate, logOffset);

    // Verify session POST (find entry matching this order's session)
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
    verifySessionGet(sessionPut!, { session, card: cards.mastercard });
    const sessionGet = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'GET'
        && l.request?.url?.includes('/session/')
        && l.response?.body?.session?.id === session
    );
    expect(sessionGet, 'session GET card details entry not found').toBeTruthy();
    verifySessionGetCardDetails(sessionGet!, { session, card: cards.mastercard });

    // Token present (saving CC)
    expect(tokenLogs.logs[0]?.content.length, 'token logs should not be empty').toBeGreaterThan(0);
    verifyTokenLog(tokenLogs.logs[0].content[0], { session, card: cards.mastercard });

    // Auth + capture logs (filter by transaction ID to avoid cross-order matches)
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

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card: cards.mastercard,
    });

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // === ADMIN BACKEND (admin page) ===
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    // === MY ACCOUNT (buyer's page) — 1 saved card ===
    await frontendLogin(page, mc005Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
      expiryMonth: cards.mastercard.month,
      expiryYear: cards.mastercard.year,
    });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-010: Logged user, pay with saved CC (from MC-009) ===

  test('MC-010 - Logged user pay with saved CC', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    await frontendLogin(page, mc005Email, billing.password);
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    sessionDate = payDate;
    await selectPaymentMethod(page, config);
    await selectSavedToken(page, 1);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    // Saved token checkout: the Place Order button may stay disabled due to
    // WC blocks validation errors from empty CC iframe fields. Force-click it
    // — the payment handler properly skips CC validation for saved tokens.
    const mode = await page.locator('.wp-block-woocommerce-checkout').count() > 0 ? 'blocks' : 'classic';
    const placeOrderBtn = page.locator(mode === 'blocks' ? '.wc-block-components-checkout-place-order-button' : '#place_order');
    await expect(placeOrderBtn).toBeVisible();
    await placeOrderBtn.click({ force: true });
    await Promise.race([
      page.waitForURL(/order-received/, { timeout: 60000 }),
      page.waitForURL(/acs|3ds|threedsecure|mastercard\.com.*prompt/i, { timeout: 60000 }),
      page.locator('.wc-block-components-notice-banner.is-error, .woocommerce-error').first().waitFor({ state: 'visible', timeout: 60000 }),
    ]);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    // Cart should be empty after successful checkout
    await verifyCartEmpty(page);

    // === API VERIFICATION ===
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // === LOG VERIFICATION ===
    const allLogs = await extractAllLogs(payDate, logOffset);
    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate, logOffset);
    const tokenLogs = await extractTokenLogs(payDate, payDate, logOffset);

    // Verify session GET (saved card). For saved-token path the CC iframes
    // are not rendered, so `session` extracted from the DOM may be empty.
    // Derive it from the UPDATE_SESSION PUT entry instead.
    expect(sessionGetLogs.logs[0]?.content.length, 'session GET logs should not be empty').toBeGreaterThan(0);
    const sessionPut = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'PUT'
        && l.request?.body?.apiOperation === 'UPDATE_SESSION'
        && l.response?.body?.session?.updateStatus === 'SUCCESS'
    );
    expect(sessionPut, 'UPDATE_SESSION PUT log entry not found').toBeTruthy();
    const resolvedSession: string = session
      || sessionPut!.request.body.session?.id
      || sessionPut!.response.body.session?.id
      || '';
    verifySessionGet(sessionPut!, { session: resolvedSession, card: cards.mastercard });
    // Saved-token path does not fetch card details from the session — the
    // card data already lives in the token. Skip verifySessionGetCardDetails.

    // No new token (using saved CC)
    verifyTokenLogsEmpty(tokenLogs);

    // Auth + capture logs (filter by transaction ID to avoid cross-order matches)
    expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
    const logContent = allLogs.logs[0].content;
    const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

    const initiateAuthLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(initiateAuthLog, 'INITIATE_AUTHENTICATION log not found').toBeTruthy();
    verifyInitiateAuthentication(initiateAuthLog!, {
      session: resolvedSession, card: cards.mastercard, transactionId: transactionId!, currency: 'USD',
    });

    const authenticatePayerLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(authenticatePayerLog, 'AUTHENTICATE_PAYER log not found').toBeTruthy();
    verifyAuthenticatePayer(authenticatePayerLog!, {
      session: resolvedSession, transactionId: transactionId!, currency: 'USD', card: cards.mastercard,
    });

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session: resolvedSession, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card: cards.mastercard,
    });

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // === ADMIN BACKEND (admin page) ===
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    // === MY ACCOUNT (buyer's page) — still 1 card ===
    await frontendLogin(page, mc005Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
      expiryMonth: cards.mastercard.month,
      expiryYear: cards.mastercard.year,
    });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });
});
