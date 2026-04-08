import { Page, FrameLocator, expect } from '@playwright/test';
import type { CardData, PluginConfig } from '../plugin-config.types';
import { waitForUnblock } from './block-ui';

/**
 * Find the MPGS iframe that contains a specific field.
 * MPGS hosted session renders one iframe per field (number, expiryMonth, expiryYear, securityCode).
 */
async function findFieldFrame(page: Page, config: PluginConfig, fieldId: string, timeout = 15000): Promise<FrameLocator> {
  const iframes = page.locator(config.mpgsIframePattern);
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const count = await iframes.count();
    for (let i = 0; i < count; i++) {
      const frame = iframes.nth(i).contentFrame();
      const found = await frame.locator(`#${fieldId}`).count().catch(() => 0);
      if (found > 0) return frame;
    }
    await page.waitForTimeout(500);
  }

  throw new Error(`Could not find #${fieldId} in any MPGS iframe within ${timeout}ms`);
}

export async function assertSessionFieldsPresent(page: Page, config: PluginConfig): Promise<void> {
  const numberFrame = await findFieldFrame(page, config, 'number');
  await expect(numberFrame.locator('#number')).toBeVisible({ timeout: 15000 });

  const monthFrame = await findFieldFrame(page, config, 'expiryMonth');
  await expect(monthFrame.locator('#expiryMonth')).toBeVisible();

  const yearFrame = await findFieldFrame(page, config, 'expiryYear');
  await expect(yearFrame.locator('#expiryYear')).toBeVisible();

  const cvcFrame = await findFieldFrame(page, config, 'securityCode');
  await expect(cvcFrame.locator('#securityCode')).toBeVisible();
}

/**
 * Fill credit card fields inside the MPGS hosted session iframes.
 *
 * MPGS iframes are cross-origin — Playwright's fill() sets input values but
 * doesn't trigger MPGS's internal event listeners. Instead, we click the iframe
 * element to focus it, then use page.keyboard.type() to send real keyboard
 * events that MPGS captures. Tab navigates between iframe fields.
 */
export async function fillHostedSessionCC(page: Page, card: CardData, config: PluginConfig): Promise<void> {
  await waitForUnblock(page);

  const iframes = page.locator(config.mpgsIframePattern);
  // Wait for iframes to load
  await iframes.first().waitFor({ state: 'attached', timeout: 15000 });
  const count = await iframes.count();
  if (count < 4) throw new Error(`Expected 4 MPGS iframes, found ${count}`);

  // Focus the first iframe (card number) and type
  await iframes.nth(0).click({ force: true });
  await page.waitForTimeout(300);
  await page.keyboard.type(card.number, { delay: 30 });
  await page.waitForTimeout(300);

  // Tab to expiry month and type
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  await page.keyboard.type(card.month, { delay: 30 });
  await page.waitForTimeout(300);

  // Tab to expiry year and type
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  await page.keyboard.type(card.year, { delay: 30 });
  await page.waitForTimeout(300);

  // Tab to security code and type
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  await page.keyboard.type(card.cvv, { delay: 30 });
  await page.waitForTimeout(300);

  // Tab out to trigger validation
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1000);
}

/**
 * Fill only specific CC fields (for partial-fill validation tests).
 * Pass undefined for fields to leave empty.
 */
export async function fillHostedSessionCCPartial(
  page: Page,
  config: PluginConfig,
  fields: { number?: string; month?: string; year?: string; cvv?: string }
): Promise<void> {
  await waitForUnblock(page);

  const iframes = page.locator(config.mpgsIframePattern);
  await iframes.first().waitFor({ state: 'attached', timeout: 15000 });

  // Focus first iframe
  await iframes.nth(0).click({ force: true });
  await page.waitForTimeout(300);

  // Card number
  if (fields.number !== undefined) {
    await page.keyboard.type(fields.number, { delay: 30 });
  }
  await page.waitForTimeout(300);

  // Tab to expiry month
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  if (fields.month !== undefined) {
    await page.keyboard.type(fields.month, { delay: 30 });
  }
  await page.waitForTimeout(300);

  // Tab to expiry year
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  if (fields.year !== undefined) {
    await page.keyboard.type(fields.year, { delay: 30 });
  }
  await page.waitForTimeout(300);

  // Tab to CVC
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  if (fields.cvv !== undefined) {
    await page.keyboard.type(fields.cvv, { delay: 30 });
  }
  await page.waitForTimeout(300);

  // Tab out
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
}
