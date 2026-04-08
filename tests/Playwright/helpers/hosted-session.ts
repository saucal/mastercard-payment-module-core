import { Page, FrameLocator, expect } from '@playwright/test';
import type { CardData, PluginConfig } from '../plugin-config.types';
import { waitForUnblock } from './block-ui';

/**
 * Find the MPGS iframe that contains a specific field.
 * MPGS hosted session renders one iframe per field (number, expiryMonth, expiryYear, securityCode).
 * Each iframe's src contains the field role, but we walk all matching iframes and check
 * for the target element to handle any layout variation.
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

export async function fillHostedSessionCC(page: Page, card: CardData, config: PluginConfig): Promise<void> {
  await waitForUnblock(page);

  const numberFrame = await findFieldFrame(page, config, 'number');
  await numberFrame.locator('#number').click();
  await waitForUnblock(page);
  await numberFrame.locator('#number').fill(card.number);

  const monthFrame = await findFieldFrame(page, config, 'expiryMonth');
  await monthFrame.locator('#expiryMonth').click();
  await monthFrame.locator('#expiryMonth').fill(card.month);

  const yearFrame = await findFieldFrame(page, config, 'expiryYear');
  await yearFrame.locator('#expiryYear').click();
  await yearFrame.locator('#expiryYear').fill(card.year);

  const cvcFrame = await findFieldFrame(page, config, 'securityCode');
  await cvcFrame.locator('#securityCode').click();
  await cvcFrame.locator('#securityCode').fill(card.cvv);
  await cvcFrame.locator('#securityCode').press('Tab');
}

export async function fillHostedSessionCCPartial(
  page: Page,
  config: PluginConfig,
  fields: { number?: string; month?: string; year?: string; cvv?: string }
): Promise<void> {
  await waitForUnblock(page);

  if (fields.number !== undefined) {
    const frame = await findFieldFrame(page, config, 'number');
    await frame.locator('#number').click();
    await frame.locator('#number').fill(fields.number);
  }
  if (fields.month !== undefined) {
    const frame = await findFieldFrame(page, config, 'expiryMonth');
    await frame.locator('#expiryMonth').click();
    await frame.locator('#expiryMonth').fill(fields.month);
  }
  if (fields.year !== undefined) {
    const frame = await findFieldFrame(page, config, 'expiryYear');
    await frame.locator('#expiryYear').click();
    await frame.locator('#expiryYear').fill(fields.year);
  }
  if (fields.cvv !== undefined) {
    const frame = await findFieldFrame(page, config, 'securityCode');
    await frame.locator('#securityCode').click();
    await frame.locator('#securityCode').fill(fields.cvv);
    await frame.locator('#securityCode').press('Tab');
  }
}
