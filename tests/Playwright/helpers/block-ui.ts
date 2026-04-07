import { Page } from '@playwright/test';

/**
 * Wait for WooCommerce loading overlays (blockUI, block spinners) to disappear.
 */
export async function waitForUnblock(page: Page, timeout = 30000): Promise<void> {
  const overlays = [
    '.blockUI',
    '.wc-block-components-spinner',
    '.wc-block-components-checkout-place-order-button--loading',
    '.wc-blocks-components-button--loading',
  ];
  for (const selector of overlays) {
    await page.waitForSelector(selector, { state: 'detached', timeout }).catch(() => {});
  }
}

/**
 * Wait for page to fully load (document.readyState === 'complete').
 */
export async function waitForPageLoad(page: Page): Promise<void> {
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 30000 });
}
