import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI } from '../../helpers/api';
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
import { handle3DSChallenge } from '../../helpers/three-ds';
import { adminLogin } from '../../helpers/wp-login';
import { navigateToOrder, assertOrderStatus, assertPaymentMethodMeta, assertCapturedNote } from '../../helpers/admin-orders';
import {
  extractAllLogs,
  extractSessionPostLogs,
  extractSessionGetLogs,
  extractTokenLogs,
  verifySessionPost,
  verifySessionGet,
  verifyInitiateAuthentication,
  verifyAuthenticatePayer,
  verifyAuthenticationResult,
  verifyAuthorizeCaptureLog,
  verifyTokenLogsEmpty,
} from '../../helpers/log-verification';
import { verifyOrderEmails } from '../../helpers/email-verification';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

test.describe.serial('Hosted Session - 3DS', () => {
  // === MC-050: 3DS Visa with Challenge ===

  let mc050OrderNumber: string;
  let mc050Total: string;
  let mc050Session: string;
  let mc050PayDate: string;

  test('MC-050 - 3DS Visa with Challenge', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      checkout_mode: 'hosted_session',
    });

    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    mc050Total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    mc050Session = await extractSessionId(page);
    await fillHostedSessionCC(page, cards.visaChallenge, config);

    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: mc050Total });
    mc050OrderNumber = result.orderNumber;
    mc050PayDate = new Date().toISOString().slice(0, 10);
    expect(mc050OrderNumber).toBeTruthy();
  });

  test('MC-050 - Admin', async ({ page }) => {
    expect(mc050OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc050OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // Phase 2: Log extraction
    const allLogs = await extractAllLogs(mc050PayDate);
    const sessionPostLogs = await extractSessionPostLogs(mc050PayDate, mc050PayDate, '', '');
    const sessionGetLogs = await extractSessionGetLogs(mc050PayDate, mc050Session, mc050PayDate);
    const tokenLogs = await extractTokenLogs(mc050PayDate, mc050PayDate);

    // Phase 3: Verify Session POST
    const sessionPostLog = sessionPostLogs.logs[0]?.content[0];
    if (sessionPostLog) {
      verifySessionPost(sessionPostLog, {
        session: mc050Session,
        total: mc050Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber: mc050OrderNumber,
        apiOperation: 'CREATE_SESSION',
      });
    }

    // Phase 3b: Verify Session GET (UPDATE_SESSION)
    const sessionGetLog = sessionGetLogs.logs[0]?.content[0];
    if (sessionGetLog) {
      verifySessionGet(sessionGetLog, {
        session: mc050Session,
        card: cards.visaChallenge,
      });
    }

    // Phase 4: No token expected (guest / tokenized cards not triggered)
    verifyTokenLogsEmpty(tokenLogs);

    // Phase 5-7: 3DS auth logs — find by apiOperation in allLogs content
    const allContent = allLogs.logs[0]?.content ?? [];
    const initiateLog = allContent.find((e: any) => e.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION');
    const payerLog = allContent.find((e: any) => e.request?.body?.apiOperation === 'AUTHENTICATE_PAYER');
    // Authentication result is typically a GET response entry after authenticate payer
    const authResultLog = allContent.find(
      (e: any) =>
        e.response?.body?.authenticationStatus !== undefined ||
        e.response?.body?.order?.authenticationStatus !== undefined,
    );
    const captureLog = allContent.find((e: any) => e.request?.body?.apiOperation === 'PAY');

    if (initiateLog) {
      verifyInitiateAuthentication(initiateLog, {
        session: mc050Session,
        card: cards.visaChallenge,
        transactionId: transactionId!,
        currency: 'USD',
      });
    }

    if (payerLog) {
      // Challenge flow: result may be PENDING
      verifyAuthenticatePayer(payerLog, {
        session: mc050Session,
        transactionId: transactionId!,
        currency: 'USD',
        card: cards.visaChallenge,
      });
    }

    if (authResultLog) {
      verifyAuthenticationResult(authResultLog, {
        transactionId: transactionId!,
        currency: 'USD',
        authStatus: 'AUTHENTICATION_SUCCESSFUL',
      });
    }

    // Phase 8: Verify PAY transaction
    if (captureLog) {
      verifyAuthorizeCaptureLog(captureLog, {
        apiOperation: 'PAY',
        session: mc050Session,
        total: mc050Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber: mc050OrderNumber,
        card: cards.visaChallenge,
      });
    }

    // Phase 11: Email verification (purchase → both admin + customer emails)
    await verifyOrderEmails(mc050OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend order check
    await adminLogin(page);
    await navigateToOrder(page, mc050OrderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId!);
    await assertCapturedNote(page, config, transactionId!);
  });

  // === MC-051: 3DS Visa Frictionless ===

  let mc051OrderNumber: string;
  let mc051Total: string;
  let mc051Session: string;
  let mc051PayDate: string;

  test('MC-051 - 3DS Visa Frictionless', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    mc051Total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    mc051Session = await extractSessionId(page);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: mc051Total });
    mc051OrderNumber = result.orderNumber;
    mc051PayDate = new Date().toISOString().slice(0, 10);
    expect(mc051OrderNumber).toBeTruthy();
  });

  test('MC-051 - Admin', async ({ page }) => {
    expect(mc051OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc051OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // Phase 2: Log extraction
    const allLogs = await extractAllLogs(mc051PayDate);
    const sessionPostLogs = await extractSessionPostLogs(mc051PayDate, mc051PayDate, '', '');
    const sessionGetLogs = await extractSessionGetLogs(mc051PayDate, mc051Session, mc051PayDate);
    const tokenLogs = await extractTokenLogs(mc051PayDate, mc051PayDate);

    // Phase 3: Session POST
    const sessionPostLog = sessionPostLogs.logs[0]?.content[0];
    if (sessionPostLog) {
      verifySessionPost(sessionPostLog, {
        session: mc051Session,
        total: mc051Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber: mc051OrderNumber,
        apiOperation: 'CREATE_SESSION',
      });
    }

    // Phase 3b: Session GET
    const sessionGetLog = sessionGetLogs.logs[0]?.content[0];
    if (sessionGetLog) {
      verifySessionGet(sessionGetLog, {
        session: mc051Session,
        card: cards.visaFrictionless,
      });
    }

    // Phase 4: No token expected
    verifyTokenLogsEmpty(tokenLogs);

    // Phase 5-7: 3DS auth logs (frictionless — no challenge, result SUCCESS immediately)
    const allContent = allLogs.logs[0]?.content ?? [];
    const initiateLog = allContent.find((e: any) => e.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION');
    const payerLog = allContent.find((e: any) => e.request?.body?.apiOperation === 'AUTHENTICATE_PAYER');
    const authResultLog = allContent.find(
      (e: any) =>
        e.response?.body?.authenticationStatus !== undefined ||
        e.response?.body?.order?.authenticationStatus !== undefined,
    );
    const captureLog = allContent.find((e: any) => e.request?.body?.apiOperation === 'PAY');

    if (initiateLog) {
      verifyInitiateAuthentication(initiateLog, {
        session: mc051Session,
        card: cards.visaFrictionless,
        transactionId: transactionId!,
        currency: 'USD',
      });
    }

    if (payerLog) {
      // Frictionless: no challenge, result should be SUCCESS (not PENDING)
      verifyAuthenticatePayer(payerLog, {
        session: mc051Session,
        transactionId: transactionId!,
        currency: 'USD',
        card: cards.visaFrictionless,
      });
    }

    if (authResultLog) {
      verifyAuthenticationResult(authResultLog, {
        transactionId: transactionId!,
        currency: 'USD',
        authStatus: 'AUTHENTICATION_SUCCESSFUL',
      });
    }

    // Phase 8: PAY transaction
    if (captureLog) {
      verifyAuthorizeCaptureLog(captureLog, {
        apiOperation: 'PAY',
        session: mc051Session,
        total: mc051Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber: mc051OrderNumber,
        card: cards.visaFrictionless,
      });
    }

    // Phase 11: Emails
    await verifyOrderEmails(mc051OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend
    await adminLogin(page);
    await navigateToOrder(page, mc051OrderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId!);
    await assertCapturedNote(page, config, transactionId!);
  });

  // === MC-052: 3DS Visa Frictionless Authentication Attempted ===

  let mc052OrderNumber: string;
  let mc052Total: string;
  let mc052Session: string;
  let mc052PayDate: string;

  test('MC-052 - 3DS Visa Frictionless Authentication Attempted', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    mc052Total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    mc052Session = await extractSessionId(page);
    await fillHostedSessionCC(page, cards.visaFrictionlessAttempted, config);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: mc052Total });
    mc052OrderNumber = result.orderNumber;
    mc052PayDate = new Date().toISOString().slice(0, 10);
    expect(mc052OrderNumber).toBeTruthy();
  });

  test('MC-052 - Admin', async ({ page }) => {
    expect(mc052OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc052OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // Phase 2: Log extraction
    const allLogs = await extractAllLogs(mc052PayDate);
    const sessionPostLogs = await extractSessionPostLogs(mc052PayDate, mc052PayDate, '', '');
    const sessionGetLogs = await extractSessionGetLogs(mc052PayDate, mc052Session, mc052PayDate);
    const tokenLogs = await extractTokenLogs(mc052PayDate, mc052PayDate);

    // Phase 3: Session POST
    const sessionPostLog = sessionPostLogs.logs[0]?.content[0];
    if (sessionPostLog) {
      verifySessionPost(sessionPostLog, {
        session: mc052Session,
        total: mc052Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber: mc052OrderNumber,
        apiOperation: 'CREATE_SESSION',
      });
    }

    // Phase 3b: Session GET
    const sessionGetLog = sessionGetLogs.logs[0]?.content[0];
    if (sessionGetLog) {
      verifySessionGet(sessionGetLog, {
        session: mc052Session,
        card: cards.visaFrictionlessAttempted,
      });
    }

    // Phase 4: No token expected
    verifyTokenLogsEmpty(tokenLogs);

    // Phase 5-7: 3DS auth logs — auth status AUTHENTICATION_ATTEMPTED
    const allContent = allLogs.logs[0]?.content ?? [];
    const initiateLog = allContent.find((e: any) => e.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION');
    const payerLog = allContent.find((e: any) => e.request?.body?.apiOperation === 'AUTHENTICATE_PAYER');
    const authResultLog = allContent.find(
      (e: any) =>
        e.response?.body?.authenticationStatus !== undefined ||
        e.response?.body?.order?.authenticationStatus !== undefined,
    );
    const captureLog = allContent.find((e: any) => e.request?.body?.apiOperation === 'PAY');

    if (initiateLog) {
      verifyInitiateAuthentication(initiateLog, {
        session: mc052Session,
        card: cards.visaFrictionlessAttempted,
        transactionId: transactionId!,
        currency: 'USD',
      });
    }

    if (payerLog) {
      verifyAuthenticatePayer(payerLog, {
        session: mc052Session,
        transactionId: transactionId!,
        currency: 'USD',
        card: cards.visaFrictionlessAttempted,
      });
    }

    if (authResultLog) {
      verifyAuthenticationResult(authResultLog, {
        transactionId: transactionId!,
        currency: 'USD',
        authStatus: 'AUTHENTICATION_ATTEMPTED',
      });
    }

    // Phase 8: PAY transaction
    if (captureLog) {
      verifyAuthorizeCaptureLog(captureLog, {
        apiOperation: 'PAY',
        session: mc052Session,
        total: mc052Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber: mc052OrderNumber,
        card: cards.visaFrictionlessAttempted,
      });
    }

    // Phase 11: Emails
    await verifyOrderEmails(mc052OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend
    await adminLogin(page);
    await navigateToOrder(page, mc052OrderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId!);
    await assertCapturedNote(page, config, transactionId!);
  });
});
