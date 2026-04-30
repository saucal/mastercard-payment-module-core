import { test, expect } from '../../fixtures/test';
import { Page } from '@playwright/test';
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
import { handle3DSChallenge } from '../../helpers/three-ds';
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

test.describe.serial('Hosted Session - Capture - Classic', () => {
  let orderNumber: string;
  const mc005Email = uniqueEmail();
  const mc006Email = uniqueEmail();

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
    await switchCheckoutMode('classic');
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
      ? sessionPostLogs.logs[0].content.find((l: any) => l.response?.body?.session?.id === session && (l.response?.body?.result === "SUCCESS" || l.response?.body?.session?.updateStatus === "SUCCESS" || l.response?.body?.session?.version))
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

    expect(sessionPostLogs.logs[0]?.content.length, 'session POST logs should not be empty').toBeGreaterThan(0);
    const sessionPostLog = session
      ? sessionPostLogs.logs[0].content.find((l: any) => l.response?.body?.session?.id === session && (l.response?.body?.result === "SUCCESS" || l.response?.body?.session?.updateStatus === "SUCCESS" || l.response?.body?.session?.version))
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

    // === MY ACCOUNT (buyer's page) — 0 saved cards ===
    await frontendLogin(page, mc005Email, billing.password);
    await verifyPaymentMethods(page, { expectedCards: 0 });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-006: New user, saving CC ===

  test('MC-006 - New user saving CC', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.digital);
    sessionDate = payDate;
    await fillBilling(page, { ...billing, email: mc006Email });
    await createAccountAtCheckout(page, billing.password);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);
    await clickSaveCardCheckbox(page);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

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

    expect(sessionPostLogs.logs[0]?.content.length, 'session POST logs should not be empty').toBeGreaterThan(0);
    const sessionPostLog = session
      ? sessionPostLogs.logs[0].content.find((l: any) => l.response?.body?.session?.id === session && (l.response?.body?.result === "SUCCESS" || l.response?.body?.session?.updateStatus === "SUCCESS" || l.response?.body?.session?.version))
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

    // Auth + capture logs
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
    await frontendLogin(page, mc006Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
      expiryMonth: cards.mastercard.month,
      expiryYear: cards.mastercard.year,
    });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-007: Logged user, pay with saved CC ===
  // AUDIT 2026-04-29 vs GI: JUSTIFIED FIX — saved-token path skips
  // `verifySessionGetCardDetails` (saved-token flow doesn't fetch card
  // details from MPGS — token references the card, no GET /session/{id}
  // for fresh card data).

  test('MC-007 - Logged user pay with saved CC', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    await frontendLogin(page, mc006Email, billing.password);
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    sessionDate = payDate;
    await selectPaymentMethod(page, config);
    await selectSavedToken(page, 1);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    // === API VERIFICATION ===
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // === LOG VERIFICATION ===
    const allLogs = await extractAllLogs(payDate, logOffset);
    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate, logOffset);
    const tokenLogs = await extractTokenLogs(payDate, payDate, logOffset);

    // Saved-token path: session may be empty in the DOM; derive from log.
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
    // Saved-token path does not fetch card details from the session — skip.

    // No new token (using saved CC)
    verifyTokenLogsEmpty(tokenLogs);

    // Auth + capture logs
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
    await frontendLogin(page, mc006Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
      expiryMonth: cards.mastercard.month,
      expiryYear: cards.mastercard.year,
    });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-008: Logged user, pay with new CC (not saving) ===

  test('MC-008 - Logged user pay with new CC', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    await frontendLogin(page, mc006Email, billing.password);
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    sessionDate = payDate;
    await selectPaymentMethod(page, config, true); // useNewToken = true
    await fillHostedSessionCC(page, cards.mastercard2, config);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

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

    expect(sessionPostLogs.logs[0]?.content.length, 'session POST logs should not be empty').toBeGreaterThan(0);
    const sessionPostLog = session
      ? sessionPostLogs.logs[0].content.find((l: any) => l.response?.body?.session?.id === session && (l.response?.body?.result === "SUCCESS" || l.response?.body?.session?.updateStatus === "SUCCESS" || l.response?.body?.session?.version))
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
    verifySessionGet(sessionPut!, { session, card: cards.mastercard2 });
    const sessionGet = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'GET'
        && l.request?.url?.includes('/session/')
        && l.response?.body?.session?.id === session
    );
    expect(sessionGet, 'session GET card details entry not found').toBeTruthy();
    verifySessionGetCardDetails(sessionGet!, { session, card: cards.mastercard2 });

    verifyTokenLogsEmpty(tokenLogs);

    // Auth + capture logs
    expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
    const logContent = allLogs.logs[0].content;
    const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

    const initiateAuthLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(initiateAuthLog, 'INITIATE_AUTHENTICATION log not found').toBeTruthy();
    verifyInitiateAuthentication(initiateAuthLog!, {
      session, card: cards.mastercard2, transactionId: transactionId!, currency: 'USD',
    });

    const authenticatePayerLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(authenticatePayerLog, 'AUTHENTICATE_PAYER log not found').toBeTruthy();
    verifyAuthenticatePayer(authenticatePayerLog!, {
      session, transactionId: transactionId!, currency: 'USD', card: cards.mastercard2,
    });

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card: cards.mastercard2,
    });

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // === ADMIN BACKEND (admin page) ===
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    // === MY ACCOUNT (buyer's page) — still 1 card (didn't save new one) ===
    await frontendLogin(page, mc006Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
      expiryMonth: cards.mastercard.month,
      expiryYear: cards.mastercard.year,
    });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-009: Logged user, pay with new CC and save it ===

  // AUDIT 2026-04-29 vs GI: JUSTIFIED FIX — challenge card adds
  // `handle3DSChallenge` + `AUTHENTICATION_SUCCESSFUL` log probe (GI's
  // shared-step library handles this conditionally; PW makes it explicit).
  test('MC-009 - Logged user pay with new CC and save it', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    await frontendLogin(page, mc006Email, billing.password);
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    sessionDate = payDate;
    await selectPaymentMethod(page, config, true); // useNewToken = true
    await fillHostedSessionCC(page, cards.mastercard3, config);
    await clickSaveCardCheckbox(page);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

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

    expect(sessionPostLogs.logs[0]?.content.length, 'session POST logs should not be empty').toBeGreaterThan(0);
    const sessionPostLog = session
      ? sessionPostLogs.logs[0].content.find((l: any) => l.response?.body?.session?.id === session && (l.response?.body?.result === "SUCCESS" || l.response?.body?.session?.updateStatus === "SUCCESS" || l.response?.body?.session?.version))
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
    verifySessionGet(sessionPut!, { session, card: cards.mastercard3 });
    const sessionGet = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'GET'
        && l.request?.url?.includes('/session/')
        && l.response?.body?.session?.id === session
    );
    expect(sessionGet, 'session GET card details entry not found').toBeTruthy();
    verifySessionGetCardDetails(sessionGet!, { session, card: cards.mastercard3 });

    // Token present (saving CC)
    expect(tokenLogs.logs[0]?.content.length, 'token logs should not be empty').toBeGreaterThan(0);
    verifyTokenLog(tokenLogs.logs[0].content[0], { session, card: cards.mastercard3 });

    // Auth + capture logs
    expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
    const logContent = allLogs.logs[0].content;
    const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

    const initiateAuthLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(initiateAuthLog, 'INITIATE_AUTHENTICATION log not found').toBeTruthy();
    verifyInitiateAuthentication(initiateAuthLog!, {
      session, card: cards.mastercard3, transactionId: transactionId!, currency: 'USD',
    });

    const expectedAuthResult = cards.mastercard3.challenge ? 'PENDING' : 'SUCCESS';
    const authenticatePayerLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER' && txFilter(l)
        && l.response?.body?.result === expectedAuthResult
    );
    expect(authenticatePayerLog, 'AUTHENTICATE_PAYER log not found').toBeTruthy();
    verifyAuthenticatePayer(authenticatePayerLog!, {
      session, transactionId: transactionId!, currency: 'USD', card: cards.mastercard3,
    });

    // For challenge cards, verify final authentication status after ACS prompt.
    if (cards.mastercard3.challenge) {
      const authResultLog = logContent.find(
        (l: any) => txFilter(l) && (
          l.response?.body?.authenticationStatus === 'AUTHENTICATION_SUCCESSFUL'
          || l.response?.body?.order?.authenticationStatus === 'AUTHENTICATION_SUCCESSFUL'
        )
      );
      expect(authResultLog, 'AUTHENTICATION_SUCCESSFUL result log not found').toBeTruthy();
    }

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card: cards.mastercard3,
    });

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // === ADMIN BACKEND (admin page) ===
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    // === MY ACCOUNT (buyer's page) — 2 cards (MC-006 saved + MC-009 saved) ===
    await frontendLogin(page, mc006Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 2,
      cards: [
        { cardName: cards.mastercard.name, fourDigits: fourDigits(cards.mastercard), expiryMonth: cards.mastercard.month, expiryYear: cards.mastercard.year },
        { cardName: cards.mastercard3.name, fourDigits: fourDigits(cards.mastercard3), expiryMonth: cards.mastercard3.month, expiryYear: cards.mastercard3.year },
      ],
    });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-010: Logged user, pay with second saved CC ===

  // AUDIT 2026-04-29 vs GI: JUSTIFIED FIX — saved-token of a challenge card
  // skips `verifySessionGetCardDetails` (saved-token path) and adds
  // conditional 3DS handling (challenge token MAY re-challenge per issuer).
  test('MC-010 - Logged user pay with second saved CC', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    await frontendLogin(page, mc006Email, billing.password);
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    sessionDate = payDate;
    await selectPaymentMethod(page, config);
    await selectSavedToken(page, 2);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    if (/acs|3ds|threedsecure|mastercard\.com.*prompt/i.test(page.url())) {
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
    const allLogs = await extractAllLogs(payDate, logOffset);
    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate, logOffset);
    const tokenLogs = await extractTokenLogs(payDate, payDate, logOffset);

    // Saved-token path: session may be empty in the DOM; derive from log.
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
    verifySessionGet(sessionPut!, { session: resolvedSession, card: cards.mastercard3 });
    // Saved-token path does not fetch card details from the session — skip.

    // No new token (using existing saved CC)
    verifyTokenLogsEmpty(tokenLogs);

    // Auth + capture logs
    expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
    const logContent = allLogs.logs[0].content;
    const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

    const initiateAuthLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(initiateAuthLog, 'INITIATE_AUTHENTICATION log not found').toBeTruthy();
    verifyInitiateAuthentication(initiateAuthLog!, {
      session: resolvedSession, card: cards.mastercard3, transactionId: transactionId!, currency: 'USD',
    });

    const expectedAuthResult = cards.mastercard3.challenge ? 'PENDING' : 'SUCCESS';
    const authenticatePayerLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER' && txFilter(l)
        && l.response?.body?.result === expectedAuthResult
    );
    expect(authenticatePayerLog, 'AUTHENTICATE_PAYER log not found').toBeTruthy();
    verifyAuthenticatePayer(authenticatePayerLog!, {
      session: resolvedSession, transactionId: transactionId!, currency: 'USD', card: cards.mastercard3,
    });

    // For challenge cards, verify final authentication status after ACS prompt.
    if (cards.mastercard3.challenge) {
      const authResultLog = logContent.find(
        (l: any) => txFilter(l) && (
          l.response?.body?.authenticationStatus === 'AUTHENTICATION_SUCCESSFUL'
          || l.response?.body?.order?.authenticationStatus === 'AUTHENTICATION_SUCCESSFUL'
        )
      );
      expect(authResultLog, 'AUTHENTICATION_SUCCESSFUL result log not found').toBeTruthy();
    }

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session: resolvedSession, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card: cards.mastercard3,
    });

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // === ADMIN BACKEND (admin page) ===
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    // === MY ACCOUNT (buyer's page) — still 2 cards ===
    await frontendLogin(page, mc006Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 2,
      cards: [
        { cardName: cards.mastercard.name, fourDigits: fourDigits(cards.mastercard), expiryMonth: cards.mastercard.month, expiryYear: cards.mastercard.year },
        { cardName: cards.mastercard3.name, fourDigits: fourDigits(cards.mastercard3), expiryMonth: cards.mastercard3.month, expiryYear: cards.mastercard3.year },
      ],
    });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });
});
