import { Page } from '@playwright/test';

export interface OrderReceivedData {
  orderNumber: string;
  subscriptionId?: string;
  declined: boolean;
}

/**
 * Read the order-received page's data without asserting anything. Pass the
 * result to assertions.assertOrderReceived(), which owns the checks — including
 * the subscription-id invariant, which is why the data is returned rather than
 * validated here.
 */
export async function collectOrderReceivedData(page: Page): Promise<OrderReceivedData> {
  await page.waitForLoadState('load');

  const declined = await page.locator('.woocommerce-error').isVisible().catch(() => false);
  if (declined) {
    return { orderNumber: '', declined: true };
  }

  // The previous single-function verifyOrderReceived() got its wait for free
  // from an auto-retrying expect() on the page title, which ran before this
  // read. Without that, reading the order number races the confirmation page's
  // render — so wait for the element explicitly.
  const orderLocator = page
    .locator('.order > strong, li:has-text("Order number") > strong')
    .first();
  await orderLocator.waitFor({ state: 'visible', timeout: 30000 });
  const orderNumber = (await orderLocator.textContent() || '').trim();

  let subscriptionId: string | undefined;
  const subLink = page.locator('td.subscription-id > a');
  if (await subLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    subscriptionId = (await subLink.textContent() || '').trim();
  }

  return { orderNumber, subscriptionId, declined: false };
}
