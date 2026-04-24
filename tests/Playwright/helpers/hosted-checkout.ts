import { Page, expect } from '@playwright/test';
import type { CardData, PluginConfig } from '../plugin-config.types';

/**
 * Click the classic Place Order button and wait for the MPGS hosted-checkout
 * iframe to appear. Unlike the generic clickPlaceOrder helper this does NOT
 * wait for order-received or a 3DS/ACS URL — for hosted-checkout the browser
 * either navigates to /checkout/order-pay/<id>/ (standard flow) or reloads
 * the same page (pay-for-order flow); in both cases the MPGS iframe appears.
 */
export async function clickPlaceOrderHostedCheckout(page: Page, config: PluginConfig): Promise<void> {
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
  await page.locator(config.mpgsIframePattern).first().waitFor({ state: 'visible', timeout: 60000 });
}

export async function fillHostedCheckoutCC(page: Page, card: CardData, config: PluginConfig): Promise<void> {
  // MPGS renders the hosted-checkout UI inside a top-level iframe; the CC
  // option selector + pay button live there. Each CC input field is in its
  // OWN nested iframe (name, number, expiry month/year, security code),
  // each identified by a distinct class on the iframe element.
  const hostedFrame = page.frameLocator(config.mpgsIframePattern);

  // Click "Credit or Debit card" option
  await hostedFrame.locator('.payment-option__credit-debit-text').first()
    .click()
    .catch(() => hostedFrame.locator('text=Credit or Debit card').first().click());

  // Each field iframe has a gw-proxy-<fieldName> class; inside it the input
  // element uses the field name as id.
  const fillField = async (fieldClass: string, inputId: string, value: string) => {
    await hostedFrame.frameLocator(`iframe.${fieldClass}`).locator(`#${inputId}`).fill(value);
  };

  await fillField('gw-proxy-nameOnCard',  'nameOnCard',   'QA Test');
  await fillField('gw-proxy-number',      'number',       card.number);
  await fillField('gw-proxy-expiryMonth', 'expiryMonth',  card.month);
  await fillField('gw-proxy-expiryYear',  'expiryYear',   card.year);
  await fillField('gw-proxy-securityCode','securityCode', card.cvv);
}

export async function clickHostedCheckoutPay(page: Page, config: PluginConfig): Promise<void> {
  const hostedFrame = page.frameLocator(config.mpgsIframePattern);
  await hostedFrame.locator('#label-transactional-currency').click().catch(() => {});
  await hostedFrame.locator('#pay-label').click();
  // After submission MPGS either: (a) redirects the top page to the 3DS
  // challenge, (b) redirects to the WC order-received page, (c) stays on
  // the hosted-checkout iframe with an error. Race the positive outcomes
  // and let the caller handle any 3DS challenge after.
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
