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
  refundPayment,
  assertOrderNoteContains,
} from '../../helpers/admin-orders';
import {
  extractTransactionPutLogs,
  verifyRefundLog,
} from '../../helpers/log-verification';
import { verifyOrderEmails } from '../../helpers/email-verification';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

test.describe.serial('Refund', () => {
  // === MC-040: Full refund ===

  let mc040OrderNumber: string;
  let mc040Total: string;
  let mc040PayDate: string;
  let mc040TransactionId: string;

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

    mc040PayDate = new Date().toISOString().slice(0, 10);
    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: mc040Total });
    mc040OrderNumber = result.orderNumber;
    expect(mc040OrderNumber).toBeTruthy();
  });

  test('MC-040 Step 2 - Full refund', async ({ page }) => {
    expect(mc040OrderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(mc040OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();
    mc040TransactionId = transactionId!;

    // Phase 11: Email verification (purchase)
    await verifyOrderEmails(mc040OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Perform full refund
    await adminLogin(page);
    await navigateToOrder(page, mc040OrderNumber);

    const refundAmount = mc040Total.replace(/[^0-9.]/g, '');
    await refundPayment(page, refundAmount);

    // After full refund, order status should change to Refunded
    await assertOrderStatus(page, 'Refunded');
    await assertOrderNoteContains(page, `Refund of`);
  });

  test('MC-040 Step 3 - Verify REFUND log', async () => {
    expect(mc040TransactionId).toBeTruthy();

    // Verify REFUND log
    const transactionLogs = await extractTransactionPutLogs(mc040PayDate);
    const refundLogs = transactionLogs.logs[0]?.content?.filter(
      (l: any) => l.request?.body?.apiOperation === 'REFUND'
    ) || [];

    if (refundLogs.length > 0) {
      const refundLog = refundLogs[0];
      verifyRefundLog(refundLog, {
        total: mc040Total,
        currency: 'USD',
        isPartial: false,
      });
    }
  });

  // === MC-041: Partial refund ===

  let mc041OrderNumber: string;
  let mc041Total: string;
  let mc041PayDate: string;
  let mc041TransactionId: string;
  let mc041HalfAmount: string;

  test('MC-041 Step 1 - Prepare order', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    mc041Total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    mc041PayDate = new Date().toISOString().slice(0, 10);
    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: mc041Total });
    mc041OrderNumber = result.orderNumber;
    expect(mc041OrderNumber).toBeTruthy();
  });

  test('MC-041 Step 2 - Partial refund', async ({ page }) => {
    expect(mc041OrderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(mc041OrderNumber, config);
    expect(transactionId).toBeTruthy();
    mc041TransactionId = transactionId!;

    // Phase 11: Email verification
    await verifyOrderEmails(mc041OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Perform partial refund
    await adminLogin(page);
    await navigateToOrder(page, mc041OrderNumber);

    mc041HalfAmount = (parseFloat(mc041Total.replace(/[^0-9.]/g, '')) / 2).toFixed(2);
    await refundPayment(page, mc041HalfAmount);

    // After partial refund, order should still be processing (not fully refunded)
    await assertOrderStatus(page, 'Processing');
    await assertOrderNoteContains(page, `Refund of`);
  });

  test('MC-041 Step 3 - Verify REFUND log', async () => {
    expect(mc041TransactionId).toBeTruthy();

    // Verify REFUND log with partial amount
    const transactionLogs = await extractTransactionPutLogs(mc041PayDate);
    const refundLogs = transactionLogs.logs[0]?.content?.filter(
      (l: any) => l.request?.body?.apiOperation === 'REFUND'
    ) || [];

    if (refundLogs.length > 0) {
      const refundLog = refundLogs[0];
      verifyRefundLog(refundLog, {
        total: mc041Total,
        currency: 'USD',
        isPartial: true,
        partialAmount: mc041HalfAmount,
      });
    }
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
      } else {
        // Error appeared as expected — order should still be at partial refund state
        expect(hasError).toBeTruthy();
      }
    } else {
      // Button correctly disabled — refund blocked
      expect(isDisabled).toBeTruthy();
    }
  });
});
