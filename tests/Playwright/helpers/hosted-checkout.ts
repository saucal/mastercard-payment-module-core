import { Page } from '@playwright/test';
import type { CardData, PluginConfig } from '../plugin-config.types';

export async function fillHostedCheckoutCC(page: Page, card: CardData, config: PluginConfig): Promise<void> {
  // Click "Credit or Debit card" option
  await page.locator('text=Credit or Debit card').first().click().catch(() => {
    return page.locator('.payment-option__credit-debit-text').first().click();
  });

  // Card fields are in nested iframes on the MPGS hosted checkout page
  const outerFrame = page.frameLocator(config.mpgsIframePattern);
  const innerFrame = outerFrame.frameLocator(config.mpgsIframePattern);

  await innerFrame.locator('#nameOnCard').fill('QA Test');
  await innerFrame.locator('#number').fill(card.number);
  await innerFrame.locator('#expiryMonth').fill(card.month);
  await innerFrame.locator('#expiryYear').fill(card.year);
  await innerFrame.locator('#securityCode').fill(card.cvv);
}

export async function clickHostedCheckoutPay(page: Page): Promise<void> {
  await page.locator('#label-transactional-currency').click().catch(() => {});
  await page.locator('#pay-label').click();
  await page.waitForSelector('.absolute', { timeout: 30000 }).catch(() => {});
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
