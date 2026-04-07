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
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

test.describe.serial('Hosted Session - Declined Transactions', () => {
  // === MC-014: Declined transaction ===

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
    const error = await getCheckoutError(page);
    expect(error).toContain('Do not honour');
  });

  test('MC-014 - Declined - Admin', async () => {
    const failedOrders = await getFailedOrders();
    expect(failedOrders.length).toBeGreaterThan(0);
    const latestFailed = failedOrders[0];
    expect(latestFailed.status).toBe('failed');
    expect(latestFailed.payment_method).toBe(config.paymentMethodSlug);
  });

  // === MC-015: Expired CC ===

  test('MC-015 - Expired CC', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.expired, config);

    await clickPlaceOrder(page);
    await waitForUnblock(page);
    const error = await getCheckoutError(page);
    expect(error).toContain('Expired Card');
  });

  test('MC-015 - Expired CC - Admin', async () => {
    const failedOrders = await getFailedOrders();
    expect(failedOrders.length).toBeGreaterThan(0);
    const latestFailed = failedOrders[0];
    expect(latestFailed.status).toBe('failed');
    expect(latestFailed.payment_method).toBe(config.paymentMethodSlug);
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

  test('MC-016 - Timed out', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, timedOutCard, config);

    await clickPlaceOrder(page);
    await waitForUnblock(page);
    const error = await getCheckoutError(page);
    expect(error.length).toBeGreaterThan(0);
  });

  test('MC-016 - Timed out - Admin', async () => {
    const failedOrders = await getFailedOrders();
    expect(failedOrders.length).toBeGreaterThan(0);
    const latestFailed = failedOrders[0];
    expect(latestFailed.status).toBe('failed');
    expect(latestFailed.payment_method).toBe(config.paymentMethodSlug);
  });
});
