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

  // Order number — try multiple selectors for different WC themes
  const orderNumber = await page.locator('.order > strong, li:has-text("Order number") > strong').first().textContent() || '';

  // Payment method
  await expect(
    page.locator('.method > strong, li:has-text("Payment method") > strong')
  ).toContainText(options.displayName);

  if (options.expectedTotal) {
    // Try multiple selectors: tfoot total, order summary list, order details table
    const totalLocator = page.locator(
      'tfoot tr.order-total td span.woocommerce-Price-amount.amount > bdi, ' +
      'li:has-text("Total") > strong, ' +
      'tr:has(> th:has-text("Total"), > td.rowheader:has-text("Total")) td .woocommerce-Price-amount.amount'
    ).first();
    await expect(totalLocator).toContainText(options.expectedTotal);
  }

  let subscriptionId: string | undefined;
  const subLink = page.locator('td.subscription-id > a');
  if (await subLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    await expect(subLink).toBeVisible();
    subscriptionId = (await subLink.textContent() || '').trim();
    expect(subscriptionId, 'Subscription ID should not be empty').toBeTruthy();
  }

  return { orderNumber: orderNumber.trim(), subscriptionId };
}
