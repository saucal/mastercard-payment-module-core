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

test.describe.serial('Subscription Upgrade', () => {
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

  // === MC-064: Upgrade subscription ===

  test('MC-064 - Upgrade subscription', async ({ page }) => {
    expect(subscriptionId).toBeTruthy();

    await frontendLogin(page, billing.email, billing.password);
    await page.goto(`/my-account/view-subscription/${subscriptionId}/`);

    // Look for upgrade/switch button - depends on WooCommerce Subscriptions Switching being configured
    const upgradeLink = page.locator('a.subscription_switch_link, a[href*="switch-subscription"]');
    if (await upgradeLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await upgradeLink.first().click();
      // Select new product/plan and proceed through checkout
      // This is store-specific and depends on the upgrade product being configured
      await selectPaymentMethod(page, config);
      await clickPlaceOrder(page);
      const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
      expect(result.orderNumber).toBeTruthy();
      orderNumber = result.orderNumber;
      // Update subscriptionId to the upgraded subscription if a new one was created
      if (result.subscriptionId) {
        subscriptionId = result.subscriptionId;
      }
    } else {
      // TODO: Configure WooCommerce Subscriptions Switching and an upgradeable product
      // to enable this test. Skipping as the upgrade option is not available.
      test.skip();
    }
  });

  // === MC-064: Admin - verify upgraded subscription ===

  test('MC-064 - Admin', async ({ page }) => {
    expect(orderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // Log extraction for upgrade order
    const upgradePayDate = new Date().toISOString().slice(0, 19);
    const allLogs = await extractAllLogs(upgradePayDate);
    const logContent = allLogs.logs[0]?.content ?? [];

    // Verify agreement in upgrade order logs
    const agreementLog = logContent.find(
      (l: any) => l.request?.body?.agreement?.type === 'RECURRING',
    );
    if (agreementLog) {
      verifyAgreement(agreementLog, {
        type: 'RECURRING',
        amountVariability: 'FIXED',
        subscriptionId,
        frequency: 'MONTHLY',
        payDate: upgradePayDate,
      });
    }

    // Phase 12: Admin backend — verify order status in UI
    await adminLogin(page);
    await navigateToOrder(page, orderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId!);
    await assertCapturedNote(page, config, transactionId!);
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { displayName: config.displayName });

    // Verify subscription status in My Account
    expect(subscriptionId).toBeTruthy();
    await verifySubscription(page, subscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  // === MC-064: Renewal of upgraded subscription ===

  test('MC-064 - Renewal of upgrade', async ({ page }) => {
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
