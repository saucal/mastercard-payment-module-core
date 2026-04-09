import { Page, expect } from '@playwright/test';

export async function verifyPaymentMethods(
  page: Page,
  options: { expectedCards: number; cardName?: string; fourDigits?: string; expiryMonth?: string; expiryYear?: string }
): Promise<void> {
  await page.goto('/my-account/payment-methods/');

  if (options.expectedCards === 0) {
    await expect(page.getByText('No saved methods found')).toBeVisible();
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
    if (options.expiryMonth && options.expiryYear) {
      const expiryCell = page.locator(
        `tr:nth-of-type(${i}) > td.woocommerce-PaymentMethod.woocommerce-PaymentMethod--expires`
      );
      await expect(expiryCell).toContainText(`${options.expiryMonth}/${options.expiryYear}`);
    }
  }
}

export async function verifyOrderInMyAccount(
  page: Page,
  orderNumber: string,
  expectedStatus: string,
  options?: { expectedTotal?: string; displayName?: string }
): Promise<void> {
  await page.goto(`/my-account/view-order/${orderNumber}/`);
  await expect(page.locator('mark.order-status')).toContainText(expectedStatus);
  if (options?.expectedTotal) {
    // Find the Total row's value cell — works across themes
    const totalCell = page.locator('tr:has(th:has-text("Total"), td:has-text("Total:")) td').last();
    await expect(totalCell).toContainText(options.expectedTotal);
  }
  if (options?.displayName) {
    await expect(page.locator('section.woocommerce-order-details')).toContainText(options.displayName);
  }
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
  const cartUrl = process.env.CART_URL || '/cart/';
  await page.goto(cartUrl);
  await expect(page.locator('body')).toContainText('Your cart is currently empty', { timeout: 10000 });
}
