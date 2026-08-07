import { Page, expect } from '@playwright/test';
import type { PluginConfig, BillingData } from '../plugin-config.types';
import { waitForUnblock } from './block-ui';

export type CheckoutMode = 'classic' | 'blocks';

const classicSelectors = {
  firstName: '#billing_first_name',
  lastName: '#billing_last_name',
  company: '#billing_company',
  country: '#select2-billing_country-container',
  countrySearch: 'span > span:nth-of-type(1) > input[type="text"]',
  address1: '#billing_address_1',
  address2: '#billing_address_2',
  city: '#billing_city',
  state: '#select2-billing_state-container',
  stateSearch: 'span > span:nth-of-type(1) > input[type="text"]',
  postcode: '#billing_postcode',
  phone: '#billing_phone',
  email: '#billing_email',
  createAccount: '//span[contains(text(), "Create an account?")]',
  accountPassword: '#account_password',
  // PayPal Payments' advanced-card-processing button reuses id="place_order"
  // inside #ppcp-hosted-fields, so a bare '#place_order' matches two elements
  // and every strict-mode assertion on it fails. Exclude their variant by class
  // rather than taking .first(), which would silently depend on DOM order.
  placeOrder: '#place_order:not(.ppcp-dcc-order-button)',
  sessionId: '#mastercard_merchant_cloud_session_id, #acme_session_id',
  saveCard: 'label[for="wc-mastercard_merchant_cloud-new-payment-method"], label[for="wc-acme-new-payment-method"]',
  savedTokenNew: '#wc-mastercard_merchant_cloud-payment-token-new, #wc-acme-payment-token-new',
  savedTokenList: 'li.woocommerce-SavedPaymentMethods-token > label',
  errorMessage: '.woocommerce-error',
};

const blocksSelectors = {
  firstName: '#billing-first_name, #shipping-first_name',
  lastName: '#billing-last_name, #shipping-last_name',
  company: '#billing-company, #shipping-company',
  country: 'select#billing-country, select#shipping-country',
  countrySearch: null as string | null,
  address1: '#billing-address_1, #shipping-address_1',
  address2: '#billing-address_2, #shipping-address_2',
  city: '#billing-city, #shipping-city',
  state: 'select#billing-state, select#shipping-state',
  stateSearch: null as string | null,
  postcode: '#billing-postcode, #shipping-postcode',
  phone: '#billing-phone, #shipping-phone',
  email: '#email',
  createAccount: 'div.wc-block-components-checkbox.wc-block-checkout__create-account > label > span',
  accountPassword: 'div.wc-block-components-address-form__password > input',
  placeOrder: '.wc-block-components-checkout-place-order-button',
  sessionId: '#mastercard_merchant_cloud_session_id, #acme_session_id',
  saveCard: 'div.wc-block-components-payment-methods__save-card-info input',
  savedTokenNew: '#radio-control-wc-payment-method-options-mastercard_merchant_cloud, #radio-control-wc-payment-method-options-acme',
  savedTokenList: 'label > input[name="radio-control-wc-payment-method-saved-tokens"]',
  errorMessage: '.wc-block-components-notice-banner.is-error',
};

export async function detectCheckoutMode(page: Page): Promise<CheckoutMode> {
  // `count()` resolves immediately instead of waiting, so a call that lands
  // while the checkout is still navigating sees zero of all three markers and
  // throws even though the form renders a moment later. Wait for whichever
  // marker appears first, then run the checks below unchanged.
  await page
    .locator('form.woocommerce-checkout, .wp-block-woocommerce-checkout, form#order_review')
    .first()
    .waitFor({ state: 'attached', timeout: 30000 })
    .catch(() => {});
  if (await page.locator('form.woocommerce-checkout').count() > 0) return 'classic';
  if (await page.locator('.wp-block-woocommerce-checkout').count() > 0) return 'blocks';
  // The pay-for-order flow renders a minimal form with id="order_review"
  // instead of the full woocommerce-checkout form — treat it as classic
  // since the payment-method + place-order selectors are the same.
  if (await page.locator('form#order_review').count() > 0) return 'classic';
  // Say *where* we are: this fires whenever a navigation landed somewhere other
  // than a checkout — a 404, a login redirect, wp-admin — and the bare message
  // sends you looking for a selector bug instead.
  const title = await page.title().catch(() => '(unavailable)');
  const heading = await page.locator('h1').first().textContent().catch(() => null);
  throw new Error(
    'Could not detect checkout mode (neither classic nor blocks found)\n'
    + `  url:     ${page.url()}\n`
    + `  title:   ${title}\n`
    + `  h1:      ${heading?.trim() ?? '(none)'}`,
  );
}

export function getSelectors(mode: CheckoutMode) {
  return mode === 'classic' ? classicSelectors : blocksSelectors;
}

async function tryFill(page: Page, selector: string, value: string): Promise<void> {
  const el = page.locator(selector).first();
  if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
    await el.fill(value);
  }
}

export async function fillBilling(page: Page, billing: BillingData): Promise<void> {
  const mode = await detectCheckoutMode(page);
  const sel = getSelectors(mode);

  // Email first (blocks shows it at top)
  await tryFill(page, sel.email, billing.email);

  if (mode === 'classic') {
    // Skip the select2 dance if WC already pre-filled the country (logged
    // returning user). Re-clicking an already-selected option in select2
    // races the dropdown's internal close handler — the <li> is "stable"
    // per Playwright's actionability checks but the pointer event lands
    // as select2 detaches the option, so the action hangs to timeout.
    const currentCountry = await page.locator('#billing_country').inputValue().catch(() => '');
    if (currentCountry !== billing.shortCountry) {
      await page.locator(sel.country).click();
      await page.locator(sel.countrySearch!).fill(billing.country);
      await page.locator(`//li[contains(text(), "${billing.country}")]`).first().click();
    }
  } else {
    const countryEl = page.locator(sel.country).first();
    if (await countryEl.isVisible({ timeout: 3000 }).catch(() => false)) {
      await countryEl.selectOption({ label: billing.country });
      await page.waitForTimeout(500);
    }
  }

  await tryFill(page, sel.firstName, billing.firstName);
  await tryFill(page, sel.lastName, billing.lastName);
  await tryFill(page, sel.company, billing.company);
  await tryFill(page, sel.address1, billing.street);
  await tryFill(page, sel.address2, billing.address2);
  await tryFill(page, sel.city, billing.city);

  if (mode === 'classic') {
    const stateEl = page.locator(sel.state);
    if (await stateEl.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Same idempotency check as country (see comment above) — re-clicking
      // a select2 option that's already selected times out under sweep load.
      const currentState = await page.locator('#billing_state').inputValue().catch(() => '');
      if (currentState !== billing.shortState) {
        await stateEl.click();
        await page.locator(sel.stateSearch!).fill(billing.state);
        await page.locator(`//li[contains(text(), "${billing.state}")]`).first().click();
      }
    }
  } else {
    const stateEl = page.locator(sel.state).first();
    if (await stateEl.isVisible({ timeout: 2000 }).catch(() => false)) {
      await stateEl.selectOption({ label: billing.state });
    }
  }

  await tryFill(page, sel.postcode, billing.zipCode);
  await tryFill(page, sel.phone, billing.phone);
  await waitForUnblock(page);

}

/**
 * Force one final order-review recalculation and wait for it to land.
 *
 * The gateway stores its hosted-session config keyed by *cart hash*
 * (`maybe_update_hosted_session_config()` → `hosted_session_config_key($hash)`),
 * and the config includes the cart total. Filling billing changes shipping and
 * tax, so the cart hash moves after the session was created; unless an
 * `update_order_review` completes afterwards, nothing is stored under the new
 * hash. At submit the plugin then finds no matching config, issues one more
 * UPDATE_SESSION, bumps the MPGS session version past the version the browser
 * already posted, and `validate_payment_session_status()` rejects the payment as
 * "The Payment Session is invalid or has expired."
 *
 * Called at the end of `fillBilling` rather than just before submit on purpose:
 * the refresh re-renders the payment box, which would tear down the
 * hosted-session iframes and lose the card details.
 */
export async function refreshOrderReview(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).jQuery?.(document.body).trigger('update_checkout');
  });
  // Let the request start before waiting for quiescence, otherwise a check that
  // lands before jQuery registers it sees an already-idle page.
  await page
    .waitForFunction(() => ((window as any).jQuery?.active ?? 0) > 0, undefined, { timeout: 5000 })
    .catch(() => {});
  await waitForCheckoutSettled(page);
}

export async function createAccountAtCheckout(page: Page, password: string): Promise<void> {
  const mode = await detectCheckoutMode(page);
  const sel = getSelectors(mode);
  await page.locator(sel.createAccount).first().click();
  // Password field may not appear (WC can auto-generate passwords)
  const pwField = page.locator(sel.accountPassword).first();
  if (await pwField.isVisible({ timeout: 3000 }).catch(() => false)) {
    await pwField.fill(password);
  }
}

export async function selectPaymentMethod(page: Page, config: PluginConfig, useNewToken = false): Promise<void> {
  const mode = await detectCheckoutMode(page);
  const allSlugs = [config.paymentMethodSlug, ...config.paymentMethodSlugsAlt];

  for (const slug of allSlugs) {
    if (mode === 'classic') {
      // Classic checkout hides the radio input (1x1px, clipped) and renders
      // a custom radio via the label's CSS. Click the label instead.
      const label = page.locator(`label[for="payment_method_${slug}"]`);
      if (await label.isVisible({ timeout: 3000 }).catch(() => false)) {
        await label.click();
        await waitForUnblock(page);
        break;
      }
    } else {
      const blocksRadio = page.locator(`#radio-control-wc-payment-method-options-${slug}`);
      if (await blocksRadio.isVisible({ timeout: 3000 }).catch(() => false)) {
        await blocksRadio.click();
        await waitForUnblock(page);
        break;
      }
    }
  }

  if (useNewToken) {
    if (mode === 'classic') {
      // "Use a new payment method" radio — click via label
      for (const slug of allSlugs) {
        const label = page.locator(`label[for="wc-${slug}-payment-token-new"]`);
        if (await label.isVisible({ timeout: 3000 }).catch(() => false)) {
          await label.click();
          break;
        }
      }
    } else {
      const sel = getSelectors(mode);
      const newTokenRadio = page.locator(sel.savedTokenNew);
      if (await newTokenRadio.isVisible({ timeout: 3000 }).catch(() => false)) {
        await newTokenRadio.click();
      }
    }
  }

  await waitForUnblock(page);
}

export async function clickSaveCardCheckbox(page: Page): Promise<void> {
  const mode = await detectCheckoutMode(page);
  const sel = getSelectors(mode);
  await page.locator(sel.saveCard).first().click();
}

export async function selectSavedToken(page: Page, index: number): Promise<void> {
  const mode = await detectCheckoutMode(page);
  if (mode === 'classic') {
    await page.locator(`li:nth-of-type(${index}).woocommerce-SavedPaymentMethods-token > label`).click();
  } else {
    await page.locator(`label[for*='radio-control-wc-payment-method-saved-tokens']:nth-of-type(${index})`).click();
  }
  await waitForUnblock(page);
}

export async function extractOrderTotal(page: Page): Promise<string> {
  // Wait for WC to finish recalculating after billing changes
  await waitForUnblock(page);
  const mode = await detectCheckoutMode(page);
  if (mode === 'blocks') {
    return await page.locator('div.wc-block-components-totals-item__value > span').last().textContent() || '';
  }
  const total = await page.locator('tfoot tr.order-total:not(.recurring-total) td span.woocommerce-Price-amount.amount > bdi').first().textContent();
  return total || '';
}

export async function extractRecurringTotal(page: Page): Promise<string> {
  const mode = await detectCheckoutMode(page);
  if (mode === 'blocks') {
    return await page.locator('.wcs-recurring-totals-panel__title span.wc-block-components-totals-item__value').first().textContent() || '';
  }
  return await page.locator('tfoot > tr.order-total.recurring-total > td span.woocommerce-Price-amount.amount').first().textContent() || '';
}

export async function extractSessionId(page: Page): Promise<string> {
  const mode = await detectCheckoutMode(page);
  const sel = getSelectors(mode);
  return await page.locator(sel.sessionId).first().inputValue().catch(() => '');
}

/**
 * Wait until WooCommerce's checkout AJAX has settled.
 *
 * Filling billing fields faster than WooCommerce's `update_order_review`
 * debounce leaves overlapping requests, and the aborted one is often the
 * request whose response would have stored the gateway's session-config hash.
 * With a stale hash, `maybe_update_session()` sees a config difference at
 * submit and issues one more UPDATE_SESSION — bumping the MPGS session version
 * past the version the browser posted, so `validate_payment_session_status()`
 * rejects the payment as "The Payment Session is invalid or has expired."
 *
 * Confirmed by diffing a passing manual checkout (order 5884: no UPDATE_SESSION
 * between the browser's update and the validating GET) against a failing
 * automated one (UPDATE_SESSION landing in the same second as the GET).
 */
export async function waitForCheckoutSettled(page: Page): Promise<void> {
  expect(page.locator('.blockUI, .wc-blocks-components-button--loading, .wc-block-components-spinner, .wc-block-components-checkout-place-order-button--loading')).toBeVisible({ timeout: 30000 }).catch(() => {});
  expect(page.locator('.blockUI, .wc-blocks-components-button--loading, .wc-block-components-spinner, .wc-block-components-checkout-place-order-button--loading')).toHaveCount(0, { timeout: 30000 }).catch(() => {});
}

export async function clickPlaceOrder(page: Page): Promise<void> {
  const mode = await detectCheckoutMode(page);
  const sel = getSelectors(mode);
  const btn = page.locator(sel.placeOrder);
  await expect(btn).toBeVisible();
  await page.waitForFunction(
    (selector: string) => {
      const el = document.querySelector(selector);
      return el && !el.hasAttribute('disabled');
    },
    sel.placeOrder.split(',')[0].trim(),
    { timeout: 30000 }
  );
  await btn.scrollIntoViewIfNeeded();
  await btn.first().click();

  // Wait for either redirect to order-received, a checkout error, or 3DS redirect
  await Promise.race([
    page.waitForURL(/order-received/, { timeout: 60000 }),
    page.waitForURL(/acs|3ds|threedsecure|mastercard\.com.*prompt/i, { timeout: 60000 }),
    page.locator(sel.errorMessage).first().waitFor({ state: 'visible', timeout: 60000 }),
  ]);
}

export async function getCheckoutError(page: Page): Promise<string> {
  const mode = await detectCheckoutMode(page);
  const sel = getSelectors(mode);
  const texts = await page.locator(sel.errorMessage).allTextContents();
  return texts.join(' ');
}
