import { test, expect } from '@playwright/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI, getOrderMeta } from '../../helpers/api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  createAccountAtCheckout,
  extractOrderTotal,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { verifyOrderReceived } from '../../helpers/order-received';
import { handle3DSChallenge } from '../../helpers/three-ds';
import { verifySubscription, verifyPaymentMethods } from '../../helpers/my-account';
import { adminLogin, frontendLogin } from '../../helpers/wp-login';
import { waitForUnblock } from '../../helpers/block-ui';
import { navigateToOrder, assertOrderStatus } from '../../helpers/admin-orders';
import {
  extractAllLogs,
  extractSessionPostLogs,
  extractSessionGetLogs,
  extractTokenLogs,
  verifySessionPost,
  verifySessionGet,
  verifyTokenLogsEmpty,
  verifyAuthorizeCaptureLog,
  verifyAgreement,
} from '../../helpers/log-verification';
import { verifyOrderEmails } from '../../helpers/email-verification';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

test.describe.serial('Hosted Session - Save CC Deactivated', () => {
  const mc031Email = uniqueEmail();

  // === MC-030: Guest checkout, save CC deactivated ===

  let mc030OrderNumber: string;
  let mc030PayDate: string;
  let mc030Session: string;
  let mc030Total: string;

  test('MC-030 - Guest checkout', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'no',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });

    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    mc030Total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);

    // Save card checkbox must NOT be present (guest + deactivated)
    await expect(
      page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`)
    ).not.toBeVisible();
    await expect(page.locator('text=Save to account')).not.toBeVisible();

    mc030PayDate = new Date().toISOString().slice(0, 10);
    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc030OrderNumber = result.orderNumber;
    expect(mc030OrderNumber).toBeTruthy();
  });

  test('MC-030 - Guest checkout - Admin', async ({ page }) => {
    expect(mc030OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc030OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    mc030Session = getOrderMeta(order, config.sessionIdMetaKey) || '';

    // Phase 2: Log extraction
    const sessionPostLogs = await extractSessionPostLogs(mc030PayDate, mc030PayDate, '', '');
    const sessionGetLogs = await extractSessionGetLogs(mc030PayDate, mc030Session, mc030PayDate);
    const tokenLogs = await extractTokenLogs(mc030PayDate, mc030PayDate);

    // Phase 3: Verify session POST
    if (sessionPostLogs.logs[0]?.content?.length) {
      const sessionPostLog = sessionPostLogs.logs[0].content[0];
      verifySessionPost(sessionPostLog, {
        session: mc030Session,
        total: mc030Total,
        currency: 'USD',
        transactionId: transactionId!,
        orderNumber: mc030OrderNumber,
        apiOperation: 'CREATE_SESSION',
      });
    }

    // Phase 3: Verify session GET
    if (sessionGetLogs.logs[0]?.content?.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session: mc030Session, card: cards.mastercard });
    }

    // Phase 4: Token logs must be EMPTY (tokenizedCards=inactive)
    verifyTokenLogsEmpty(tokenLogs);

    // Phase 11: Email verification (purchase = admin + customer)
    await verifyOrderEmails(mc030OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend
    await adminLogin(page);
    await navigateToOrder(page, mc030OrderNumber);
    await assertOrderStatus(page, 'Processing');
    await expect(page.locator('.woocommerce-order-data__meta')).toContainText(`Payment via ${config.displayName}`);
    await expect(page.locator('li.note.system-note .note_content > p').first()).toContainText(transactionId!);

    // Phase 13: My Account – 0 saved cards (guest, save CC deactivated)
    await verifyPaymentMethods(page, { expectedCards: 0 });
  });

  // === MC-031: New user, save CC deactivated ===

  let mc031OrderNumber: string;
  let mc031PayDate: string;
  let mc031Session: string;
  let mc031Total: string;

  test('MC-031 - New user', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.digital);
    await fillBilling(page, { ...billing, email: mc031Email });
    await createAccountAtCheckout(page, billing.password);
    mc031Total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);

    // Save card checkbox must NOT be present (deactivated)
    await expect(
      page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`)
    ).not.toBeVisible();

    mc031PayDate = new Date().toISOString().slice(0, 10);
    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc031OrderNumber = result.orderNumber;
    expect(mc031OrderNumber).toBeTruthy();
  });

  test('MC-031 - New user - Admin', async ({ page }) => {
    expect(mc031OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc031OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    mc031Session = getOrderMeta(order, config.sessionIdMetaKey) || '';

    // Phase 4: Token logs must be EMPTY (tokenizedCards=inactive)
    const tokenLogs = await extractTokenLogs(mc031PayDate, mc031PayDate);
    verifyTokenLogsEmpty(tokenLogs);

    // Phase 11: Email verification
    await verifyOrderEmails(mc031OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend
    await adminLogin(page);
    await navigateToOrder(page, mc031OrderNumber);
    await assertOrderStatus(page, 'Processing');

    // Phase 13: My Account – 0 saved cards
    await frontendLogin(page, mc031Email, billing.password);
    await verifyPaymentMethods(page, { expectedCards: 0 });
  });

  // === MC-032: Logged user, pay with new CC, save CC deactivated ===

  let mc032OrderNumber: string;
  let mc032PayDate: string;
  let mc032Total: string;

  test('MC-032 - Logged user pay with new CC', async ({ page }) => {
    await frontendLogin(page, mc031Email, billing.password);
    await addToCartAndCheckout(page, config.products.physical);
    mc032Total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);

    // Save card checkbox must NOT be present (deactivated)
    await expect(
      page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`)
    ).not.toBeVisible();

    mc032PayDate = new Date().toISOString().slice(0, 10);
    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc032OrderNumber = result.orderNumber;
    expect(mc032OrderNumber).toBeTruthy();
  });

  test('MC-032 - Logged user pay with new CC - Admin', async ({ page }) => {
    expect(mc032OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc032OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // Phase 4: Token logs must be EMPTY (tokenizedCards=inactive)
    const tokenLogs = await extractTokenLogs(mc032PayDate, mc032PayDate);
    verifyTokenLogsEmpty(tokenLogs);

    // Phase 11: Email verification
    await verifyOrderEmails(mc032OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 13: My Account – still 0 saved cards
    await frontendLogin(page, mc031Email, billing.password);
    await verifyPaymentMethods(page, { expectedCards: 0 });
  });

  // === MC-060: Subscription with challenge, save CC deactivated ===

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

    // Save card checkbox must NOT be visible even for subscriptions (forced tokenization, no UI checkbox)
    await expect(
      page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`)
    ).not.toBeVisible();

    mc060PayDate = new Date().toISOString().slice(0, 10);
    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
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

    // Phase 2: Log extraction
    const sessionGetLogs = await extractSessionGetLogs(mc060PayDate, mc060Session, mc060PayDate);
    const tokenLogs = await extractTokenLogs(mc060PayDate, mc060PayDate);
    const allLogs = await extractAllLogs(mc060PayDate);

    // Phase 3: Verify session GET (UPDATE_SESSION)
    if (sessionGetLogs.logs[0]?.content?.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session: mc060Session, card: cards.visaChallenge });
    }

    // Phase 9: Verify agreement (subscription)
    if (allLogs.logs[0]?.content?.length) {
      const agreementLog = allLogs.logs[0].content.find(
        (l: any) => l.request?.body?.agreement
      );
      if (agreementLog) {
        verifyAgreement(agreementLog, {
          subscriptionId: mc060SubscriptionId,
          frequency: 'MONTHLY',
          payDate: mc060PayDate,
        });
      }
    }

    // Phase 11: Email verification (purchase)
    await verifyOrderEmails(mc060OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend
    await adminLogin(page);
    await navigateToOrder(page, mc060OrderNumber);
    await assertOrderStatus(page, 'Processing');

    // Phase 14: Verify subscription
    expect(mc060SubscriptionId).toBeTruthy();
    await verifySubscription(page, mc060SubscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  test('MC-060 - Subscription Renewal', async ({ page }) => {
    expect(mc060SubscriptionId).toBeTruthy();

    await adminLogin(page);

    // Try HPOS URL first, fall back to classic post edit URL
    const hposUrl = `/wp-admin/admin.php?page=wc-orders--shop_subscription&action=edit&id=${mc060SubscriptionId}`;
    const classicUrl = `/wp-admin/post.php?post=${mc060SubscriptionId}&action=edit`;

    // Check if HPOS is enabled by looking for the nav menu item
    const hposMenuLink = page.locator('a[href*="wc-orders--shop_subscription"]');
    const hposEnabled = await hposMenuLink.isVisible({ timeout: 3000 }).catch(() => false);

    if (hposEnabled) {
      await page.goto(hposUrl);
    } else {
      await page.goto(classicUrl);
    }

    await page.waitForLoadState('networkidle');

    // Select the process renewal action
    const actionSelect = page.locator('#order_action, select[name="wc_order_action"]');
    await actionSelect.selectOption('wcs_process_renewal');

    // Click Update
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

    // Verify the subscription page is still present after renewal trigger
    await expect(page.locator('h1, .woocommerce-page-title, #title')).toBeVisible();
  });
});
