import { Page, expect } from '@playwright/test';

export async function verifyPaymentMethods(
  page: Page,
  options: { expectedCards: number; cardName?: string; fourDigits?: string }
): Promise<void> {
  await page.goto('/my-account/payment-methods/');

  if (options.expectedCards === 0) {
    await expect(page.locator('.woocommerce-info')).toContainText('No saved methods found');
    return;
  }

  for (let i = 1; i <= options.expectedCards; i++) {
    const row = page.locator(
      `tr:nth-of-type(${i}) > td.woocommerce-PaymentMethod.woocommerce-PaymentMethod--method`
    );
    await expect(row).toBeVisible();
    if (options.cardName && options.fourDigits) {
      await expect(row).toContainText(`${options.cardName} ending in ${options.fourDigits}`);
    }
  }
}

export async function verifyOrderInMyAccount(
  page: Page,
  orderNumber: string,
  expectedStatus: string
): Promise<void> {
  await page.goto(`/my-account/view-order/${orderNumber}/`);
  await expect(page.locator('mark.order-status')).toContainText(expectedStatus);
}

export async function verifySubscription(
  page: Page,
  subscriptionId: string,
  options: { expectedStatus: string; displayName: string }
): Promise<void> {
  await page.goto(`/my-account/view-subscription/${subscriptionId}/`);
  await expect(
    page.locator('table.shop_table.subscription_details > tbody > tr:nth-of-type(1) > td:nth-of-type(1)')
  ).toContainText(options.expectedStatus);
  await expect(page.locator('.subscription-payment-method')).toContainText(`Via ${options.displayName}`);
}

export async function deletePaymentMethod(page: Page, index: number): Promise<void> {
  await page.goto('/my-account/payment-methods/');
  await page.locator(
    `tr:nth-of-type(${index}) > td.woocommerce-PaymentMethod--actions > a.delete`
  ).click();
  await page.waitForLoadState('networkidle');
}

export async function verifyCartEmpty(page: Page): Promise<void> {
  await page.goto('/cart-2/');
  await expect(page.locator('body')).toContainText('Your cart is currently empty');
}
