import { Page } from '@playwright/test';
import { waitForUnblock } from './block-ui';
import { siteUrl } from './site';

/**
 * Add a product to cart by ID via URL and navigate to checkout.
 * Returns the current ISO date string for session date tracking.
 */
export async function addToCartAndCheckout(page: Page, productId: number): Promise<string> {
  const baseUrl = siteUrl();
  await page.goto(`${baseUrl}?add-to-cart=${productId}`);
  await page.waitForLoadState('load');
  await page.locator('a[href*="checkout"]').first().click();
  await page.waitForLoadState('domcontentloaded');
  const payDate = new Date().toISOString().slice(0, 19);
  await waitForUnblock(page);

  return payDate;
}
