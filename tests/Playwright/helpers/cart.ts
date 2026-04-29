import { Page } from '@playwright/test';
import { waitForPageLoad } from './block-ui';

/**
 * Add a product to cart by ID via URL and navigate to checkout.
 * Returns the current ISO date string for session date tracking.
 */
export async function addToCartAndCheckout(page: Page, productId: number): Promise<string> {
  const baseUrl = process.env.WP_BASE_URL || 'https://mastercard-saucal.sa.ngrok.io';
  await page.goto(`${baseUrl}?add-to-cart=${productId}`);
  await waitForPageLoad(page);
  await page.locator('a[href*="checkout"]').first().click();
  await waitForPageLoad(page);
  const payDate = new Date().toISOString().slice(0, 19);
  return payDate;
}
