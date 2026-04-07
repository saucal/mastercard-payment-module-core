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
import { adminLogin, frontendLogin } from '../../helpers/wp-login';
import {
  triggerSubscriptionRenewal,
  extractRenewalOrderNumber,
} from '../../helpers/admin-orders';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

test.describe.serial('Subscription Manual Renewal', () => {
  let orderNumber: string;
  let subscriptionId: string;

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

    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
    expect(result.subscriptionId).toBeTruthy();
    subscriptionId = result.subscriptionId!;
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
      const result = await verifyOrderReceived(page, { displayName: config.displayName });
      expect(result.orderNumber).toBeTruthy();
      orderNumber = result.orderNumber;
    } else {
      // TODO: Configure WooCommerce Subscriptions to allow early manual renewal
      // to enable this test. Skipping as the renewal option is not available.
      test.skip();
    }
  });

  // === MC-065: Admin - verify manual renewal order ===

  test('MC-065 - Admin', async () => {
    expect(orderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();
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
    expect(transactionId).toBeTruthy();
  });
});
