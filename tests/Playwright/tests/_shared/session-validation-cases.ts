import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway } from '../../helpers/wc-api';
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
import type { CheckoutMode } from '../../helpers/checkout';

/**
 * MC-001..MC-003 hosted-session field-validation cases.
 *
 * Suites 08 (classic) and 09 (blocks) were identical apart from the describe
 * title, the `switchCheckoutMode` argument, and one AUDIT comment — the mode is
 * already parameterized inside `clickPlaceOrder` / `getCheckoutError`, which
 * detect it from the page. This is the single copy, called once per mode; the
 * test ids and names are unchanged from both originals.
 *
 * Not a spec file: Playwright's default testMatch only collects `*.spec.ts`, so
 * nothing here runs until a suite calls it.
 */
export function describeSessionValidationCases(mode: CheckoutMode): void {
  test.beforeAll(async () => {
    await switchCheckoutMode(mode);
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
      // Pinned off: site-global, and an unanswered DCC offer blocks place-order
      // (see suite 01 for the full explanation). DCC's own coverage is suite 19.
      currency_conversion: 'no',
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

  // AUDIT 2026-04-29 vs GI: DRIFT — GI classic asserts "CVV invalid or
  // missing"; PW asserts "Security code (is )?invalid or missing". WC
  // tokenizer label may have changed across WC versions (blocks variant
  // also says "Security code"). Confirm against current MPGS tokenizer
  // output — if "Security code" is the live label, document and align
  // GI; if WC still emits "CVV" classic-side, restore the original assert.
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
}
