import { Page } from '@playwright/test';
import type { PluginConfig } from '../plugin-config.types';
import { waitForUnblock } from './block-ui';

/**
 * Navigate to the Add Payment Method page and select the configured gateway.
 * If a saved token already exists for this user, click the "Use new payment
 * method" radio (matches GI MC-052 step 27 — without it, the .saveNew row
 * stays hidden by tokenization-form.js and the iframe never mounts).
 */
export async function selectGatewayOnAddPaymentMethod(page: Page, config: PluginConfig): Promise<void> {
  await page.goto('/my-account/add-payment-method/');
  await page.waitForLoadState('load');

  const allSlugs = [config.paymentMethodSlug, ...config.paymentMethodSlugsAlt];

  // Classic checkout/account pages hide the radio input (1x1 px) and render a
  // custom radio via the <li> + label CSS — the <li> intercepts pointer events.
  // Click the <label> (matches checkout.ts selectPaymentMethod behavior).
  for (const slug of allSlugs) {
    const label = page.locator(`label[for="payment_method_${slug}"]`);
    if (await label.isVisible({ timeout: 3000 }).catch(() => false)) {
      await label.click();
      break;
    }
  }

  for (const slug of allSlugs) {
    const newTokenLabel = page.locator(`label[for="wc-${slug}-payment-token-new"]`);
    if (await newTokenLabel.isVisible({ timeout: 1500 }).catch(() => false)) {
      await newTokenLabel.click();
      break;
    }
  }

  await waitForUnblock(page);
}

export async function deletePaymentMethod(page: Page, index: number): Promise<void> {
  await page.goto('/my-account/payment-methods/');
  await page.locator(
    `tr:nth-of-type(${index}) > td.woocommerce-PaymentMethod--actions > a.delete`
  ).click();
  await page.waitForLoadState('load');
}
