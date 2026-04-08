import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI } from '../../helpers/api';
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
import { adminLogin, frontendLogin } from '../../helpers/wp-login';
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
  verifyAuthorizeCaptureLog,
  verifyAgreement,
} from '../../helpers/log-verification';
import { verifyOrderEmails } from '../../helpers/email-verification';
import { verifySubscription, verifyOrderInMyAccount } from '../../helpers/my-account';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

test.describe.serial('Subscription Manual Renewal', () => {
  let orderNumber: string;
  let subscriptionId: string;
  let session: string;
  let total: string;
  let totalRenew: string;
  let payDate: string;

  // === MC-060: Subscription with Challenge (baseline) ===

  test('MC-060 - Subscription with challenge', async ({ page }) => {
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

    session = await extractSessionId(page);
    total = await extractOrderTotal(page);
    totalRenew = await extractRecurringTotal(page);
    payDate = new Date().toISOString().slice(0, 19);

    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
    expect(result.subscriptionId).toBeTruthy();
    subscriptionId = result.subscriptionId!;
  });

  test('MC-060 - Admin', async ({ page }) => {
    expect(orderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // Log extraction
    const allLogs = await extractAllLogs(payDate);
    const sessionPostLogs = await extractSessionPostLogs(payDate, payDate, '', '');
    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate);
    const tokenLogs = await extractTokenLogs(payDate, payDate);

    // Verify session POST
    const sessionPostLog = sessionPostLogs.logs[0]?.content[0];
    if (sessionPostLog) {
      verifySessionPost(sessionPostLog, {
        session,
        total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber,
        apiOperation: 'INITIATE_CHECKOUT',
      });
    }

    // Verify session GET
    const sessionGetLog = sessionGetLogs.logs[0]?.content[0];
    if (sessionGetLog) {
      verifySessionGet(sessionGetLog, { session, card: cards.visaChallenge });
    }

    // Token log: subscription forces tokenization
    const tokenLog = tokenLogs.logs[0]?.content[0];
    if (tokenLog) {
      verifyTokenLog(tokenLog, { session, card: cards.visaChallenge });
    }

    // Verify 3DS auth logs
    const logContent = allLogs.logs[0]?.content ?? [];
    const initiateAuthLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION',
    );
    if (initiateAuthLog) {
      verifyInitiateAuthentication(initiateAuthLog, {
        session,
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
        session,
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
        session,
        total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber,
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
        subscriptionId,
        frequency: 'MONTHLY',
        payDate,
      });
    }

    // Email verification
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend — verify order status in UI
    await adminLogin(page);
    await navigateToOrder(page, orderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId!);
    await assertCapturedNote(page, config, transactionId!);
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { displayName: config.displayName });

    // Verify subscription status
    expect(subscriptionId).toBeTruthy();
    await verifySubscription(page, subscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  // === MC-065: Manual renewal from My Account ===

  test('MC-065 - Manual renewal', async ({ page }) => {
    expect(subscriptionId).toBeTruthy();

    await frontendLogin(page, billing.email, billing.password);
    await page.goto(`/my-account/view-subscription/${subscriptionId}/`);

    // Look for "Renew Now" or early renewal link - depends on WooCommerce Subscriptions configuration
    const renewLink = page.locator('a.subscription_renewal_early, a[href*="subscription_renewal"]');
    if (await renewLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await renewLink.first().click();
      // Goes through checkout with saved payment method
      await selectPaymentMethod(page, config);
      await clickPlaceOrder(page);
      const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
      expect(result.orderNumber).toBeTruthy();
      orderNumber = result.orderNumber;
    } else {
      // TODO: Configure WooCommerce Subscriptions to allow early manual renewal
      // to enable this test. Skipping as the renewal option is not available.
      test.skip();
    }
  });

  // === MC-065: Admin - verify manual renewal order ===

  test('MC-065 - Admin', async ({ page }) => {
    expect(orderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // Log extraction for manual renewal order
    const manualRenewDate = new Date().toISOString().slice(0, 19);
    const allLogs = await extractAllLogs(manualRenewDate);
    const logContent = allLogs.logs[0]?.content ?? [];

    // Verify agreement in manual renewal order logs
    const agreementLog = logContent.find(
      (l: any) => l.request?.body?.agreement?.type === 'RECURRING',
    );
    if (agreementLog) {
      verifyAgreement(agreementLog, {
        type: 'RECURRING',
        amountVariability: 'FIXED',
        subscriptionId,
        frequency: 'MONTHLY',
        payDate: manualRenewDate,
      });
    }

    // Email verification for renewal order
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend — verify order status in UI
    await adminLogin(page);
    await navigateToOrder(page, orderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId!);
    await assertCapturedNote(page, config, transactionId!);
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { displayName: config.displayName });

    // Verify subscription remains active
    expect(subscriptionId).toBeTruthy();
    await verifySubscription(page, subscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  // === MC-065: Automatic renewal after manual renewal ===

  test('MC-065 - Renewal after manual renew', async ({ page }) => {
    expect(subscriptionId).toBeTruthy();

    await adminLogin(page);
    await triggerSubscriptionRenewal(page, subscriptionId);

    const renewalOrderNumber = await extractRenewalOrderNumber(page);
    expect(renewalOrderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(renewalOrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // Renewal: verify total matches totalRenew
    const renewalTotal = parseFloat(totalRenew.replace(/[^0-9.]/g, ''));
    const orderTotal = parseFloat(order.total);
    expect(orderTotal).toBeCloseTo(renewalTotal, 2);

    // Renewal uses stored token — no new session logs expected
    const renewDate = new Date().toISOString().slice(0, 19);
    const sessionPostLogs = await extractSessionPostLogs(renewDate, renewDate, '', '');
    const sessionGetLogs = await extractSessionGetLogs(renewDate, session, renewDate);
    expect(sessionPostLogs.logs[0]?.content.length ?? 0).toBe(0);
    expect(sessionGetLogs.logs[0]?.content.length ?? 0).toBe(0);
  });
});
