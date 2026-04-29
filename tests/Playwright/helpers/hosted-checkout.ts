import { Page, FrameLocator, expect } from '@playwright/test';
import type { CardData, PluginConfig } from '../plugin-config.types';

export type HostedCheckoutMode = 'embedded' | 'redirect';

/**
 * In embedded mode the merchant page hosts an MPGS iframe; in redirect mode
 * the browser navigates to the MPGS domain itself, so the MPGS UI is at the
 * page top level (no outer iframe), with each CC field still proxied via its
 * own per-field iframe (gw-proxy-*). Both Page and FrameLocator expose the
 * `locator()` and `frameLocator()` methods we need, so we resolve a single
 * "host" and use it uniformly.
 */
function getHostedHost(page: Page, config: PluginConfig, mode: HostedCheckoutMode): Page | FrameLocator {
  return mode === 'redirect' ? page : page.frameLocator(config.mpgsIframePattern);
}

/**
 * Click the classic Place Order button and wait for the MPGS hosted-checkout
 * UI to appear. In embedded mode the inner iframe shows up; in redirect mode
 * the browser navigates to test-gateway.mastercard.com.
 */
export async function clickPlaceOrderHostedCheckout(page: Page, config: PluginConfig, mode: HostedCheckoutMode = 'embedded'): Promise<void> {
  const btn = page.locator('#place_order, .wc-block-components-checkout-place-order-button').first();
  // The pay-for-order page can ship the Place Order button hidden (its
  // ancestor `#payment` section is display:none until a payment method is
  // chosen and the gateway confirms it is active). In that case click()
  // fails even with force:true, so fall back to submitting the parent form
  // directly via evaluate().
  try {
    await btn.click({ timeout: 3000 });
  } catch {
    await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('#place_order, button[type="submit"][name="woocommerce_pay"]');
      if (button) {
        button.click();
      } else {
        const form = document.querySelector<HTMLFormElement>('form#order_review, form.woocommerce-checkout');
        form?.submit();
      }
    });
  }
  if (mode === 'redirect') {
    await page.waitForURL(/test-gateway\.mastercard\.com/, { timeout: 60000 });
  } else {
    await page.locator(config.mpgsIframePattern).first().waitFor({ state: 'visible', timeout: 60000 });
  }
}

export async function fillHostedCheckoutCC(page: Page, card: CardData, config: PluginConfig, mode: HostedCheckoutMode = 'embedded'): Promise<void> {
  // Each CC field is in its own iframe (gw-proxy-<field>). In embedded mode
  // those iframes live inside the MPGS wrapper iframe; in redirect mode they
  // are direct children of the top-level page (which IS the MPGS page).
  const host = getHostedHost(page, config, mode);

  // Click "Credit or Debit card" option
  await host.locator('.payment-option__credit-debit-text').first()
    .click()
    .catch(() => host.locator('text=Credit or Debit card').first().click());

  const fillField = async (fieldClass: string, inputId: string, value: string) => {
    await host.frameLocator(`iframe.${fieldClass}`).locator(`#${inputId}`).fill(value);
  };

  await fillField('gw-proxy-nameOnCard',  'nameOnCard',   'QA Test');
  await fillField('gw-proxy-number',      'number',       card.number);
  await fillField('gw-proxy-expiryMonth', 'expiryMonth',  card.month);
  await fillField('gw-proxy-expiryYear',  'expiryYear',   card.year);
  await fillField('gw-proxy-securityCode','securityCode', card.cvv);
}

export async function clickHostedCheckoutPay(page: Page, config: PluginConfig, mode: HostedCheckoutMode = 'embedded'): Promise<void> {
  const host = getHostedHost(page, config, mode);
  await host.locator('#label-transactional-currency').click().catch(() => {});
  await host.locator('#pay-label').click();
  // After submission MPGS either: (a) redirects the top page to the 3DS
  // challenge, (b) redirects to the WC order-received page, (c) stays on
  // the hosted-checkout UI with an error. Race the positive outcomes and
  // let the caller handle any 3DS challenge after.
  await Promise.race([
    page.waitForURL(/order-received/, { timeout: 60000 }),
    page.waitForURL(/acs|3ds|threedsecure|mastercard\.com.*prompt/i, { timeout: 60000 }),
  ]).catch(() => {});
}

export async function extractHostedCheckoutSession(page: Page): Promise<string> {
  const selectors = [
    'app-root[data-session-id]',
    '#acme-hosted-checkout-container[data-session-id]',
    '#mastercard_merchant_cloud-hosted-checkout-container[data-session-id]',
  ];
  for (const sel of selectors) {
    const el = page.locator(sel);
    if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
      return await el.getAttribute('data-session-id') || '';
    }
  }
  return '';
}
