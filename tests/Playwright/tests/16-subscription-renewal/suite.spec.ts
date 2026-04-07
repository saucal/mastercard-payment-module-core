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
import { verifySubscription } from '../../helpers/my-account';
import { adminLogin } from '../../helpers/wp-login';
import {
  triggerSubscriptionRenewal,
  extractRenewalOrderNumber,
} from '../../helpers/admin-orders';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

test.describe.serial('Subscription Renewal', () => {
  // === MC-060: Subscription with Challenge (classic) ===

  let mc060OrderNumber: string;
  let mc060SubscriptionId: string;

  test('MC-060 - Subscription with challenge (classic)', async ({ page }) => {
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
    mc060OrderNumber = result.orderNumber;
    expect(mc060OrderNumber).toBeTruthy();
    expect(result.subscriptionId).toBeTruthy();
    mc060SubscriptionId = result.subscriptionId!;
  });

  test('MC-060 - Admin', async ({ page }) => {
    expect(mc060OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc060OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    expect(mc060SubscriptionId).toBeTruthy();
    await adminLogin(page);
    await verifySubscription(page, mc060SubscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  test('MC-060 - Renewal', async ({ page }) => {
    expect(mc060SubscriptionId).toBeTruthy();

    await adminLogin(page);
    await triggerSubscriptionRenewal(page, mc060SubscriptionId);

    const renewalOrderNumber = await extractRenewalOrderNumber(page);
    expect(renewalOrderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(renewalOrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();
  });

  // === MC-061: Subscription frictionless (classic) ===

  let mc061OrderNumber: string;
  let mc061SubscriptionId: string;

  test('MC-061 - Subscription frictionless (classic)', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc061OrderNumber = result.orderNumber;
    expect(mc061OrderNumber).toBeTruthy();
    expect(result.subscriptionId).toBeTruthy();
    mc061SubscriptionId = result.subscriptionId!;
  });

  test('MC-061 - Admin', async ({ page }) => {
    expect(mc061OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc061OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    expect(mc061SubscriptionId).toBeTruthy();
    await adminLogin(page);
    await verifySubscription(page, mc061SubscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  test('MC-061 - Renewal', async ({ page }) => {
    expect(mc061SubscriptionId).toBeTruthy();

    await adminLogin(page);
    await triggerSubscriptionRenewal(page, mc061SubscriptionId);

    const renewalOrderNumber = await extractRenewalOrderNumber(page);
    expect(renewalOrderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(renewalOrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();
  });

  // === MC-062: Subscription with Challenge (blocks) ===

  let mc062OrderNumber: string;
  let mc062SubscriptionId: string;

  test('MC-062 - Subscription with challenge (blocks)', async ({ page }) => {
    await switchCheckoutMode('blocks');

    await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaChallenge, config);

    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc062OrderNumber = result.orderNumber;
    expect(mc062OrderNumber).toBeTruthy();
    expect(result.subscriptionId).toBeTruthy();
    mc062SubscriptionId = result.subscriptionId!;
  });

  test('MC-062 - Admin', async ({ page }) => {
    expect(mc062OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc062OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    expect(mc062SubscriptionId).toBeTruthy();
    await adminLogin(page);
    await verifySubscription(page, mc062SubscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });

  // === MC-063: Subscription frictionless (blocks) ===

  let mc063OrderNumber: string;
  let mc063SubscriptionId: string;

  test('MC-063 - Subscription frictionless (blocks)', async ({ page }) => {
    await switchCheckoutMode('blocks');

    await addToCartAndCheckout(page, config.products.subscription);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc063OrderNumber = result.orderNumber;
    expect(mc063OrderNumber).toBeTruthy();
    expect(result.subscriptionId).toBeTruthy();
    mc063SubscriptionId = result.subscriptionId!;
  });

  test('MC-063 - Admin', async ({ page }) => {
    expect(mc063OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc063OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    expect(mc063SubscriptionId).toBeTruthy();
    await adminLogin(page);
    await verifySubscription(page, mc063SubscriptionId, {
      expectedStatus: 'Active',
      displayName: config.displayName,
    });
  });
});
