import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI, getOrderMeta } from '../../helpers/api';
import { waitForUnblock } from '../../helpers/block-ui';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  extractOrderTotal,
  extractRecurringTotal,
  extractSessionId,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { verifyOrderReceived } from '../../helpers/order-received';
import { handle3DSChallenge } from '../../helpers/three-ds';
import { verifySubscription, verifyOrderInMyAccount } from '../../helpers/my-account';
import { adminLogin } from '../../helpers/wp-login';
import {
  triggerSubscriptionRenewal,
  extractRenewalOrderNumber,
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
  verifyTokenLog,
  verifyInitiateAuthentication,
  verifyAuthenticatePayer,
  verifyAuthenticationResult,
  verifyAuthorizeCaptureLog,
  verifyAgreement,
} from '../../helpers/log-verification';
import { verifyOrderEmails } from '../../helpers/email-verification';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

test.describe.serial('Subscription Renewal', () => {
  // === MC-060: Subscription with Challenge (classic) ===

  let mc060OrderNumber: string;
  let mc060SubscriptionId: string;
  let mc060Session: string;
  let mc060Total: string;
  let mc060TotalRenew: string;
  let mc060PayDate: string;

  test('MC-060 - Subscription with challenge (classic)', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
      subscription: 'yes',
    });

    await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaChallenge, config);

    mc060Session = await extractSessionId(page);
    mc060Total = await extractOrderTotal(page);
    mc060TotalRenew = await extractRecurringTotal(page);
    mc060PayDate = new Date().toISOString().slice(0, 19);

    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: mc060Total });
    mc060OrderNumber = result.orderNumber;
    expect(mc060OrderNumber).toBeTruthy();
    expect(result.subscriptionId).toBeTruthy();
    mc060SubscriptionId = result.subscriptionId!;
  });

  test('MC-060 - Admin', async ({ page }) => {
    expect(mc060OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc060OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // Log extraction
    const allLogs = await extractAllLogs(mc060PayDate);
    const sessionPostLogs = await extractSessionPostLogs(mc060PayDate, mc060PayDate, '', '');
    const sessionGetLogs = await extractSessionGetLogs(mc060PayDate, mc060Session, mc060PayDate);
    const tokenLogs = await extractTokenLogs(mc060PayDate, mc060PayDate);

    // Verify session POST
    const sessionPostLog = sessionPostLogs.logs[0]?.content[0];
    if (sessionPostLog) {
      verifySessionPost(sessionPostLog, {
        session: mc060Session,
        total: mc060Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber: mc060OrderNumber,
        apiOperation: 'INITIATE_CHECKOUT',
      });
    }

    // Verify session GET (UPDATE_SESSION)
    const sessionGetLog = sessionGetLogs.logs[0]?.content[0];
    if (sessionGetLog) {
      verifySessionGet(sessionGetLog, {
        session: mc060Session,
        card: cards.visaChallenge,
      });
    }

    // Token log: subscription forces tokenization
    const tokenLog = tokenLogs.logs[0]?.content[0];
    if (tokenLog) {
      verifyTokenLog(tokenLog, { session: mc060Session, card: cards.visaChallenge });
    }

    // Verify 3DS auth logs
    const logContent = allLogs.logs[0]?.content ?? [];
    const initiateAuthLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION',
    );
    if (initiateAuthLog) {
      verifyInitiateAuthentication(initiateAuthLog, {
        session: mc060Session,
        card: cards.visaChallenge,
        transactionId: transactionId!,
        currency: 'USD',
      });
    }

    const authenticatePayerLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER',
    );
    if (authenticatePayerLog) {
      verifyAuthenticatePayer(authenticatePayerLog, {
        session: mc060Session,
        transactionId: transactionId!,
        currency: 'USD',
        card: cards.visaChallenge,
      });
    }

    // Verify PAY log
    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY',
    );
    if (captureLog) {
      verifyAuthorizeCaptureLog(captureLog, {
        apiOperation: 'PAY',
        session: mc060Session,
        total: mc060Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber: mc060OrderNumber,
        card: cards.visaChallenge,
      });
    }

    // Verify agreement (subscription)
    const agreementLog = logContent.find(
      (l: any) => l.request?.body?.agreement?.type === 'RECURRING',
    );
    if (agreementLog) {
      verifyAgreement(agreementLog, {
        type: 'RECURRING',
        amountVariability: 'FIXED',
        subscriptionId: mc060SubscriptionId,
        frequency: 'MONTHLY',
        payDate: mc060PayDate,
      });
    }

    // Email verification (PURCHASE = both admin and customer emails)
    await verifyOrderEmails(mc060OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend — verify order status in UI
    await adminLogin(page);
    await navigateToOrder(page, mc060OrderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId!);
    await assertCapturedNote(page, config, transactionId!);
    await verifyOrderInMyAccount(page, mc060OrderNumber, 'Processing', { displayName: config.displayName });

    // Verify subscription status in My Account
    expect(mc060SubscriptionId).toBeTruthy();
    await verifySubscription(page, mc060SubscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  test('MC-060 - Renewal', async ({ page }) => {
    expect(mc060SubscriptionId).toBeTruthy();

    await adminLogin(page);
    await triggerSubscriptionRenewal(page, mc060SubscriptionId);

    const renewalOrderNumber = await extractRenewalOrderNumber(page);
    expect(renewalOrderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(renewalOrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // Renewal: verify total matches totalRenew (uses stored token, no new session logs)
    const renewalTotal = parseFloat(mc060TotalRenew.replace(/[^0-9.]/g, ''));
    const orderTotal = parseFloat(order.total);
    expect(orderTotal).toBeCloseTo(renewalTotal, 2);

    // Renewal uses stored token — no new session logs expected
    const renewDate = new Date().toISOString().slice(0, 19);
    const sessionPostLogs = await extractSessionPostLogs(renewDate, renewDate, '', '');
    const sessionGetLogs = await extractSessionGetLogs(renewDate, mc060Session, renewDate);
    expect(sessionPostLogs.logs[0]?.content.length ?? 0).toBe(0);
    expect(sessionGetLogs.logs[0]?.content.length ?? 0).toBe(0);
  });

  // === MC-061: Subscription frictionless (classic) ===

  let mc061OrderNumber: string;
  let mc061SubscriptionId: string;
  let mc061Session: string;
  let mc061Total: string;
  let mc061TotalRenew: string;
  let mc061PayDate: string;

  test('MC-061 - Subscription frictionless (classic)', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    mc061Session = await extractSessionId(page);
    mc061Total = await extractOrderTotal(page);
    mc061TotalRenew = await extractRecurringTotal(page);
    mc061PayDate = new Date().toISOString().slice(0, 19);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: mc061Total });
    mc061OrderNumber = result.orderNumber;
    expect(mc061OrderNumber).toBeTruthy();
    expect(result.subscriptionId).toBeTruthy();
    mc061SubscriptionId = result.subscriptionId!;
  });

  test('MC-061 - Admin', async ({ page }) => {
    expect(mc061OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc061OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // Log extraction
    const allLogs = await extractAllLogs(mc061PayDate);
    const sessionPostLogs = await extractSessionPostLogs(mc061PayDate, mc061PayDate, '', '');
    const sessionGetLogs = await extractSessionGetLogs(mc061PayDate, mc061Session, mc061PayDate);
    const tokenLogs = await extractTokenLogs(mc061PayDate, mc061PayDate);

    // Verify session POST
    const sessionPostLog = sessionPostLogs.logs[0]?.content[0];
    if (sessionPostLog) {
      verifySessionPost(sessionPostLog, {
        session: mc061Session,
        total: mc061Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber: mc061OrderNumber,
        apiOperation: 'INITIATE_CHECKOUT',
      });
    }

    // Verify session GET
    const sessionGetLog = sessionGetLogs.logs[0]?.content[0];
    if (sessionGetLog) {
      verifySessionGet(sessionGetLog, {
        session: mc061Session,
        card: cards.visaFrictionless,
      });
    }

    // Token log: subscription forces tokenization
    const tokenLog = tokenLogs.logs[0]?.content[0];
    if (tokenLog) {
      verifyTokenLog(tokenLog, { session: mc061Session, card: cards.visaFrictionless });
    }

    // Verify 3DS auth logs (frictionless — no challenge but auth logs still present)
    const logContent = allLogs.logs[0]?.content ?? [];
    const initiateAuthLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION',
    );
    if (initiateAuthLog) {
      verifyInitiateAuthentication(initiateAuthLog, {
        session: mc061Session,
        card: cards.visaFrictionless,
        transactionId: transactionId!,
        currency: 'USD',
      });
    }

    const authenticatePayerLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER',
    );
    if (authenticatePayerLog) {
      verifyAuthenticatePayer(authenticatePayerLog, {
        session: mc061Session,
        transactionId: transactionId!,
        currency: 'USD',
        card: cards.visaFrictionless,
      });
    }

    // Verify PAY log
    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY',
    );
    if (captureLog) {
      verifyAuthorizeCaptureLog(captureLog, {
        apiOperation: 'PAY',
        session: mc061Session,
        total: mc061Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber: mc061OrderNumber,
        card: cards.visaFrictionless,
      });
    }

    // Verify agreement (subscription)
    const agreementLog = logContent.find(
      (l: any) => l.request?.body?.agreement?.type === 'RECURRING',
    );
    if (agreementLog) {
      verifyAgreement(agreementLog, {
        type: 'RECURRING',
        amountVariability: 'FIXED',
        subscriptionId: mc061SubscriptionId,
        frequency: 'MONTHLY',
        payDate: mc061PayDate,
      });
    }

    // Email verification
    await verifyOrderEmails(mc061OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend — verify order status in UI
    await adminLogin(page);
    await navigateToOrder(page, mc061OrderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId!);
    await assertCapturedNote(page, config, transactionId!);
    await verifyOrderInMyAccount(page, mc061OrderNumber, 'Processing', { displayName: config.displayName });

    // Verify subscription status
    expect(mc061SubscriptionId).toBeTruthy();
    await verifySubscription(page, mc061SubscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  test('MC-061 - Renewal', async ({ page }) => {
    expect(mc061SubscriptionId).toBeTruthy();

    await adminLogin(page);
    await triggerSubscriptionRenewal(page, mc061SubscriptionId);

    const renewalOrderNumber = await extractRenewalOrderNumber(page);
    expect(renewalOrderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(renewalOrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // Renewal: verify total matches totalRenew
    const renewalTotal = parseFloat(mc061TotalRenew.replace(/[^0-9.]/g, ''));
    const orderTotal = parseFloat(order.total);
    expect(orderTotal).toBeCloseTo(renewalTotal, 2);

    // Renewal uses stored token — no new session logs expected
    const renewDate = new Date().toISOString().slice(0, 19);
    const sessionPostLogs = await extractSessionPostLogs(renewDate, renewDate, '', '');
    const sessionGetLogs = await extractSessionGetLogs(renewDate, mc061Session, renewDate);
    expect(sessionPostLogs.logs[0]?.content.length ?? 0).toBe(0);
    expect(sessionGetLogs.logs[0]?.content.length ?? 0).toBe(0);
  });

  // === MC-062: Subscription with Challenge (blocks) ===

  let mc062OrderNumber: string;
  let mc062SubscriptionId: string;
  let mc062Session: string;
  let mc062Total: string;
  let mc062TotalRenew: string;
  let mc062PayDate: string;

  test('MC-062 - Subscription with challenge (blocks)', async ({ page }) => {
    await switchCheckoutMode('blocks');

    await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaChallenge, config);

    mc062Session = await extractSessionId(page);
    mc062Total = await extractOrderTotal(page);
    mc062TotalRenew = await extractRecurringTotal(page);
    mc062PayDate = new Date().toISOString().slice(0, 19);

    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: mc062Total });
    mc062OrderNumber = result.orderNumber;
    expect(mc062OrderNumber).toBeTruthy();
    expect(result.subscriptionId).toBeTruthy();
    mc062SubscriptionId = result.subscriptionId!;
  });

  test('MC-062 - Admin', async ({ page }) => {
    expect(mc062OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc062OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // Log extraction
    const allLogs = await extractAllLogs(mc062PayDate);
    const sessionPostLogs = await extractSessionPostLogs(mc062PayDate, mc062PayDate, '', '');
    const sessionGetLogs = await extractSessionGetLogs(mc062PayDate, mc062Session, mc062PayDate);
    const tokenLogs = await extractTokenLogs(mc062PayDate, mc062PayDate);

    // Verify session POST
    const sessionPostLog = sessionPostLogs.logs[0]?.content[0];
    if (sessionPostLog) {
      verifySessionPost(sessionPostLog, {
        session: mc062Session,
        total: mc062Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber: mc062OrderNumber,
        apiOperation: 'INITIATE_CHECKOUT',
      });
    }

    // Verify session GET
    const sessionGetLog = sessionGetLogs.logs[0]?.content[0];
    if (sessionGetLog) {
      verifySessionGet(sessionGetLog, {
        session: mc062Session,
        card: cards.visaChallenge,
      });
    }

    // Token log: subscription forces tokenization
    const tokenLog = tokenLogs.logs[0]?.content[0];
    if (tokenLog) {
      verifyTokenLog(tokenLog, { session: mc062Session, card: cards.visaChallenge });
    }

    // Verify 3DS auth logs
    const logContent = allLogs.logs[0]?.content ?? [];
    const initiateAuthLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION',
    );
    if (initiateAuthLog) {
      verifyInitiateAuthentication(initiateAuthLog, {
        session: mc062Session,
        card: cards.visaChallenge,
        transactionId: transactionId!,
        currency: 'USD',
      });
    }

    const authenticatePayerLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER',
    );
    if (authenticatePayerLog) {
      verifyAuthenticatePayer(authenticatePayerLog, {
        session: mc062Session,
        transactionId: transactionId!,
        currency: 'USD',
        card: cards.visaChallenge,
      });
    }

    // Verify PAY log
    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY',
    );
    if (captureLog) {
      verifyAuthorizeCaptureLog(captureLog, {
        apiOperation: 'PAY',
        session: mc062Session,
        total: mc062Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber: mc062OrderNumber,
        card: cards.visaChallenge,
      });
    }

    // Verify agreement (subscription)
    const agreementLog = logContent.find(
      (l: any) => l.request?.body?.agreement?.type === 'RECURRING',
    );
    if (agreementLog) {
      verifyAgreement(agreementLog, {
        type: 'RECURRING',
        amountVariability: 'FIXED',
        subscriptionId: mc062SubscriptionId,
        frequency: 'MONTHLY',
        payDate: mc062PayDate,
      });
    }

    // Email verification
    await verifyOrderEmails(mc062OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend — verify order status in UI
    await adminLogin(page);
    await navigateToOrder(page, mc062OrderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId!);
    await assertCapturedNote(page, config, transactionId!);
    await verifyOrderInMyAccount(page, mc062OrderNumber, 'Processing', { displayName: config.displayName });

    // Verify subscription status
    expect(mc062SubscriptionId).toBeTruthy();
    await verifySubscription(page, mc062SubscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  // === MC-063: Subscription frictionless (blocks) ===

  let mc063OrderNumber: string;
  let mc063SubscriptionId: string;
  let mc063Session: string;
  let mc063Total: string;
  let mc063TotalRenew: string;
  let mc063PayDate: string;

  test('MC-063 - Subscription frictionless (blocks)', async ({ page }) => {
    await switchCheckoutMode('blocks');

    await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    mc063Session = await extractSessionId(page);
    mc063Total = await extractOrderTotal(page);
    mc063TotalRenew = await extractRecurringTotal(page);
    mc063PayDate = new Date().toISOString().slice(0, 19);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: mc063Total });
    mc063OrderNumber = result.orderNumber;
    expect(mc063OrderNumber).toBeTruthy();
    expect(result.subscriptionId).toBeTruthy();
    mc063SubscriptionId = result.subscriptionId!;
  });

  test('MC-063 - Admin', async ({ page }) => {
    expect(mc063OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc063OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // Log extraction
    const allLogs = await extractAllLogs(mc063PayDate);
    const sessionPostLogs = await extractSessionPostLogs(mc063PayDate, mc063PayDate, '', '');
    const sessionGetLogs = await extractSessionGetLogs(mc063PayDate, mc063Session, mc063PayDate);
    const tokenLogs = await extractTokenLogs(mc063PayDate, mc063PayDate);

    // Verify session POST
    const sessionPostLog = sessionPostLogs.logs[0]?.content[0];
    if (sessionPostLog) {
      verifySessionPost(sessionPostLog, {
        session: mc063Session,
        total: mc063Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber: mc063OrderNumber,
        apiOperation: 'INITIATE_CHECKOUT',
      });
    }

    // Verify session GET
    const sessionGetLog = sessionGetLogs.logs[0]?.content[0];
    if (sessionGetLog) {
      verifySessionGet(sessionGetLog, {
        session: mc063Session,
        card: cards.visaFrictionless,
      });
    }

    // Token log: subscription forces tokenization
    const tokenLog = tokenLogs.logs[0]?.content[0];
    if (tokenLog) {
      verifyTokenLog(tokenLog, { session: mc063Session, card: cards.visaFrictionless });
    }

    // Verify 3DS auth logs (frictionless)
    const logContent = allLogs.logs[0]?.content ?? [];
    const initiateAuthLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION',
    );
    if (initiateAuthLog) {
      verifyInitiateAuthentication(initiateAuthLog, {
        session: mc063Session,
        card: cards.visaFrictionless,
        transactionId: transactionId!,
        currency: 'USD',
      });
    }

    const authenticatePayerLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER',
    );
    if (authenticatePayerLog) {
      verifyAuthenticatePayer(authenticatePayerLog, {
        session: mc063Session,
        transactionId: transactionId!,
        currency: 'USD',
        card: cards.visaFrictionless,
      });
    }

    // Verify PAY log
    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY',
    );
    if (captureLog) {
      verifyAuthorizeCaptureLog(captureLog, {
        apiOperation: 'PAY',
        session: mc063Session,
        total: mc063Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber: mc063OrderNumber,
        card: cards.visaFrictionless,
      });
    }

    // Verify agreement (subscription)
    const agreementLog = logContent.find(
      (l: any) => l.request?.body?.agreement?.type === 'RECURRING',
    );
    if (agreementLog) {
      verifyAgreement(agreementLog, {
        type: 'RECURRING',
        amountVariability: 'FIXED',
        subscriptionId: mc063SubscriptionId,
        frequency: 'MONTHLY',
        payDate: mc063PayDate,
      });
    }

    // Email verification
    await verifyOrderEmails(mc063OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend — verify order status in UI
    await adminLogin(page);
    await navigateToOrder(page, mc063OrderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId!);
    await assertCapturedNote(page, config, transactionId!);
    await verifyOrderInMyAccount(page, mc063OrderNumber, 'Processing', { displayName: config.displayName });

    // Verify subscription status
    expect(mc063SubscriptionId).toBeTruthy();
    await verifySubscription(page, mc063SubscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });
});

// ============================================================================
// MC-060 variant: 3DS Inactive (moved from suite 07-hosted-session-3ds-inactive)
// ----------------------------------------------------------------------------
// The subscription addon's gateway-support filter currently rejects the gateway
// when _3d_secure: 'no'. Skipped pending addon-side investigation; sources
// preserved verbatim from the original suite-07 port for future reactivation.
// ============================================================================

test.describe.skip('Subscription Order - Challenge with 3DS Inactive (from suite 07)', () => {
  test.beforeAll(async () => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'no',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });
  });

  let orderNumber: string;
  let subscriptionId: string;
  let mc060Total: string;
  let mc060Session: string;
  let mc060PayDate: string;

  test('MC-060 - Subscription order with Challenge', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, billing);
    mc060Total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    mc060Session = await extractSessionId(page);
    await fillHostedSessionCC(page, cards.visaChallenge, config);

    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: mc060Total });
    orderNumber = result.orderNumber;
    mc060PayDate = new Date().toISOString().slice(0, 19);
    expect(orderNumber).toBeTruthy();
    expect(result.subscriptionId).toBeTruthy();
    subscriptionId = result.subscriptionId!;
  });

  test('MC-060 - Subscription Admin', async ({ page }) => {
    expect(orderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    const allLogs = await extractAllLogs(mc060PayDate);
    const sessionPostLogs = await extractSessionPostLogs(mc060PayDate, mc060PayDate, '', '');
    const sessionGetLogs = await extractSessionGetLogs(mc060PayDate, mc060Session, mc060PayDate);

    const sessionPostLog = sessionPostLogs.logs[0]?.content[0];
    if (sessionPostLog) {
      verifySessionPost(sessionPostLog, {
        session: mc060Session,
        total: mc060Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber,
        apiOperation: 'CREATE_SESSION',
      });
    }

    const sessionGetLog = sessionGetLogs.logs[0]?.content[0];
    if (sessionGetLog) {
      verifySessionGet(sessionGetLog, { session: mc060Session, card: cards.visaChallenge });
    }

    const allContent = allLogs.logs[0]?.content ?? [];
    const initiateLog = allContent.find((e: any) => e.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION');
    const payerLog = allContent.find((e: any) => e.request?.body?.apiOperation === 'AUTHENTICATE_PAYER');
    expect(initiateLog).toBeUndefined();
    expect(payerLog).toBeUndefined();

    const captureLog = allContent.find((e: any) => e.request?.body?.apiOperation === 'PAY');
    if (captureLog) {
      verifyAuthorizeCaptureLog(captureLog, {
        apiOperation: 'PAY',
        session: mc060Session,
        total: mc060Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber,
        card: cards.visaChallenge,
      });
    }

    const agreementLog = allContent.find(
      (e: any) => e.request?.body?.agreement !== undefined || e.response?.body?.agreement !== undefined,
    );
    if (agreementLog && subscriptionId) {
      verifyAgreement(agreementLog, {
        subscriptionId,
        frequency: 'MONTHLY',
        payDate: mc060PayDate,
      });
    }

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    await adminLogin(page);
    await navigateToOrder(page, orderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId!);
    await assertCapturedNote(page, config, transactionId!);

    expect(subscriptionId).toBeTruthy();
    await verifySubscription(page, subscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  test('MC-060 - Subscription Renewal', async ({ page }) => {
    expect(subscriptionId).toBeTruthy();

    await adminLogin(page);
    await triggerSubscriptionRenewal(page, subscriptionId);

    const renewalOrderNumber = await extractRenewalOrderNumber(page);
    expect(renewalOrderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(renewalOrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();
  });
});

// ============================================================================
// MC-060 variant: Save CC Deactivated (moved from suite 11-save-cc-deactivated)
// ----------------------------------------------------------------------------
// Subscriptions need a saved card to renew; with saved_cards: 'no' the addon's
// gateway-support filter rejects the gateway. Skipped pending addon-side
// investigation; sources preserved verbatim from the original suite-11 port.
// ============================================================================

test.describe.skip('Subscription Order - Challenge with Save CC Deactivated (from suite 11)', () => {
  test.beforeAll(async () => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'no',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });
  });

  let mc060OrderNumber: string;
  let mc060SubscriptionId: string;
  let mc060PayDate: string;
  let mc060Session: string;
  let mc060Total: string;

  test('MC-060 - Subscription with challenge', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, billing);
    mc060Total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaChallenge, config);

    // Save card checkbox must NOT be visible (saved_cards: 'no')
    await expect(
      page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`),
    ).not.toBeVisible();

    mc060PayDate = new Date().toISOString().slice(0, 19);
    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: mc060Total });
    mc060OrderNumber = result.orderNumber;
    expect(mc060OrderNumber).toBeTruthy();
    expect(result.subscriptionId).toBeTruthy();
    mc060SubscriptionId = result.subscriptionId!;
  });

  test('MC-060 - Subscription Admin', async ({ page }) => {
    expect(mc060OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc060OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    mc060Session = getOrderMeta(order, config.sessionIdMetaKey) || '';

    const sessionGetLogs = await extractSessionGetLogs(mc060PayDate, mc060Session, mc060PayDate);
    const allLogs = await extractAllLogs(mc060PayDate);

    if (sessionGetLogs.logs[0]?.content?.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session: mc060Session, card: cards.visaChallenge });
    }

    if (allLogs.logs[0]?.content?.length) {
      const agreementLog = allLogs.logs[0].content.find(
        (l: any) => l.request?.body?.agreement,
      );
      if (agreementLog) {
        verifyAgreement(agreementLog, {
          subscriptionId: mc060SubscriptionId,
          frequency: 'MONTHLY',
          payDate: mc060PayDate,
        });
      }
    }

    await verifyOrderEmails(mc060OrderNumber, { paymentMethodTitle: config.displayName });

    await adminLogin(page);
    await navigateToOrder(page, mc060OrderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId!);
    await assertCapturedNote(page, config, transactionId!);

    expect(mc060SubscriptionId).toBeTruthy();
    await verifySubscription(page, mc060SubscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  test('MC-060 - Subscription Renewal', async ({ page }) => {
    expect(mc060SubscriptionId).toBeTruthy();

    await adminLogin(page);

    const hposUrl = `/wp-admin/admin.php?page=wc-orders--shop_subscription&action=edit&id=${mc060SubscriptionId}`;
    const classicUrl = `/wp-admin/post.php?post=${mc060SubscriptionId}&action=edit`;

    const hposMenuLink = page.locator('a[href*="wc-orders--shop_subscription"]');
    const hposEnabled = await hposMenuLink.isVisible({ timeout: 3000 }).catch(() => false);

    if (hposEnabled) {
      await page.goto(hposUrl);
    } else {
      await page.goto(classicUrl);
    }

    await page.waitForLoadState('networkidle');

    const actionSelect = page.locator('#order_action, select[name="wc_order_action"]');
    await actionSelect.selectOption('wcs_process_renewal');

    const updateBtn = page.locator('#post-preview, button[name="save"], input[name="save"], button.components-button.is-primary').first();
    const classicUpdateBtn = page.locator('#publish');
    const wooUpdateBtn = page.locator('button.save_order, button[name="save_order"]');

    if (await classicUpdateBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await classicUpdateBtn.click();
    } else if (await wooUpdateBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await wooUpdateBtn.click();
    } else {
      await updateBtn.click();
    }

    await waitForUnblock(page);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1, .woocommerce-page-title, #title')).toBeVisible();
  });
});
