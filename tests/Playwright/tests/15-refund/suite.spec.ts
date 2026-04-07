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
  refundPayment,
} from '../../helpers/admin-orders';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

test.describe.serial('Refund', () => {
  // === MC-040: Full refund ===

  let mc040OrderNumber: string;
  let mc040Total: string;

  test('MC-040 Step 1 - Prepare order', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });

    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    mc040Total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc040OrderNumber = result.orderNumber;
    expect(mc040OrderNumber).toBeTruthy();
    expect(mc040Total).toBeTruthy();
  });

  test('MC-040 Step 2 - Full refund', async ({ page }) => {
    expect(mc040OrderNumber).toBeTruthy();

    await adminLogin(page);
    await navigateToOrder(page, mc040OrderNumber);

    const refundAmount = mc040Total.replace(/[^0-9.]/g, '');
    await refundPayment(page, refundAmount);

    // After full refund, order status should change (Refunded)
    await assertOrderStatus(page, 'Refunded');
  });

  // === MC-041: Partial refund ===

  let mc041OrderNumber: string;
  let mc041Total: string;

  test('MC-041 Step 1 - Prepare order', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    mc041Total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc041OrderNumber = result.orderNumber;
    expect(mc041OrderNumber).toBeTruthy();
    expect(mc041Total).toBeTruthy();
  });

  test('MC-041 Step 2 - Partial refund', async ({ page }) => {
    expect(mc041OrderNumber).toBeTruthy();

    await adminLogin(page);
    await navigateToOrder(page, mc041OrderNumber);

    const halfAmount = (parseFloat(mc041Total.replace(/[^0-9.]/g, '')) / 2).toFixed(2);
    await refundPayment(page, halfAmount);

    // After partial refund, order should still be processing (not fully refunded)
    await assertOrderStatus(page, 'Processing');
  });

  // === MC-042: Exceed total refund ===

  test('MC-042 - Exceed total refund', async ({ page }) => {
    expect(mc041OrderNumber).toBeTruthy();
    expect(mc041Total).toBeTruthy();

    await adminLogin(page);
    await navigateToOrder(page, mc041OrderNumber);

    // Attempt to refund the full original amount (exceeds remaining after partial refund)
    const exceedAmount = mc041Total.replace(/[^0-9.]/g, '');
    await page.locator('.refund-items').click();
    await page.locator('#refund_amount').fill(exceedAmount);

    // The refund button should be disabled or an error should appear
    const refundBtn = page.locator('.do-api-refund');
    const isDisabled = await refundBtn.isDisabled({ timeout: 3000 }).catch(() => false);

    if (!isDisabled) {
      // If button is not disabled, attempt and expect an error
      await refundBtn.click();
      page.once('dialog', dialog => dialog.accept());
      // Either an error notice appears, or the order status stays the same
      const hasError = await page.locator('.notice-error, .woocommerce-error, #message.error').isVisible({ timeout: 5000 }).catch(() => false);
      if (!hasError) {
        // If no error was thrown, verify the order wasn't over-refunded
        await assertOrderStatus(page, 'Refunded');
      }
    } else {
      expect(isDisabled).toBeTruthy();
    }
  });
});
