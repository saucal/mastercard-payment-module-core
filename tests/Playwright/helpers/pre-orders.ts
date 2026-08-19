/**
 * WooCommerce Pre-Orders primitives for suite 20.
 *
 * Covers the two things a spec cannot do with the generic helpers: proving the
 * product under test really is a pre-order, and firing the release that triggers
 * `PreOrders::process_pre_order_release_payment`.
 */

import { Page, expect } from '@playwright/test';
import { siteUrl } from './site';
import { ensureAdminSession } from './wp-login';
import type { PluginConfig } from '../plugin-config.types';
import { getProduct, getLoggedMail } from './wc-api';
import { showEmails } from './debug';

const preOrdersUrl = () => `${siteUrl()}/wp-admin/admin.php?page=wc_pre_orders`;

/**
 * The list row for one order.
 *
 * Matched on the bulk-action checkbox value rather than the visible text: the
 * cell reads "Order 4790", so a `has-text` match on the number alone would also
 * hit "Order 47901". The value is the order id, which is what the bulk action
 * posts anyway.
 */
function preOrderRow(page: Page, orderNumber: string) {
  return page.locator(`tr:has(input[name="order_id[]"][value="${orderNumber}"])`);
}

/**
 * Fail unless the product is a pre-order charged the expected way.
 *
 * Not paranoia: an ordinary product checks out fine through every step of this
 * suite, so without this guard a wrong or reconfigured id makes every
 * pre-order-specific assertion pass vacuously instead of failing. Both ids came
 * from a hand-edit on the staging site (discovery note, 2026-08-13) and nothing
 * else pins them.
 */
export async function assertPreOrderProduct(
  productId: number,
  whenToCharge: 'upfront' | 'upon_release',
): Promise<void> {
  expect(productId, 'pre-order product id must be configured').toBeGreaterThan(0);
  const product = await getProduct(productId);
  const meta = (key: string) =>
    product.meta_data?.find((m: { key: string }) => m.key === key)?.value;

  expect(meta('_wc_pre_orders_enabled'), `product ${productId} is not a pre-order`).toBe('yes');
  expect(
    meta('_wc_pre_orders_when_to_charge'),
    `product ${productId} does not charge ${whenToCharge}`,
  ).toBe(whenToCharge);
  // `?add-to-cart=<id>` needs a variation id for a variable product, so a
  // conversion back to variable would break cart entry, not the assertions.
  expect(product.type, `product ${productId} must stay simple`).toBe('simple');
}

/**
 * Fire the pre-order release, which is what triggers
 * `wc_pre_orders_process_pre_order_completion_payment_<gateway>` and therefore
 * the deferred capture in `PreOrders::process_pre_order_release_payment`.
 *
 * Uses the bulk action rather than the row's "Complete" link: the row actions
 * are `<a href=null>` driven by JS (discovery note), while the bulk control is
 * plain HTML posting the same `complete` action for the checked ids.
 */
export async function releasePreOrder(adminPage: Page, orderNumber: string): Promise<void> {
  await ensureAdminSession(adminPage);
  await adminPage.goto(preOrdersUrl());
  await adminPage.waitForLoadState('domcontentloaded');

  const row = preOrderRow(adminPage, orderNumber);
  await expect(row, `pre-order row for order ${orderNumber} not found`).toBeVisible({
    timeout: 30_000,
  });

  await row.locator('input[name="order_id[]"]').check();
  await adminPage.selectOption('#bulk-action-selector-top', 'complete');
  // Completing charges the card, so the screen may ask first.
  adminPage.once('dialog', (d) => d.accept());
  await adminPage.click('#doaction');
  await adminPage.waitForLoadState('load');
}

/** The pre-order's own status column, distinct from the WC order status. */
export async function assertPreOrderStatus(
  adminPage: Page,
  orderNumber: string,
  expected: string,
): Promise<void> {
  await expect(preOrderRow(adminPage, orderNumber).locator('td.column-status mark')).toContainText(
    expected,
    { timeout: 15_000 },
  );
}

/**
 * Assert the pre-order emails WooCommerce Pre-Orders sends in place of the
 * ordinary order emails.
 *
 * `verifyOrderEmails` deliberately does not cover these: the plugin replaces
 * both messages outright, so neither subject matches its "new order" /
 * "order has been received" patterns. Observed on order 6276 (2026-08-19):
 *
 *   admin    [Testing Site] New customer pre-order (6276) - August 19, 2026
 *   customer Your Testing Site pre-order confirmation from August 19, 2026
 *
 * Both carry the gateway's own "Payment method:" row, which is the thing the
 * generic assertion was there for.
 */
export async function assertPreOrderEmails(
  orderNumber: string,
  config: PluginConfig,
  page?: Page,
): Promise<void> {
  const mails = await getLoggedMail({ contains: orderNumber }, { minCount: 1 });
  if (page) await showEmails(page, mails);

  const admin = mails.find((m) => /pre-order/i.test(m.subject) && m.subject.includes(orderNumber));
  expect(
    admin,
    `admin pre-order email for ${orderNumber} not found. Seen: ${mails.map((m) => m.subject).join(' | ')}`,
  ).toBeTruthy();
  expect(admin!.message, 'admin pre-order email should name the gateway').toContain(
    config.displayName,
  );
}
