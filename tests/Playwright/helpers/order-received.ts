import { Page, expect } from '@playwright/test';
import { waitForPageLoad } from './block-ui';

export interface OrderReceivedData {
  orderNumber: string;
  subscriptionId?: string;
}

export async function verifyOrderReceived(
  page: Page,
  options: { displayName: string; expectDeclined?: boolean; expectedTotal?: string }
): Promise<OrderReceivedData> {
  await waitForPageLoad(page);

  if (options.expectDeclined) {
    await expect(page.locator('.woocommerce-error')).toBeVisible();
    return { orderNumber: '' };
  }

  await expect(page.locator('h1.entry-title')).toContainText('Order received');
  const orderNumber = await page.locator('.order > strong').first().textContent() || '';
  await expect(page.locator('.method > strong')).toContainText(options.displayName);

  if (options.expectedTotal) {
    // Classic: tfoot tr.order-total td span.woocommerce-Price-amount.amount > bdi
    // Also try: tr:nth-of-type(5) > td > .woocommerce-Price-amount, tr:nth-of-type(4) > td > .woocommerce-Price-amount
    const totalLocator = page.locator('tfoot tr.order-total td span.woocommerce-Price-amount.amount > bdi, tr:nth-of-type(5) > td > .woocommerce-Price-amount.amount, tr:nth-of-type(4) > td > .woocommerce-Price-amount.amount').first();
    await expect(totalLocator).toContainText(options.expectedTotal);
  }

  let subscriptionId: string | undefined;
  const subLink = page.locator('td.subscription-id > a');
  if (await subLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    subscriptionId = await subLink.textContent() || undefined;
  }

  return { orderNumber: orderNumber.trim(), subscriptionId };
}
