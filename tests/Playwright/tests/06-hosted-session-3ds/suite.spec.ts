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
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

test.describe.serial('Hosted Session - 3DS', () => {
  // === MC-050: 3DS Visa with Challenge ===

  let mc050OrderNumber: string;

  test('MC-050 - 3DS Visa with Challenge', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      checkout_mode: 'hosted_session',
    });

    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaChallenge, config);

    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc050OrderNumber = result.orderNumber;
    expect(mc050OrderNumber).toBeTruthy();
  });

  test('MC-050 - Admin', async () => {
    expect(mc050OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc050OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();
  });

  // === MC-051: 3DS Visa Frictionless ===

  let mc051OrderNumber: string;

  test('MC-051 - 3DS Visa Frictionless', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc051OrderNumber = result.orderNumber;
    expect(mc051OrderNumber).toBeTruthy();
  });

  test('MC-051 - Admin', async () => {
    expect(mc051OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc051OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();
  });

  // === MC-052: 3DS Visa Frictionless Authentication Attempted ===

  let mc052OrderNumber: string;

  test('MC-052 - 3DS Visa Frictionless Authentication Attempted', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionlessAttempted, config);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc052OrderNumber = result.orderNumber;
    expect(mc052OrderNumber).toBeTruthy();
  });

  test('MC-052 - Admin', async () => {
    expect(mc052OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc052OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();
  });
});
