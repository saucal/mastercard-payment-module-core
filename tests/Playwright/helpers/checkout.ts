import { Page, expect } from '@playwright/test';
import type { PluginConfig, BillingData } from '../plugin-config.types';
import { waitForUnblock, waitForPageLoad } from './block-ui';

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
  placeOrder: '#place_order',
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
  if (await page.locator('form.woocommerce-checkout').count() > 0) return 'classic';
  if (await page.locator('.wp-block-woocommerce-checkout').count() > 0) return 'blocks';
  throw new Error('Could not detect checkout mode (neither classic nor blocks found)');
}

export function getSelectors(mode: CheckoutMode) {
  return mode === 'classic' ? classicSelectors : blocksSelectors;
}

export async function fillBilling(page: Page, billing: BillingData): Promise<void> {
  const mode = await detectCheckoutMode(page);
  const sel = getSelectors(mode);

  await page.locator(sel.firstName).first().fill(billing.firstName);
  await page.locator(sel.lastName).first().fill(billing.lastName);
  await page.locator(sel.company).first().fill(billing.company);

  if (mode === 'classic') {
    await page.locator(sel.country).click();
    await page.locator(sel.countrySearch!).fill(billing.country);
    await page.locator(`//li[contains(text(), "${billing.country}")]`).first().click();
  } else {
    await page.locator(sel.country).first().selectOption({ label: billing.country });
  }

  await page.locator(sel.address1).first().fill(billing.street);
  await page.locator(sel.address2).first().fill(billing.address2);
  await page.locator(sel.city).first().fill(billing.city);

  if (mode === 'classic') {
    await page.locator(sel.state).click();
    await page.locator(sel.stateSearch!).fill(billing.state);
    await page.locator(`//li[contains(text(), "${billing.state}")]`).first().click();
  } else {
    await page.locator(sel.state).first().selectOption({ label: billing.state });
  }

  await page.locator(sel.postcode).first().fill(billing.zipCode);
  await page.locator(sel.phone).first().fill(billing.phone);
  await page.locator(sel.email).first().fill(billing.email);
}

export async function createAccountAtCheckout(page: Page, password: string): Promise<void> {
  const mode = await detectCheckoutMode(page);
  const sel = getSelectors(mode);
  await page.locator(sel.createAccount).first().click();
  await page.locator(sel.accountPassword).first().fill(password);
}

export async function selectPaymentMethod(page: Page, config: PluginConfig, useNewToken = false): Promise<void> {
  await waitForUnblock(page);
  const mode = await detectCheckoutMode(page);
  const allSlugs = [config.paymentMethodSlug, ...config.paymentMethodSlugsAlt];

  for (const slug of allSlugs) {
    if (mode === 'classic') {
      // Classic checkout hides the radio input (1x1px, clipped) and renders
      // a custom radio via the label's CSS. Click the label instead.
      const label = page.locator(`label[for="payment_method_${slug}"]`);
      if (await label.isVisible({ timeout: 3000 }).catch(() => false)) {
        await label.click();
        break;
      }
    } else {
      const blocksRadio = page.locator(`#radio-control-wc-payment-method-options-${slug}`);
      if (await blocksRadio.isVisible({ timeout: 3000 }).catch(() => false)) {
        await blocksRadio.click();
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
  await btn.first().click();
}

export async function getCheckoutError(page: Page): Promise<string> {
  const mode = await detectCheckoutMode(page);
  const sel = getSelectors(mode);
  return await page.locator(sel.errorMessage).first().textContent() || '';
}
