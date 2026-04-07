import { test, expect } from '@playwright/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI } from '../../helpers/api';
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
} from '../../helpers/admin-orders';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

test.describe.serial('Authorize / Capture / Void', () => {
  // === MC-020: Partial capture ===

  let mc020OrderNumber: string;
  let mc020Total: string;

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

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc020OrderNumber = result.orderNumber;
    expect(mc020OrderNumber).toBeTruthy();
  });

  test('MC-020 Step 2 - Partial capture', async ({ page }) => {
    expect(mc020OrderNumber).toBeTruthy();

    await adminLogin(page);
    await navigateToOrder(page, mc020OrderNumber);
    await assertOrderStatus(page, 'On hold');
    await assertCaptureFormVisible(page, config, true);
    await assertVoidFormVisible(page, config, true);

    const partialAmount = (parseFloat(mc020Total.replace(/[^0-9.]/g, '')) / 4).toFixed(2);
    await capturePayment(page, config, partialAmount);

    // After partial capture, order remains On hold
    await assertOrderStatus(page, 'On hold');
  });

  // === MC-021: Full capture ===

  let mc021OrderNumber: string;

  test('MC-021 Step 1 - Create order', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc021OrderNumber = result.orderNumber;
    expect(mc021OrderNumber).toBeTruthy();
  });

  test('MC-021 Step 2 - Full capture', async ({ page }) => {
    expect(mc021OrderNumber).toBeTruthy();

    await adminLogin(page);
    await navigateToOrder(page, mc021OrderNumber);
    await assertOrderStatus(page, 'On hold');

    // Full capture (no amount = full)
    await capturePayment(page, config);

    // After full capture, order should move to Processing or Completed
    const statusEl = page.locator('#select2-order_status-container');
    const status = await statusEl.textContent() || '';
    expect(['Processing', 'Completed'].some(s => status.includes(s))).toBeTruthy();
  });

  // === MC-022: Void payment ===

  let mc022OrderNumber: string;

  test('MC-022 Step 1 - Create order', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc022OrderNumber = result.orderNumber;
    expect(mc022OrderNumber).toBeTruthy();
  });

  test('MC-022 Step 2 - Void payment', async ({ page }) => {
    expect(mc022OrderNumber).toBeTruthy();

    await adminLogin(page);
    await navigateToOrder(page, mc022OrderNumber);
    await assertOrderStatus(page, 'On hold');

    await voidPayment(page, config);

    await assertOrderStatus(page, 'Cancelled');
    await assertCaptureFormVisible(page, config, false);
    await assertVoidFormVisible(page, config, false);
  });

  // === MC-061: Subscription with authorize mode ===

  let mc061OrderNumber: string;
  let mc061SubscriptionId: string;

  test('MC-061 - Subscription frictionless', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

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

    expect(mc061SubscriptionId).toBeTruthy();
    await adminLogin(page);
    await navigateToOrder(page, mc061OrderNumber);
    await assertOrderStatus(page, 'On hold');
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
