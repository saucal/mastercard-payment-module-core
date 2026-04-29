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
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { verifyOrderReceived } from '../../helpers/order-received';
import { adminLogin } from '../../helpers/wp-login';
import {
  navigateToOrder,
  assertOrderStatus,
  assertPaymentMethodMeta,
  assertCapturedNote,
} from '../../helpers/admin-orders';
import { verifyCartEmpty } from '../../helpers/my-account';
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
import { billing } from '../../fixtures/billing';

test.describe.serial('Hosted Session - 3DS Inactive', () => {
  let orderNumber: string;

  let payDate: string;
  let sessionDate: string;
  let session: string;
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

  // === MC-050: 3DS Visa with Challenge (3DS inactive — no auth flow) ===

  test('MC-050 - 3DS Visa with Challenge', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'no',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });

    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    sessionDate = payDate;
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaChallenge, config);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    await page.waitForURL(/order-received/, { timeout: 60000 });
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
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
    verifySessionGet(sessionPut!, { session, card: cards.visaChallenge });
    const sessionGet = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'GET'
        && l.request?.url?.includes('/session/')
        && l.response?.body?.session?.id === session
    );
    expect(sessionGet, 'session GET card details entry not found').toBeTruthy();
    verifySessionGetCardDetails(sessionGet!, { session, card: cards.visaChallenge });

    verifyTokenLogsEmpty(tokenLogs);

    expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
    const logContent = allLogs.logs[0].content;
    const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

    // 3DS inactive: no auth flow expected
    const initiateAuthLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l)
    );
    expect(initiateAuthLog, 'INITIATE_AUTHENTICATION log should NOT be present (3DS inactive)').toBeFalsy();
    const authenticatePayerLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER' && txFilter(l)
    );
    expect(authenticatePayerLog, 'AUTHENTICATE_PAYER log should NOT be present (3DS inactive)').toBeFalsy();

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card: cards.visaChallenge,
    });

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);
  });

  // === MC-051: 3DS Visa Frictionless (3DS inactive) ===

  test('MC-051 - 3DS Visa Frictionless', async ({ page }) => {
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    sessionDate = payDate;
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    await page.waitForURL(/order-received/, { timeout: 60000 });
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
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
    verifySessionGet(sessionPut!, { session, card: cards.visaFrictionless });
    const sessionGet = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'GET'
        && l.request?.url?.includes('/session/')
        && l.response?.body?.session?.id === session
    );
    expect(sessionGet, 'session GET card details entry not found').toBeTruthy();
    verifySessionGetCardDetails(sessionGet!, { session, card: cards.visaFrictionless });

    verifyTokenLogsEmpty(tokenLogs);

    expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
    const logContent = allLogs.logs[0].content;
    const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

    const initiateAuthLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l)
    );
    expect(initiateAuthLog, 'INITIATE_AUTHENTICATION log should NOT be present (3DS inactive)').toBeFalsy();
    const authenticatePayerLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER' && txFilter(l)
    );
    expect(authenticatePayerLog, 'AUTHENTICATE_PAYER log should NOT be present (3DS inactive)').toBeFalsy();

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card: cards.visaFrictionless,
    });

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);
  });

  // === MC-052: 3DS Visa Frictionless Authentication Attempted (3DS inactive) ===

  test('MC-052 - 3DS Visa Frictionless Authentication Attempted', async ({ page }) => {
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    sessionDate = payDate;
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionlessAttempted, config);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    await page.waitForURL(/order-received/, { timeout: 60000 });
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
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
    verifySessionGet(sessionPut!, { session, card: cards.visaFrictionlessAttempted });
    const sessionGet = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'GET'
        && l.request?.url?.includes('/session/')
        && l.response?.body?.session?.id === session
    );
    expect(sessionGet, 'session GET card details entry not found').toBeTruthy();
    verifySessionGetCardDetails(sessionGet!, { session, card: cards.visaFrictionlessAttempted });

    verifyTokenLogsEmpty(tokenLogs);

    expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
    const logContent = allLogs.logs[0].content;
    const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

    const initiateAuthLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l)
    );
    expect(initiateAuthLog, 'INITIATE_AUTHENTICATION log should NOT be present (3DS inactive)').toBeFalsy();
    const authenticatePayerLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER' && txFilter(l)
    );
    expect(authenticatePayerLog, 'AUTHENTICATE_PAYER log should NOT be present (3DS inactive)').toBeFalsy();

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card: cards.visaFrictionlessAttempted,
    });

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);
  });

});
