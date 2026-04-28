import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway } from '../../helpers/api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  getCheckoutError,
} from '../../helpers/checkout';
import {
  assertSessionFieldsPresent,
  fillHostedSessionCCPartial,
} from '../../helpers/hosted-session';
import { waitForUnblock } from '../../helpers/block-ui';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

test.describe.serial('Hosted Session - Session Loading & Validation (Classic)', () => {
  test.beforeAll(async () => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });
  });

  test('MC-001 - Session loading', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config);
    await assertSessionFieldsPresent(page, config);
  });

  test('MC-002 - Place order without CC info', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await clickPlaceOrder(page);
    await waitForUnblock(page);

    const error = await getCheckoutError(page);
    expect(error).toMatch(/Card number (is )?invalid or missing/);
    expect(error).toMatch(/Expiry month (is )?invalid or missing/);
    expect(error).toMatch(/Expiry year (is )?invalid or missing/);
  });

  test('MC-003 - Invalid card number', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCCPartial(page, config, {
      number: cards.invalidCC.number,
      month: cards.mastercard3.month,
      year: cards.mastercard3.year,
      cvv: cards.mastercard3.cvv,
    });
    await clickPlaceOrder(page);
    await waitForUnblock(page);

    const error = await getCheckoutError(page);
    expect(error).toMatch(/Card number (is )?invalid or missing/);
  });

  test('MC-003 - Missing CVC', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCCPartial(page, config, {
      number: cards.mastercard3.number,
      month: cards.mastercard3.month,
      year: cards.mastercard3.year,
    });
    await clickPlaceOrder(page);
    await waitForUnblock(page);

    const error = await getCheckoutError(page);
    expect(error).toMatch(/Security code (is )?invalid or missing/);
  });

  test('MC-003 - Missing expiry month', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCCPartial(page, config, {
      number: cards.mastercard3.number,
      year: cards.mastercard3.year,
      cvv: cards.mastercard3.cvv,
    });
    await clickPlaceOrder(page);
    await waitForUnblock(page);

    const error = await getCheckoutError(page);
    expect(error).toMatch(/Expiry month (is )?invalid or missing/);
  });

  test('MC-003 - Missing expiry year', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCCPartial(page, config, {
      number: cards.mastercard3.number,
      month: cards.mastercard3.month,
      cvv: cards.mastercard3.cvv,
    });
    await clickPlaceOrder(page);
    await waitForUnblock(page);

    const error = await getCheckoutError(page);
    expect(error).toMatch(/Expiry year (is )?invalid or missing/);
  });
});
