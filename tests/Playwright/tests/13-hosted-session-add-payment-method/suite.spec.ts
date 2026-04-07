import { test, expect } from '@playwright/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI } from '../../helpers/api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  selectSavedToken,
} from '../../helpers/checkout';
import {
  fillHostedSessionCC,
  assertSessionFieldsPresent,
  fillHostedSessionCCPartial,
} from '../../helpers/hosted-session';
import { verifyOrderReceived } from '../../helpers/order-received';
import { verifyPaymentMethods, deletePaymentMethod } from '../../helpers/my-account';
import { frontendLogin, registerUser } from '../../helpers/wp-login';
import { waitForUnblock, waitForPageLoad } from '../../helpers/block-ui';
import config from '../../plugin-config';
import { cards, fourDigits } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

/**
 * Navigate to the Add Payment Method page, select the gateway, and fill CC details.
 */
async function addPaymentMethod(page: any, card: any): Promise<void> {
  await page.goto('/my-account/add-payment-method/');
  await page.waitForLoadState('networkidle');

  // Select the payment method radio
  const allSlugs = [config.paymentMethodSlug, ...config.paymentMethodSlugsAlt];
  for (const slug of allSlugs) {
    const radio = page.locator(`#payment_method_${slug}`);
    if (await radio.isVisible({ timeout: 3000 }).catch(() => false)) {
      await radio.click();
      break;
    }
  }

  await waitForUnblock(page);
  await fillHostedSessionCC(page, card, config);
}

test.describe.serial('Hosted Session - Add Payment Method', () => {
  const mc050Email = uniqueEmail();
  const mc052Email = uniqueEmail();

  // === MC-050: Add Payment Method ===

  test('MC-050 - Add Payment Method', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });

    // Register a new user
    await registerUser(page, mc050Email, billing.password);

    await addPaymentMethod(page, cards.mastercard);

    // Click "Add payment method" button
    await page.locator('button#place_order, button[type="submit"]').first().click();
    await waitForUnblock(page);
    await page.waitForLoadState('networkidle');

    // Verify card was saved
    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
    });
  });

  // === MC-051: Logged user pay with saved CC (from MC-050) ===

  let mc051OrderNumber: string;

  test('MC-051 - Logged user pay with saved CC', async ({ page }) => {
    await frontendLogin(page, mc050Email, billing.password);
    await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config);
    await selectSavedToken(page, 1);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc051OrderNumber = result.orderNumber;
    expect(mc051OrderNumber).toBeTruthy();
  });

  test('MC-051 - Logged user pay with saved CC - Admin', async () => {
    expect(mc051OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc051OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();
  });

  // === MC-052: Add second payment method ===

  test('MC-052 - Add second payment method', async ({ page }) => {
    await registerUser(page, mc052Email, billing.password);

    // Add first card
    await addPaymentMethod(page, cards.mastercard);
    await page.locator('button#place_order, button[type="submit"]').first().click();
    await waitForUnblock(page);
    await page.waitForLoadState('networkidle');

    // Add second card
    await addPaymentMethod(page, cards.mastercard);
    await page.locator('button#place_order, button[type="submit"]').first().click();
    await waitForUnblock(page);
    await page.waitForLoadState('networkidle');

    // Verify 2 cards saved
    await verifyPaymentMethods(page, {
      expectedCards: 2,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
    });
  });

  // === MC-053: Session loading ===

  test('MC-053 - Session loading', async ({ page }) => {
    await frontendLogin(page, mc050Email, billing.password);
    await page.goto('/my-account/add-payment-method/');
    await page.waitForLoadState('networkidle');

    const allSlugs = [config.paymentMethodSlug, ...config.paymentMethodSlugsAlt];
    for (const slug of allSlugs) {
      const radio = page.locator(`#payment_method_${slug}`);
      if (await radio.isVisible({ timeout: 3000 }).catch(() => false)) {
        await radio.click();
        break;
      }
    }

    await waitForUnblock(page);
    await assertSessionFieldsPresent(page, config);
  });

  // === MC-054: Not filling CC info ===

  test('MC-054 - Not filling CC info', async ({ page }) => {
    await frontendLogin(page, mc050Email, billing.password);
    await page.goto('/my-account/add-payment-method/');
    await page.waitForLoadState('networkidle');

    const allSlugs = [config.paymentMethodSlug, ...config.paymentMethodSlugsAlt];
    for (const slug of allSlugs) {
      const radio = page.locator(`#payment_method_${slug}`);
      if (await radio.isVisible({ timeout: 3000 }).catch(() => false)) {
        await radio.click();
        break;
      }
    }

    await waitForUnblock(page);

    // Click submit without filling CC info
    await page.locator('button#place_order, button[type="submit"]').first().click();
    await waitForUnblock(page);

    // Expect a validation error
    const error = page.locator('.woocommerce-error, .woocommerce-notices-wrapper .woocommerce-error, .wc-block-components-notice-banner.is-error');
    await expect(error.first()).toBeVisible({ timeout: 10000 });
  });

  // === MC-055: Invalid missing CC number ===

  test('MC-055 - Invalid missing CC number', async ({ page }) => {
    await frontendLogin(page, mc050Email, billing.password);
    await page.goto('/my-account/add-payment-method/');
    await page.waitForLoadState('networkidle');

    const allSlugs = [config.paymentMethodSlug, ...config.paymentMethodSlugsAlt];
    for (const slug of allSlugs) {
      const radio = page.locator(`#payment_method_${slug}`);
      if (await radio.isVisible({ timeout: 3000 }).catch(() => false)) {
        await radio.click();
        break;
      }
    }

    await waitForUnblock(page);

    // Fill all fields except card number
    await fillHostedSessionCCPartial(page, config, {
      month: cards.mastercard.month,
      year: cards.mastercard.year,
      cvv: cards.mastercard.cvv,
    });

    await page.locator('button#place_order, button[type="submit"]').first().click();
    await waitForUnblock(page);

    const error = page.locator('.woocommerce-error, .woocommerce-notices-wrapper .woocommerce-error, .wc-block-components-notice-banner.is-error');
    await expect(error.first()).toBeVisible({ timeout: 10000 });
  });

  // === MC-056: Invalid missing CVC ===

  test('MC-056 - Invalid missing CVC', async ({ page }) => {
    await frontendLogin(page, mc050Email, billing.password);
    await page.goto('/my-account/add-payment-method/');
    await page.waitForLoadState('networkidle');

    const allSlugs = [config.paymentMethodSlug, ...config.paymentMethodSlugsAlt];
    for (const slug of allSlugs) {
      const radio = page.locator(`#payment_method_${slug}`);
      if (await radio.isVisible({ timeout: 3000 }).catch(() => false)) {
        await radio.click();
        break;
      }
    }

    await waitForUnblock(page);

    // Fill all fields except CVV
    await fillHostedSessionCCPartial(page, config, {
      number: cards.mastercard.number,
      month: cards.mastercard.month,
      year: cards.mastercard.year,
    });

    await page.locator('button#place_order, button[type="submit"]').first().click();
    await waitForUnblock(page);

    const error = page.locator('.woocommerce-error, .woocommerce-notices-wrapper .woocommerce-error, .wc-block-components-notice-banner.is-error');
    await expect(error.first()).toBeVisible({ timeout: 10000 });
  });

  // === MC-057: Invalid missing expiry month ===

  test('MC-057 - Invalid missing expiry month', async ({ page }) => {
    await frontendLogin(page, mc050Email, billing.password);
    await page.goto('/my-account/add-payment-method/');
    await page.waitForLoadState('networkidle');

    const allSlugs = [config.paymentMethodSlug, ...config.paymentMethodSlugsAlt];
    for (const slug of allSlugs) {
      const radio = page.locator(`#payment_method_${slug}`);
      if (await radio.isVisible({ timeout: 3000 }).catch(() => false)) {
        await radio.click();
        break;
      }
    }

    await waitForUnblock(page);

    // Fill all fields except expiry month
    await fillHostedSessionCCPartial(page, config, {
      number: cards.mastercard.number,
      year: cards.mastercard.year,
      cvv: cards.mastercard.cvv,
    });

    await page.locator('button#place_order, button[type="submit"]').first().click();
    await waitForUnblock(page);

    const error = page.locator('.woocommerce-error, .woocommerce-notices-wrapper .woocommerce-error, .wc-block-components-notice-banner.is-error');
    await expect(error.first()).toBeVisible({ timeout: 10000 });
  });

  // === MC-058: Invalid missing expiry year ===

  test('MC-058 - Invalid missing expiry year', async ({ page }) => {
    await frontendLogin(page, mc050Email, billing.password);
    await page.goto('/my-account/add-payment-method/');
    await page.waitForLoadState('networkidle');

    const allSlugs = [config.paymentMethodSlug, ...config.paymentMethodSlugsAlt];
    for (const slug of allSlugs) {
      const radio = page.locator(`#payment_method_${slug}`);
      if (await radio.isVisible({ timeout: 3000 }).catch(() => false)) {
        await radio.click();
        break;
      }
    }

    await waitForUnblock(page);

    // Fill all fields except expiry year
    await fillHostedSessionCCPartial(page, config, {
      number: cards.mastercard.number,
      month: cards.mastercard.month,
      cvv: cards.mastercard.cvv,
    });

    await page.locator('button#place_order, button[type="submit"]').first().click();
    await waitForUnblock(page);

    const error = page.locator('.woocommerce-error, .woocommerce-notices-wrapper .woocommerce-error, .wc-block-components-notice-banner.is-error');
    await expect(error.first()).toBeVisible({ timeout: 10000 });
  });

  // === MC-059: Delete payment method ===

  test('MC-059 - Delete payment method', async ({ page }) => {
    await frontendLogin(page, mc050Email, billing.password);

    // Delete the first saved card
    await deletePaymentMethod(page, 1);

    // Verify card was removed
    await verifyPaymentMethods(page, { expectedCards: 0 });
  });
});
