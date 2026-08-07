import { expect, Page } from '@playwright/test';

/** WooCommerce's loading overlays, classic (blockUI) and blocks (spinners). */
const BUSY_SELECTOR = [
  '.blockUI',
  '.wc-blocks-components-button--loading',
  '.wc-block-components-spinner',
  '.wc-block-components-checkout-place-order-button--loading',
].join(', ');

/** How long to give an overlay to appear before deciding none is coming. */
const APPEAR_TIMEOUT = 10_000;

/**
 * Wait for WooCommerce loading overlays (blockUI, block spinners) to disappear.
 *
 * Best-effort: if an overlay never clears within `timeout` this resolves anyway
 * rather than throwing, since callers use it as a soft settle point.
 */
export async function waitForUnblock(page: Page, timeout = 30_000): Promise<void> {
  const busy = page.locator(BUSY_SELECTOR);

  // An overlay may not have rendered yet when we get here, so give it a brief
  // window to show up. No overlay at all is a normal outcome — hence the short
  // timeout, and hence swallowing the failure.
  await expect(busy.first()).toBeAttached({ timeout: APPEAR_TIMEOUT }).catch(() => {});

  await expect(busy).toHaveCount(0, { timeout }).catch(() => {});
}

