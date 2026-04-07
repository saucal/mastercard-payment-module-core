import { test, expect } from '@playwright/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI } from '../../helpers/api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
} from '../../helpers/checkout';
import { fillHostedCheckoutCC, clickHostedCheckoutPay } from '../../helpers/hosted-checkout';
import { verifyOrderReceived } from '../../helpers/order-received';
import { handle3DSChallenge } from '../../helpers/three-ds';
import { frontendLogin } from '../../helpers/wp-login';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
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

test.describe.serial('Hosted Checkout - Redirect - Authorize', () => {
  let orderNumber: string;
  const mc005Email = uniqueEmail();
  const mc008Email = uniqueEmail();

  // === MC-004: Guest checkout ===

  test('MC-004 - Guest checkout', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      transaction_mode: 'AUTHORIZE',
      checkout_mode: 'hosted_checkout',
      hosted_checkout_mode: 'redirect',
    });

    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await clickPlaceOrder(page);

    // Now redirected to hosted checkout MPGS page — fill CC and pay
    await fillHostedCheckoutCC(page, cards.mastercard, config);
    await clickHostedCheckoutPay(page);

    // Handle 3DS if challenged
    if (cards.mastercard.challenge) {
      await handle3DSChallenge(page);
    }

    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-004 - Guest checkout - Admin', async () => {
    expect(orderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(order.status).toBe('on-hold');
    expect(transactionId).toBeTruthy();
  });

  // === MC-005: New user ===

  test('MC-005 - New user', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.digital);
    await fillBilling(page, { ...billing, email: mc005Email });

    // Create account at checkout
    const createAccountLink = page.locator('//span[contains(text(), "Create an account?")]');
    if (await createAccountLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await createAccountLink.click();
      await page.locator('#account_password').fill(billing.password);
    }

    await selectPaymentMethod(page, config);
    await clickPlaceOrder(page);

    await fillHostedCheckoutCC(page, cards.mastercard, config);
    await clickHostedCheckoutPay(page);

    if (cards.mastercard.challenge) {
      await handle3DSChallenge(page);
    }

    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-005 - New user - Admin', async () => {
    expect(orderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.status).toBe('on-hold');
    expect(transactionId).toBeTruthy();
  });

  // === MC-008: Logged user ===

  test('MC-008 - Logged user', async ({ page }) => {
    await frontendLogin(page, mc008Email, billing.password).catch(async () => {
      // User may not exist yet — register first
      await page.goto('/my-account');
      await page.locator('#reg_email').fill(mc008Email);
      await page.locator('#reg_password').fill(billing.password);
      await page.locator('button[name="register"]').first().click();
    });

    await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config);
    await clickPlaceOrder(page);

    await fillHostedCheckoutCC(page, cards.mastercard, config);
    await clickHostedCheckoutPay(page);

    if (cards.mastercard.challenge) {
      await handle3DSChallenge(page);
    }

    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-008 - Logged user - Admin', async () => {
    expect(orderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.status).toBe('on-hold');
    expect(transactionId).toBeTruthy();
  });

  // === MC-011: Pay for order ===

  test('MC-011 - Pay for order', async ({ page }) => {
    const { orderId, orderKey } = await createPendingOrder(config.products.physical);

    await page.goto(`/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`);
    await page.waitForLoadState('networkidle');

    await selectPaymentMethod(page, config);
    await clickPlaceOrder(page);

    await fillHostedCheckoutCC(page, cards.mastercard, config);
    await clickHostedCheckoutPay(page);

    if (cards.mastercard.challenge) {
      await handle3DSChallenge(page);
    }

    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-011 - Pay for order - Admin', async () => {
    expect(orderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(order.status).toBe('on-hold');
    expect(transactionId).toBeTruthy();
  });
});
