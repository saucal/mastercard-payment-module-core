import { test, expect } from '@playwright/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI } from '../../helpers/api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  extractOrderTotal,
  createAccountAtCheckout,
  clickSaveCardCheckbox,
  selectSavedToken,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { verifyOrderReceived } from '../../helpers/order-received';
import { verifyPaymentMethods } from '../../helpers/my-account';
import { frontendLogin } from '../../helpers/wp-login';
import config from '../../plugin-config';
import { cards, fourDigits } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

test.describe.serial('Hosted Session - Capture - Blocks', () => {
  let orderNumber: string;
  const mc005Email = uniqueEmail();

  // === MC-004: Guest checkout ===

  test('MC-004 - Guest checkout', async ({ page }) => {
    await switchCheckoutMode('blocks');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });

    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);

    // Guest should NOT see save card checkbox
    await expect(page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`)).not.toBeVisible();

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-004 - Guest checkout - Admin', async () => {
    expect(orderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();
  });

  // === MC-005: New user, NOT saving CC ===

  test('MC-005 - New user not saving CC', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.digital);
    await fillBilling(page, { ...billing, email: mc005Email });
    await createAccountAtCheckout(page, billing.password);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-005 - New user not saving CC - Admin', async ({ page }) => {
    expect(orderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    await frontendLogin(page, mc005Email, billing.password);
    await verifyPaymentMethods(page, { expectedCards: 0 });
  });

  // === MC-008: Logged user, pay with new CC (not saving) ===

  test('MC-008 - Logged user pay with new CC', async ({ page }) => {
    await frontendLogin(page, mc005Email, billing.password);
    await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config, true); // useNewToken = true
    await fillHostedSessionCC(page, cards.mastercard, config);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-008 - Logged user pay with new CC - Admin', async () => {
    expect(orderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();
  });

  // === MC-009: Logged user, pay with new CC and save it ===

  test('MC-009 - Logged user pay with new CC and save it', async ({ page }) => {
    await frontendLogin(page, mc005Email, billing.password);
    await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config, true); // useNewToken = true
    await fillHostedSessionCC(page, cards.mastercard, config);
    await clickSaveCardCheckbox(page);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-009 - Logged user pay with new CC and save it - Admin', async ({ page }) => {
    expect(orderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    await frontendLogin(page, mc005Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
    });
  });

  // === MC-010: Logged user, pay with saved CC (from MC-009) ===

  test('MC-010 - Logged user pay with saved CC', async ({ page }) => {
    await frontendLogin(page, mc005Email, billing.password);
    await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config);
    await selectSavedToken(page, 1);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-010 - Logged user pay with saved CC - Admin', async () => {
    expect(orderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();
  });
});
