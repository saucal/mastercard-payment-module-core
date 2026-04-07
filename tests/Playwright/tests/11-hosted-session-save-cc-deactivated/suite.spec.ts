import { test, expect } from '@playwright/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI } from '../../helpers/api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  createAccountAtCheckout,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { verifyOrderReceived } from '../../helpers/order-received';
import { handle3DSChallenge } from '../../helpers/three-ds';
import { verifySubscription } from '../../helpers/my-account';
import { adminLogin, frontendLogin } from '../../helpers/wp-login';
import { waitForUnblock } from '../../helpers/block-ui';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

test.describe.serial('Hosted Session - Save CC Deactivated', () => {
  const mc031Email = uniqueEmail();

  // === MC-030: Guest checkout, save CC deactivated ===

  let mc030OrderNumber: string;

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
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);

    // Save card checkbox must NOT be present (guest + deactivated)
    await expect(
      page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`)
    ).not.toBeVisible();

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc030OrderNumber = result.orderNumber;
    expect(mc030OrderNumber).toBeTruthy();
  });

  test('MC-030 - Guest checkout - Admin', async () => {
    expect(mc030OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc030OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();
  });

  // === MC-031: New user, save CC deactivated ===

  let mc031OrderNumber: string;

  test('MC-031 - New user', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.digital);
    await fillBilling(page, { ...billing, email: mc031Email });
    await createAccountAtCheckout(page, billing.password);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);

    // Save card checkbox must NOT be present (deactivated)
    await expect(
      page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`)
    ).not.toBeVisible();

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc031OrderNumber = result.orderNumber;
    expect(mc031OrderNumber).toBeTruthy();
  });

  test('MC-031 - New user - Admin', async () => {
    expect(mc031OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc031OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();
  });

  // === MC-032: Logged user, pay with new CC, save CC deactivated ===

  let mc032OrderNumber: string;

  test('MC-032 - Logged user pay with new CC', async ({ page }) => {
    await frontendLogin(page, mc031Email, billing.password);
    await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);

    // Save card checkbox must NOT be present (deactivated)
    await expect(
      page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`)
    ).not.toBeVisible();

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc032OrderNumber = result.orderNumber;
    expect(mc032OrderNumber).toBeTruthy();
  });

  test('MC-032 - Logged user pay with new CC - Admin', async () => {
    expect(mc032OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc032OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();
  });

  // === MC-060: Subscription with challenge, save CC deactivated ===

  let mc060OrderNumber: string;
  let mc060SubscriptionId: string;

  test('MC-060 - Subscription with challenge', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaChallenge, config);

    // Save card checkbox must NOT be visible even for subscriptions (forced tokenization, no UI checkbox)
    await expect(
      page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`)
    ).not.toBeVisible();

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
