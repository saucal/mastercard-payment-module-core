import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI, getOrderMeta } from '../../helpers/api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  extractOrderTotal,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { verifyOrderReceived } from '../../helpers/order-received';
import { adminLogin } from '../../helpers/wp-login';
import {
  navigateToOrder,
  assertOrderStatus,
  capturePayment,
  voidPayment,
  triggerSubscriptionRenewal,
  extractRenewalOrderNumber,
  assertCaptureFormVisible,
  assertVoidFormVisible,
  assertAuthorizedNote,
  assertCapturedNote,
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
  verifyAgreement,
} from '../../helpers/log-verification';
import { verifyAdminEmail } from '../../helpers/email-verification';
import { verifySubscription } from '../../helpers/my-account';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

test.describe.serial('Authorize / Capture / Void', () => {
  // === MC-020: Partial capture ===

  let mc020OrderNumber: string;
  let mc020Total: string;
  let mc020PayDate: string;
  let mc020Session: string;
  let mc020TransactionId: string;
  let mc020PartialAmount: string;

  test('MC-020 Step 1 - Create order', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      transaction_mode: 'AUTHORIZE',
      checkout_mode: 'hosted_session',
    });

    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    mc020Total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    mc020PayDate = new Date().toISOString().slice(0, 19);
    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: mc020Total });
    mc020OrderNumber = result.orderNumber;
    expect(mc020OrderNumber).toBeTruthy();
  });

  test('MC-020 Step 2 - Partial capture', async ({ page }) => {
    expect(mc020OrderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(mc020OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();
    mc020TransactionId = transactionId!;
    mc020Session = getOrderMeta(order, config.sessionIdMetaKey) || '';

    // Phase 3: Verify AUTHORIZE log
    const sessionGetLogs = await extractSessionGetLogs(mc020PayDate, mc020Session, mc020PayDate);
    if (sessionGetLogs.logs[0]?.content?.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session: mc020Session, card: cards.visaFrictionless });
    }

    // Phase 4: No token log (not saving CC, transactionType=authorize)
    const tokenLogs = await extractTokenLogs(mc020PayDate, mc020PayDate);
    verifyTokenLogsEmpty(tokenLogs);

    // Phase 11: Admin email only (AUTHORIZE mode)
    await verifyAdminEmail(mc020OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend - perform partial capture
    await adminLogin(page);
    await navigateToOrder(page, mc020OrderNumber);
    await assertOrderStatus(page, 'On hold');
    await assertAuthorizedNote(page, config, mc020TransactionId);
    await assertCaptureFormVisible(page, config, true);
    await assertVoidFormVisible(page, config, true);

    mc020PartialAmount = (parseFloat(mc020Total.replace(/[^0-9.]/g, '')) / 4).toFixed(2);
    await capturePayment(page, config, mc020PartialAmount);

    // After partial capture, order remains On hold
    await assertOrderStatus(page, 'On hold');
    await assertCapturedNote(page, config, mc020TransactionId);
  });

  test('MC-020 Step 3 - Verify CAPTURE log', async () => {
    expect(mc020TransactionId).toBeTruthy();

    // Verify CAPTURE log with partial amount
    const transactionLogs = await extractTransactionPutLogs(mc020PayDate);
    const captureLogs = transactionLogs.logs[0]?.content?.filter(
      (l: any) => l.request?.body?.apiOperation === 'CAPTURE'
    ) || [];

    if (captureLogs.length > 0) {
      const captureLog = captureLogs[0];
      verifyAuthorizeCaptureLog(captureLog, {
        apiOperation: 'CAPTURE',
        total: mc020PartialAmount,
        currency: 'USD',
        transactionId: mc020TransactionId,
        orderNumber: mc020OrderNumber,
        card: cards.visaFrictionless,
      });
    }
  });

  // === MC-021: Full capture ===

  let mc021OrderNumber: string;
  let mc021Total: string;
  let mc021PayDate: string;
  let mc021Session: string;
  let mc021TransactionId: string;

  test('MC-021 Step 1 - Create order', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    mc021Total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    mc021PayDate = new Date().toISOString().slice(0, 19);
    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: mc021Total });
    mc021OrderNumber = result.orderNumber;
    expect(mc021OrderNumber).toBeTruthy();
  });

  test('MC-021 Step 2 - Full capture', async ({ page }) => {
    expect(mc021OrderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(mc021OrderNumber, config);
    expect(transactionId).toBeTruthy();
    mc021TransactionId = transactionId!;
    mc021Session = getOrderMeta(order, config.sessionIdMetaKey) || '';

    // Phase 3: Verify session GET (AUTHORIZE)
    const sessionGetLogs = await extractSessionGetLogs(mc021PayDate, mc021Session, mc021PayDate);
    if (sessionGetLogs.logs[0]?.content?.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session: mc021Session, card: cards.visaFrictionless });
    }

    // Phase 11: Admin email only (AUTHORIZE mode)
    await verifyAdminEmail(mc021OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend - full capture
    await adminLogin(page);
    await navigateToOrder(page, mc021OrderNumber);
    await assertOrderStatus(page, 'On hold');
    await assertAuthorizedNote(page, config, mc021TransactionId);

    // Full capture (no amount = full)
    await capturePayment(page, config);

    // After full capture, order should move to Processing or Completed
    const statusEl = page.locator('#select2-order_status-container');
    const status = await statusEl.textContent() || '';
    expect(['Processing', 'Completed'].some(s => status.includes(s))).toBeTruthy();
    await assertCapturedNote(page, config, mc021TransactionId);
  });

  test('MC-021 Step 3 - Verify CAPTURE log', async () => {
    expect(mc021TransactionId).toBeTruthy();

    // Verify CAPTURE log with full amount
    const transactionLogs = await extractTransactionPutLogs(mc021PayDate);
    const captureLogs = transactionLogs.logs[0]?.content?.filter(
      (l: any) => l.request?.body?.apiOperation === 'CAPTURE'
    ) || [];

    if (captureLogs.length > 0) {
      const captureLog = captureLogs[0];
      verifyAuthorizeCaptureLog(captureLog, {
        apiOperation: 'CAPTURE',
        total: mc021Total,
        currency: 'USD',
        transactionId: mc021TransactionId,
        orderNumber: mc021OrderNumber,
        card: cards.visaFrictionless,
      });
    }
  });

  // === MC-022: Void payment ===

  let mc022OrderNumber: string;
  let mc022PayDate: string;
  let mc022Session: string;
  let mc022TransactionId: string;

  test('MC-022 Step 1 - Create order', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    mc022PayDate = new Date().toISOString().slice(0, 19);
    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc022OrderNumber = result.orderNumber;
    expect(mc022OrderNumber).toBeTruthy();
  });

  test('MC-022 Step 2 - Void payment', async ({ page }) => {
    expect(mc022OrderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(mc022OrderNumber, config);
    expect(transactionId).toBeTruthy();
    mc022TransactionId = transactionId!;
    mc022Session = getOrderMeta(order, config.sessionIdMetaKey) || '';

    await adminLogin(page);
    await navigateToOrder(page, mc022OrderNumber);
    await assertOrderStatus(page, 'On hold');
    await assertAuthorizedNote(page, config, mc022TransactionId);

    await voidPayment(page, config);

    await assertOrderStatus(page, 'Cancelled');
    await assertCaptureFormVisible(page, config, false);
    await assertVoidFormVisible(page, config, false);
    await assertOrderNoteContains(page, 'Authorization was cancelled');
  });

  test('MC-022 Step 3 - Verify VOID log', async () => {
    expect(mc022TransactionId).toBeTruthy();

    // Verify VOID log
    const transactionLogs = await extractTransactionPutLogs(mc022PayDate);
    const voidLogs = transactionLogs.logs[0]?.content?.filter(
      (l: any) => l.request?.body?.apiOperation === 'VOID'
    ) || [];

    if (voidLogs.length > 0) {
      const voidLog = voidLogs[0];
      verifyVoidLog(voidLog, {
        transactionId: mc022TransactionId,
        orderNumber: mc022OrderNumber,
        currency: 'USD',
        card: cards.visaFrictionless,
      });
    }
  });

  // === MC-061: Subscription with authorize mode ===

  let mc061OrderNumber: string;
  let mc061SubscriptionId: string;
  let mc061PayDate: string;
  let mc061Session: string;
  let mc061TransactionId: string;

  test('MC-061 - Subscription frictionless', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    mc061PayDate = new Date().toISOString().slice(0, 19);
    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc061OrderNumber = result.orderNumber;
    expect(mc061OrderNumber).toBeTruthy();
    expect(result.subscriptionId).toBeTruthy();
    mc061SubscriptionId = result.subscriptionId!;
  });

  test('MC-061 - Subscription Admin', async ({ page }) => {
    expect(mc061OrderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(mc061OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();
    mc061TransactionId = transactionId!;
    mc061Session = getOrderMeta(order, config.sessionIdMetaKey) || '';

    // Phase 3: Verify session GET
    const sessionGetLogs = await extractSessionGetLogs(mc061PayDate, mc061Session, mc061PayDate);
    if (sessionGetLogs.logs[0]?.content?.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session: mc061Session, card: cards.visaFrictionless });
    }

    // Phase 9: Verify agreement (subscription)
    const { extractAllLogs } = await import('../../helpers/log-verification');
    const allLogs = await extractAllLogs(mc061PayDate);
    if (allLogs.logs[0]?.content?.length) {
      const agreementLog = allLogs.logs[0].content.find(
        (l: any) => l.request?.body?.agreement
      );
      if (agreementLog) {
        verifyAgreement(agreementLog, {
          subscriptionId: mc061SubscriptionId,
          frequency: 'MONTHLY',
          payDate: mc061PayDate,
        });
      }
    }

    // Phase 11: Admin email only (AUTHORIZE mode)
    await verifyAdminEmail(mc061OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend - order on hold (authorize mode)
    await adminLogin(page);
    await navigateToOrder(page, mc061OrderNumber);
    await assertOrderStatus(page, 'On hold');
    await assertAuthorizedNote(page, config, mc061TransactionId);

    // Phase 14: Verify subscription active
    expect(mc061SubscriptionId).toBeTruthy();
    await verifySubscription(page, mc061SubscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  test('MC-061 - Subscription Renewal', async ({ page }) => {
    expect(mc061SubscriptionId).toBeTruthy();

    await adminLogin(page);
    await triggerSubscriptionRenewal(page, mc061SubscriptionId);

    const renewalOrderNumber = await extractRenewalOrderNumber(page);
    expect(renewalOrderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(renewalOrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();
  });
});
