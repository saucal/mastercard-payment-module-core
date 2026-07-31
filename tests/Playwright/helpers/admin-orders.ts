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

export async function capturePayment(page: Page, config: PluginConfig, amount?: string): Promise<void> {
  if (amount) {
    const input = page.locator(`#${config.paymentMethodSlug}_capture_amount, #acme_capture_amount`).first();
    // Match the locale's decimal separator (see refundPayment for context).
    const placeholder = await input.getAttribute('placeholder').catch(() => null);
    const sample = placeholder || await page
      .locator('.wc-order-totals tr:has(td:has-text("Order Total")) td')
      .first()
      .textContent()
      .catch(() => null);
    let decimalSep = '.';
    if (sample) {
      const m = sample.match(/(\d)([.,])(\d{2})\b/);
      if (m) decimalSep = m[2];
    }
    const localized = decimalSep === ',' ? amount.replace('.', ',') : amount;
    await input.fill(localized);
  }
  await page.locator('//button[contains(text(), "Capture")]').first().click();
  await expect(page.locator('#message > p')).toContainText('Order updated');
}

export async function voidPayment(page: Page, config: PluginConfig): Promise<void> {
  // The void button click dispatches a confirm() prompt
  // ("Are you sure that you want to cancel the Payment Authorization?") via
  // payment-core's admin JS. Register the handler BEFORE the click so the
  // dialog auto-accepts and the form submits.
  page.once('dialog', dialog => dialog.accept());

  const btn = page.locator(
    `#${config.paymentMethodSlug}_void_transaction_button, #acme_void_transaction_button`
  ).first();
  if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await btn.click();
  } else {
    await page.getByRole('button', { name: 'Cancel Authorization' }).first().click();
  }
  // The form submits and reloads the order page; the "Authorization was
  // cancelled" order note appears after reload.
  await expect(
    page.locator('li.note .note_content p, #order_note_list li .note_content p')
      .filter({ hasText: 'Authorization was cancelled' })
      .first(),
  ).toBeVisible({ timeout: 15000 });
}

export async function refundPayment(page: Page, amount: string): Promise<void> {
  await page.locator('.refund-items').click();
  // WC's refund_amount field is parsed via accounting.js using the store's
  // locale separators. Spanish-locale stores treat "." as a thousands sep,
  // so "10.00" is read as 1000. Read the decimal separator off the rendered
  // "Total available to refund" amount and rewrite the input accordingly.
  const availableText = await page
    .locator('.wc-order-totals tr:has(td:has-text("Total available")) td.total, .wc-order-totals tr:has-text("Total available to refund") td.total')
    .first()
    .textContent()
    .catch(() => null);
  let decimalSep = '.';
  if (availableText) {
    const match = availableText.match(/(\d)([.,])(\d{2})\b/);
    if (match) decimalSep = match[2];
  }
  const localized = decimalSep === ',' ? amount.replace('.', ',') : amount;
  await page.locator('#refund_amount').fill(localized);
  // Register the dialog handler BEFORE the click — clicking .do-api-refund
  // synchronously triggers the confirm() prompt; registering after the click
  // race-loses and the test hangs waiting for it to clear.
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.do-api-refund').click();
  // Refund returns via AJAX and reloads the order page; there is no
  // "Order updated" admin notice. Wait for the "Refund of ... processed"
  // order note to appear instead.
  await expect(
    page.locator('li.note .note_content p, #order_note_list li .note_content p')
      .filter({ hasText: 'Refund of' })
      .first(),
  ).toBeVisible({ timeout: 15000 });
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

