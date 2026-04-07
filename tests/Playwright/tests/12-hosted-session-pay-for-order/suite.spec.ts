import { test, expect } from '@playwright/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI } from '../../helpers/api';
import {
  selectPaymentMethod,
  clickPlaceOrder,
  clickSaveCardCheckbox,
  selectSavedToken,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { verifyOrderReceived } from '../../helpers/order-received';
import { verifyPaymentMethods } from '../../helpers/my-account';
import { frontendLogin, registerUser } from '../../helpers/wp-login';
import { waitForUnblock } from '../../helpers/block-ui';
import config from '../../plugin-config';
import { cards, fourDigits } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

const BASE_URL = process.env.WP_BASE_URL || 'https://mastercard-saucal.sa.ngrok.io';
const WOO_USER = process.env.WOO_USER || '';
const WOO_PASS = process.env.WOO_PASS || '';

async function createPendingOrder(productId: number): Promise<{ orderId: string; orderKey: string }> {
  const res = await fetch(`${BASE_URL}/wp-json/wc/v3/orders`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${WOO_USER}:${WOO_PASS}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      status: 'pending',
      line_items: [{ product_id: productId, quantity: 1 }],
    }),
  });
  if (!res.ok) throw new Error(`createPendingOrder failed: ${res.status}`);
  const order = await res.json();
  return { orderId: String(order.id), orderKey: order.order_key };
}

test.describe.serial('Hosted Session - Pay For Order', () => {
  const mc011Email = uniqueEmail();

  // === MC-011: Pay for order, not saving CC ===

  let mc011OrderNumber: string;

  test('MC-011 - Pay for order not saving CC', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });

    // Register user first
    await registerUser(page, mc011Email, billing.password);

    // Create a pending order via WC REST API
    const { orderId, orderKey } = await createPendingOrder(config.products.physical);

    // Navigate to pay-for-order page
    await page.goto(`/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`);
    await page.waitForLoadState('networkidle');

    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);

    // Do NOT click save card checkbox

    await clickPlaceOrder(page);
    await waitForUnblock(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc011OrderNumber = result.orderNumber;
    expect(mc011OrderNumber).toBeTruthy();
  });

  test('MC-011 - Pay for order not saving CC - Admin', async () => {
    expect(mc011OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc011OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();
  });

  // === MC-012: Pay for order, saving CC ===

  let mc012OrderNumber: string;

  test('MC-012 - Pay for order saving CC', async ({ page }) => {
    // Login as mc011 user
    await frontendLogin(page, mc011Email, billing.password);

    // Create a pending order via WC REST API
    const { orderId, orderKey } = await createPendingOrder(config.products.physical);

    // Navigate to pay-for-order page
    await page.goto(`/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`);
    await page.waitForLoadState('networkidle');

    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);
    await clickSaveCardCheckbox(page);

    await clickPlaceOrder(page);
    await waitForUnblock(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc012OrderNumber = result.orderNumber;
    expect(mc012OrderNumber).toBeTruthy();
  });

  test('MC-012 - Pay for order saving CC - Admin', async ({ page }) => {
    expect(mc012OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc012OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    await frontendLogin(page, mc011Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
    });
  });

  // === MC-013: Pay for order with saved CC ===

  let mc013OrderNumber: string;

  test('MC-013 - Pay for order with saved CC', async ({ page }) => {
    // Login as mc011 user (has 1 saved card from MC-012)
    await frontendLogin(page, mc011Email, billing.password);

    // Create a pending order via WC REST API
    const { orderId, orderKey } = await createPendingOrder(config.products.physical);

    // Navigate to pay-for-order page
    await page.goto(`/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`);
    await page.waitForLoadState('networkidle');

    await selectPaymentMethod(page, config);
    await selectSavedToken(page, 1);

    await clickPlaceOrder(page);
    await waitForUnblock(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc013OrderNumber = result.orderNumber;
    expect(mc013OrderNumber).toBeTruthy();
  });

  test('MC-013 - Pay for order with saved CC - Admin', async () => {
    expect(mc013OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc013OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();
  });
});
