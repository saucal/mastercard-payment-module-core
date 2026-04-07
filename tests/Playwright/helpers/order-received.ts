import { Page, expect } from '@playwright/test';
import { waitForPageLoad } from './block-ui';

export interface OrderReceivedData {
  orderNumber: string;
  subscriptionId?: string;
}

export async function verifyOrderReceived(
  page: Page,
  options: { displayName: string; expectDeclined?: boolean }
): Promise<OrderReceivedData> {
  await waitForPageLoad(page);

  if (options.expectDeclined) {
    await expect(page.locator('.woocommerce-error')).toBeVisible();
    return { orderNumber: '' };
  }

  await expect(page.locator('h1.entry-title')).toContainText('Order received');
  const orderNumber = await page.locator('.order > strong').first().textContent() || '';
  await expect(page.locator('.method > strong')).toContainText(options.displayName);

  let subscriptionId: string | undefined;
  const subLink = page.locator('td.subscription-id > a');
  if (await subLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    subscriptionId = await subLink.textContent() || undefined;
  }

  return { orderNumber: orderNumber.trim(), subscriptionId };
}
