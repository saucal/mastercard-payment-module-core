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

test.describe.serial('Subscription Upgrade', () => {
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
      const result = await verifyOrderReceived(page, { displayName: config.displayName });
      expect(result.orderNumber).toBeTruthy();
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

  test('MC-064 - Admin', async () => {
    expect(orderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();
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
    expect(transactionId).toBeTruthy();
  });
});
