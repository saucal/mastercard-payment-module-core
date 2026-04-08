import { test, expect } from '@playwright/test';
import { switchCheckoutMode, configureGateway, getFailedOrders } from '../../helpers/api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  getCheckoutError,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { waitForUnblock } from '../../helpers/block-ui';
import { adminLogin } from '../../helpers/wp-login';
import { navigateToOrder, assertOrderStatus, assertOrderNoteContains, assertPaymentMethodMeta } from '../../helpers/admin-orders';
import {
  extractAllLogs,
} from '../../helpers/log-verification';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

test.describe.serial('Hosted Session - Declined Transactions', () => {
  // === MC-014: Declined transaction ===

  let mc014FailedOrderId: string;
  let mc014PayDate: string;

  test('MC-014 - Declined transaction', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });

    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.declined, config);

    await clickPlaceOrder(page);
    await waitForUnblock(page);
    mc014PayDate = new Date().toISOString().slice(0, 10);
    const error = await getCheckoutError(page);
    expect(error).toContain('Do not honour');
  });

  test('MC-014 - Declined - Admin', async ({ page }) => {
    const failedOrders = await getFailedOrders();
    expect(failedOrders.length).toBeGreaterThan(0);
    const latestFailed = failedOrders[0];
    expect(latestFailed.status).toBe('failed');
    expect(latestFailed.payment_method).toBe(config.paymentMethodSlug);

    mc014FailedOrderId = String(latestFailed.id);

    // Phase 12: Admin backend — verify failed order status in UI
    await adminLogin(page);
    await navigateToOrder(page, mc014FailedOrderId);
    await assertOrderStatus(page, 'Failed');
    await assertPaymentMethodMeta(page, config);
    await assertOrderNoteContains(page, 'Error processing payment.');

    // Phase 2: Log verification for declined — PAY log should show failed/declined result
    if (mc014PayDate) {
      const allLogs = await extractAllLogs(mc014PayDate);
      const allContent = allLogs.logs[0]?.content ?? [];
      const payLog = allContent.find((e: any) => e.request?.body?.apiOperation === 'PAY');
      if (payLog) {
        // Declined orders result in a non-SUCCESS response
        const result = payLog.response?.body?.result;
        expect(['FAILURE', 'DECLINED', 'ERROR']).toContain(result);
      }
    }
  });

  // === MC-015: Expired CC ===

  let mc015FailedOrderId: string;
  let mc015PayDate: string;

  test('MC-015 - Expired CC', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.expired, config);

    await clickPlaceOrder(page);
    await waitForUnblock(page);
    mc015PayDate = new Date().toISOString().slice(0, 10);
    const error = await getCheckoutError(page);
    expect(error).toContain('Expired Card');
  });

  test('MC-015 - Expired CC - Admin', async ({ page }) => {
    const failedOrders = await getFailedOrders();
    expect(failedOrders.length).toBeGreaterThan(0);
    const latestFailed = failedOrders[0];
    expect(latestFailed.status).toBe('failed');
    expect(latestFailed.payment_method).toBe(config.paymentMethodSlug);

    mc015FailedOrderId = String(latestFailed.id);

    // Phase 12: Admin backend — verify failed order status in UI
    await adminLogin(page);
    await navigateToOrder(page, mc015FailedOrderId);
    await assertOrderStatus(page, 'Failed');
    await assertPaymentMethodMeta(page, config);
    await assertOrderNoteContains(page, 'Error processing payment.');

    // Phase 2: Log verification for expired card
    if (mc015PayDate) {
      const allLogs = await extractAllLogs(mc015PayDate);
      const allContent = allLogs.logs[0]?.content ?? [];
      const payLog = allContent.find((e: any) => e.request?.body?.apiOperation === 'PAY');
      if (payLog) {
        const result = payLog.response?.body?.result;
        expect(['FAILURE', 'DECLINED', 'ERROR']).toContain(result);
      }
    }
  });

  // === MC-016: Timed out ===

  const timedOutCard = {
    number: '5123456789012346',
    name: 'MasterCard',
    shortName: 'MASTERCARD',
    month: '05',
    year: '39',
    cvv: '100',
  };

  let mc016FailedOrderId: string;
  let mc016PayDate: string;

  test('MC-016 - Timed out', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, timedOutCard, config);

    await clickPlaceOrder(page);
    await waitForUnblock(page);
    mc016PayDate = new Date().toISOString().slice(0, 10);
    const error = await getCheckoutError(page);
    expect(error.length).toBeGreaterThan(0);
  });

  test('MC-016 - Timed out - Admin', async ({ page }) => {
    const failedOrders = await getFailedOrders();
    expect(failedOrders.length).toBeGreaterThan(0);
    const latestFailed = failedOrders[0];
    expect(latestFailed.status).toBe('failed');
    expect(latestFailed.payment_method).toBe(config.paymentMethodSlug);

    mc016FailedOrderId = String(latestFailed.id);

    // Phase 12: Admin backend — verify failed order status in UI
    await adminLogin(page);
    await navigateToOrder(page, mc016FailedOrderId);
    await assertOrderStatus(page, 'Failed');
    await assertPaymentMethodMeta(page, config);
    await assertOrderNoteContains(page, 'Error processing payment.');

    // Phase 2: Log verification for timed out — transaction log may or may not exist
    if (mc016PayDate) {
      const allLogs = await extractAllLogs(mc016PayDate);
      const allContent = allLogs.logs[0]?.content ?? [];
      const payLog = allContent.find((e: any) => e.request?.body?.apiOperation === 'PAY');
      if (payLog) {
        // Timed out may result in various error states
        const result = payLog.response?.body?.result;
        expect(['FAILURE', 'DECLINED', 'ERROR', 'PENDING']).toContain(result);
      }
      // It's valid for no PAY log to exist if the gateway timed out before sending the request
    }
  });
});
