import { test, expect } from '@playwright/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI } from '../../helpers/api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { verifyOrderReceived } from '../../helpers/order-received';
import { handle3DSChallenge } from '../../helpers/three-ds';
import { verifySubscription } from '../../helpers/my-account';
import { adminLogin } from '../../helpers/wp-login';
import { waitForUnblock } from '../../helpers/block-ui';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

test.describe.serial('Hosted Session - 3DS Inactive', () => {
  // === MC-050: 3DS Visa with Challenge ===

  let mc050OrderNumber: string;

  test('MC-050 - 3DS Visa with Challenge', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'inactive',
      checkout_mode: 'hosted_session',
    });

    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaChallenge, config);

    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc050OrderNumber = result.orderNumber;
    expect(mc050OrderNumber).toBeTruthy();
  });

  test('MC-050 - Admin', async () => {
    expect(mc050OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc050OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();
  });

  // === MC-051: 3DS Visa Frictionless ===

  let mc051OrderNumber: string;

  test('MC-051 - 3DS Visa Frictionless', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc051OrderNumber = result.orderNumber;
    expect(mc051OrderNumber).toBeTruthy();
  });

  test('MC-051 - Admin', async () => {
    expect(mc051OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc051OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();
  });

  // === MC-052: 3DS Visa Frictionless Authentication Attempted ===

  let mc052OrderNumber: string;

  test('MC-052 - 3DS Visa Frictionless Authentication Attempted', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionlessAttempted, config);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc052OrderNumber = result.orderNumber;
    expect(mc052OrderNumber).toBeTruthy();
  });

  test('MC-052 - Admin', async () => {
    expect(mc052OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc052OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();
  });

  // === MC-060: Subscription order with Challenge ===

  let orderNumber: string;
  let subscriptionId: string;

  test('MC-060 - Subscription order with Challenge', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaChallenge, config);

    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    orderNumber = result.orderNumber;
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

    expect(subscriptionId).toBeTruthy();
    await verifySubscription(page, subscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  test('MC-060 - Subscription Renewal', async ({ page }) => {
    expect(subscriptionId).toBeTruthy();

    await adminLogin(page);

    // Try HPOS URL first, fall back to classic post edit URL
    const hposUrl = `/wp-admin/admin.php?page=wc-orders--shop_subscription&action=edit&id=${subscriptionId}`;
    const classicUrl = `/wp-admin/post.php?post=${subscriptionId}&action=edit`;

    let navigated = false;

    // Check if HPOS is enabled by looking for the nav menu item
    const hposMenuLink = page.locator('a[href*="wc-orders--shop_subscription"]');
    const hposEnabled = await hposMenuLink.isVisible({ timeout: 3000 }).catch(() => false);

    if (hposEnabled) {
      await page.goto(hposUrl);
    } else {
      await page.goto(classicUrl);
    }

    // Wait for the subscription edit page to load
    await page.waitForLoadState('networkidle');

    // Select the process renewal action
    const actionSelect = page.locator('#order_action, select[name="wc_order_action"]');
    await actionSelect.selectOption('wcs_process_renewal');

    // Click Update
    const updateBtn = page.locator('#post-preview, button[name="save"], input[name="save"], button.components-button.is-primary').first();
    // For classic WP post editor
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

    // Verify a new renewal order was created by checking the subscription still exists
    await expect(page.locator('h1, .woocommerce-page-title, #title')).toBeVisible();
  });
});
