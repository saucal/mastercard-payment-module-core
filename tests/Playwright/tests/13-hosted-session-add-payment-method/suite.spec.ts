import { test, expect } from '@playwright/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI, getOrderMeta } from '../../helpers/api';
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
import { adminLogin } from '../../helpers/wp-login';
import { waitForUnblock, waitForPageLoad } from '../../helpers/block-ui';
import {
  navigateToOrder,
  assertOrderStatus,
  assertPaymentMethodMeta,
  assertCapturedNote,
} from '../../helpers/admin-orders';
import {
  extractSessionGetLogs,
  extractTokenLogs,
  verifySessionGet,
  verifyTokenLog,
} from '../../helpers/log-verification';
import { verifyOrderEmails } from '../../helpers/email-verification';
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

  let mc050PayDate: string;
  let mc050Session: string;

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

    mc050PayDate = new Date().toISOString().slice(0, 10);
    await addPaymentMethod(page, cards.mastercard);

    // Click "Add payment method" button
    await page.locator('button#place_order, button[type="submit"]').first().click();
    await waitForUnblock(page);
    await page.waitForLoadState('networkidle');

    // Verify redirect success message
    await expect(page.locator('.woocommerce-message')).toContainText('Payment method successfully added.');

    // Verify card was saved
    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
      expiryMonth: cards.mastercard.month,
      expiryYear: cards.mastercard.year,
    });
  });

  test('MC-050 - Add Payment Method - Admin', async () => {
    // MC-050 is an add-payment-method flow (no order), verify token logs exist
    const tokenLogs = await extractTokenLogs(mc050PayDate, mc050PayDate);
    // Token log should be present (card was saved)
    expect(tokenLogs.logs[0]?.content?.length).toBeGreaterThan(0);
    const tokenLog = tokenLogs.logs[0].content[0];
    verifyTokenLog(tokenLog, { session: tokenLog.request.body.session?.id || '', card: cards.mastercard });
  });

  // === MC-051: Logged user pay with saved CC (from MC-050) ===

  let mc051OrderNumber: string;
  let mc051PayDate: string;
  let mc051Session: string;
  // Token saved during MC-050 (retrieved from token log)
  let mc050Token: string;

  test('MC-051 - Logged user pay with saved CC', async ({ page }) => {
    await frontendLogin(page, mc050Email, billing.password);
    await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config);
    await selectSavedToken(page, 1);

    mc051PayDate = new Date().toISOString().slice(0, 10);
    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName });
    mc051OrderNumber = result.orderNumber;
    expect(mc051OrderNumber).toBeTruthy();
  });

  test('MC-051 - Logged user pay with saved CC - Admin', async ({ page }) => {
    expect(mc051OrderNumber).toBeTruthy();
    const { order, transactionId } = await verifyOrderViaAPI(mc051OrderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    mc051Session = getOrderMeta(order, config.sessionIdMetaKey) || '';
    mc050Token = getOrderMeta(order, config.tokenMetaKey) || '';

    // Phase 3: Verify session GET has token (using saved CC)
    const sessionGetLogs = await extractSessionGetLogs(mc051PayDate, mc051Session, mc051PayDate);
    if (sessionGetLogs.logs[0]?.content?.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, {
        session: mc051Session,
        card: cards.mastercard,
        token: mc050Token,
      });
    }

    // Phase 11: Email verification
    await verifyOrderEmails(mc051OrderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend
    await adminLogin(page);
    await navigateToOrder(page, mc051OrderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId!);
    await assertCapturedNote(page, config, transactionId!);
  });

  // === MC-052: Add second payment method ===

  let mc052PayDate: string;

  test('MC-052 - Add second payment method', async ({ page }) => {
    await registerUser(page, mc052Email, billing.password);

    mc052PayDate = new Date().toISOString().slice(0, 10);

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

    // Verify redirect success message after second card
    await expect(page.locator('.woocommerce-message')).toContainText('Payment method successfully added.');

    // Verify 2 cards saved
    await verifyPaymentMethods(page, {
      expectedCards: 2,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
      expiryMonth: cards.mastercard.month,
      expiryYear: cards.mastercard.year,
    });
  });

  test('MC-052 - Add second payment method - Admin', async () => {
    // Token logs should contain 2 entries (one per card added)
    const tokenLogs = await extractTokenLogs(mc052PayDate, mc052PayDate);
    expect(tokenLogs.logs[0]?.content?.length).toBeGreaterThanOrEqual(2);
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

    // Verify deletion notice and card was removed
    await expect(page.locator('.woocommerce-message')).toContainText('Payment method deleted.');
    await verifyPaymentMethods(page, { expectedCards: 0 });
  });
});
