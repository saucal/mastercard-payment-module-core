import { Page, expect } from '@playwright/test';
import type { PluginConfig } from '../plugin-config.types';

export async function detectHPOS(page: Page): Promise<boolean> {
  return (await page.locator('a[href="admin.php?page=wc-orders"]').count()) > 0;
}

export async function navigateToOrder(page: Page, orderNumber: string): Promise<void> {
  const hpos = await detectHPOS(page);
  if (hpos) {
    await page.goto(`/wp-admin/admin.php?page=wc-orders&action=edit&id=${orderNumber}`);
  } else {
    await page.goto(`/wp-admin/post.php?post=${orderNumber}&action=edit`);
  }
}

export async function navigateToSubscription(page: Page, subscriptionId: string): Promise<void> {
  const hpos = await detectHPOS(page);
  if (hpos) {
    await page.goto(`/wp-admin/admin.php?page=wc-orders--shop_subscription&action=edit&id=${subscriptionId}`);
  } else {
    await page.goto(`/wp-admin/post.php?post=${subscriptionId}&action=edit`);
  }
}

export async function assertOrderStatus(page: Page, expectedStatus: string): Promise<void> {
  await expect(page.locator('#select2-order_status-container')).toContainText(expectedStatus);
}

export async function capturePayment(page: Page, config: PluginConfig, amount?: string): Promise<void> {
  if (amount) {
    const input = page.locator(`#${config.paymentMethodSlug}_capture_amount, #acme_capture_amount`);
    await input.first().fill(amount);
  }
  await page.locator('//button[contains(text(), "Capture")]').first().click();
  await expect(page.locator('#message > p')).toContainText('Order updated');
}

export async function voidPayment(page: Page, config: PluginConfig): Promise<void> {
  const btn = page.locator(
    `//button[contains(text(), "Cancel Authorization")], #${config.paymentMethodSlug}_void_transaction_button, #acme_void_transaction_button`
  );
  await btn.first().click();
  await expect(page.locator('#message > p')).toContainText('Order updated');
}

export async function refundPayment(page: Page, amount: string): Promise<void> {
  await page.locator('.refund-items').click();
  await page.locator('#refund_amount').fill(amount);
  await page.locator('.do-api-refund').click();
  // Handle confirmation dialog
  page.once('dialog', dialog => dialog.accept());
  await expect(page.locator('#message > p')).toContainText('Order updated');
}

export async function triggerSubscriptionRenewal(page: Page, subscriptionId: string): Promise<void> {
  await navigateToSubscription(page, subscriptionId);
  await page.locator('select[name="wc_order_action"]').selectOption('wcs_process_renewal');
  await page.locator('//button[contains(text(), "Update")], button[name="save"]').first().click();
  await expect(page.locator('#message > p')).toContainText('Subscription updated');
}

export async function extractRenewalOrderNumber(page: Page): Promise<string> {
  const link = page.locator('#subscription_renewal_orders > div.inside > div > table > tbody > tr:nth-child(1) > td:nth-child(1) > a');
  const href = await link.getAttribute('href') || '';
  const match = href.match(/(?:post=|id=)(\d+)/);
  return match ? match[1] : '';
}

export async function assertCaptureFormVisible(page: Page, config: PluginConfig, visible: boolean): Promise<void> {
  const form = page.locator(`.${config.paymentMethodSlug}-capture-form, .acme-capture-form, .mpgs-capture-form`);
  if (visible) {
    await expect(form.first()).toBeVisible();
  } else {
    await expect(form.first()).not.toBeVisible();
  }
}

export async function assertVoidFormVisible(page: Page, config: PluginConfig, visible: boolean): Promise<void> {
  const form = page.locator(`.${config.paymentMethodSlug}-void-form, .acme-void-form, .mpgs-void-form`);
  if (visible) {
    await expect(form.first()).toBeVisible();
  } else {
    await expect(form.first()).not.toBeVisible();
  }
}
