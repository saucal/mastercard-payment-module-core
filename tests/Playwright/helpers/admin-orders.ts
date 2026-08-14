import { Page, expect } from '@playwright/test';
import type { PluginConfig } from '../plugin-config.types';
import { ensureAdminSession } from './wp-login';

/**
 * HPOS vs legacy is decided by a link in the admin menu, so this only answers
 * correctly on a page that is already showing wp-admin — see
 * `ensureAdminSession()`.
 */
export async function detectHPOS(page: Page): Promise<boolean> {
  return (await page.locator('a[href="admin.php?page=wc-orders"]').count()) > 0;
}

export async function navigateToOrder(page: Page, orderNumber: string): Promise<void> {
  await ensureAdminSession(page);
  const hpos = await detectHPOS(page);
  if (hpos) {
    await page.goto(`/wp-admin/admin.php?page=wc-orders&action=edit&id=${orderNumber}`);
  } else {
    await page.goto(`/wp-admin/post.php?post=${orderNumber}&action=edit`);
  }
}

export async function navigateToSubscription(page: Page, subscriptionId: string): Promise<void> {
  await ensureAdminSession(page);
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

/**
 * Type a refund amount into the refund panel and return the total WooCommerce
 * computed from it.
 *
 * `#refund_amount` is readonly on current WooCommerce: the total is derived from
 * the per-line-item refund inputs, so filling it directly only spins until
 * Playwright times out on "element is not editable". Older installs allow it,
 * hence the branch.
 *
 * `verifyTotal` is for callers that expect the amount to be accepted verbatim.
 * A test deliberately entering more than the remaining refundable amount wants
 * whatever WooCommerce does with it, not an assertion failure here.
 */
export async function enterRefundAmount(
  page: Page,
  amount: string,
  opts: { verifyTotal?: boolean } = {},
): Promise<string> {
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

  const totalField = page.locator('#refund_amount');
  if (await totalField.isEditable().catch(() => false)) {
    await totalField.fill(localized);
    return (await totalField.inputValue()).trim();
  }

  const lineTotals = page.locator('input.refund_line_total');
  if (!(await lineTotals.count())) {
    throw new Error(
      'enterRefundAmount: #refund_amount is readonly and no input.refund_line_total '
      + 'fields were found — the refund UI markup is not what this helper expects.',
    );
  }

  // Put the whole amount on the first *visible* refundable line. WooCommerce
  // validates the order's remaining refundable total rather than each line, so a
  // single-line allocation works for full and partial refunds alike and keeps
  // the requested figure exact instead of reassembling it from quantities,
  // taxes and shipping.
  const target = lineTotals.filter({ visible: true }).first();
  await target.fill(localized);
  // WooCommerce recomputes #refund_amount from a delegated jQuery `change`
  // handler on these inputs. fill() dispatches one, but dispatch again
  // explicitly: if the handler was bound after our fill (the refund panel is
  // rendered when .refund-items is clicked) the first event is lost.
  await target.dispatchEvent('change');

  const shown = (await totalField.inputValue()).trim();

  if (shown === '' && opts.verifyTotal) {
    // Nothing was computed. Dump what the panel actually offers rather than
    // guessing which field WooCommerce wants — markup varies with taxes,
    // shipping lines and WooCommerce version.
    const inventory = await page.locator('#woocommerce-order-items input').evaluateAll((els) =>
      els
        .filter((el) => /refund/.test((el as HTMLInputElement).name || (el as HTMLInputElement).className))
        .map((el) => {
          const i = el as HTMLInputElement;
          return `${i.name || i.id || i.className}="${i.value}"`
            + `${i.readOnly ? ' [readonly]' : ''}${i.offsetParent === null ? ' [hidden]' : ''}`;
        }),
    );
    throw new Error(
      `enterRefundAmount: filled ${localized} into input.refund_line_total but #refund_amount stayed empty.\n`
      + `  refund inputs present: ${inventory.join(', ') || '(none)'}`,
    );
  }

  if (opts.verifyTotal) {
    // Confirm the computed total matches before the caller submits, otherwise
    // the gateway is asked to refund a different amount than intended.
    expect(
      shown.replace(',', '.'),
      `refund total did not pick up the line amount (wanted ${amount}, field shows "${shown}")`,
    ).toBe(amount.replace(',', '.'));
  }

  return shown;
}

export async function refundPayment(page: Page, amount: string): Promise<void> {
  await page.locator('.refund-items').click();
  await enterRefundAmount(page, amount, { verifyTotal: true });
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
  // Subscriptions guards this action with a native confirm():
  //
  //   $('#order').on('submit', function () {
  //     if ('wcs_process_renewal' == $('select[name=wc_order_action]').val())
  //       return confirm( wcs_admin_meta_boxes.process_renewal_action_warning );
  //   });
  //
  // Playwright auto-dismisses dialogs, so confirm() returned false and cancelled
  // the submit -- the click landed, the button took focus, and nothing was ever
  // POSTed. Accept it before clicking.
  page.once('dialog', (dialog) => dialog.accept());

  // CSS only. A selector string beginning with "//" is parsed as XPath in its
  // entirety, so the previous '//button[...], button[name="save"]' was not a
  // union of two engines -- it was one invalid XPath expression, and the click
  // threw SyntaxError every time. `save_order`/`save` cover HPOS, `#publish` the
  // classic post-edit screen.
  await page.locator('button[name="save"], button.save_order, #publish').first().click();
  await expect(page.locator('#message > p')).toContainText('Subscription updated');
}

export async function extractRenewalOrderNumber(page: Page): Promise<string> {
  const link = page.locator('#subscription_renewal_orders > div.inside > div > table > tbody > tr:nth-child(1) > td:nth-child(1) > a');
  const href = await link.getAttribute('href') || '';
  const match = href.match(/(?:post=|id=)(\d+)/);
  return match ? match[1] : '';
}

